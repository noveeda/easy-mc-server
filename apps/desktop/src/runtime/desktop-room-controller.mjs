import { randomBytes } from "node:crypto";
import { createDesktopRuntimeBridge } from "./desktop-runtime-bridge.mjs";
import { HostRuntimeStates } from "./host-runtime.mjs";
import { createControlPlaneSimulation } from "../../../../services/control-plane/src/domain/simulation.mjs";
import { createRelaySimulation } from "../../../../services/relay/src/relay-simulation.mjs";

export const DesktopRoomControllerFailureReasons = Object.freeze({
  CONTROL_PLANE_ROOM_FAILED: "control_plane_room_failed",
  CONTROL_PLANE_INVITE_FAILED: "control_plane_invite_failed",
  RELAY_OPEN_FAILED: "relay_open_failed",
  RELAY_CLOSE_FAILED: "relay_close_failed",
  CLEANUP_PENDING: "cleanup_pending"
});

const MINECRAFT_TARGET = Object.freeze({
  kind: "minecraft",
  host: "127.0.0.1",
  port: 25565
});

const DEFAULT_INVITE_BASE_URL = "https://easy-mc.local/invite";

export function createDesktopRoomController(runtimePlan, options = {}) {
  const runtimeBridge = options.runtimeBridge
    ?? createDesktopRuntimeBridge(runtimePlan, options.runtimeBridgeOptions ?? {});
  const controlPlane = options.controlPlane
    ?? createControlPlaneSimulation(options.controlPlaneOptions ?? {});
  const relayFactory = options.relayFactory ?? createDefaultRelay;
  const hostId = options.hostId ?? runtimePlan?.room?.hostId;
  const inviteBaseUrl = options.inviteBaseUrl ?? DEFAULT_INVITE_BASE_URL;
  const createHostTunnelToken = options.createHostTunnelToken ?? defaultHostTunnelToken;

  let active = emptyActiveRoom();
  let lastRelaySnapshot = emptyRelaySnapshot();
  let lastControlPlaneSnapshot = emptyControlPlaneSnapshot();
  let cleanupPending = false;

  async function prepareRoom(prepareOptions = {}) {
    const prepared = await runtimeBridge.prepareRoom(prepareOptions);
    return withRoomReadiness(prepared);
  }

  async function openRoom(openOptions = {}) {
    if (cleanupPending) {
      return withRoomReadiness(blockedRuntimeDto(DesktopRoomControllerFailureReasons.CLEANUP_PENDING), {
        inviteLink: null
      });
    }

    const opened = await runtimeBridge.openRoom(openOptions);
    if (!isRuntimeReadyForInvite(opened?.state)) {
      return withoutInviteReadiness(opened, { relay: emptyRelaySnapshot() });
    }

    return provisionOpenRoom(opened, openOptions);
  }

  async function closeRoom(closeOptions = {}) {
    const relayClosed = await closeRelayTunnel(closeOptions);
    await revokeInvite();
    active.inviteId = null;
    active.inviteLink = null;

    const closed = await runtimeBridge.closeRoom(closeOptions);
    if (!relayCloseSucceeded(relayClosed)) {
      cleanupPending = true;
      return withRoomReadiness({
        ...closed,
        state: "blocked",
        summary: failureSummary(DesktopRoomControllerFailureReasons.RELAY_CLOSE_FAILED),
        failure: {
          reason: DesktopRoomControllerFailureReasons.RELAY_CLOSE_FAILED,
          message: failureSummary(DesktopRoomControllerFailureReasons.RELAY_CLOSE_FAILED)
        }
      }, {
        inviteLink: null,
        controlPlane: emptyControlPlaneSnapshot(),
        relay: relayClosed
      });
    }

    cleanupPending = false;
    active = emptyActiveRoom();
    return withRoomReadiness(closed, {
      inviteLink: null,
      controlPlane: emptyControlPlaneSnapshot(),
      relay: relayClosed
    });
  }

  async function restartRoom(restartOptions = {}) {
    if (cleanupPending) {
      return withRoomReadiness(blockedRuntimeDto(DesktopRoomControllerFailureReasons.CLEANUP_PENDING), {
        inviteLink: null
      });
    }

    const restarted = await runtimeBridge.restartRoom(restartOptions);
    if (!isRuntimeReadyForInvite(restarted?.state)) {
      await clearOpenRoomSideEffects();
      return withoutInviteReadiness(restarted);
    }

    if (active.inviteLink && relayIsReady(lastRelaySnapshot)) {
      return withRoomReadiness(restarted);
    }

    return provisionOpenRoom(restarted, restartOptions);
  }

  function status() {
    const runtimeStatus = runtimeBridge.status();
    if (!isRuntimeReadyForInvite(runtimeStatus?.state)) {
      return withoutInviteReadiness(runtimeStatus);
    }

    return withRoomReadiness(runtimeStatus);
  }

  async function statusRoom() {
    const runtimeStatus = runtimeBridge.status();
    if (!isRuntimeReadyForInvite(runtimeStatus?.state)) {
      return withoutInviteReadiness(runtimeStatus);
    }

    if (active.inviteLink && relayIsReady(lastRelaySnapshot)) {
      return withRoomReadiness(runtimeStatus);
    }

    return provisionOpenRoom(runtimeStatus);
  }

  async function provisionOpenRoom(runtimeDto, commandOptions = {}) {
    let failureReason = DesktopRoomControllerFailureReasons.CONTROL_PLANE_ROOM_FAILED;
    try {
      const roomResult = await Promise.resolve(controlPlane.createRoom({
        hostId,
        alias: runtimePlan?.room?.name ?? runtimePlan?.room?.id,
        minecraftVersion: runtimePlan?.room?.minecraftVersion,
        packProfileName: runtimePlan?.pack?.id
      }));
      const room = normalizeRoomResult(roomResult);

      if (!room?.id) {
        return failClosed(runtimeDto, DesktopRoomControllerFailureReasons.CONTROL_PLANE_ROOM_FAILED, roomResult);
      }

      active.roomId = room.id;
      lastControlPlaneSnapshot = {
        ready: false,
        room: {
          ready: true,
          id: room.id,
          state: room.state
        },
        invite: {
          ready: false
        }
      };

      failureReason = DesktopRoomControllerFailureReasons.RELAY_OPEN_FAILED;
      const hostToken = await createHostTunnelToken({
        hostId,
        roomId: room.id,
        runtimePlan,
        target: MINECRAFT_TARGET
      });
      active.hostToken = hostToken;
      active.relay = await relayFactory({
        hostId,
        roomId: room.id,
        hostToken,
        runtimePlan,
        target: MINECRAFT_TARGET,
        options: commandOptions
      });

      const relayOpened = await active.relay.openHostTunnel({
        hostId,
        roomId: room.id,
        hostToken,
        target: { ...MINECRAFT_TARGET }
      });

      if (!relayOpened?.ok) {
        return failClosed(runtimeDto, DesktopRoomControllerFailureReasons.RELAY_OPEN_FAILED, relayOpened);
      }

      active.tunnelId = relayOpened.tunnel?.id;
      lastRelaySnapshot = relaySnapshot(relayOpened.tunnel);

      failureReason = DesktopRoomControllerFailureReasons.CONTROL_PLANE_INVITE_FAILED;
      const inviteResult = await Promise.resolve(controlPlane.createInvite({
        actorId: hostId,
        roomId: room.id
      }));
      const invite = normalizeInviteResult(inviteResult);

      if (!invite?.ok || !invite.id || !invite.publicHandle) {
        return failClosed(runtimeDto, DesktopRoomControllerFailureReasons.CONTROL_PLANE_INVITE_FAILED, inviteResult);
      }

      active.inviteId = invite.id;
      active.inviteLink = createInviteLink(inviteBaseUrl, invite.publicHandle);
      lastControlPlaneSnapshot = {
        ready: true,
        room: {
          ready: true,
          id: room.id,
          state: room.state
        },
        invite: {
          ready: true,
          expiresAt: invite.expiresAt
        }
      };

      await Promise.resolve(controlPlane.heartbeatHost?.({
        actorId: hostId,
        roomId: room.id
      }));

      return withRoomReadiness(runtimeDto);
    } catch (error) {
      return failClosed(runtimeDto, failureReason, error);
    }
  }

  async function failClosed(runtimeDto, reason, cause) {
    await clearOpenRoomSideEffects();
    const closedRuntime = await Promise.resolve(runtimeBridge.closeRoom()).catch(() => null);

    return withRoomReadiness({
      ...(closedRuntime ?? runtimeDto),
      state: "blocked",
      summary: failureSummary(reason),
      failure: {
        reason,
        message: failureSummary(reason),
        detail: sanitizeValue(cause)
      }
    }, {
      inviteLink: null,
      controlPlane: lastControlPlaneSnapshot.ready
        ? lastControlPlaneSnapshot
        : {
            ...lastControlPlaneSnapshot,
            ready: false
          },
      relay: lastRelaySnapshot
    });
  }

  async function clearOpenRoomSideEffects() {
    const relayClosed = await closeRelayTunnel({ reason: "controller_fail_closed" });
    await revokeInvite();
    active.inviteId = null;
    active.inviteLink = null;
    if (relayCloseSucceeded(relayClosed)) {
      cleanupPending = false;
      active = emptyActiveRoom();
    } else {
      cleanupPending = true;
    }
    return relayClosed;
  }

  async function closeRelayTunnel(closeOptions = {}) {
    if (!active.relay || !active.roomId) {
      lastRelaySnapshot = closedRelaySnapshot(lastRelaySnapshot);
      return lastRelaySnapshot;
    }

    const closed = await Promise.resolve(active.relay.closeHostTunnel({
      tunnelId: active.tunnelId,
      roomId: active.roomId,
      hostId,
      hostToken: active.hostToken,
      reason: closeOptions.reason ?? "host_closed"
    })).catch((error) => ({
      ok: false,
      reason: error?.message ?? "relay_close_failed"
    }));

    lastRelaySnapshot = closed?.ok
      ? relaySnapshot(closed.tunnel)
      : {
          ready: false,
          closed: false,
          session: {
            ready: false,
            closed: false
          },
          failure: sanitizeValue(closed)
        };

    return lastRelaySnapshot;
  }

  async function revokeInvite() {
    if (!active.inviteId || !active.roomId) {
      return;
    }

    await Promise.resolve(controlPlane.revokeInvite?.({
      actorId: hostId,
      inviteId: active.inviteId
    })).catch(() => null);
  }

  function withRoomReadiness(runtimeDto, overrides = {}) {
    const inviteLink = Object.hasOwn(overrides, "inviteLink")
      ? overrides.inviteLink
      : active.inviteLink;

    return sanitizeValue({
      ...runtimeDto,
      ...(inviteLink ? { inviteLink } : {}),
      controlPlane: overrides.controlPlane ?? lastControlPlaneSnapshot,
      relay: overrides.relay ?? lastRelaySnapshot
    });
  }

  function withoutInviteReadiness(runtimeDto, overrides = {}) {
    return withRoomReadiness(runtimeDto, {
      inviteLink: null,
      controlPlane: emptyControlPlaneSnapshot(),
      relay: lastRelaySnapshot,
      ...overrides
    });
  }

  return {
    prepareRoom,
    openRoom,
    closeRoom,
    restartRoom,
    status,
    statusRoom
  };
}

