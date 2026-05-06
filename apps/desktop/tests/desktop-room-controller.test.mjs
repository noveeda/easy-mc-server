import { test } from "node:test";
import assert from "node:assert/strict";
import { HostRuntimeStates } from "../src/runtime/host-runtime.mjs";
import {
  DesktopRoomControllerFailureReasons,
  createDesktopRoomController
} from "../src/runtime/desktop-room-controller.mjs";
import { createControlPlaneSimulation } from "../../../services/control-plane/src/domain/simulation.mjs";

test("desktop room controller does not create invite when runtime is blocked", async () => {
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: "blocked",
        summary: "Runtime blocked.",
        failure: {
          reason: "java_missing",
          message: "Runtime blocked."
        }
      }
    }),
    controlPlane: createControlPlaneSimulation()
  });

  const result = await controller.openRoom();

  assert.equal(result.state, "blocked");
  assert.equal(result.inviteLink, undefined);
  assert.equal(result.controlPlane.ready, false);
  assert.equal(result.relay.ready, false);
});

test("desktop room controller does not create invite while runtime is still starting", async () => {
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: HostRuntimeStates.STARTING,
        summary: "Room is opening."
      }
    }),
    controlPlane: createControlPlaneSimulation()
  });

  const result = await controller.openRoom();

  assert.equal(result.state, HostRuntimeStates.STARTING);
  assert.equal(result.inviteLink, undefined);
  assert.equal(result.controlPlane.ready, false);
  assert.equal(result.relay.ready, false);
});

test("desktop room controller creates invite and ready relay for fake running runtime", async () => {
  const hostToken = "host-token-secret";
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: HostRuntimeStates.RUNNING,
        summary: "Room is open."
      }
    }),
    controlPlane: createControlPlaneSimulation(),
    inviteBaseUrl: "https://join.example.test/invite",
    createHostTunnelToken: () => hostToken
  });

  const result = await controller.openRoom();

  assert.equal(result.state, HostRuntimeStates.RUNNING);
  assert.ok(result.inviteLink.startsWith("https://join.example.test/invite?invite="));
  assert.equal(result.controlPlane.ready, true);
  assert.equal(result.controlPlane.room.ready, true);
  assert.equal(result.controlPlane.invite.ready, true);
  assert.equal(result.relay.ready, true);
  assert.equal(result.relay.session.ready, true);
  assert.equal(result.relay.tunnel.target.host, "[redacted]");
  assert.equal(result.relay.tunnel.target.port, 25565);
  assert.equal(JSON.stringify(result.controlPlane).includes(hostToken), false);
  assert.equal(JSON.stringify(result.relay).includes(hostToken), false);
});

test("desktop room controller fail-closes when control-plane room creation fails", async () => {
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: {
      async createRoom() {
        return {
          ok: false,
          reason: "room_quota"
        };
      }
    }
  });

  const result = await controller.openRoom();

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, DesktopRoomControllerFailureReasons.CONTROL_PLANE_ROOM_FAILED);
  assert.equal(result.inviteLink, undefined);
  assert.equal(result.controlPlane.ready, false);
  assert.equal(runtimeBridge.closeCalls(), 1);
});

test("desktop room controller fail-closes when control-plane invite creation fails", async () => {
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: {
      async createRoom() {
        return {
          ok: true,
          room: {
            id: "room-service-a",
            state: "open"
          }
        };
      },
      async createInvite() {
        return {
          ok: false,
          reason: "invite_service_failed",
          detail: {
            inviteUrl: "https://join.example.test/invite?invite=raw-secret",
            inviteLink: "https://join.example.test/invite?invite=nested-raw-secret"
          }
        };
      },
      async revokeInvite() {
        return { ok: true };
      }
    }
  });

  const result = await controller.openRoom();

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, DesktopRoomControllerFailureReasons.CONTROL_PLANE_INVITE_FAILED);
  assert.equal(result.inviteLink, undefined);
  assert.equal(runtimeBridge.closeCalls(), 1);
  assert.equal(JSON.stringify(result).includes("raw-secret"), false);
  assert.equal(JSON.stringify(result).includes("nested-raw-secret"), false);
});

