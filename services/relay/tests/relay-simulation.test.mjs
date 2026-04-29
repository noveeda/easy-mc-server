import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RelayFailureReasons,
  createRelayClock,
  createRelaySimulation,
  redactRelayDiagnostics
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
    inviteId: "invite-a",
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
    hostCredentials: {
      "room-a:host-a": "host-token-a"
    },
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
    hostToken: "host-token-a",
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
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.deepEqual(stream, {
    ok: true,
    stream: {
      id: stream.stream.id,
      protocolVersion: "relay.m4",
      kind: "friend_stream",
      roomId: "room-a",
      inviteId: "invite-a",
      tunnelId: stream.stream.tunnelId,
      hostId: "host-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      target: HOST_TARGET,
      state: "open"
    }
  });
  assert.match(stream.stream.id, /^relay_stream_/);
  assert.match(stream.stream.tunnelId, /^relay_tunnel_/);
});

test("host tunnels require the room host credential and cannot be overwritten by another host", () => {
  const relay = createRelaySimulation({
    clock: createRelayClock(0),
    hostCredentials: {
      "room-a:host-a": "host-token-a",
      "room-a:host-b": "host-token-b"
    }
  });

  assert.deepEqual(
    relay.openHostTunnel({
      hostId: "host-a",
      roomId: "room-a",
      hostToken: "wrong-token",
      target: HOST_TARGET
    }),
    { ok: false, reason: RelayFailureReasons.HOST_TUNNEL_UNAUTHORIZED }
  );

  assert.equal(relay.openHostTunnel({
    hostId: "host-a",
    roomId: "room-a",
    hostToken: "host-token-a",
    target: HOST_TARGET
  }).ok, true);

  assert.deepEqual(
    relay.openHostTunnel({
      hostId: "host-b",
      roomId: "room-a",
      hostToken: "host-token-b",
      target: HOST_TARGET
    }),
    { ok: false, reason: RelayFailureReasons.HOST_TUNNEL_CONFLICT }
  );
  assert.deepEqual(relay.closeHostTunnel({ roomId: "room-a", hostId: "host-b", hostToken: "host-token-b" }), {
    ok: false,
    reason: RelayFailureReasons.HOST_TUNNEL_UNAUTHORIZED
  });
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
  relay.authorizeSession(createApprovedSession({
    sessionId: "wrong-host-session",
    sessionToken: "wrong-host-token",
    hostId: "host-b"
  }));
  relay.authorizeSession(createApprovedSession({
    sessionId: "revoked-session",
    sessionToken: "revoked-token",
    approved: false
  }));

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-a",
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
      inviteId: "invite-a",
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
      inviteId: "invite-a",
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
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-b",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.WRONG_UUID }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "wrong-host-session",
      sessionToken: "wrong-host-token"
    }),
    { ok: false, reason: RelayFailureReasons.WRONG_HOST }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "revoked-session",
      sessionToken: "revoked-token"
    }),
    { ok: false, reason: RelayFailureReasons.UNAUTHENTICATED }
  );
});

test("relay validates sessions through the service boundary and refuses replay or invite rebinding", () => {
  const calls = [];
  const relay = createRelaySimulation({
    clock: createRelayClock(0),
    hostCredentials: {
      "room-a:host-a": "host-token-a"
    },
    sessionService: {
      validateSession(request) {
        calls.push(request);
        return {
          ok: true,
          session: createApprovedSession()
        };
      }
    }
  });
  assert.equal(relay.openHostTunnel({ hostId: "host-a", roomId: "room-a", hostToken: "host-token-a", target: HOST_TARGET }).ok, true);

  const first = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.equal(first.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    {
      sessionId: calls[0].sessionId,
      roomId: calls[0].roomId,
      inviteId: calls[0].inviteId,
      friendId: calls[0].friendId,
      minecraftUuid: calls[0].minecraftUuid,
      consume: calls[0].consume
    },
    {
      sessionId: "session-a",
      roomId: "room-a",
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      consume: true
    }
  );

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.SESSION_REPLAYED }
  );

  const reboundRelay = createOpenRelay().relay;
  reboundRelay.authorizeSession(createApprovedSession());
  assert.deepEqual(
    reboundRelay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-b",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.WRONG_INVITE }
  );
});

