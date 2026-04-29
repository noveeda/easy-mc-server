import { spawn as defaultSpawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize } from "node:path";
import { HostRuntimeActions, HostRuntimeStates, createRedactedLogEvent } from "./host-runtime.mjs";
import { createLocalServerProcessIntent, createRoomMaterializationPlan } from "./local-runtime-adapter.mjs";

export const NodeLocalRuntimeFailureReasons = Object.freeze({
  INVALID_RUNTIME_PLAN: "invalid_runtime_plan",
  MOD_SOURCE_MISSING: "mod_source_missing",
  PROCESS_ALREADY_RUNNING: "process_already_running",
  PROCESS_ERROR: "process_error",
  PROCESS_STOP_TIMEOUT: "process_stop_timeout",
  RUNTIME_ARTIFACT_MISSING: "runtime_artifact_missing",
  UNTRUSTED_LAUNCH_COMMAND: "untrusted_launch_command",
  UNSUPPORTED_LAUNCH_MODE: "unsupported_launch_mode"
});

const failureMessages = Object.freeze({
  [NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN]: "방 실행 계획을 먼저 준비해야 합니다.",
  [NodeLocalRuntimeFailureReasons.MOD_SOURCE_MISSING]: "고정팩 파일을 찾을 수 없습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_ALREADY_RUNNING]: "방이 이미 열리고 있습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_ERROR]: "방 실행 프로세스에서 오류가 발생했습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_STOP_TIMEOUT]: "방을 닫는 데 시간이 너무 오래 걸렸습니다.",
  [NodeLocalRuntimeFailureReasons.RUNTIME_ARTIFACT_MISSING]: "방 실행 파일을 찾을 수 없습니다.",
  [NodeLocalRuntimeFailureReasons.UNTRUSTED_LAUNCH_COMMAND]: "검증된 Java/Fabric 실행 명령만 사용할 수 있습니다.",
  [NodeLocalRuntimeFailureReasons.UNSUPPORTED_LAUNCH_MODE]: "지원하지 않는 실행 방식입니다."
});

export async function materializeRoom(runtimePlan = {}, options = {}) {
  const materialization = createRoomMaterializationPlan(runtimePlan);
  if (!materialization.ok) {
    return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, materialization.failure);
  }

  const writtenFiles = [];
  const preservedFiles = [];
  const copiedMods = [];
  const pendingMods = [];

  for (const directory of materialization.plan.directories) {
    await mkdir(toNativePath(directory), { recursive: true });
  }

  for (const file of materialization.plan.files) {
    const target = toNativePath(file.path);
    await mkdir(dirname(target), { recursive: true });

    if (file.overwrite === false && await exists(target)) {
      preservedFiles.push(file.path);
      continue;
    }

    if (typeof file.contents === "string") {
      await writeFile(target, file.contents, "utf8");
      writtenFiles.push(file.path);
    }
  }

  for (const operation of materialization.plan.modOperations) {
    if (operation.verified !== true) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, {
        modId: operation.modId,
        reason: "unverified_mod"
      });
    }

    if (!isPathLike(operation.source)) {
      pendingMods.push({
        modId: operation.modId,
        source: operation.source,
        target: operation.target
      });
      continue;
    }

    const source = toNativePath(operation.source);
    if (!await exists(source)) {
      if (options.allowMissingModSources === true) {
        pendingMods.push({
          modId: operation.modId,
          source: operation.source,
          target: operation.target
        });
        continue;
      }

      return fail(NodeLocalRuntimeFailureReasons.MOD_SOURCE_MISSING, {
        modId: operation.modId,
        source: operation.source
      });
    }

    const target = toNativePath(operation.target);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    copiedMods.push({
      modId: operation.modId,
      source: operation.source,
      target: operation.target
    });
  }

  return {
    ok: true,
    roomId: materialization.plan.roomId,
    root: runtimePlan.files.root,
    writtenFiles,
    preservedFiles,
    copiedMods,
    pendingMods
  };
}

export async function launchLocalServer(runtimePlan = {}, options = {}) {
  const action = options.action ?? HostRuntimeActions.START;
  const intentResult = createLocalServerProcessIntent(runtimePlan, action);
  if (!intentResult.ok) {
    return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, intentResult.failure);
  }

  const intent = intentResult.intent;
  const mode = options.mode ?? "dry-run";

  if (mode === "dry-run") {
    return {
      ok: true,
      launched: false,
      mode,
      intent
    };
  }

  if (mode !== "real") {
    return fail(NodeLocalRuntimeFailureReasons.UNSUPPORTED_LAUNCH_MODE, { mode });
  }

  if (intent.type !== "process.start") {
    return fail(NodeLocalRuntimeFailureReasons.UNSUPPORTED_LAUNCH_MODE, { action });
  }

  const launchCommand = validateLaunchCommand(runtimePlan, intent);
  if (!launchCommand.ok) {
    return fail(NodeLocalRuntimeFailureReasons.UNTRUSTED_LAUNCH_COMMAND, launchCommand.detail);
  }

  const missing = [];
  const cwd = toNativePath(intent.cwd);
  const jarPath = jarPathFromArgs(intent.args);

  if (!await exists(cwd)) {
    missing.push("room_root");
  }

  if (jarPath && !await exists(toNativePath(jarPath))) {
    missing.push("fabric_server_jar");
  }

  if (isAbsolute(intent.command) && !await exists(toNativePath(intent.command))) {
    missing.push("java_runtime");
  }

  if (missing.length > 0) {
    return fail(NodeLocalRuntimeFailureReasons.RUNTIME_ARTIFACT_MISSING, { missing, intent });
  }

  const spawnImpl = options.spawn ?? defaultSpawn;
  const child = spawnImpl(intent.command, intent.args, {
    cwd,
    windowsHide: true,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"]
  });

  return {
    ok: true,
    launched: true,
    mode,
    intent,
    process: child
  };
}

