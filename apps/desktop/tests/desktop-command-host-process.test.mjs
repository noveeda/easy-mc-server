import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDesktopCommandHostForDevRuntime,
  handleCommandFrame
} from "../src/runtime/desktop-command-host-process.mjs";

test("desktop command host process handler handles multiple JSONL frames", async () => {
  const devRoot = await mkdtemp(join(tmpdir(), "easy-mc-desktop-host-"));
  const commandHost = await createDesktopCommandHostForDevRuntime({
    runtimePlanOptions: {
      appDataRoot: devRoot
    }
  });

  try {
    const status = await handleCommandFrame(commandHost, JSON.stringify({
      id: 1,
      command: "desktop_status_room",
      request: {}
    }));
    assert.equal(status.id, 1);
    assert.equal(status.ok, true);
    assert.equal(status.result.state, "stopped");
    assert.equal(status.result.inviteLink, undefined);

    const commandBeforeOpen = await handleCommandFrame(commandHost, JSON.stringify({
      id: 2,
      command: "desktop_send_server_command",
      request: { command: "say hello world" }
    }));
    assert.equal(commandBeforeOpen.id, 2);
    assert.equal(commandBeforeOpen.ok, true);
    assert.equal(commandBeforeOpen.result.failure.reason, "server_command_unavailable");

    const unknown = await handleCommandFrame(commandHost, JSON.stringify({
      id: 3,
      command: "desktop_delete_everything",
      request: {}
    }));
    assert.equal(unknown.id, 3);
    assert.equal(unknown.result.state, "blocked");
    assert.equal(unknown.result.failure.reason, "unknown_command");

    const malformed = await handleCommandFrame(commandHost, "not-json");
    assert.equal(malformed.id, null);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.result.failure.reason, "invalid_frame");
  } finally {
    await rm(devRoot, { recursive: true, force: true });
  }
});
