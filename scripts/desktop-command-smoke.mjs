import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { HostRuntimeStates } from "../apps/desktop/src/runtime/host-runtime.mjs";
import { createLocalServerLifecycleManager } from "../apps/desktop/src/runtime/node-local-runtime.mjs";

const commandHostScript = resolve("apps/desktop/src/runtime/desktop-command-host-process.mjs");
const devRoot = await mkdtemp(join(tmpdir(), "easy-mc-desktop-smoke-"));
const child = spawn(process.execPath, [commandHostScript], {
  cwd: resolve("apps/desktop"),
  env: {
    ...process.env,
    EASY_MC_DESKTOP_DEV_ROOT: devRoot
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
const stderr = [];
let nextId = 0;

lines.on("line", (line) => {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    stderr.push(`invalid stdout frame: ${line}`);
    return;
  }

  if (parsed?.event === "desktop_runtime_event") {
    return;
  }

  const waiter = pending.get(parsed?.id);
  if (waiter) {
    pending.delete(parsed.id);
    waiter.resolve(parsed);
  }
});

child.stderr.on("data", (chunk) => {
  stderr.push(String(chunk));
});

child.on("exit", (code, signal) => {
  for (const [id, waiter] of pending) {
    pending.delete(id);
    waiter.reject(new Error(`desktop command host exited early: code=${code} signal=${signal}`));
  }
});

try {
  const initial = await sendCommand("desktop_status_room");
  assert.equal(initial.result?.state, "stopped", "initial desktop status should be stopped");
  assertNoInvite(initial, "initial status must not include an invite link");

  const commandBeforeOpen = await sendCommand("desktop_send_server_command", {
    command: "say hello world"
  });
  assert.equal(commandBeforeOpen.result?.failure?.reason, "server_command_unavailable");
  assertNoInvite(commandBeforeOpen, "server command before open must not include an invite link");

  const prepared = await sendCommand("desktop_prepare_room", {
    minecraftVersion: "1.21.1",
    pack: "performance"
  });
  assert(
    ["ready", "blocked"].includes(prepared.result?.state),
    `prepare should be ready or honestly blocked, received ${prepared.result?.state}`
  );
  assertNoInvite(prepared, "prepare must not include an invite link");

  const afterPrepare = await sendCommand("desktop_status_room");
  assert(["ready", "blocked", "stopped"].includes(afterPrepare.result?.state), "status should remain responsive after prepare");
  assertNoInvite(afterPrepare, "status must not include an invite link before open succeeds");

  const reset = await sendCommand("desktop_reset_room");
  assert(["idle", "stopped"].includes(reset.result?.state), "reset should return an idle or stopped DTO");
  assertNoInvite(reset, "reset must not include an invite link");

  await assertServerCommandWritesToStdin();

  console.log("Desktop command smoke: passed");
} finally {
  child.kill();
  child.stdin.destroy();
  await rm(devRoot, { recursive: true, force: true });
}

async function sendCommand(command, request = {}) {
  const id = ++nextId;
  child.stdin.write(`${JSON.stringify({ id, command, request })}\n`);
  const parsed = await nextFrame(id, 10000);

  assert.equal(parsed.id, id, `response id should match command ${command}`);
  return parsed;
}

function nextFrame(id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve(frame) {
        clearTimeout(timeout);
        resolve(frame);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`desktop command host timed out\nstderr=${stderr.join("")}`));
    }, timeoutMs);

    pending.set(id, waiter);
  });
}

function assertNoInvite(frame, message) {
  assert.equal(frame.result?.inviteLink, undefined, message);
}

async function assertServerCommandWritesToStdin() {
  const process = createFakeServerProcess();
  const manager = createLocalServerLifecycleManager({
    room: { id: "desktop-command-smoke-room" }
  }, {
    mode: "real",
    launch: async () => ({
      ok: true,
      launched: true,
      mode: "real",
      intent: {
        type: "process.start",
        healthCheck: {
          readyLogPattern: "Done"
        }
      },
      process
    }),
    readProcessMetrics: async () => null
  });

  const started = await manager.start();
  assert.equal(started.ok, true, "fake server process should start for command smoke");

  process.stdout.emit("data", "Done (0.1s)! For help, type \"help\"\n");
  assert.equal(manager.status().state, HostRuntimeStates.RUNNING, "fake server process should reach running state");

  const sent = await manager.sendCommand({ command: "say hello world" });
  const commandEvent = manager.status().events.find((event) => event.type === "runtime.command");

  assert.equal(sent.ok, true, "say hello world should be accepted while the server is running");
  assert.deepEqual(process.stdinWrites, ["say hello world\n"], "say hello world must be written to server stdin");
  assert.equal(commandEvent?.line, "say hello world", "command smoke should expose a redacted runtime command event");

  process.emit("exit", 0, null);
}

function createFakeServerProcess() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdinWrites = [];
  process.stdin = {
    write(command, callback) {
      process.stdinWrites.push(command);
      callback?.();
      return true;
    }
  };
  process.kill = () => {
    process.emit("exit", null, "SIGTERM");
  };
  return process;
}