test("desktop room controller accepts service-shaped async room and invite results", async () => {
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: HostRuntimeStates.RUNNING,
        summary: "Room is open."
      }
    }),
    controlPlane: {
      async createRoom() {
        return {
          ok: true,
          room: {
            id: "room-service-a",
            state: "open"
          }
        };
      },
      async createInvite() {
        return {
          ok: true,
          invite: {
            id: "invite-service-a",
            publicHandle: "service-handle-a",
            token: "service-token-a",
            expiresAt: 1770000000000
          }
        };
      },
      async revokeInvite() {
        return { ok: true };
      },
      heartbeatHost() {
        return true;
      }
    },
    inviteBaseUrl: "https://join.example.test/invite"
  });

  const result = await controller.openRoom();

  assert.equal(result.state, HostRuntimeStates.RUNNING);
  assert.equal(result.controlPlane.room.id, "room-service-a");
  assert.equal(Object.hasOwn(result.controlPlane.invite, "id"), false);
  assert.equal(new URL(result.inviteLink).searchParams.get("invite"), "service-handle-a");
  assert.equal(JSON.stringify(result.controlPlane).includes("service-token-a"), false);
});

test("desktop room controller rejects token-only invite responses", async () => {
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: HostRuntimeStates.RUNNING,
        summary: "Room is open."
      }
    }),
    controlPlane: {
      createRoom() {
        return {
          id: "room-token-only",
          state: "open"
        };
      },
      createInvite() {
        return {
          ok: true,
          invite: {
            id: "invite-token-only",
            token: "raw-invite-token"
          }
        };
      },
      revokeInvite() {
        return { ok: true };
      }
    },
    inviteBaseUrl: "https://join.example.test/invite"
  });

  const result = await controller.openRoom();

  assert.equal(result.state, "blocked");
  assert.equal(result.inviteLink, undefined);
  assert.equal(result.failure.reason, DesktopRoomControllerFailureReasons.CONTROL_PLANE_INVITE_FAILED);
  assert.equal(JSON.stringify(result).includes("raw-invite-token"), false);
});

test("desktop room controller restart preserves an existing ready invite", async () => {
  let createRoomCalls = 0;
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: {
      createRoom() {
        createRoomCalls += 1;
        return {
          id: `room-${createRoomCalls}`,
          state: "open"
        };
      },
      createInvite() {
        return {
          ok: true,
          inviteId: `invite-${createRoomCalls}`,
          handle: `invite-handle-${createRoomCalls}`,
          expiresAt: 1770000000000
        };
      },
      revokeInvite() {
        return { ok: true };
      },
      heartbeatHost() {
        return true;
      }
    },
    inviteBaseUrl: "https://join.example.test/invite"
  });

  const opened = await controller.openRoom();
  const restarted = await controller.restartRoom();

  assert.equal(restarted.inviteLink, opened.inviteLink);
  assert.equal(createRoomCalls, 1);
});

test("desktop room controller clears invite and marks relay closed after closeRoom", async () => {
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: createControlPlaneSimulation()
  });

  const opened = await controller.openRoom();
  const closed = await controller.closeRoom();

  assert.ok(opened.inviteLink);
  assert.equal(closed.state, HostRuntimeStates.STOPPED);
  assert.equal(closed.inviteLink, undefined);
  assert.equal(closed.relay.ready, false);
  assert.equal(closed.relay.closed, true);
  assert.equal(closed.relay.session.closed, true);
  assert.equal(runtimeBridge.closeCalls(), 1);
  assert.equal(controller.status().inviteLink, undefined);
});

