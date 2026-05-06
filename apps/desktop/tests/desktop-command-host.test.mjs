import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DesktopRuntimeCommands,
  createDesktopCommandHost
} from "../src/runtime/desktop-command-host.mjs";

test("desktop command host routes runtime commands to controller methods", async () => {
  const calls = [];
  const controller = createRecordingController(calls);
  const host = createDesktopCommandHost(controller);
  const roomRequest = { minecraftVersion: "1.21.1", pack: "performance", catalogModId: "lithium" };
  const emptyRequest = {};

  const cases = [
    [DesktopRuntimeCommands.PREPARE_ROOM, "prepareRoom", roomRequest],
    [DesktopRuntimeCommands.OPEN_ROOM, "openRoom", roomRequest],
    [DesktopRuntimeCommands.CLOSE_ROOM, "closeRoom", emptyRequest],
    [DesktopRuntimeCommands.RESTART_ROOM, "restartRoom", roomRequest],
    [DesktopRuntimeCommands.SEND_SERVER_COMMAND, "sendServerCommand", { command: "say hello" }],
    [DesktopRuntimeCommands.STATUS_ROOM, "status", emptyRequest],
    [DesktopRuntimeCommands.RESET_ROOM, "resetRoom", emptyRequest]
  ];

  for (const [command, method, request] of cases) {
    const result = await host.invoke(command, { request });
    assert.equal(result.state, `${method}:ok`);
  }

  assert.deepEqual(calls, cases.map(([, method, request]) => ({ method, request })));
});

test("desktop open command returns sanitized controller DTO", async () => {
  const openDto = {
    state: "running",
    summary: "Room is open.",
    inviteLink: "https://example.test/invite/room-a",
    runtimePlan: {
      room: { id: "room-a" },
      relay: { region: "local" },
      controlPlane: { hostSessionId: "host-a" }
    }
  };
  const host = createDesktopCommandHost({
    openRoom: async () => openDto
  });

  const result = await host.invoke(DesktopRuntimeCommands.OPEN_ROOM, {
    request: { minecraftVersion: "1.21.1", pack: "performance" }
  });

  assert.deepEqual(result, {
    state: "running",
    summary: "Room is open.",
    inviteLink: "https://example.test/invite/room-a",
    runtimePlan: {
      room: { id: "room-a" },
      relay: { region: "local" },
      controlPlane: {}
    }
  });
  assert.equal(result.inviteLink, "https://example.test/invite/room-a");
});

test("desktop command host fails closed for unknown commands", async () => {
  const host = createDesktopCommandHost({});

  const result = await host.invoke("desktop_delete_everything", {
    request: { roomId: "room-a" }
  });

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, "unknown_command");
});

test("desktop command host fails closed for known commands without controller methods", async () => {
  const host = createDesktopCommandHost({});

  const result = await host.invoke(DesktopRuntimeCommands.OPEN_ROOM, {
    request: { minecraftVersion: "1.21.1", pack: "performance" }
  });

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, "command_unavailable");
});

test("desktop command host rejects renderer-only attempts to pass internal options", async () => {
  const calls = [];
  const host = createDesktopCommandHost(createRecordingController(calls));

  const result = await host.invoke(DesktopRuntimeCommands.OPEN_ROOM, {
    request: {
      minecraftVersion: "1.21.1",
      pack: "performance",
      downloadFabric: true,
      lifecycleOptions: { mode: "real" }
    }
  });

  assert.equal(result.state, "blocked");
  assert.equal(result.failure.reason, "invalid_request");
  assert.equal(calls.length, 0);
});

test("desktop command host rejects nested or dangerous request values", async () => {
  const calls = [];
  const host = createDesktopCommandHost(createRecordingController(calls));

  const invalidRequests = [
    { minecraftVersion: "1.21.1", pack: { id: "performance" } },
    { minecraftVersion: "1.21.1", pack: "x".repeat(65) },
    { minecraftVersion: "1.21.1", javaOptions: { configuredPath: "C:/Java/bin/java.exe" } },
    { minecraftVersion: "1.21.1", mode: "dry-run" },
    { minecraftVersion: "1.21.1", constructor: "polluted" },
    { command: "say hello\nstop" }
  ];

  for (const request of invalidRequests) {
    const result = await host.invoke(DesktopRuntimeCommands.OPEN_ROOM, { request });
    assert.equal(result.state, "blocked");
    assert.equal(result.failure.reason, "invalid_request");
  }

  assert.equal(calls.length, 0);
});

