import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("desktop state preserves pending CPU metrics while memory metrics are available", async () => {
  const model = await loadRoomDesktopState();
  const state = model.reduceRoomState(model.cloneInitialState(), {
    type: "bridge:result",
    result: {
      state: "running",
      open: true,
      metrics: {
        pid: 4321,
        source: "test-process",
        measuredAt: "2026-05-02T00:00:00.000Z",
        cpu: { processPercent: null },
        memory: {
          workingSetBytes: 512,
          totalBytes: 1024
        }
      }
    }
  });

  assert.equal(state.metrics.pid, 4321);
  assert.equal(state.metrics.cpu.processPercent, null);
  assert.equal(state.metrics.memory.workingSetBytes, 512);
  assert.equal(state.metrics.memory.totalBytes, 1024);
  assert.equal(state.metrics.memory.processPercent, 50);
  assert.equal(state.metricsProblem, null);
});

test("desktop state exposes process metric sampling failures for the UI", async () => {
  const model = await loadRoomDesktopState();
  const state = model.reduceRoomState(model.cloneInitialState(), {
    type: "bridge:result",
    result: {
      state: "running",
      open: true,
      events: [
        {
          type: "runtime.metrics_unavailable",
          message: "spawn EPERM C:/Users/Alice/AppData/server.log"
        }
      ]
    }
  });

  assert.equal(state.metrics, null);
  assert.equal(
    state.metricsProblem,
    "서버 자원 사용률을 아직 읽지 못했습니다: spawn EPERM [redacted-path]"
  );
  assert.ok(state.consoleLines.includes("[system] 서버 자원 사용률을 아직 읽지 못했습니다: spawn EPERM [redacted-path]"));
});

test("desktop state does not surface invite links before room readiness is complete", async () => {
  const model = await loadRoomDesktopState();
  const initialState = model.cloneInitialState();

  for (const result of [
    {
      state: "starting",
      inviteLink: "https://join.example.test/invite?invite=starting-token",
      controlPlane: { ready: true, room: { ready: true }, invite: { ready: true } },
      relay: { ready: true, session: { ready: true } }
    },
    {
      state: "running",
      inviteLink: "https://join.example.test/invite?invite=control-plane-token",
      controlPlane: { ready: false, room: { ready: true }, invite: { ready: false } },
      relay: { ready: true, session: { ready: true } }
    },
    {
      state: "running",
      inviteLink: "https://join.example.test/invite?invite=relay-token",
      controlPlane: { ready: true, room: { ready: true }, invite: { ready: true } },
      relay: { ready: false, session: { ready: false } }
    }
  ]) {
    const state = model.reduceRoomState(initialState, {
      type: "bridge:result",
      result
    });

    assert.equal(state.inviteLink, null);
  }
});

test("desktop state clears stale invite links when readiness regresses", async () => {
  const model = await loadRoomDesktopState();
  const openState = model.reduceRoomState(model.cloneInitialState(), {
    type: "bridge:result",
    result: {
      state: "running",
      inviteLink: "https://join.easymc.gg/invite?invite=public-room-token",
      controlPlane: { ready: true, room: { ready: true }, invite: { ready: true } },
      relay: { ready: true, session: { ready: true } }
    }
  });

  const regressedState = model.reduceRoomState(openState, {
    type: "bridge:result",
    result: {
      state: "running",
      controlPlane: { ready: false, room: { ready: true }, invite: { ready: false } },
      relay: { ready: true, session: { ready: true } }
    }
  });

  assert.equal(openState.inviteLink, "https://join.easymc.gg/invite?invite=public-room-token");
  assert.equal(regressedState.inviteLink, null);
});

test("desktop state redacts raw invite tokens from non-link diagnostics", async () => {
  const model = await loadRoomDesktopState();
  const state = model.reduceRoomState(model.cloneInitialState(), {
    type: "bridge:result",
    result: {
      state: "blocked",
      failure: {
        reason: "control_plane_invite_failed",
        message: "invite=raw-secret-token token=nested-secret",
        detail: {
          inviteUrl: "https://join.example.test/invite?invite=raw-secret-token",
          inviteToken: "nested-secret"
        }
      }
    }
  });
  const rendered = JSON.stringify({
    blocker: state.blocker,
    diagnostics: state.diagnostics,
    consoleLines: state.consoleLines
  });

  assert.equal(rendered.includes("raw-secret-token"), false);
  assert.equal(rendered.includes("nested-secret"), false);
  assert.ok(rendered.includes("[redacted]"));
});

test("desktop state allows copying only public HTTPS invite links", async () => {
  const model = await loadRoomDesktopState();
  const shareable = "https://join.easymc.gg/invite?invite=public-handle-a";
  const blocked = [
    "http://join.easymc.gg/invite?invite=public-handle-a",
    "https://join.easymc.gg/invite",
    "https://localhost/invite?invite=public-handle-a",
    "https://127.0.0.1/invite?invite=public-handle-a",
    "https://192.168.0.10/invite?invite=public-handle-a",
    "https://100.64.0.1/invite?invite=public-handle-a",
    "https://198.18.0.1/invite?invite=public-handle-a",
    "https://224.0.0.1/invite?invite=public-handle-a",
    "https://240.0.0.1/invite?invite=public-handle-a",
    "https://[::1]/invite?invite=public-handle-a",
    "https://[2001:db8::1]/invite?invite=public-handle-a",
    "https://easy-mc.local/invite?invite=public-handle-a",
    "https://join.example.test/invite?invite=public-handle-a",
    "https://example.invalid/invite?invite=public-handle-a",
    "https://not-allowed.example.com/invite?invite=public-handle-a",
    "https://user:pass@join.easymc.gg/invite?invite=public-handle-a"
  ];

  assert.equal(model.isShareableInviteLink(shareable), true);
  for (const link of blocked) {
    assert.equal(model.isShareableInviteLink(link), false, link);
  }
});

test("desktop catalog selection becomes a verified server-applied assessment", async () => {
  const model = await loadRoomDesktopState();
  const initialState = model.cloneInitialState();
  const selectedState = model.reduceRoomState(initialState, {
    type: "catalog:select",
    modId: "lithium"
  });

  assert.equal(initialState.catalog.appliedToServer, true);
  assert.equal(selectedState.catalog.selectedId, "lithium");
  assert.equal(selectedState.catalog.appliedToServer, true);
  assert.equal(selectedState.catalog.gate, "m6_curated_beta");
  assert.equal(selectedState.catalog.selected.risk.label, "높은 신뢰");
  assert.ok(selectedState.catalog.selected.dependencies.length > 0);
  assert.ok(selectedState.catalog.selected.conflicts.length > 0);
  assert.equal(selectedState.catalog.selected.serverApplicability.label, "서버 적용");
});

async function loadRoomDesktopState() {
  const source = await readFile(new URL("../state.js", import.meta.url), "utf8");
  const context = { console, URL };
  runInNewContext(source, context, { filename: "state.js" });
  return context.RoomDesktopState;
}
