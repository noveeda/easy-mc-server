import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LoopbackFailureReasons,
  createClientLoopbackPlan,
  redactLoopbackDiagnostics
} from "../src/connection/loopback-plan.mjs";

test("client loopback plan connects Minecraft to localhost and relay to the approved room", () => {
  const plan = createClientLoopbackPlan({
    roomId: "room-a",
    minecraftUuid: "uuid-a",
    relayUrl: "wss://relay.example.test/rooms/room-a",
    inviteToken: "invite-secret",
    sessionToken: "session-secret",
    sessionId: "session-a",
    localPort: 25565
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.connection, {
    minecraftServerAddress: "127.0.0.1:25565",
    localProxy: {
      host: "127.0.0.1",
      port: 25565
    },
    relay: {
      url: "wss://relay.example.test/rooms/room-a",
      roomId: "room-a",
      sessionId: "session-a",
      minecraftUuid: "uuid-a"
    }
  });
});

test("loopback diagnostics redact invite and session tokens", () => {
  const plan = createClientLoopbackPlan({
    roomId: "room-a",
    minecraftUuid: "uuid-a",
    relayUrl: "wss://relay.example.test/rooms/room-a?session=session-secret",
    inviteUrl: "https://join.example.test/invite/invite-secret",
    inviteToken: "invite-secret",
    sessionToken: "session-secret",
    relayToken: "relay-secret",
    sessionId: "session-a",
    localPort: 25565
  });

  const serialized = JSON.stringify(plan.diagnostics);

  assert.equal(serialized.includes("invite-secret"), false);
  assert.equal(serialized.includes("session-secret"), false);
  assert.equal(serialized.includes("relay-secret"), false);
  assert.match(serialized, /\[redacted:invite_token\]/);
  assert.match(serialized, /\[redacted:session_token\]/);
  assert.match(serialized, /\[redacted:relay_token\]/);
});

test("standalone diagnostic redaction removes token-shaped values from nested data", () => {
  const redacted = redactLoopbackDiagnostics(
    {
      inviteUrl: "https://join.example.test/invite/invite-secret",
      headers: {
        authorization: "Bearer session-secret"
      },
      events: ["using relay-secret for local proxy"]
    },
    {
      inviteToken: "invite-secret",
      sessionToken: "session-secret",
      relayToken: "relay-secret"
    }
  );

  assert.deepEqual(redacted, {
    inviteUrl: "https://join.example.test/invite/[redacted:invite_token]",
    headers: {
      authorization: "Bearer [redacted:session_token]"
    },
    events: ["using [redacted:relay_token] for local proxy"]
  });
});

test("loopback plan fails closed without approved session material", () => {
  assert.deepEqual(
    createClientLoopbackPlan({
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      relayUrl: "wss://relay.example.test/rooms/room-a",
      inviteToken: "invite-secret",
      localPort: 25565
    }),
    {
      ok: false,
      reason: LoopbackFailureReasons.SESSION_MISSING
    }
  );
});

test("loopback plan fails closed without room identity or relay URL", () => {
  assert.deepEqual(
    createClientLoopbackPlan({
      minecraftUuid: "uuid-a",
      relayUrl: "wss://relay.example.test/rooms/room-a",
      sessionToken: "session-secret",
      sessionId: "session-a"
    }),
    {
      ok: false,
      reason: LoopbackFailureReasons.ROOM_MISSING
    }
  );

  assert.deepEqual(
    createClientLoopbackPlan({
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      sessionToken: "session-secret",
      sessionId: "session-a"
    }),
    {
      ok: false,
      reason: LoopbackFailureReasons.RELAY_URL_MISSING
    }
  );
});
