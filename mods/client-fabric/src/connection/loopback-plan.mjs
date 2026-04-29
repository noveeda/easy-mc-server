export const LoopbackFailureReasons = Object.freeze({
  SESSION_MISSING: "session_missing",
  RELAY_URL_MISSING: "relay_url_missing",
  ROOM_MISSING: "room_missing",
  OPEN_PROXY_BLOCKED: "open_proxy_blocked",
  DISCONNECT_RETRY_EXHAUSTED: "disconnect_retry_exhausted"
});

const LOOPBACK_PROTOCOL_VERSION = "relay.m4";

const redactionLabels = Object.freeze({
  inviteToken: "invite_token",
  sessionToken: "session_token",
  relayToken: "relay_token"
});

export function createClientLoopbackPlan(input = {}) {
  if (!input.roomId || !input.minecraftUuid) {
    return fail(LoopbackFailureReasons.ROOM_MISSING);
  }

  if (!input.relayUrl) {
    return fail(LoopbackFailureReasons.RELAY_URL_MISSING);
  }

  if (!input.sessionId || !input.sessionToken) {
    return fail(LoopbackFailureReasons.SESSION_MISSING);
  }

  const localTarget = {
    kind: "minecraft",
    host: input.localHost ?? "127.0.0.1",
    port: input.localPort ?? 0
  };

  if (!isMinecraftLoopbackTarget(localTarget)) {
    return fail(LoopbackFailureReasons.OPEN_PROXY_BLOCKED);
  }

  const relayTarget = input.requestedTarget ?? {
    kind: "minecraft",
    host: "127.0.0.1",
    port: 25565
  };

  if (!isMinecraftServerTarget(relayTarget)) {
    return fail(LoopbackFailureReasons.OPEN_PROXY_BLOCKED);
  }

  const localPort = localTarget.port;
  const diagnostics = redactLoopbackDiagnostics(
    {
      roomId: input.roomId,
      minecraftUuid: input.minecraftUuid,
      inviteUrl: input.inviteUrl,
      relayUrl: input.relayUrl,
      localServerAddress: `127.0.0.1:${localPort}`,
      protocolVersion: LOOPBACK_PROTOCOL_VERSION,
      events: [
        `invite=${input.inviteToken ?? "none"}`,
        `session=${input.sessionToken}`,
        `relay=${input.relayToken ?? "none"}`
      ]
    },
    input
  );

  return {
    ok: true,
    connection: {
      protocolVersion: LOOPBACK_PROTOCOL_VERSION,
      minecraftServerAddress: `127.0.0.1:${localPort}`,
      localProxy: {
        host: "127.0.0.1",
        port: localPort,
        target: relayTarget
      },
      relay: {
        url: redactUrlSecret(input.relayUrl, input),
        roomId: input.roomId,
        inviteId: input.inviteId,
        sessionId: input.sessionId,
        sessionToken: input.sessionToken,
        minecraftUuid: input.minecraftUuid,
        openFrame: {
          protocolVersion: LOOPBACK_PROTOCOL_VERSION,
          kind: "friend_stream_open",
          roomId: input.roomId,
          inviteId: input.inviteId,
          friendId: input.friendId,
          minecraftUuid: input.minecraftUuid,
          requestedTarget: relayTarget
        }
      },
      lifecycle: {
        hostTunnelRequired: true,
        disconnect: createDisconnectRetryPlan(input.disconnectPolicy)
      }
    },
    diagnostics
  };
}

export function createLocalEchoSimulation(plan) {
  if (!plan?.ok) {
    return fail(plan?.reason ?? LoopbackFailureReasons.SESSION_MISSING);
  }

  const hostStream = [];
  const friendStream = [];
  let state = "open";

  return {
    sendFromFriend(payload) {
      if (state !== "open") {
        return fail(LoopbackFailureReasons.DISCONNECT_RETRY_EXHAUSTED);
      }

      const hostFrame = {
        protocolVersion: LOOPBACK_PROTOCOL_VERSION,
        direction: "friend_to_host",
        roomId: plan.connection.relay.roomId,
        minecraftUuid: plan.connection.relay.minecraftUuid,
        payload
      };
      hostStream.push(hostFrame);
      const friendFrame = {
        ...hostFrame,
        direction: "host_to_friend"
      };
      friendStream.push(friendFrame);

      return {
        ok: true,
        hostFrame,
        friendFrame
      };
    },
    disconnect({ failAttempts = 0 } = {}) {
      const result = createDisconnectRetryPlan({
        ...plan.connection.lifecycle.disconnect.policy,
        failAttempts
      });

      state = result.ok ? "closed" : "disconnect_failed";
      return result;
    },
    snapshot() {
      return {
        state,
        hostStream: hostStream.map((frame) => ({ ...frame })),
        friendStream: friendStream.map((frame) => ({ ...frame }))
      };
    }
  };
}

export function createDisconnectRetryPlan(policy = {}) {
  const maxAttempts = Math.max(1, policy.maxAttempts ?? 3);
  const baseDelayMs = policy.baseDelayMs ?? 100;
  const failAttempts = Math.max(0, policy.failAttempts ?? 0);
  const attempts = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const retryDelayMs = attempt === 1 ? 0 : baseDelayMs * 2 ** (attempt - 2);
    const failed = attempt <= failAttempts;
    attempts.push({
      attempt,
      retryDelayMs,
      state: failed ? "retrying" : "disconnected"
    });

    if (!failed) {
      return {
        ok: true,
        state: "closed",
        attempts,
        policy: {
          maxAttempts,
          baseDelayMs
        }
      };
    }
  }

  return {
    ok: false,
    reason: LoopbackFailureReasons.DISCONNECT_RETRY_EXHAUSTED,
    state: "disconnect_failed",
    attempts,
    policy: {
      maxAttempts,
      baseDelayMs
    }
  };
}

export function redactLoopbackDiagnostics(value, secrets = {}) {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLoopbackDiagnostics(item, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, redactLoopbackDiagnostics(nested, secrets)])
    );
  }

  return value;
}

function redactUrlSecret(url, secrets) {
  return redactString(url, {
    sessionToken: secrets.sessionToken,
    relayToken: secrets.relayToken
  });
}

function redactString(value, secrets) {
  let redacted = value;

  for (const [key, label] of Object.entries(redactionLabels)) {
    const secret = secrets[key];

    if (secret) {
      redacted = redacted.replaceAll(secret, `[redacted:${label}]`);
    }
  }

  return redacted;
}

function isMinecraftLoopbackTarget(target) {
  return target.kind === "minecraft" && target.host === "127.0.0.1" && isLoopbackPort(target.port);
}

function isMinecraftServerTarget(target) {
  return target.kind === "minecraft" && target.host === "127.0.0.1" && target.port === 25565;
}

function isLoopbackPort(port) {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

function fail(reason) {
  return {
    ok: false,
    reason
  };
}