function normalizeRoomResult(result) {
  if (result?.ok === false) {
    return null;
  }

  return result?.room ?? result;
}

function normalizeInviteResult(result) {
  if (result?.ok === false) {
    return result;
  }

  const invite = result?.invite ?? result;
  const publicHandle =
    invite?.publicHandle ??
    invite?.handle ??
    result?.inviteHandle ??
    result?.handle;
  return {
    ok: result?.ok ?? Boolean(publicHandle),
    id: invite?.id ?? result?.inviteId ?? publicHandle,
    publicHandle,
    expiresAt: invite?.expiresAt ?? result?.expiresAt
  };
}

function createDefaultRelay({ roomId, hostId, hostToken }) {
  return createRelaySimulation({
    hostCredentials: {
      [`${roomId}:${hostId}`]: hostToken
    }
  });
}

function createInviteLink(baseUrl, token) {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("invite", token);
    return url.toString();
  } catch {
    const separator = String(baseUrl).includes("?") ? "&" : "?";
    return `${baseUrl}${separator}invite=${encodeURIComponent(token)}`;
  }
}

function defaultHostTunnelToken() {
  return randomBytes(24).toString("base64url");
}

function relaySnapshot(tunnel) {
  const publicTunnel = sanitizeValue(tunnel ?? {});
  const closed = publicTunnel.state === "closed";
  const ready = publicTunnel.state === "open";

  return {
    ready,
    closed,
    session: {
      ready,
      closed
    },
    tunnel: {
      ready,
      ...publicTunnel
    }
  };
}

