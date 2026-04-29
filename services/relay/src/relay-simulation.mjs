import { randomUUID } from "node:crypto";

export const RelayFailureReasons = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
  SESSION_EXPIRED: "session_expired",
  CROSS_ROOM: "cross_room",
  WRONG_UUID: "wrong_uuid",
  WRONG_FRIEND: "wrong_friend",
  HOST_TUNNEL_UNAVAILABLE: "host_tunnel_unavailable",
  OPEN_PROXY_BLOCKED: "open_proxy_blocked",
  INVALID_TRANSFER: "invalid_transfer",
  ROOM_SIZE_QUOTA: "room_size_quota",
  SESSION_DURATION_QUOTA: "session_duration_quota",
  IDLE_QUOTA: "idle_quota",
  ROOM_BANDWIDTH_QUOTA: "room_bandwidth_quota",
  MONTHLY_HOST_QUOTA: "monthly_host_quota"
});

const defaultQuotas = Object.freeze({
  maxRoomMembers: 9,
  maxSessionMs: 6 * 60 * 60 * 1000,
  idleTimeoutMs: 20 * 60 * 1000,
  warningRoomBytes: 25 * 1024 * 1024 * 1024,
  maxRoomBytes: 40 * 1024 * 1024 * 1024,
  maxMonthlyHostBytes: 150 * 1024 * 1024 * 1024
});

export function createRelayClock(initialNow = Date.parse("2026-04-30T00:00:00.000Z")) {
  let current = initialNow;

  return {
    now() {
      return current;
    },
    advance(ms) {
      current += ms;
      return current;
    }
  };
}

export function createRelaySimulation(options = {}) {
  const clock = options.clock ?? createRelayClock();
  const quotas = {
    ...defaultQuotas,
    ...options.quotas
  };
  const hostTunnels = new Map();
  const sessions = new Map();
  const streams = new Map();
  const roomBytes = new Map();
  const monthlyHostBytes = new Map();

  function openHostTunnel({ hostId, roomId, target }) {
    if (!isMinecraftLoopbackTarget(target)) {
      return fail(RelayFailureReasons.OPEN_PROXY_BLOCKED);
    }

    const tunnel = {
      id: `relay_tunnel_${randomUUID()}`,
      hostId,
      roomId,
      target: { ...target },
      openedAt: clock.now()
    };

    hostTunnels.set(roomId, tunnel);

    return {
      ok: true,
      tunnel: { ...tunnel, target: { ...tunnel.target } }
    };
  }

  function authorizeSession(session) {
    sessions.set(session.sessionId, {
      ...session,
      authorizedAt: clock.now()
    });

    return { ok: true };
  }

  function openFriendStream(request = {}) {
    const session = sessions.get(request.sessionId);
    const authFailure = validateSession(session, request);

    if (authFailure) {
      return fail(authFailure);
    }

    const tunnel = hostTunnels.get(request.roomId);

    if (!tunnel) {
      return fail(RelayFailureReasons.HOST_TUNNEL_UNAVAILABLE);
    }

    if (!targetMatchesTunnel(request.requestedTarget, tunnel.target)) {
      return fail(RelayFailureReasons.OPEN_PROXY_BLOCKED);
    }

    if (activeRoomMemberCount(request.roomId) >= quotas.maxRoomMembers) {
      return fail(RelayFailureReasons.ROOM_SIZE_QUOTA);
    }

    const stream = {
      id: `relay_stream_${randomUUID()}`,
      roomId: request.roomId,
      hostId: tunnel.hostId,
      friendId: request.friendId,
      minecraftUuid: request.minecraftUuid,
      target: { ...tunnel.target },
      sessionId: request.sessionId,
      openedAt: clock.now(),
      lastActivityAt: clock.now(),
      bytes: 0,
      state: "open"
    };

    streams.set(stream.id, stream);

    return {
      ok: true,
      stream: publicStream(stream)
    };
  }

  function recordTransfer({ streamId, bytes }) {
    const stream = streams.get(streamId);

    if (!stream || stream.state !== "open") {
      return fail(RelayFailureReasons.UNAUTHENTICATED);
    }

    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      return fail(RelayFailureReasons.INVALID_TRANSFER);
    }

    if (clock.now() - stream.openedAt > quotas.maxSessionMs) {
      stream.state = "closed";
      return fail(RelayFailureReasons.SESSION_DURATION_QUOTA);
    }

    if (clock.now() - stream.lastActivityAt > quotas.idleTimeoutMs) {
      stream.state = "closed";
      return fail(RelayFailureReasons.IDLE_QUOTA);
    }

    const nextRoomBytes = (roomBytes.get(stream.roomId) ?? 0) + bytes;

    if (nextRoomBytes > quotas.maxRoomBytes) {
      stream.state = "closed";
      return fail(RelayFailureReasons.ROOM_BANDWIDTH_QUOTA);
    }

    const nextMonthlyHostBytes = (monthlyHostBytes.get(stream.hostId) ?? 0) + bytes;

    if (nextMonthlyHostBytes > quotas.maxMonthlyHostBytes) {
      stream.state = "closed";
      return fail(RelayFailureReasons.MONTHLY_HOST_QUOTA);
    }

    stream.bytes += bytes;
    stream.lastActivityAt = clock.now();
    roomBytes.set(stream.roomId, nextRoomBytes);
    monthlyHostBytes.set(stream.hostId, nextMonthlyHostBytes);

    return {
      ok: true,
      stream: publicStream(stream),
      warning: nextRoomBytes >= quotas.warningRoomBytes ? "room_bandwidth_warning" : undefined
    };
  }

  function validateSession(session, request) {
    if (!session || !request.sessionToken || session.sessionToken !== request.sessionToken || !session.approved) {
      return RelayFailureReasons.UNAUTHENTICATED;
    }

    if (session.expiresAt <= clock.now()) {
      return RelayFailureReasons.SESSION_EXPIRED;
    }

    if (clock.now() - session.issuedAt > quotas.maxSessionMs) {
      return RelayFailureReasons.SESSION_DURATION_QUOTA;
    }

    if (session.roomId !== request.roomId) {
      return RelayFailureReasons.CROSS_ROOM;
    }

    if (session.friendId !== request.friendId) {
      return RelayFailureReasons.WRONG_FRIEND;
    }

    if (session.minecraftUuid !== request.minecraftUuid) {
      return RelayFailureReasons.WRONG_UUID;
    }

    return null;
  }

  function activeRoomMemberCount(roomId) {
    return [...streams.values()].filter((stream) => stream.roomId === roomId && stream.state === "open").length;
  }

  return {
    clock,
    openHostTunnel,
    authorizeSession,
    openFriendStream,
    recordTransfer
  };
}

function isMinecraftLoopbackTarget(target) {
  return target?.kind === "minecraft" && target.host === "127.0.0.1" && target.port === 25565;
}

function targetMatchesTunnel(requestedTarget, tunnelTarget) {
  if (!requestedTarget) {
    return true;
  }

  return (
    requestedTarget.kind === tunnelTarget.kind &&
    requestedTarget.host === tunnelTarget.host &&
    requestedTarget.port === tunnelTarget.port
  );
}

function publicStream(stream) {
  return {
    id: stream.id,
    roomId: stream.roomId,
    hostId: stream.hostId,
    friendId: stream.friendId,
    minecraftUuid: stream.minecraftUuid,
    target: { ...stream.target }
  };
}

function fail(reason) {
  return {
    ok: false,
    reason
  };
}
