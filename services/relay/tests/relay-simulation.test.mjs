import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RelayFailureReasons,
  createRelayClock,
  createRelaySimulation
} from "../src/relay-simulation.mjs";

const HOST_TARGET = Object.freeze({
  host: "127.0.0.1",
  port: 25565,
  kind: "minecraft"
});

function createApprovedSession(overrides = {}) {
  return {
    sessionId: "session-a",
    sessionToken: "session-token-a",
    roomId: "room-a",
    hostId: "host-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    approved: true,
    issuedAt: 0,
    expiresAt: 15 * 60 * 1000,
    ...overrides
  };
}

function createOpenRelay(options = {}) {
  const clock = options.clock ?? createRelayClock(0);
  const relay = createRelaySimulation({
    clock,
    quotas: {
      maxRoomMembers: 2,
      maxSessionMs: 15 * 60 * 1000,
      idleTimeoutMs: 30 * 1000,
      maxRoomBytes: 1000,
      maxMonthlyHostBytes: 2000,
      ...options.quotas
    }
  });

  const tunnel = relay.openHostTunnel({
    hostId: "host-a",
    roomId: "room-a",
    target: HOST_TARGET
  });
  assert.equal(tunnel.ok, true);

  return { clock, relay, tunnel };
}

test("approved relay session pairs friend stream with host room target", () => {
  const { relay } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());

  const stream = relay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.deepEqual(stream, {
    ok: true,
    stream: {
      id: stream.stream.id,
      roomId: "room-a",
      hostId: "host-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      target: HOST_TARGET
    }
  });
  assert.match(stream.stream.id, /^relay_stream_/);
});

test("relay authorization fails closed for missing, expired, cross-room, wrong-friend, and wrong-UUID sessions", () => {
  const clock = createRelayClock(0);
  const { relay } = createOpenRelay({ clock });
  relay.authorizeSession(createApprovedSession());
  relay.authorizeSession(createApprovedSession({
    sessionId: "expired-session",
    sessionToken: "expired-token",
    expiresAt: 1000
  }));

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a"
    }),
    { ok: false, reason: RelayFailureReasons.UNAUTHENTICATED }
  );

  clock.advance(1001);

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "expired-session",
      sessionToken: "expired-token"
    }),
    { ok: false, reason: RelayFailureReasons.SESSION_EXPIRED }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-b",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.CROSS_ROOM }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-b",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.WRONG_FRIEND }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-b",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.WRONG_UUID }
  );
});

test("open-proxy guard rejects arbitrary TCP targets", () => {
  const { relay } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a",
      requestedTarget: {
        host: "example.com",
        port: 22,
        kind: "ssh"
      }
    }),
    { ok: false, reason: RelayFailureReasons.OPEN_PROXY_BLOCKED }
  );
});

test("room size quota is enforced", () => {
  const { relay } = createOpenRelay({ quotas: { maxRoomMembers: 1 } });
  relay.authorizeSession(createApprovedSession());
  relay.authorizeSession(createApprovedSession({
    sessionId: "session-b",
    sessionToken: "session-token-b",
    friendId: "friend-b",
    minecraftUuid: "uuid-b"
  }));

  const first = relay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.equal(first.ok, true);

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-b",
      minecraftUuid: "uuid-b",
      sessionId: "session-b",
      sessionToken: "session-token-b"
    }),
    { ok: false, reason: RelayFailureReasons.ROOM_SIZE_QUOTA }
  );
});