export function createLocalServerLifecycleManager(runtimePlan = {}, options = {}) {
  const events = [];
  const emit = options.onEvent ?? ((event) => events.push(event));
  const launch = options.launch ?? launchLocalServer;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;

  let state = HostRuntimeStates.STOPPED;
  let processRef = null;
  let processExited = true;
  let startIntent = null;
  let logSequence = 0;
  let lastExit = null;
  let exitPromise = Promise.resolve({ code: null, signal: null });

  async function start(startOptions = {}) {
    if (processRef && !processExited) {
      return fail(NodeLocalRuntimeFailureReasons.PROCESS_ALREADY_RUNNING, {
        state
      });
    }

    const result = await launch(runtimePlan, {
      ...options,
      ...startOptions,
      action: HostRuntimeActions.START,
      mode: startOptions.mode ?? options.mode ?? "real"
    });

    if (!result.ok) {
      state = HostRuntimeStates.FAILED;
      emit({
        type: "runtime.failure",
        roomId: runtimePlan.room?.id,
        failure: result.failure
      });
      return result;
    }

    if (result.launched !== true || !result.process) {
      state = HostRuntimeStates.FAILED;
      const failure = fail(NodeLocalRuntimeFailureReasons.UNSUPPORTED_LAUNCH_MODE, {
        mode: result.mode
      });
      emit({
        type: "runtime.failure",
        roomId: runtimePlan.room?.id,
        failure: failure.failure
      });
      return failure;
    }

    processRef = result.process;
    processExited = false;
    startIntent = result.intent;
    state = HostRuntimeStates.STARTING;
    exitPromise = observeProcess(processRef, {
      onLog(stream, line) {
        const event = createRedactedLogEvent({
          roomId: runtimePlan.room?.id,
          stream,
          line,
          sequence: ++logSequence
        });
        emit(event);

        if (matchesPattern(line, startIntent.healthCheck?.readyLogPattern)) {
          state = HostRuntimeStates.RUNNING;
          emit({
            type: "runtime.ready",
            roomId: runtimePlan.room?.id
          });
        }

        if (matchesPattern(line, startIntent.healthCheck?.crashLogPattern)) {
          state = HostRuntimeStates.CRASHED;
          emit({
            type: "runtime.crashed",
            roomId: runtimePlan.room?.id,
            stream,
            line: event.line
          });
        }
      },
      onExit(code, signal) {
        processExited = true;
        lastExit = { code, signal };
        processRef = null;
        const nextState = state === HostRuntimeStates.STOPPING || state === HostRuntimeStates.RESTARTING
          ? HostRuntimeStates.STOPPED
          : (state === HostRuntimeStates.CRASHED || code ? HostRuntimeStates.CRASHED : HostRuntimeStates.STOPPED);

        state = nextState;
        emit({
          type: "runtime.exit",
          roomId: runtimePlan.room?.id,
          code,
          signal,
          state
        });
      },
      onError(error) {
        processExited = true;
        processRef = null;
        state = HostRuntimeStates.FAILED;
        const failure = fail(NodeLocalRuntimeFailureReasons.PROCESS_ERROR, {
          error: error instanceof Error ? error.message : String(error)
        });
        emit({
          type: "runtime.failure",
          roomId: runtimePlan.room?.id,
          failure: failure.failure
        });
      }
    });

    return {
      ok: true,
      state,
      intent: result.intent
    };
  }

  async function stop(stopOptions = {}) {
    if (!processRef || processExited) {
      state = HostRuntimeStates.STOPPED;
      return {
        ok: true,
        state
      };
    }

    const stopIntent = createLocalServerProcessIntent(runtimePlan, HostRuntimeActions.STOP);
    if (!stopIntent.ok) {
      state = HostRuntimeStates.FAILED;
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, stopIntent.failure);
    }

    state = HostRuntimeStates.STOPPING;
    const timeoutMs = stopOptions.timeoutMs ?? options.stopTimeoutMs ?? stopIntent.intent.timeoutMs;
    const hardTimeoutMs = stopOptions.hardTimeoutMs ?? options.hardStopTimeoutMs ?? 5000;
    let didKill = false;
    let timeout = null;
    let hardTimeout = null;

    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timeout = setTimeoutImpl(() => {
        didKill = true;
        try {
          processRef?.kill?.();
        } catch {
          // The hard timeout below still bounds the stop attempt.
        }
      }, timeoutMs);
    }

    const hardTimeoutDelay = (Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0) + hardTimeoutMs;
    const hardTimeoutPromise = Number.isFinite(hardTimeoutMs) && hardTimeoutMs >= 0
      ? new Promise((resolve) => {
          hardTimeout = setTimeoutImpl(() => resolve({ timedOut: true }), hardTimeoutDelay);
        })
      : null;

    processRef.stdin?.write?.(stopIntent.intent.gracefulCommand);

    const exit = await (hardTimeoutPromise ? Promise.race([exitPromise, hardTimeoutPromise]) : exitPromise);
    if (timeout) {
      clearTimeoutImpl(timeout);
    }
    if (hardTimeout) {
      clearTimeoutImpl(hardTimeout);
    }

    if (exit?.timedOut) {
      state = HostRuntimeStates.FAILED;
      return fail(NodeLocalRuntimeFailureReasons.PROCESS_STOP_TIMEOUT, {
        killed: didKill
      });
    }

    if (exit?.error) {
      state = HostRuntimeStates.FAILED;
      return fail(NodeLocalRuntimeFailureReasons.PROCESS_ERROR, {
        error: exit.error instanceof Error ? exit.error.message : String(exit.error)
      });
    }

    processRef = null;
    processExited = true;
    state = HostRuntimeStates.STOPPED;

    return {
      ok: true,
      state,
      killed: didKill,
      exit
    };
  }

  async function restart(restartOptions = {}) {
    state = HostRuntimeStates.RESTARTING;
    const stopResult = await stop(restartOptions.stop);
    if (!stopResult.ok) {
      return stopResult;
    }

    return start(restartOptions.start);
  }

  function status() {
    return {
      state,
      hasProcess: Boolean(processRef && !processExited),
      lastExit,
      events: [...events]
    };
  }

  return {
    start,
    stop,
    restart,
    status
  };
}

