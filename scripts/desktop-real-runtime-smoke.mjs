import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const commandHostScript = resolve("apps/desktop/src/runtime/desktop-command-host-process.mjs");
const devRoot = resolve(".local/desktop-tauri-dev");
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
const runtimeEvents = [];
let nextId = 0;
let openedRoom = false;

lines.on("line", (line) => {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    stderr.push(`invalid stdout frame: ${line}`);
    return;
  }

  if (parsed?.event === "desktop_runtime_event") {
    runtimeEvents.push(parsed.payload);
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
  const prepared = await sendCommand("desktop_prepare_room", {
    minecraftVersion: "1.21.1",
    pack: "performance"
  });
  assert.equal(prepared.result?.state, "ready", describeFailure("prepare", prepared));

  const opened = await sendCommand("desktop_open_room", {
    minecraftVersion: "1.21.1",
    pack: "performance"
  }, 30000);
  assert(["starting", "running"].includes(opened.result?.state), describeFailure("open", opened));
  openedRoom = true;

  const running = await waitForRunningStatus();
  assert.equal(running.result?.state, "running", describeFailure("status", running));
  assert.ok(running.result?.metrics?.pid, "running status should include server process metrics");
  assert.ok(running.result.metrics.memory.workingSetBytes > 0, "running status should include server memory usage");
  assert.ok(running.result?.inviteLink, "running status should include an invite link after control-plane and relay readiness");
  const inviteToken = new URL(running.result.inviteLink).searchParams.get("invite");
  assert.ok(inviteToken, "invite link should include an invite handle");
  assert.equal(
    JSON.stringify({ ...running.result, inviteLink: undefined }).includes(inviteToken),
    false,
    "raw invite handle must not leak outside the public invite link"
  );

  const command = await sendCommand("desktop_send_server_command", {
    command: "say hello world"
  });
  assert.equal(command.result?.failure, undefined, describeFailure("send command", command));
  assert.equal(command.result?.state, "running", describeFailure("send command", command));
  assert(
    command.result?.events?.some((event) => event.type === "runtime.command" && event.line === "say hello world"),
    "server command result should include the redacted runtime.command event"
  );
  const commandLog = await waitForCommandLog("hello world");
  assert.ok(commandLog, "server log should include the say hello world command output");

  const closed = await sendCommand("desktop_close_room", {}, 15000);
  assert(["stopped", "failed"].includes(closed.result?.state), describeFailure("close", closed));
  openedRoom = false;

  console.log(JSON.stringify({
    ok: true,
    command: "say hello world",
    state: command.result.state,
    inviteLinkReady: Boolean(running.result.inviteLink),
    metrics: {
      pid: running.result.metrics.pid,
      cpu: running.result.metrics.cpu.processPercent,
      memoryPercent: running.result.metrics.memory.processPercent,
      memoryBytes: running.result.metrics.memory.workingSetBytes
    }
  }, null, 2));
} finally {
  if (openedRoom) {
    try {
      await sendCommand("desktop_close_room", {}, 15000);
    } catch {
      // The process kill below is the final cleanup fallback for failed smoke runs.
    }
  }
  child.kill();
  child.stdin.destroy();
}

async function waitForRunningStatus() {
  const deadline = Date.now() + 30000;
  let lastStatus = null;
  let firstRunningMetricsAt = null;

  while (Date.now() < deadline) {
    lastStatus = await sendCommand("desktop_status_room", {}, 10000);
    if (lastStatus.result?.state === "running" && lastStatus.result?.metrics) {
      firstRunningMetricsAt ??= Date.now();
      if (Date.now() - firstRunningMetricsAt >= 3000) {
        return lastStatus;
      }
    }

    await delay(1000);
  }

  return lastStatus;
}

async function waitForCommandLog(text) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const eventLog = runtimeEvents.find((event) => (
      event?.type === "runtime.log" &&
      typeof event.line === "string" &&
      event.line.includes(text)
    ));
    if (eventLog) {
      return eventLog;
    }

    const status = await sendCommand("desktop_status_room", {}, 10000);
    const log = status.result?.events?.find((event) => (
      event.type === "runtime.log" &&
      typeof event.line === "string" &&
      event.line.includes(text)
    ));
    if (log) {
      return log;
    }

    await delay(500);
  }

  return null;
}

async function sendCommand(command, request = {}, timeoutMs = 10000) {
  const id = ++nextId;
  child.stdin.write(`${JSON.stringify({ id, command, request })}\n`);
  const parsed = await nextFrame(id, timeoutMs);

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

function describeFailure(action, frame) {
  return `${action} failed: ${JSON.stringify(frame.result?.failure ?? frame.result ?? frame)}`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
