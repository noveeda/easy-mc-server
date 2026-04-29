export const HostTunnelFailureReasons = Object.freeze({
  ROOM_NOT_READY: "room_not_ready",
  RELAY_SESSION_MISSING: "relay_session_missing",
  OPEN_PROXY_BLOCKED: "open_proxy_blocked"
});

export const HostTunnelUiStates = Object.freeze({
  CONNECTING: "connecting",
  READY: "ready",
  WARNING: "warning",
  STOPPED: "stopped",
  FAILED: "failed"
});

const RELAY_PROTOCOL_VERSION = "relay.m4";

const failureMessages = Object.freeze({
  [HostTunnelFailureReasons.ROOM_NOT_READY]: "Open the room before letting friends join.",
  [HostTunnelFailureReasons.RELAY_SESSION_MISSING]: "Create a room invite before opening the friend connection.",
  [HostTunnelFailureReasons.OPEN_PROXY_BLOCKED]: "Use the local Minecraft room target."
});

export function createHostTunnelPlan(input = {}) {
  if (!input.localServerReady) {
    return fail(HostTunnelFailureReasons.ROOM_NOT_READY);
  }

  if (!input.roomId || !input.hostId || !input.relayUrl || !input.hostTunnelToken) {
    return fail(HostTunnelFailureReasons.RELAY_SESSION_MISSING);
  }

  const localTarget = input.localTarget ?? {
    kind: "minecraft",
    host: "127.0.0.1",
    port: 25565
  };

  if (!isMinecraftRoomTarget(localTarget)) {
    return fail(HostTunnelFailureReasons.OPEN_PROXY_BLOCKED);
  }

  const openFrame = {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    kind: "host_tunnel_open",
    roomId: input.roomId,
    hostId: input.hostId,
    hostToken: input.hostTunnelToken,
    target: localTarget
  };

  return {
    ok: true,
    plan: {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      roomId: input.roomId,
      hostId: input.hostId,
      relay: {
        url: redactTunnelSecrets(input.relayUrl, input),
        openFrame
      },
      localTarget,
      lifecycle: {
        openAfter: "local_room_ready",
        closeOn: ["local_room_stopped", "local_room_crashed"],
        closeFrame: {
          protocolVersion: RELAY_PROTOCOL_VERSION,
          kind: "host_tunnel_close",
          roomId: input.roomId,
          hostId: input.hostId,
          hostToken: input.hostTunnelToken
        }
      },
      diagnostics: redactTunnelDiagnostics({
        roomId: input.roomId,
        hostId: input.hostId,
        relayUrl: input.relayUrl,
        hostTunnelToken: input.hostTunnelToken,
        target: localTarget
      }, input)
    }
  };
}

export function createHostTunnelUiState(input = {}) {
  if (input.status === "open") {
    return {
      state: HostTunnelUiStates.READY,
      title: "친구가 들어올 준비가 됐습니다.",
      primaryAction: null
    };
  }

  if (input.status === "quota_warning") {
    return {
      state: HostTunnelUiStates.WARNING,
      title: "방 연결 사용량이 많습니다.",
      primaryAction: "keep_playing"
    };
  }

  if (input.status === "quota_stopped") {
    return {
      state: HostTunnelUiStates.STOPPED,
      title: "방 연결 제한에 도달했습니다.",
      primaryAction: "close_room"
    };
  }

  if (input.status === "disconnected" || input.status === "unavailable") {
    return {
      state: HostTunnelUiStates.FAILED,
      title: "방 연결이 끊겼습니다.",
      primaryAction: "retry_connection"
    };
  }

  return {
    state: HostTunnelUiStates.CONNECTING,
    title: "친구가 들어올 준비를 하는 중입니다.",
    primaryAction: null
  };
}

export function redactTunnelDiagnostics(value, secrets = {}) {
  if (typeof value === "string") {
    return redactTunnelSecrets(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactTunnelDiagnostics(item, secrets));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => {
          if (/token|credential|secret/i.test(key)) {
            return [key, "[redacted:tunnel_secret]"];
          }

          return [key, redactTunnelDiagnostics(nested, secrets)];
        })
    );
  }

  return value;
}

function redactTunnelSecrets(value, secrets = {}) {
  let redacted = String(value);

  for (const secret of [secrets.hostTunnelToken, secrets.relayToken]) {
    if (secret) {
      redacted = redacted.replaceAll(secret, "[redacted:tunnel_secret]");
    }
  }

  return redacted;
}

function isMinecraftRoomTarget(target) {
  return target?.kind === "minecraft" && target.host === "127.0.0.1" && target.port === 25565;
}

function fail(reason) {
  return {
    ok: false,
    failure: {
      reason,
      message: failureMessages[reason]
    }
  };
}