test("relay accepts asynchronous session validation service calls", async () => {
  const relay = createRelaySimulation({
    clock: createRelayClock(0),
    hostCredentials: {
      "room-a:host-a": "host-token-a"
    },
    sessionService: {
      async validateSession() {
        return {
          ok: true,
          session: createApprovedSession()
        };
      }
    }
  });
  assert.equal(relay.openHostTunnel({ hostId: "host-a", roomId: "room-a", hostToken: "host-token-a", target: HOST_TARGET }).ok, true);

  const stream = await relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.equal(stream.ok, true);
  assert.equal(stream.stream.roomId, "room-a");
});

test("open-proxy guard rejects arbitrary TCP targets", () => {
  const { relay } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-a",
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

test("host tunnel lifecycle closes active streams and blocks later joins", () => {
  const { relay, tunnel } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());
  const stream = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  const closed = relay.closeHostTunnel({ tunnelId: tunnel.tunnel.id, hostToken: "host-token-a", reason: "host_shutdown" });
  assert.equal(closed.ok, true);
  assert.equal(closed.closedStreams, 1);
  assert.equal(closed.tunnel.state, "closed");
  assert.deepEqual(relay.recordTransfer({ streamId: stream.stream.id, bytes: 1 }), {
    ok: false,
    reason: RelayFailureReasons.UNAUTHENTICATED
  });

  relay.authorizeSession(createApprovedSession({
    sessionId: "session-b",
    sessionToken: "session-token-b",
    inviteId: "invite-b"
  }));
  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-b",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-b",
      sessionToken: "session-token-b"
    }),
    { ok: false, reason: RelayFailureReasons.HOST_TUNNEL_CLOSED }
  );
});

test("local echo-style relay simulation delivers approved friend payloads to the host stream", () => {
  const { relay } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());
  const stream = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  const echo = relay.relayEcho({ streamId: stream.stream.id, payload: "hello host" });

  assert.equal(echo.ok, true);
  assert.deepEqual(echo.hostFrame, {
    protocolVersion: "relay.m4",
    streamId: stream.stream.id,
    roomId: "room-a",
    direction: "friend_to_host",
    payload: "hello host"
  });
  assert.equal(echo.friendFrame.direction, "host_to_friend");
  assert.equal(relay.readMetrics().bytesRelayed, 10);
});

test("relay metrics and disconnect retry state are bounded", () => {
  const { relay } = createOpenRelay();
  relay.authorizeSession(createApprovedSession());
  const stream = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });

  assert.deepEqual(relay.disconnectStream({ streamId: stream.stream.id, maxAttempts: 2, failAttempts: 2 }), {
    ok: false,
    reason: RelayFailureReasons.DISCONNECT_RETRY_EXHAUSTED,
    state: "disconnect_failed",
    attempts: [
      { attempt: 1, state: "retrying" },
      { attempt: 2, state: "retrying" }
    ]
  });

  const metrics = relay.readMetrics();
  assert.equal(metrics.hostTunnelsOpened, 1);
  assert.equal(metrics.friendStreamsOpened, 1);
  assert.equal(metrics.disconnectRetries, 2);
  assert.equal(metrics.disconnectFailures, 1);
});

test("relay diagnostic redaction removes secrets from errors and logs", () => {
  const redacted = redactRelayDiagnostics({
    sessionToken: "session-token-a",
    inviteToken: "invite-secret-a",
    authorization: "Bearer auth-secret",
    cookie: "sid=cookie-secret",
    message: "session=session-token-a relayToken=relay-secret-a"
  });

  assert.deepEqual(redacted, {
    sessionToken: "[redacted:relay_secret]",
    inviteToken: "[redacted:relay_secret]",
    authorization: "[redacted:relay_secret]",
    cookie: "[redacted:relay_secret]",
    message: "session=[redacted:relay_secret] relayToken=[redacted:relay_secret]"
  });
});