test("desktop room controller keeps relay cleanup retry state when relay close fails", async () => {
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  let closeAttempts = 0;
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: createControlPlaneSimulation(),
    relayFactory: () => ({
      async openHostTunnel() {
        return {
          ok: true,
          tunnel: {
            id: "tunnel-a",
            state: "open",
            target: {
              kind: "minecraft",
              host: "127.0.0.1",
              port: 25565
            }
          }
        };
      },
      async closeHostTunnel() {
        closeAttempts += 1;
        return closeAttempts === 1
          ? { ok: false, reason: "temporary_relay_close_failure" }
          : {
              ok: true,
              tunnel: {
                id: "tunnel-a",
                state: "closed"
              }
            };
      }
    })
  });

  await controller.openRoom();
  const firstClose = await controller.closeRoom();
  const blockedOpen = await controller.openRoom();
  const secondClose = await controller.closeRoom();

  assert.equal(firstClose.state, "blocked");
  assert.equal(firstClose.failure.reason, DesktopRoomControllerFailureReasons.RELAY_CLOSE_FAILED);
  assert.equal(blockedOpen.state, "blocked");
  assert.equal(blockedOpen.failure.reason, DesktopRoomControllerFailureReasons.CLEANUP_PENDING);
  assert.equal(secondClose.state, HostRuntimeStates.STOPPED);
  assert.equal(secondClose.relay.closed, true);
  assert.equal(closeAttempts, 2);
});

test("desktop room controller status keeps invite without leaking raw token into details", async () => {
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge: createFakeRuntimeBridge({
      openResult: {
        state: HostRuntimeStates.RUNNING,
        summary: "Room is open."
      }
    }),
    controlPlane: createControlPlaneSimulation(),
    inviteBaseUrl: "https://join.example.test/invite",
    createHostTunnelToken: () => "relay-host-raw-token"
  });

  const opened = await controller.openRoom();
  const status = controller.status();
  const rawInviteToken = new URL(opened.inviteLink).searchParams.get("invite");

  assert.equal(status.state, HostRuntimeStates.RUNNING);
  assert.equal(status.inviteLink, opened.inviteLink);
  assert.ok(rawInviteToken);
  assert.equal(JSON.stringify(status.controlPlane).includes(rawInviteToken), false);
  assert.equal(JSON.stringify(status.relay).includes(rawInviteToken), false);
  assert.equal(JSON.stringify(status.controlPlane).includes("relay-host-raw-token"), false);
  assert.equal(JSON.stringify(status.relay).includes("relay-host-raw-token"), false);
});

test("desktop room controller fail-closes when relay host tunnel cannot open", async () => {
  const runtimeBridge = createFakeRuntimeBridge({
    openResult: {
      state: HostRuntimeStates.RUNNING,
      summary: "Room is open."
    }
  });
  const controller = createDesktopRoomController(createRuntimePlan(), {
    runtimeBridge,
    controlPlane: createControlPlaneSimulation(),
    relayFactory: () => ({
      async openHostTunnel() {
        return {
          ok: false,
          reason: "host_tunnel_unavailable",
          detail: {
            token: "relay-secret"
          }
        };
      },
      async closeHostTunnel() {
        return {
          ok: false,
          reason: "host_tunnel_unavailable"
        };
      }
    })
  });

  const result = await controller.openRoom();

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, DesktopRoomControllerFailureReasons.RELAY_OPEN_FAILED);
  assert.equal(result.inviteLink, undefined);
  assert.equal(result.relay.ready, false);
  assert.equal(runtimeBridge.closeCalls(), 1);
  assert.equal(JSON.stringify(result).includes("relay-secret"), false);
});

function createRuntimePlan() {
  return {
    room: {
      id: "room-a",
      hostId: "host-a",
      name: "Cozy Room",
      minecraftVersion: "1.21.1"
    },
    pack: {
      id: "mvp0-performance"
    }
  };
}

function createFakeRuntimeBridge({ openResult }) {
  let state = HostRuntimeStates.STOPPED;
  let closeCount = 0;

  return {
    async prepareRoom() {
      state = HostRuntimeStates.READY;
      return {
        state,
        summary: "Room files are ready."
      };
    },
    async openRoom() {
      state = openResult.state;
      return openResult;
    },
    async closeRoom() {
      closeCount += 1;
      state = HostRuntimeStates.STOPPED;
      return {
        state,
        summary: "Room is closed."
      };
    },
    async restartRoom() {
      state = openResult.state;
      return {
        ...openResult,
        summary: "Room is restarting."
      };
    },
    status() {
      return {
        state,
        summary: state === HostRuntimeStates.RUNNING ? "Room is open." : "Room status."
      };
    },
    closeCalls() {
      return closeCount;
    }
  };
}