function emptyRelaySnapshot() {
  return {
    ready: false,
    closed: true,
    session: {
      ready: false,
      closed: true
    }
  };
}

function closedRelaySnapshot(previous) {
  if (previous?.tunnel) {
    return {
      ...previous,
      ready: false,
      closed: true,
      session: {
        ready: false,
        closed: true
      },
      tunnel: {
        ...previous.tunnel,
        ready: false,
        state: previous.tunnel.state === "open" ? "closed" : previous.tunnel.state
      }
    };
  }

  return emptyRelaySnapshot();
}

function emptyControlPlaneSnapshot() {
  return {
    ready: false,
    room: {
      ready: false
    },
    invite: {
      ready: false
    }
  };
}

function emptyActiveRoom() {
  return {
    roomId: null,
    inviteId: null,
    inviteLink: null,
    hostToken: null,
    relay: null,
    tunnelId: null
  };
}

function relayIsReady(relay) {
  return relay?.ready === true && relay?.session?.ready === true;
}

function relayCloseSucceeded(relay) {
  return relay?.closed === true && !relay.failure;
}

function isRuntimeReadyForInvite(state) {
  return state === HostRuntimeStates.RUNNING;
}

function failureSummary(reason) {
  return {
    [DesktopRoomControllerFailureReasons.CONTROL_PLANE_ROOM_FAILED]: "The room could not be registered.",
    [DesktopRoomControllerFailureReasons.CONTROL_PLANE_INVITE_FAILED]: "The invite could not be created.",
    [DesktopRoomControllerFailureReasons.RELAY_OPEN_FAILED]: "The relay tunnel could not be opened.",
    [DesktopRoomControllerFailureReasons.RELAY_CLOSE_FAILED]: "The relay tunnel could not be closed.",
    [DesktopRoomControllerFailureReasons.CLEANUP_PENDING]: "Finish closing the previous room before opening a new one."
  }[reason] ?? "The room could not be opened.";
}