test("failed stream opens log only an allowlisted diagnostic shape", () => {
  const { relay } = createOpenRelay();

  relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a",
    headers: {
      authorization: "Bearer auth-secret",
      cookie: "sid=cookie-secret"
    }
  });

  const failedEvent = relay.readEventLog().find((event) => event.type === "friend_stream_open_failed");

  assert.deepEqual(failedEvent.metadata, {
    reason: RelayFailureReasons.UNAUTHENTICATED,
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a"
  });
  assert.equal(JSON.stringify(failedEvent).includes("session-token-a"), false);
  assert.equal(JSON.stringify(failedEvent).includes("auth-secret"), false);
  assert.equal(JSON.stringify(failedEvent).includes("cookie-secret"), false);
});

test("room size quota is enforced", () => {
  const { relay } = createOpenRelay({ quotas: { maxRoomMembers: 1 } });
  relay.authorizeSession(createApprovedSession());
  relay.authorizeSession(createApprovedSession({
    sessionId: "session-b",
    sessionToken: "session-token-b",
    inviteId: "invite-b",
    friendId: "friend-b",
    minecraftUuid: "uuid-b"
  }));

  const first = relay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.equal(first.ok, true);

  assert.deepEqual(
    relay.openFriendStream({
      roomId: "room-a",
      inviteId: "invite-b",
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
    clock: createRelayClock(0),
    hostCredentials: {
      "room-a:host-a": "host-token-a"
    }
  });
  const tunnel = relay.openHostTunnel({
    hostId: "host-a",
    roomId: "room-a",
    hostToken: "host-token-a",
    target: HOST_TARGET
  });
  assert.equal(tunnel.ok, true);

  for (let index = 1; index <= 10; index += 1) {
    relay.authorizeSession(createApprovedSession({
      sessionId: `session-${index}`,
      sessionToken: `session-token-${index}`,
      inviteId: `invite-${index}`,
      friendId: `friend-${index}`,
      minecraftUuid: `uuid-${index}`
    }));
  }

  for (let index = 1; index <= 9; index += 1) {
    const result = relay.openFriendStream({
      roomId: "room-a",
      inviteId: `invite-${index}`,
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
      inviteId: "invite-10",
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
      inviteId: "invite-a",
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      sessionId: "session-a",
      sessionToken: "session-token-a"
    }),
    { ok: false, reason: RelayFailureReasons.SESSION_DURATION_QUOTA }
  );
  assert.equal(durationRelay.readMetrics().roomHours, 1001 / (60 * 60 * 1000));

  const idleClock = createRelayClock(0);
  const idleRelay = createOpenRelay({
    clock: idleClock,
    quotas: { idleTimeoutMs: 1000 }
  }).relay;
  idleRelay.authorizeSession(createApprovedSession());
  const idleStream = idleRelay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
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
    inviteId: "invite-a",
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    sessionId: "session-a",
    sessionToken: "session-token-a"
  });
  assert.deepEqual(roomRelay.recordTransfer({ streamId: roomStream.stream.id, bytes: 11 }), {
    ok: false,
    reason: RelayFailureReasons.ROOM_BANDWIDTH_QUOTA
  });
  assert.equal(roomRelay.readMetrics().quotaStops, 1);

  const hostRelay = createOpenRelay({ quotas: { maxMonthlyHostBytes: 10 } }).relay;
  hostRelay.authorizeSession(createApprovedSession());
  const hostStream = hostRelay.openFriendStream({
    roomId: "room-a",
    inviteId: "invite-a",
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
    inviteId: "invite-a",
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
    inviteId: "invite-a",
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
