export const BridgeJoinStates = Object.freeze({
  ALLOWED: "allowed",
  PENDING_APPROVAL: "pending_approval",
  DENIED: "denied",
  BLOCKED: "blocked"
});

export const BridgeDecisionTypes = Object.freeze({
  APPROVED: "approved",
  DENIED: "denied",
  BLOCKED: "blocked"
});

export const ControlPlaneOutagePolicies = Object.freeze({
  ALLOW_PREVIOUSLY_APPROVED: "allow_previously_approved",
  DENY_ALL: "deny_all"
});

const InGameMessages = Object.freeze({
  pending: "호스트가 승인하면 다시 들어올 수 있습니다.",
  denied: "호스트가 요청을 거절했습니다. 다시 초대받은 뒤 시도해 주세요.",
  blocked: "이 방에 들어올 수 없습니다.",
  controlPlaneOffline: "방 승인 상태를 확인할 수 없어 잠시 후 다시 시도해 주세요."
});

export function createServerBridgeState(config = {}) {
  const state = {
    roomId: config.roomId ?? "local-room",
    allowlistPath: config.allowlistPath ?? "whitelist.json",
    outagePolicy: config.outagePolicy ?? ControlPlaneOutagePolicies.ALLOW_PREVIOUSLY_APPROVED,
    controlPlaneOnline: config.controlPlaneOnline !== false,
    approved: normalizePlayers(config.allowlist),
    blocked: normalizePlayers(config.blocked),
    pending: new Map(),
    lastEvent: null
  };

  return {
    observePlayerJoin(input = {}) {
      const minecraftUuid = input.serverObservedUuid;

      if (!minecraftUuid) {
        return fail("server_uuid_missing", "서버가 확인한 Minecraft UUID가 필요합니다.");
      }

      if (state.blocked.has(minecraftUuid)) {
        state.lastEvent = {
          type: "bridge.join_blocked",
          roomId: state.roomId,
          minecraftUuid
        };

        return {
          state: BridgeJoinStates.BLOCKED,
          allowed: false,
          minecraftUuid,
          kickMessage: InGameMessages.blocked
        };
      }

      if (state.approved.has(minecraftUuid)) {
        if (!state.controlPlaneOnline && state.outagePolicy === ControlPlaneOutagePolicies.DENY_ALL) {
          state.lastEvent = {
            type: "bridge.join_denied",
            roomId: state.roomId,
            minecraftUuid,
            reason: "control_plane_offline"
          };

          return {
            state: BridgeJoinStates.DENIED,
            allowed: false,
            minecraftUuid,
            kickMessage: InGameMessages.controlPlaneOffline
          };
        }

        state.lastEvent = {
          type: "bridge.join_allowed",
          roomId: state.roomId,
          minecraftUuid
        };

        return {
          state: BridgeJoinStates.ALLOWED,
          allowed: true,
          minecraftUuid
        };
      }

      if (!state.controlPlaneOnline) {
        state.lastEvent = {
          type: "bridge.join_denied",
          roomId: state.roomId,
          minecraftUuid,
          reason: "control_plane_offline"
        };

        return {
          state: BridgeJoinStates.DENIED,
          allowed: false,
          minecraftUuid,
          kickMessage: InGameMessages.controlPlaneOffline
        };
      }

      const claimedMinecraftUuid = input.claimedIdentity?.minecraftUuid;
      const event = {
        type: "bridge.approval_requested",
        roomId: state.roomId,
        connectionId: input.connectionId,
        friendId: input.claimedIdentity?.friendId,
        displayName: input.displayName,
        minecraftUuid,
        claimedMinecraftUuid,
        requiresHostApproval: true,
        identityMismatch: Boolean(claimedMinecraftUuid && claimedMinecraftUuid !== minecraftUuid)
      };

      state.pending.set(minecraftUuid, event);
      state.lastEvent = event;

      return {
        state: BridgeJoinStates.PENDING_APPROVAL,
        allowed: false,
        minecraftUuid,
        event,
        kickMessage: InGameMessages.pending
      };
    },

    applyApprovalDecision(input = {}) {
      const minecraftUuid = input.minecraftUuid;

      if (!minecraftUuid) {
        return fail("minecraft_uuid_missing", "Minecraft UUID가 필요합니다.");
      }

      if (!state.pending.has(minecraftUuid)) {
        return fail("approval_request_missing", "대기 중인 승인 요청이 없습니다.");
      }

      if (input.decision === BridgeDecisionTypes.APPROVED) {
        state.pending.delete(minecraftUuid);
        state.blocked.delete(minecraftUuid);
        state.approved.set(minecraftUuid, {
          uuid: minecraftUuid,
          name: input.displayName ?? input.name ?? minecraftUuid
        });
        state.lastEvent = {
          type: "bridge.allowlist_updated",
          roomId: state.roomId,
          minecraftUuid,
          decision: BridgeDecisionTypes.APPROVED
        };

        return {
          state: BridgeJoinStates.ALLOWED,
          allowed: true,
          minecraftUuid,
          persistence: createAllowlistPersistence(state)
        };
      }

      if (input.decision === BridgeDecisionTypes.BLOCKED) {
        state.pending.delete(minecraftUuid);
        state.approved.delete(minecraftUuid);
        state.blocked.set(minecraftUuid, {
          uuid: minecraftUuid,
          name: input.displayName ?? input.name ?? minecraftUuid
        });
        state.lastEvent = {
          type: "bridge.player_blocked",
          roomId: state.roomId,
          minecraftUuid
        };

        return {
          state: BridgeJoinStates.BLOCKED,
          allowed: false,
          minecraftUuid,
          kickMessage: InGameMessages.blocked,
          persistence: createAllowlistPersistence(state)
        };
      }

      if (input.decision !== BridgeDecisionTypes.DENIED) {
        return fail("unsupported_decision", "지원하지 않는 승인 결정입니다.");
      }

      state.pending.delete(minecraftUuid);
      state.lastEvent = {
        type: "bridge.player_denied",
        roomId: state.roomId,
        minecraftUuid
      };

      return {
        state: BridgeJoinStates.DENIED,
        allowed: false,
        minecraftUuid,
        kickMessage: InGameMessages.denied
      };
    },

    canPlayerJoin(input = {}) {
      const minecraftUuid = input.minecraftUuid;
      const controlPlaneOnline = input.controlPlaneOnline ?? state.controlPlaneOnline;

      if (state.blocked.has(minecraftUuid)) {
        return {
          allowed: false,
          state: BridgeJoinStates.BLOCKED,
          kickMessage: InGameMessages.blocked
        };
      }

      if (state.approved.has(minecraftUuid)) {
        if (!controlPlaneOnline && state.outagePolicy === ControlPlaneOutagePolicies.DENY_ALL) {
          return {
            allowed: false,
            state: BridgeJoinStates.DENIED,
            kickMessage: InGameMessages.controlPlaneOffline
          };
        }

        return {
          allowed: true,
          state: BridgeJoinStates.ALLOWED,
          outageMode: !controlPlaneOnline
        };
      }

      if (!controlPlaneOnline) {
        return {
          allowed: false,
          state: BridgeJoinStates.DENIED,
          kickMessage: InGameMessages.controlPlaneOffline
        };
      }

      return {
        allowed: false,
        state: state.pending.has(minecraftUuid) ? BridgeJoinStates.PENDING_APPROVAL : BridgeJoinStates.DENIED,
        kickMessage: state.pending.has(minecraftUuid) ? InGameMessages.pending : InGameMessages.denied
      };
    },

    setControlPlaneOnline(online) {
      state.controlPlaneOnline = online === true;
    },

    readAllowlist() {
      return [...state.approved.values()].sort((left, right) => left.uuid.localeCompare(right.uuid));
    },

    readHealth() {
      return {
        type: "bridge.health",
        roomId: state.roomId,
        status: "healthy",
        controlPlaneOnline: state.controlPlaneOnline,
        outagePolicy: state.outagePolicy,
        pendingCount: state.pending.size,
        allowedCount: state.approved.size,
        blockedCount: state.blocked.size,
        lastEventType: state.lastEvent?.type ?? null
      };
    }
  };
}

export function serializeMinecraftWhitelist(players = []) {
  return `${JSON.stringify(players.map((player) => ({
    uuid: player.uuid,
    name: player.name ?? player.uuid
  })), null, 2)}\n`;
}

function createAllowlistPersistence(state) {
  return {
    path: state.allowlistPath,
    kind: "minecraft-whitelist",
    contents: serializeMinecraftWhitelist([...state.approved.values()])
  };
}

function normalizePlayers(players = []) {
  return new Map(players.map((player) => [
    player.uuid,
    {
      uuid: player.uuid,
      name: player.name ?? player.uuid
    }
  ]));
}

function fail(reason, message) {
  return {
    ok: false,
    failure: {
      reason,
      message
    }
  };
}