test("default room size allows 9 friends for 10 total players including host", () => {
  const relay = createRelaySimulation({
    clock: createRelayClock(0)
  });
  const tunnel = relay.openHostTunnel({
    hostId: "host-a",
    roomId: "room-a",
    target: HOST_TARGET
  });
  assert.equal(tunnel.ok, true);

  for (let index = 1; index <= 10; index += 1) {
    relay.authorizeSession(createApprovedSession({
      sessionId: `session-${index}`,
      sessionToken: `session-token-${index}`,
      friendId: `friend-${index}`,
      minecraftUuid: `uuid-${index}`
    }));
  }

  for (let index = 1; index <= 9; index += 1) {
    const result = relay.openFriendStream({
      roomId: "room-a",
      friendId: `friend-${index}`,
      minecraftUuid: `uuid-${index}`,
      sessionId: `session-${index}`,
      sessionToken: `session-token-${index}`
    });
    assert.equal(result.ok, true, `friend ${index} should fit under the 10-player room limit`);
  }

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-10",
      minecraftUuid: "uuid-10",
      sessionId: "session-10",
      sessionToken: "session-token-10"
    }),
    { ok: false, reason: RelayFailureReasons.ROOM_SIZE_QUOTA }
  );
});

test("duration, idle, room bandwidth, and monthly host quotas are enforced", () => {
  const durationClock = createRelayClock(0);
  const durationRelay = createOpenRelay({
    clock: durationClock,
    quotas: { maxSessionMs: 1000 }
  }).relay;
  durationRelay.authorizeSession(createApprovedSession({ expiresAt: 60_000 }));
  durationClock.advance(1001);
  assert.deepEqual(
    durationRelay.openFriendStream({
      roomId: "room-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.SESSION_DURATION_QUOTA }
  );

  const idleClock = createRelayClock(0);
  const idleRelay = createOpenRelay({
    clock: idleClock,
    quotas: { idleTimeoutMs: 1000 }
  }).relay;
  idleRelay.authorizeSession(createApprovedSession());
  const idleStream = idleRelay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  idleClock.advance(1001);
  assert.deepEqual(idleRelay.recordTransfer({ streamId: idleStream.stream.id, bytes: 1 }), {
    ok: false,
    reason: RelayFailureReasons.IDLE_QUOTA
  });

  const roomRelay = createOpenRelay({ quotas: { maxRoomBytes: 10 } }).relay;
  roomRelay.authorizeSession(createApprovedSession());
  const roomStream = roomRelay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.deepEqual(roomRelay.recordTransfer({ streamId: roomStream.stream.id, bytes: 11 }), {
    ok: false,
    reason: RelayFailureReasons.ROOM_BANDWIDTH_QUOTA
  });

  const hostRelay = createOpenRelay({ quotas: { maxMonthlyHostBytes: 10 } }).relay;
  hostRelay.authorizeSession(createApprovedSession());
  const hostStream = hostRelay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.deepEqual(hostRelay.recordTransfer({ streamId: hostStream.stream.id, bytes: 11 }), {
    ok: false,
    reason: RelayFailureReasons.MONTHLY_HOST_QUOTA
  });
});

test("relay quota accounting rejects negative, zero, and non-finite byte counts", () => {
  const relay = createOpenRelay({ quotas: { maxRoomBytes: 10 } }).relay;
  relay.authorizeSession(createApprovedSession());
  const stream = relay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  for (const bytes of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.deepEqual(relay.recordTransfer({ streamId: stream.stream.id, bytes }), {
      ok: false,
      reason: RelayFailureReasons.INVALID_TRANSFER
    });
  }

  assert.equal(relay.recordTransfer({ streamId: stream.stream.id, bytes: 10 }).ok, true);
  assert.deepEqual(relay.recordTransfer({ streamId: stream.stream.id, bytes: 1 }), {
    ok: false,
    reason: RelayFailureReasons.ROOM_BANDWIDTH_QUOTA
  });
});

test("room bandwidth warning fires before the hard cap", () => {
  const relay = createOpenRelay({
    quotas: {
      warningRoomBytes: 10,
      maxRoomBytes: 20
    }
  }).relay;
  relay.authorizeSession(createApprovedSession());
  const stream = relay.openFriendStream({
    roomId: "room-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.deepEqual(relay.recordTransfer({ streamId: stream.stream.id, bytes: 10 }), {
    ok: true,
    stream: {
      ...stream.stream
    },
    warning: "room_bandwidth_warning"
  });
});
