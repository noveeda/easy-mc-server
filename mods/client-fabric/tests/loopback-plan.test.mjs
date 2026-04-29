import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LoopbackFailureReasons,
  createDisconnectRetryPlan,
  createClientLoopbackPlan,
  createLocalEchoSimulation,
  redactLoopbackDiagnostics
} from "../src/connection/loopback-plan.mjs";

test("client loopback plan connects Minecraft to localhost and relay to the approved room", () => {
  const plan = createClientLoopbackPlan({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    relayUrl: "wss://relay.example.test/rooms/room-a",
    inviteToken: "invite-secret",
    sessionToken: "session-secret",
    sessionId: "session-a",
    localPort: 41234
  });

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.connection, {
    protocolVersion: "relay.m4",
    minecraftServerAddress: "127.0.0.1:41234",
    localProxy: {
      host: "127.0.0.1",
      port: 41234,
      target: {
        kind: "minecraft",
        host: "127.0.0.1",
        port: 25565
      }
    },
    relay: {
      url: "wss://relay.example.test/rooms/room-a",
      roomId: "room-a",
      inviteId: "invite-a",
      sessionId: "session-a",
      sessionToken: "session-secret",
      minecraftUuid: "uuid-a",
      openFrame: {
        protocolVersion: "relay.m4",
        kind: "friend_stream_open",
        roomId: "room-a",
        inviteId: "invite-a",
        friendId: "friend-a",
        minecraftUuid: "uuid-a",
        requestedTarget: {
          kind: "minecraft",
          host: "127.0.0.1",
          port: 25565
        }
      }
    },
    lifecycle: {
      hostTunnelRequired: true,
      disconnect: {
        ok: true,
        state: "closed",
        attempts: [
          {
            attempt: 1,
            retryDelayMs: 0,
            state: "disconnected"
          }
        ],
        policy: {
          maxAttempts: 3,
          baseDelayMs: 100
        }
      }
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

test("loopback plan blocks arbitrary local TCP targets", () => {
  assert.deepEqual(
    createClientLoopbackPlan({
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      relayUrl: "wss://relay.example.test/rooms/room-a",
      sessionToken: "session-secret",
      sessionId: "session-a",
      localHost: "0.0.0.0",
      localPort: 22
    }),
    {
      ok: false,
      reason: LoopbackFailureReasons.OPEN_PROXY_BLOCKED
    }
  );

  assert.deepEqual(
    createClientLoopbackPlan({
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      relayUrl: "wss://relay.example.test/rooms/room-a",
      sessionToken: "session-secret",
      sessionId: "session-a",
      requestedTarget: {
        kind: "minecraft",
        host: "127.0.0.1",
        port: 22
      }
    }),
    {
      ok: false,
      reason: LoopbackFailureReasons.OPEN_PROXY_BLOCKED
    }
  );
});

test("local echo simulation sends approved friend stream frames to the host stream", () => {
  const plan = createClientLoopbackPlan({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    relayUrl: "wss://relay.example.test/rooms/room-a",
    sessionToken: "session-secret",
    sessionId: "session-a",
    localPort: 25565
  });
  const echo = createLocalEchoSimulation(plan);

  assert.deepEqual(echo.sendFromFriend("hello host"), {
    ok: true,
    hostFrame: {
      protocolVersion: "relay.m4",
      direction: "friend_to_host",
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      payload: "hello host"
    },
    friendFrame: {
      protocolVersion: "relay.m4",
      direction: "host_to_friend",
      roomId: "room-a",
      minecraftUuid: "uuid-a",
      payload: "hello host"
    }
  });
  assert.deepEqual(echo.snapshot().hostStream.map((frame) => frame.payload), ["hello host"]);
});

test("disconnect retries are bounded and expose failure state", () => {
  assert.deepEqual(createDisconnectRetryPlan({ maxAttempts: 3, baseDelayMs: 50, failAttempts: 3 }), {
    ok: false,
    reason: LoopbackFailureReasons.DISCONNECT_RETRY_EXHAUSTED,
    state: "disconnect_failed",
    attempts: [
      { attempt: 1, retryDelayMs: 0, state: "retrying" },
      { attempt: 2, retryDelayMs: 50, state: "retrying" },
      { attempt: 3, retryDelayMs: 100, state: "retrying" }
    ],
    policy: {
      maxAttempts: 3,
      baseDelayMs: 50
    }
  });
});