test("desktop command host accepts only one-line server console commands", async () => {
  const calls = [];
  const host = createDesktopCommandHost(createRecordingController(calls));

  const accepted = await host.invoke(DesktopRuntimeCommands.SEND_SERVER_COMMAND, {
    request: { command: "whitelist add PlayerOne" }
  });
  assert.equal(accepted.state, "sendServerCommand:ok");
  assert.deepEqual(calls.at(-1), {
    method: "sendServerCommand",
    request: { command: "whitelist add PlayerOne" }
  });

  for (const command of ["", "say hello\nstop", "x".repeat(257), "\u0007"]) {
    const result = await host.invoke(DesktopRuntimeCommands.SEND_SERVER_COMMAND, {
      request: { command }
    });
    assert.equal(result.state, "blocked");
    assert.equal(result.failure.reason, "invalid_request");
  }
});

test("desktop reset returns idle DTO when controller has no reset method", async () => {
  const host = createDesktopCommandHost({});

  const result = await host.invoke(DesktopRuntimeCommands.RESET_ROOM, {
    request: {}
  });

  assert.deepEqual(result, {
    state: "idle",
    summary: "Room command host is idle."
  });
});

test("desktop status prefers room-aware status so invites can finish after runtime readiness", async () => {
  let statusRoomCalls = 0;
  let statusCalls = 0;
  const host = createDesktopCommandHost({
    statusRoom: () => {
      statusRoomCalls += 1;
      return {
        state: "running",
        inviteLink: "https://join.example.test/invite?invite=public-room-token"
      };
    },
    status: () => {
      statusCalls += 1;
      return {
        state: "running",
        summary: "Room is open."
      };
    }
  });

  const result = await host.invoke(DesktopRuntimeCommands.STATUS_ROOM);

  assert.equal(result.state, "running");
  assert.equal(statusRoomCalls, 1);
  assert.equal(statusCalls, 0);
  assert.equal(result.inviteLink, "https://join.example.test/invite?invite=public-room-token");
});

test("desktop command host redacts controller DTOs before renderer egress", async () => {
  const host = createDesktopCommandHost({
    openRoom: async () => ({
      state: "running",
      summary: "Room is open for user@example.test with token=raw-token.",
      inviteLink: "https://join.example.test/invite?invite=allowed-public-token",
      failure: {
        reason: "example",
        message: "Bearer raw-secret from 192.168.0.12:51234"
      },
      detail: {
        token: "raw-token",
        inviteLink: "https://join.example.test/invite?invite=nested-raw-token",
        sessionCredential: "raw-session",
        minecraftUuid: "123e4567-e89b-12d3-a456-426614174000",
        logPath: "C:/Users/Alice/AppData/server.log",
        safe: "hello"
      }
    })
  });

  const result = await host.invoke(DesktopRuntimeCommands.OPEN_ROOM, {
    request: { minecraftVersion: "1.21.1", pack: "performance" }
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.inviteLink, "https://join.example.test/invite?invite=allowed-public-token");
  assert.equal(Object.hasOwn(result.detail, "inviteLink"), false);
  assert.equal(result.detail.safe, "hello");
  assert.equal(serialized.includes("raw-token"), false);
  assert.equal(serialized.includes("nested-raw-token"), false);
  assert.equal(serialized.includes("raw-session"), false);
  assert.equal(serialized.includes("user@example.test"), false);
  assert.equal(serialized.includes("123e4567-e89b-12d3-a456-426614174000"), false);
  assert.equal(serialized.includes("192.168.0.12"), false);
  assert.equal(serialized.includes("C:/Users/Alice"), false);
});

function createRecordingController(calls) {
  const controller = {};
  for (const method of ["prepareRoom", "openRoom", "closeRoom", "restartRoom", "sendServerCommand", "status", "resetRoom"]) {
    controller[method] = async (request) => {
      calls.push({ method, request });
      return { state: `${method}:ok` };
    };
  }
  return controller;
}