function blockedRuntimeDto(reason) {
  return {
    state: "blocked",
    summary: failureSummary(reason),
    failure: {
      reason,
      message: failureSummary(reason)
    }
  };
}

function sanitizeValue(value, key = "", depth = 0) {
  if (typeof value === "string") {
    if (isTopLevelInviteLink(key, depth)) {
      return value;
    }
    return redactSecretString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, "", depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => isTopLevelInviteLink(entryKey, depth + 1) || !isSecretKey(entryKey))
        .map(([entryKey, entry]) => [entryKey, sanitizeValue(entry, entryKey, depth + 1)])
    );
  }

  return value;
}

function redactSecretString(value) {
  return String(value)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[redacted]")
    .replace(/\[(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]{0,}\](?::\d{1,5})?/gi, "[redacted]")
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[redacted-path]")
    .replace(/(^|\s)\/(?:Users|home|var|tmp|opt)\/[^\s"'<>]+/g, "$1[redacted-path]")
    .replace(/\b(invite|inviteToken|token|secret|password|credential|authorization|cookie)=([^&\s"'<>]+)/gi, "$1=[redacted]")
    .replace(/\b(Bearer|Basic)\s+[^&\s"'<>]+/gi, "$1 [redacted]");
}

function isSecretKey(key) {
  return /inviteLink|inviteUrl|inviteToken|rawInvite|token|secret|password|credential|authorization|cookie/i.test(key);
}

function isTopLevelInviteLink(key, depth) {
  return key === "inviteLink" && depth === 1;
}
