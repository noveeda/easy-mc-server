import { randomUUID } from "node:crypto";

export const RelayFailureReasons = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
  SESSION_EXPIRED: "session_expired",
  CROSS_ROOM: "cross_room",
  WRONG_INVITE: "wrong_invite",
  SESSION_REPLAYED: "session_replayed",
  WRONG_UUID: "wrong_uuid",
  WRONG_FRIEND: "wrong_friend",
  HOST_TUNNEL_UNAVAILABLE: "host_tunnel_unavailable",
  HOST_TUNNEL_CLOSED: "host_tunnel_closed",
  OPEN_PROXY_BLOCKED: "open_proxy_blocked",
  INVALID_TRANSFER: "invalid_transfer",
  DISCONNECT_RETRY_EXHAUSTED: "disconnect_retry_exhausted",
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

const RELAY_PROTOCOL_VERSION = "relay.m4";

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
  const sessionService = options.sessionService;
  const quotas = {
    ...defaultQuotas,
    ...options.quotas
  };
  const hostTunnels = new Map();
  const sessions = new Map();
  const streams = new Map();
  const roomBytes = new Map();
  const monthlyHostBytes = new Map();
  const events = [];
  const metrics = {
    hostTunnelsOpened: 0,
    hostTunnelsClosed: 0,
    friendStreamsOpened: 0,
    friendStreamsClosed: 0,
    failedOpens: 0,
    bytesRelayed: 0,
    disconnectRetries: 0,
    disconnectFailures: 0
  };

  function openHostTunnel({ hostId, roomId, target }) {
    if (!isMinecraftLoopbackTarget(target)) {
      return fail(RelayFailureReasons.OPEN_PROXY_BLOCKED, { hostId, roomId, target });
    }

    const tunnel = {
      id: `relay_tunnel_${randomUUID()}`,
      protocolVersion: RELAY_PROTOCOL_VERSION,
      kind: "host_tunnel",
      role: "host",
      hostId,
      roomId,
      target: { ...target },
      openedAt: clock.now(),
      closedAt: null,
      state: "open"
    };

    hostTunnels.set(roomId, tunnel);
    metrics.hostTunnelsOpened += 1;
    recordEvent("host_tunnel_opened", { tunnelId: tunnel.id, hostId, roomId, target });

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
    const sessionResult = readSessionForRequest(request);
    if (isThenable(sessionResult)) {
      return sessionResult.then((resolvedSessionResult) => openFriendStreamWithSession(request, resolvedSessionResult));
    }

    return openFriendStreamWithSession(request, sessionResult);
  }

  function openFriendStreamWithSession(request, sessionResult) {
    if (!sessionResult.ok) {
      return failOpen(sessionResult.reason, request);
    }

    const session = sessionResult.session;
    const authFailure = validateSession(session, request);

    if (authFailure) {
      return failOpen(authFailure, request);
    }

    const tunnel = hostTunnels.get(request.roomId);

    if (!tunnel) {
      return failOpen(RelayFailureReasons.HOST_TUNNEL_UNAVAILABLE, request);
    }

    if (tunnel.state !== "open") {
      return failOpen(RelayFailureReasons.HOST_TUNNEL_CLOSED, request);
    }

    if (!targetMatchesTunnel(request.requestedTarget, tunnel.target)) {
      return failOpen(RelayFailureReasons.OPEN_PROXY_BLOCKED, request);
    }

    if (activeRoomMemberCount(request.roomId) >= quotas.maxRoomMembers) {
      return failOpen(RelayFailureReasons.ROOM_SIZE_QUOTA, request);
    }

    const stream = {
      id: `relay_stream_${randomUUID()}`,
      protocolVersion: RELAY_PROTOCOL_VERSION,
      kind: "friend_stream",
      role: "friend",
      roomId: request.roomId,
      inviteId: session.inviteId ?? request.inviteId,
      hostId: tunnel.hostId,
      friendId: request.friendId,
      minecraftUuid: request.minecraftUuid,
      target: { ...tunnel.target },
      sessionId: request.sessionId,
      tunnelId: tunnel.id,
      openedAt: clock.now(),
      lastActivityAt: clock.now(),
      bytes: 0,
      hostInbox: [],
      friendInbox: [],
      state: "open"
    };

    streams.set(stream.id, stream);
    session.consumedAt = clock.now();
    metrics.friendStreamsOpened += 1;
    recordEvent("friend_stream_opened", stream);

    return {
      ok: true,
      stream: publicStream(stream)
    };
  }

  function recordTransfer({ streamId, bytes }) {
    const stream = streams.get(streamId);

    if (!stream || stream.state !== "open") {
      return fail(RelayFailureReasons.UNAUTHENTICATED, { streamId });
    }

    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      return fail(RelayFailureReasons.INVALID_TRANSFER, { streamId, bytes });
    }

    if (clock.now() - stream.openedAt > quotas.maxSessionMs) {
      closeStream(stream, "session_duration_quota");
      return fail(RelayFailureReasons.SESSION_DURATION_QUOTA, { streamId });
    }

    if (clock.now() - stream.lastActivityAt > quotas.idleTimeoutMs) {
      closeStream(stream, "idle_quota");
      return fail(RelayFailureReasons.IDLE_QUOTA, { streamId });
    }

    const nextRoomBytes = (roomBytes.get(stream.roomId) ?? 0) + bytes;

    if (nextRoomBytes > quotas.maxRoomBytes) {
      closeStream(stream, "room_bandwidth_quota");
      return fail(RelayFailureReasons.ROOM_BANDWIDTH_QUOTA, { streamId, bytes });
    }

    const nextMonthlyHostBytes = (monthlyHostBytes.get(stream.hostId) ?? 0) + bytes;

    if (nextMonthlyHostBytes > quotas.maxMonthlyHostBytes) {
      closeStream(stream, "monthly_host_quota");
      return fail(RelayFailureReasons.MONTHLY_HOST_QUOTA, { streamId, bytes });
    }

    stream.bytes += bytes;
    stream.lastActivityAt = clock.now();
    roomBytes.set(stream.roomId, nextRoomBytes);
    monthlyHostBytes.set(stream.hostId, nextMonthlyHostBytes);
    metrics.bytesRelayed += bytes;
    recordEvent("relay_transfer_recorded", { streamId, roomId: stream.roomId, bytes });

    return {
      ok: true,
      stream: publicStream(stream),
      warning: nextRoomBytes >= quotas.warningRoomBytes ? "room_bandwidth_warning" : undefined
    };
  }

  function relayEcho({ streamId, payload }) {
    const stream = streams.get(streamId);

    if (!stream || stream.state !== "open") {
      return fail(RelayFailureReasons.UNAUTHENTICATED, { streamId });
    }

    const bytes = byteLength(payload);
    const transfer = recordTransfer({ streamId, bytes });
    if (!transfer.ok) {
      return transfer;
    }

    const frame = {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      streamId,
      roomId: stream.roomId,
      direction: "friend_to_host",
      payload
    };
    stream.hostInbox.push(frame);
    stream.friendInbox.push({
      ...frame,
      direction: "host_to_friend"
    });

    return {
      ok: true,
      hostFrame: { ...stream.hostInbox.at(-1) },
      friendFrame: { ...stream.friendInbox.at(-1) },
      stream: publicStream(stream)
    };
  }

  function closeHostTunnel({ tunnelId, roomId, reason = "host_closed" }) {
    const tunnel = tunnelId
      ? [...hostTunnels.values()].find((candidate) => candidate.id === tunnelId)
      : hostTunnels.get(roomId);

    if (!tunnel) {
      return fail(RelayFailureReasons.HOST_TUNNEL_UNAVAILABLE, { tunnelId, roomId });
    }

    if (tunnel.state === "closed") {
      return {
        ok: true,
        tunnel: publicTunnel(tunnel),
        closedStreams: 0
      };
    }

    tunnel.state = "closed";
    tunnel.closedAt = clock.now();
    metrics.hostTunnelsClosed += 1;

    let closedStreams = 0;
    for (const stream of streams.values()) {
      if (stream.tunnelId === tunnel.id && stream.state === "open") {
        closeStream(stream, reason);
        closedStreams += 1;
      }
    }

    recordEvent("host_tunnel_closed", { tunnelId: tunnel.id, roomId: tunnel.roomId, reason, closedStreams });

    return {
      ok: true,
      tunnel: publicTunnel(tunnel),
      closedStreams
    };
  }

  function disconnectStream({ streamId, maxAttempts = 3, failAttempts = 0 }) {
    const stream = streams.get(streamId);
    if (!stream) {
      return fail(RelayFailureReasons.UNAUTHENTICATED, { streamId });
    }

    const attempts = [];
    const boundedMaxAttempts = Math.max(1, maxAttempts);
    for (let attempt = 1; attempt <= boundedMaxAttempts; attempt += 1) {
      const failed = attempt <= failAttempts;
      attempts.push({
        attempt,
        state: failed ? "retrying" : "disconnected"
      });
      if (failed) {
        metrics.disconnectRetries += 1;
      } else {
        closeStream(stream, "friend_disconnected");
        recordEvent("friend_stream_disconnected", { streamId, attempts: attempt });
        return {
          ok: true,
          state: "closed",
          attempts,
          stream: publicStream(stream)
        };
      }
    }

    stream.state = "disconnect_failed";
    metrics.disconnectFailures += 1;
    recordEvent("friend_stream_disconnect_failed", { streamId, attempts: boundedMaxAttempts });

    return {
      ok: false,
      reason: RelayFailureReasons.DISCONNECT_RETRY_EXHAUSTED,
      state: stream.state,
      attempts
    };
  }

  function readMetrics() {
    return {
      ...metrics,
      openHostTunnels: [...hostTunnels.values()].filter((tunnel) => tunnel.state === "open").length,
      openFriendStreams: [...streams.values()].filter((stream) => stream.state === "open").length,
      roomBytes: Object.fromEntries(roomBytes),
      monthlyHostBytes: Object.fromEntries(monthlyHostBytes)
    };
  }

  function readEventLog() {
    return events.map((event) => redactRelayDiagnostics(event));
  }

  function readSessionForRequest(request) {
    if (sessionService?.validateSession) {
      const result = sessionService.validateSession({
        sessionId: request.sessionId,
        sessionToken: request.sessionToken,
        roomId: request.roomId,
        inviteId: request.inviteId,
        friendId: request.friendId,
        minecraftUuid: request.minecraftUuid,
        now: clock.now()
      });

      if (isThenable(result)) {
        return result
          .then((resolvedResult) => normalizeServiceSessionResult(resolvedResult, request))
          .catch(() => fail(RelayFailureReasons.UNAUTHENTICATED, request));
      }

      return normalizeServiceSessionResult(result, request);
    }

    const session = sessions.get(request.sessionId);
    if (!session) {
      return fail(RelayFailureReasons.UNAUTHENTICATED, request);
    }

    return { ok: true, session };
  }

  function normalizeServiceSessionResult(result, request) {
    if (!result?.ok) {
      return fail(result?.reason ?? RelayFailureReasons.UNAUTHENTICATED, request);
    }

    const serviceSession = normalizeSession(result.session);
    const existing = sessions.get(serviceSession.sessionId);
    if (existing?.consumedAt !== undefined) {
      serviceSession.consumedAt = existing.consumedAt;
    }
    sessions.set(serviceSession.sessionId, serviceSession);
    return { ok: true, session: serviceSession };
  }

  function validateSession(session, request) {
    if (!session || !request.sessionToken || session.sessionToken !== request.sessionToken || !session.approved) {
      return RelayFailureReasons.UNAUTHENTICATED;
    }

    if (session.consumedAt !== undefined) {
      return RelayFailureReasons.SESSION_REPLAYED;
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

    if (session.inviteId && session.inviteId !== request.inviteId) {
      return RelayFailureReasons.WRONG_INVITE;
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

  function closeStream(stream, reason) {
    if (stream.state === "closed") {
      return;
    }

    stream.state = "closed";
    stream.closedAt = clock.now();
    metrics.friendStreamsClosed += 1;
    recordEvent("friend_stream_closed", { streamId: stream.id, roomId: stream.roomId, reason });
  }

  function recordEvent(type, metadata) {
    events.push({
      type,
      occurredAt: clock.now(),
      metadata: redactRelayDiagnostics(metadata)
    });
  }

  function failOpen(reason, request) {
    metrics.failedOpens += 1;
    recordEvent("friend_stream_open_failed", { reason, ...request });
    return fail(reason);
  }

  return {
    clock,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    openHostTunnel,
    closeHostTunnel,
    authorizeSession,
    openFriendStream,
    recordTransfer,
    relayEcho,
    disconnectStream,
    readMetrics,
    readEventLog
  };
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
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
    protocolVersion: stream.protocolVersion,
    kind: stream.kind,
    roomId: stream.roomId,
    inviteId: stream.inviteId,
    tunnelId: stream.tunnelId,
    hostId: stream.hostId,
    friendId: stream.friendId,
    minecraftUuid: stream.minecraftUuid,
    target: { ...stream.target },
    state: stream.state
  };
}

function publicTunnel(tunnel) {
  return {
    id: tunnel.id,
    protocolVersion: tunnel.protocolVersion,
    kind: tunnel.kind,
    role: tunnel.role,
    hostId: tunnel.hostId,
    roomId: tunnel.roomId,
    target: { ...tunnel.target },
    state: tunnel.state,
    openedAt: tunnel.openedAt,
    closedAt: tunnel.closedAt
  };
}

function normalizeSession(session = {}) {
  return {
    sessionId: session.sessionId ?? session.id,
    sessionToken: session.sessionToken ?? session.sessionCredential,
    roomId: session.roomId,
    inviteId: session.inviteId,
    hostId: session.hostId,
    friendId: session.friendId,
    minecraftUuid: session.minecraftUuid,
    approved: session.approved ?? session.state === "issued",
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt
  };
}

export function redactRelayDiagnostics(value) {
  if (typeof value === "string") {
    return value
      .replace(/\b(sessionToken|session|relayToken|inviteToken|token)=([^&\s"'<>]+)/gi, "$1=[redacted:relay_secret]")
      .replace(/\b[A-Za-z0-9_-]*(session-token|invite-secret|relay-secret)[A-Za-z0-9_-]*\b/gi, "[redacted:relay_secret]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactRelayDiagnostics(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => {
          if (/token|credential|secret/i.test(key)) {
            return [key, "[redacted:relay_secret]"];
          }

          return [key, redactRelayDiagnostics(nested)];
        })
    );
  }

  return value;
}

function byteLength(payload) {
  if (typeof payload === "string") {
    return Buffer.byteLength(payload);
  }

  if (payload instanceof Uint8Array) {
    return payload.byteLength;
  }

  return Buffer.byteLength(JSON.stringify(payload));
}

function fail(reason, metadata) {
  if (metadata !== undefined) {
    // Kept out of the public return shape so callers only see stable reason codes.
  }

  return {
    ok: false,
    reason
  };
}