export async function readRuntimeManifest(runtimePlan = {}) {
  const manifest = await readFile(toNativePath(`${runtimePlan.layout.runtime}/room-runtime-manifest.json`), "utf8");
  return JSON.parse(manifest);
}

function jarPathFromArgs(args = []) {
  const jarIndex = args.indexOf("-jar");
  return jarIndex >= 0 ? args[jarIndex + 1] : null;
}

function validateLaunchCommand(runtimePlan, intent) {
  const command = toNativePath(intent.command);
  const javaPath = toNativePath(runtimePlan.java?.path);
  const launcherJar = runtimePlan.fabric?.launcherJar;
  const javaBinary = basename(command).toLowerCase();

  if (!isAbsolute(command) || command !== javaPath || javaBinary !== "java.exe") {
    return {
      ok: false,
      detail: {
        reason: "java_command_mismatch",
        command: intent.command,
        expectedCommand: runtimePlan.java?.path
      }
    };
  }

  if (intent.args?.length !== 3 || intent.args[0] !== "-jar" || intent.args[1] !== launcherJar || intent.args[2] !== "nogui") {
    return {
      ok: false,
      detail: {
        reason: "fabric_args_mismatch",
        args: intent.args,
        expectedArgs: ["-jar", launcherJar, "nogui"]
      }
    };
  }

  return { ok: true };
}

function observeProcess(child, observers) {
  if (!child) {
    return Promise.resolve({ code: null, signal: null });
  }

  const stdout = createLineBuffer((line) => observers.onLog("stdout", line));
  const stderr = createLineBuffer((line) => observers.onLog("stderr", line));

  child.stdout?.on?.("data", (chunk) => {
    stdout.push(chunk);
  });

  child.stderr?.on?.("data", (chunk) => {
    stderr.push(chunk);
  });

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      stdout.flush();
      stderr.flush();
      resolve(result);
    };

    child.once?.("exit", (code, signal) => {
      observers.onExit(code, signal);
      settle({ code, signal });
    });
    child.once?.("error", (error) => {
      observers.onError?.(error);
      settle({ code: null, signal: null, error });
    });
  });
}

function createLineBuffer(onLine) {
  let buffer = "";

  return {
    push(chunk) {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        emitLine(line);
      }
    },
    flush() {
      emitLine(buffer);
      buffer = "";
    }
  };

  function emitLine(line) {
    const trimmed = String(line).trim();
    if (trimmed) {
      onLine(trimmed);
    }
  }
}

function matchesPattern(line, pattern) {
  return Boolean(pattern && new RegExp(pattern, "i").test(String(line)));
}

function isPathLike(value) {
  return typeof value === "string" && (value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toNativePath(path) {
  return normalize(String(path));
}

function fail(reason, detail = {}) {
  return {
    ok: false,
    failure: {
      reason,
      message: failureMessages[reason],
      detail
    }
  };
}
