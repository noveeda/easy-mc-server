import { execFile as defaultExecFile, spawn as defaultSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative } from "node:path";
import { HostRuntimeActions, HostRuntimeStates, createRedactedLogEvent, redactHostLogLine } from "./host-runtime.mjs";
import { createLocalServerProcessIntent, createRoomMaterializationPlan } from "./local-runtime-adapter.mjs";

export const NodeLocalRuntimeFailureReasons = Object.freeze({
  INVALID_RUNTIME_PLAN: "invalid_runtime_plan",
  MOD_CHECKSUM_MISMATCH: "mod_checksum_mismatch",
  MOD_DOWNLOAD_FAILED: "mod_download_failed",
  MOD_DOWNLOAD_UNTRUSTED: "mod_download_untrusted",
  MOD_SOURCE_MISSING: "mod_source_missing",
  PROCESS_ALREADY_RUNNING: "process_already_running",
  PROCESS_ERROR: "process_error",
  PROCESS_NOT_RUNNING: "process_not_running",
  PROCESS_STOP_TIMEOUT: "process_stop_timeout",
  SERVER_COMMAND_INVALID: "server_command_invalid",
  SERVER_COMMAND_WRITE_FAILED: "server_command_write_failed",
  RUNTIME_ARTIFACT_MISSING: "runtime_artifact_missing",
  UNTRUSTED_LAUNCH_COMMAND: "untrusted_launch_command",
  UNSUPPORTED_LAUNCH_MODE: "unsupported_launch_mode"
});

const failureMessages = Object.freeze({
  [NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN]: "방 실행 계획을 먼저 준비해야 합니다.",
  [NodeLocalRuntimeFailureReasons.MOD_CHECKSUM_MISMATCH]: "고정팩 파일이 검증된 해시와 일치하지 않습니다.",
  [NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_FAILED]: "추천 모드 파일을 내려받지 못했습니다.",
  [NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_UNTRUSTED]: "추천 모드 파일 주소가 검증된 원본이 아닙니다.",
  [NodeLocalRuntimeFailureReasons.MOD_SOURCE_MISSING]: "고정팩 파일을 찾을 수 없습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_ALREADY_RUNNING]: "방이 이미 열리고 있습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_ERROR]: "방 실행 프로세스에서 오류가 발생했습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_NOT_RUNNING]: "방을 연 뒤 서버 명령을 보낼 수 있습니다.",
  [NodeLocalRuntimeFailureReasons.PROCESS_STOP_TIMEOUT]: "방을 닫는 데 시간이 너무 오래 걸렸습니다.",
  [NodeLocalRuntimeFailureReasons.SERVER_COMMAND_INVALID]: "서버 명령은 한 줄 텍스트로 입력해야 합니다.",
  [NodeLocalRuntimeFailureReasons.SERVER_COMMAND_WRITE_FAILED]: "서버 명령을 전달하지 못했습니다.",
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
  const removedMods = [];
  const appDataRoot = materialization.plan.appDataRoot;

  if (appDataRoot) {
    await mkdir(toNativePath(appDataRoot), { recursive: true });
    const boundary = await verifyManagedPath(appDataRoot, appDataRoot);
    if (!boundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, boundary.detail);
    }
  }

  for (const directory of materialization.plan.directories) {
    const parentBoundary = await verifyManagedPath(appDataRoot, dirname(toNativePath(directory)), {
      allowMissingTarget: true
    });
    if (!parentBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, parentBoundary.detail);
    }

    await mkdir(toNativePath(directory), { recursive: true });

    const directoryBoundary = await verifyManagedPath(appDataRoot, directory);
    if (!directoryBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, directoryBoundary.detail);
    }
  }

  for (const file of materialization.plan.files) {
    const target = toNativePath(file.path);
    const targetBoundary = await verifyManagedPath(appDataRoot, dirname(target), {
      allowMissingTarget: true
    });
    if (!targetBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, targetBoundary.detail);
    }

    await mkdir(dirname(target), { recursive: true });

    if (file.overwrite === false && await exists(target)) {
      const existingBoundary = await verifyManagedPath(appDataRoot, target);
      if (!existingBoundary.ok) {
        return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, existingBoundary.detail);
      }
      preservedFiles.push(file.path);
      continue;
    }

    if (typeof file.contents === "string") {
      const writeBoundary = await verifyManagedPath(appDataRoot, dirname(target));
      if (!writeBoundary.ok) {
        return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, writeBoundary.detail);
      }
      await writeFile(target, file.contents, "utf8");
      writtenFiles.push(file.path);
    }
  }

  if (materialization.plan.safety.removeUnknownMods === true) {
    const expectedModFiles = new Set(
      materialization.plan.modOperations
        .map((operation) => basename(toNativePath(operation.target)))
    );
    const modsDirectory = toNativePath(runtimePlan.files.mods);
    const modsBoundary = await verifyManagedPath(appDataRoot, modsDirectory);
    if (!modsBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, modsBoundary.detail);
    }

    for (const entry of await safeReadDirectory(modsDirectory)) {
      if (!entry.isFile() || expectedModFiles.has(entry.name)) {
        continue;
      }

      const stalePath = join(modsDirectory, entry.name);
      const staleBoundary = await verifyManagedPath(appDataRoot, stalePath);
      if (!staleBoundary.ok) {
        return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, staleBoundary.detail);
      }
      await rm(stalePath, { force: true });
      removedMods.push(entry.name);
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
    const sourceBoundary = await verifyManagedPath(appDataRoot, source, {
      allowMissingTarget: true
    });
    if (!sourceBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, sourceBoundary.detail);
    }
    if (!await exists(source)) {
      if (operation.downloadUrl) {
        const downloaded = await downloadVerifiedModSource(operation, source, options);
        if (!downloaded.ok) {
          return downloaded;
        }
      }
    }

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

    const actualSha256 = await sha256File(source);
    if (!isSha256(operation.expectedSha256) || actualSha256 !== operation.expectedSha256) {
      return fail(NodeLocalRuntimeFailureReasons.MOD_CHECKSUM_MISMATCH, {
        modId: operation.modId,
        expectedSha256: operation.expectedSha256,
        actualSha256
      });
    }

    const target = toNativePath(operation.target);
    const targetBoundary = await verifyManagedPath(appDataRoot, dirname(target), {
      allowMissingTarget: true
    });
    if (!targetBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, targetBoundary.detail);
    }
    await mkdir(dirname(target), { recursive: true });
    const targetParentBoundary = await verifyManagedPath(appDataRoot, dirname(target));
    if (!targetParentBoundary.ok) {
      return fail(NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN, targetParentBoundary.detail);
    }
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
    pendingMods,
    removedMods
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
  const readProcessMetrics = options.readProcessMetrics ?? readProcessResourceMetrics;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
  const metricsSampleIntervalMs = options.metricsSampleIntervalMs ?? 1000;

  let state = HostRuntimeStates.STOPPED;
  let processRef = null;
  let processExited = true;
  let startIntent = null;
  let logSequence = 0;
  let lastExit = null;
  let lastMetrics = null;
  let lastProcessMetricsSample = null;
  let lastMetricsSampleAt = 0;
  let metricsSampleInFlight = null;
  let lastMetricsFailureKey = null;
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
    lastMetrics = null;
    lastProcessMetricsSample = null;
    lastMetricsSampleAt = 0;
    startIntent = result.intent;
    state = HostRuntimeStates.STARTING;
    refreshProcessMetrics({ force: true });
    exitPromise = observeProcess(processRef, {
      onLog(stream, line) {
        const event = createRedactedLogEvent({
          roomId: runtimePlan.room?.id,
          stream,
          line,
          sequence: ++logSequence
        });
        emit(event);

        if (state === HostRuntimeStates.STARTING && matchesPattern(line, startIntent.healthCheck?.readyLogPattern)) {
          state = HostRuntimeStates.RUNNING;
          emit({
            type: "runtime.ready",
            roomId: runtimePlan.room?.id
          });
        }

        if (state !== HostRuntimeStates.CRASHED && matchesPattern(line, startIntent.healthCheck?.crashLogPattern)) {
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
        lastMetrics = null;
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
        lastMetrics = null;
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
    lastMetrics = null;
    lastProcessMetricsSample = null;
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

  async function sendCommand(commandOptions = {}) {
    const normalized = normalizeServerCommand(commandOptions.command ?? commandOptions);
    if (!normalized.ok) {
      return fail(NodeLocalRuntimeFailureReasons.SERVER_COMMAND_INVALID, normalized.detail);
    }

    if (!processRef || processExited || !processRef.stdin) {
      return fail(NodeLocalRuntimeFailureReasons.PROCESS_NOT_RUNNING, {
        state
      });
    }

    try {
      await writeServerCommand(processRef.stdin, `${normalized.command}\n`);
    } catch (error) {
      return fail(NodeLocalRuntimeFailureReasons.SERVER_COMMAND_WRITE_FAILED, {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    emit({
      type: "runtime.command",
      roomId: runtimePlan.room?.id,
      line: redactHostLogLine(normalized.command),
      sequence: ++logSequence
    });

    return {
      ok: true,
      state,
      command: normalized.command
    };
  }

  function status() {
    refreshProcessMetrics();

    return {
      state,
      hasProcess: Boolean(processRef && !processExited),
      lastExit,
      metrics: processRef && !processExited ? lastMetrics : null,
      events: [...events]
    };
  }

  return {
    start,
    stop,
    restart,
    sendCommand,
    status
  };

  function refreshProcessMetrics({ force = false } = {}) {
    if (!processRef || processExited || !Number.isInteger(processRef.pid)) {
      lastMetrics = null;
      return;
    }

    const now = Date.now();
    if (!force && (metricsSampleInFlight || now - lastMetricsSampleAt < metricsSampleIntervalMs)) {
      return;
    }

    lastMetricsSampleAt = now;
    const result = readProcessMetrics(processRef.pid, {
      cpuCount: logicalCpuCount(),
      measuredAt: new Date(now).toISOString(),
      previousSample: lastProcessMetricsSample,
      totalMemoryBytes: totalmem()
    });

    if (result && typeof result.then === "function") {
      metricsSampleInFlight = result
        .then((metrics) => {
          storeProcessMetrics(metrics);
          lastMetricsFailureKey = null;
        })
        .catch((error) => {
          lastMetrics = lastMetrics ?? null;
          emitMetricsUnavailable(error);
        })
        .finally(() => {
          metricsSampleInFlight = null;
        });
      return;
    }

    storeProcessMetrics(result);
  }

  function storeProcessMetrics(metrics) {
    lastMetrics = normalizeProcessMetrics(metrics);
    lastProcessMetricsSample = metrics?._sample ?? lastProcessMetricsSample;
  }

  function emitMetricsUnavailable(error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    const failureKey = `${processRef?.pid ?? "unknown"}:${message}`;
    if (failureKey === lastMetricsFailureKey) {
      return;
    }

    lastMetricsFailureKey = failureKey;
    emit({
      type: "runtime.metrics_unavailable",
      roomId: runtimePlan.room?.id,
      source: "process",
      message: redactHostLogLine(message)
    });
  }
}

async function downloadVerifiedModSource(operation, source, options = {}) {
  const urlReadiness = validateModDownloadUrl(operation.downloadUrl);
  if (!urlReadiness.ok) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_UNTRUSTED, {
      modId: operation.modId,
      reason: urlReadiness.reason
    });
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_FAILED, {
      modId: operation.modId,
      reason: "fetch_unavailable"
    });
  }

  let response;
  try {
    response = await fetchImpl(operation.downloadUrl, { redirect: "follow" });
  } catch (error) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_FAILED, {
      modId: operation.modId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  if (!response?.ok || !validateModDownloadUrl(response.url || operation.downloadUrl).ok) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_UNTRUSTED, {
      modId: operation.modId,
      reason: "response_not_ok_or_redirected"
    });
  }

  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_FAILED, {
      modId: operation.modId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  if (Number.isInteger(operation.expectedFileSize) && operation.expectedFileSize > 0 && bytes.byteLength !== operation.expectedFileSize) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_DOWNLOAD_FAILED, {
      modId: operation.modId,
      reason: "file_size_mismatch"
    });
  }

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!isSha256(operation.expectedSha256) || actualSha256 !== operation.expectedSha256) {
    return fail(NodeLocalRuntimeFailureReasons.MOD_CHECKSUM_MISMATCH, {
      modId: operation.modId,
      expectedSha256: operation.expectedSha256,
      actualSha256
    });
  }

  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, bytes);
  return { ok: true };
}

function validateModDownloadUrl(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== "cdn.modrinth.com"
      || parsed.username
      || parsed.password
    ) {
      return { ok: false, reason: "untrusted_url" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
}

export async function readProcessResourceMetrics(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  if (process.platform === "win32") {
    return readWindowsProcessResourceMetrics(pid, options);
  }

  return readPosixProcessResourceMetrics(pid, options);
}

async function readWindowsProcessResourceMetrics(pid, options = {}) {
  const powershell = options.powershell ?? "powershell.exe";
  try {
    return await readWindowsGetProcessResourceMetrics(pid, {
      ...options,
      powershell
    });
  } catch (error) {
    if (options.allowSlowWindowsCim === true) {
      return readWindowsCimProcessResourceMetrics(pid, {
        ...options,
        powershell
      });
    }

    throw error;
  }
}

async function readWindowsGetProcessResourceMetrics(pid, options = {}) {
  const powershell = options.powershell ?? "powershell.exe";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-Process -Id ${pid}`,
    "[pscustomobject]@{Id=$p.Id;CPU=$p.CPU;WorkingSet64=$p.WorkingSet64;PrivateMemorySize64=$p.PrivateMemorySize64} | ConvertTo-Json -Compress"
  ].join("; ");
  const stdout = await execFileText(powershell, ["-NoProfile", "-Command", script], options.execFileOptions);
  const parsed = parseJsonObject(stdout);
  if (!parsed?.Id) {
    return null;
  }

  const measuredAt = options.measuredAt ?? new Date().toISOString();
  const measuredAtMs = Date.parse(measuredAt);
  const cpuCount = options.cpuCount ?? logicalCpuCount();
  const cpuTimeSeconds = Number(parsed.CPU ?? 0);
  const previousSample = options.previousSample;
  const cpuPercent = processCpuPercentFromSampleDelta({
    pid,
    cpuTimeSeconds,
    measuredAtMs,
    previousSample,
    cpuCount
  });
  const workingSetBytes = Number(parsed.WorkingSet64 || parsed.PrivateMemorySize64 || 0);

  return createProcessMetrics({
    pid,
    source: "windows-get-process",
    measuredAt,
    cpuPercent,
    workingSetBytes,
    totalMemoryBytes: options.totalMemoryBytes,
    sample: {
      pid,
      cpuTimeSeconds,
      measuredAtMs
    }
  });
}

async function readWindowsCimProcessResourceMetrics(pid, options = {}) {
  const powershell = options.powershell ?? "powershell.exe";
  const script = [
    `$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "IDProcess = ${pid}" | Select-Object -First 1 IDProcess,PercentProcessorTime,WorkingSetPrivate,WorkingSet`,
    "if ($null -eq $p) { '{}' } else { $p | ConvertTo-Json -Compress }"
  ].join("; ");
  const stdout = await execFileText(powershell, ["-NoProfile", "-Command", script], options.execFileOptions);
  const parsed = parseJsonObject(stdout);
  if (!parsed?.IDProcess) {
    return null;
  }

  const cpuCount = options.cpuCount ?? logicalCpuCount();
  const cpuPercent = clampPercent(Number(parsed.PercentProcessorTime) / Math.max(1, cpuCount));
  const workingSetBytes = Number(parsed.WorkingSet || parsed.WorkingSetPrivate || 0);
  return createProcessMetrics({
    pid,
    source: "windows-cim-process",
    measuredAt: options.measuredAt,
    cpuPercent,
    workingSetBytes,
    totalMemoryBytes: options.totalMemoryBytes
  });
}

function processCpuPercentFromSampleDelta({ pid, cpuTimeSeconds, measuredAtMs, previousSample, cpuCount }) {
  if (
    !previousSample ||
    previousSample.pid !== pid ||
    !Number.isFinite(cpuTimeSeconds) ||
    !Number.isFinite(previousSample.cpuTimeSeconds) ||
    !Number.isFinite(measuredAtMs) ||
    !Number.isFinite(previousSample.measuredAtMs)
  ) {
    return null;
  }

  const cpuDeltaSeconds = cpuTimeSeconds - previousSample.cpuTimeSeconds;
  const wallDeltaSeconds = (measuredAtMs - previousSample.measuredAtMs) / 1000;
  if (cpuDeltaSeconds < 0 || wallDeltaSeconds <= 0) {
    return null;
  }

  return clampPercent((cpuDeltaSeconds / wallDeltaSeconds / Math.max(1, cpuCount)) * 100);
}

async function readPosixProcessResourceMetrics(pid, options = {}) {
  const stdout = await execFileText("ps", ["-p", String(pid), "-o", "%cpu=", "-o", "rss="], options.execFileOptions);
  const [cpuRaw, rssKbRaw] = stdout.trim().split(/\s+/);
  if (!cpuRaw || !rssKbRaw) {
    return null;
  }

  const cpuCount = options.cpuCount ?? logicalCpuCount();
  return createProcessMetrics({
    pid,
    source: "posix-ps-process",
    measuredAt: options.measuredAt,
    cpuPercent: clampPercent(Number(cpuRaw) / Math.max(1, cpuCount)),
    workingSetBytes: Number(rssKbRaw) * 1024,
    totalMemoryBytes: options.totalMemoryBytes
  });
}

function createProcessMetrics({ pid, source, measuredAt, cpuPercent, workingSetBytes, totalMemoryBytes, sample }) {
  const totalBytes = Number.isFinite(totalMemoryBytes) && totalMemoryBytes > 0 ? totalMemoryBytes : totalmem();
  const numericWorkingSetBytes = optionalFiniteNumber(workingSetBytes);
  const memoryPercent = totalBytes > 0 && numericWorkingSetBytes !== null
    ? clampPercent((numericWorkingSetBytes / totalBytes) * 100)
    : null;

  const metrics = normalizeProcessMetrics({
    pid,
    source,
    measuredAt: measuredAt ?? new Date().toISOString(),
    cpu: {
      processPercent: optionalFiniteNumber(cpuPercent)
    },
    memory: {
      workingSetBytes: numericWorkingSetBytes ?? 0,
      totalBytes,
      processPercent: memoryPercent
    }
  });

  if (sample) {
    Object.defineProperty(metrics, "_sample", {
      value: sample,
      enumerable: false
    });
  }

  return metrics;
}

function normalizeProcessMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") {
    return null;
  }

  const pid = Number(metrics.pid);
  const cpuValue = optionalFiniteNumber(metrics.cpu?.processPercent ?? metrics.cpuPercent);
  const cpuPercent = cpuValue === null ? null : clampPercent(cpuValue);
  const workingSetValue = optionalFiniteNumber(metrics.memory?.workingSetBytes ?? metrics.workingSetBytes);
  const workingSetBytes = workingSetValue === null ? null : Math.max(0, Math.round(workingSetValue));
  const totalValue = optionalFiniteNumber(metrics.memory?.totalBytes ?? metrics.totalMemoryBytes ?? totalmem());
  const totalBytes = Math.max(0, Math.round(totalValue ?? 0));
  const explicitMemoryPercent = optionalFiniteNumber(metrics.memory?.processPercent);
  const memoryPercent = explicitMemoryPercent !== null
    ? clampPercent(explicitMemoryPercent)
    : (
        totalBytes > 0 && workingSetBytes !== null
          ? clampPercent((workingSetBytes / totalBytes) * 100)
          : null
      );

  if (cpuPercent === null && workingSetBytes === null && memoryPercent === null) {
    return null;
  }

  return {
    pid: Number.isInteger(pid) ? pid : null,
    source: String(metrics.source ?? "process"),
    measuredAt: String(metrics.measuredAt ?? new Date().toISOString()),
    basis: {
      process: "minecraft_server_java_process",
      cpu: "process_cpu_percent_of_total_logical_cpu",
      memory: "process_working_set_percent_of_total_physical_memory"
    },
    cpu: {
      processPercent: cpuPercent === null ? null : roundMetric(cpuPercent)
    },
    memory: {
      workingSetBytes: workingSetBytes ?? 0,
      totalBytes,
      processPercent: memoryPercent === null ? null : roundMetric(memoryPercent)
    }
  };
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    defaultExecFile(command, args, {
      windowsHide: true,
      timeout: 1500,
      maxBuffer: 64 * 1024,
      ...(options ?? {})
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(String(stdout ?? ""));
    });
  });
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text ?? "").trim() || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function verifyManagedPath(root, path, options = {}) {
  if (!root) {
    return { ok: true };
  }

  const rootPath = toNativePath(root);
  const targetPath = toNativePath(path);
  const relation = relative(rootPath, targetPath);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    return {
      ok: false,
      detail: { reason: "path_outside_app_data_root", path: redactHostLogLine(path) }
    };
  }

  const rootStat = await safeLstat(rootPath);
  if (!rootStat || rootStat.isSymbolicLink()) {
    return {
      ok: false,
      detail: { reason: "unsafe_app_data_root", path: redactHostLogLine(root) }
    };
  }

  const symlink = await findExistingSymlinkSegment(rootPath, targetPath);
  if (symlink) {
    return {
      ok: false,
      detail: { reason: "managed_path_reparse_point", path: redactHostLogLine(symlink) }
    };
  }

  const existingPath = options.allowMissingTarget
    ? await nearestExistingPath(targetPath)
    : targetPath;
  const existingReal = await safeRealpath(existingPath);
  const rootReal = await safeRealpath(rootPath);
  if (!existingReal || !rootReal || !isSubPath(rootReal, existingReal)) {
    return {
      ok: false,
      detail: { reason: "managed_path_escape", path: redactHostLogLine(path) }
    };
  }

  return { ok: true };
}

async function findExistingSymlinkSegment(rootPath, targetPath) {
  const relation = relative(rootPath, targetPath);
  const segments = relation.split(/[\\/]+/).filter(Boolean);
  let current = rootPath;

  for (const segment of segments) {
    current = join(current, segment);
    const stat = await safeLstat(current);
    if (stat?.isSymbolicLink()) {
      return current;
    }
  }

  return null;
}

async function nearestExistingPath(path) {
  let current = path;
  while (current && current !== dirname(current)) {
    if (await exists(current)) {
      return current;
    }
    current = dirname(current);
  }

  return current;
}

async function safeLstat(path) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

async function safeRealpath(path) {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function isSubPath(root, path) {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function logicalCpuCount() {
  return Math.max(1, cpus().length);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function roundMetric(value) {
  return Math.round(value * 10) / 10;
}

function normalizeServerCommand(command) {
  if (typeof command !== "string") {
    return {
      ok: false,
      detail: { reason: "not_string" }
    };
  }

  const trimmed = command.trim();
  const consoleCommand = trimmed.startsWith("/") ? trimmed.slice(1).trimStart() : trimmed;
  if (!consoleCommand || consoleCommand.length > 256 || /[\r\n]/.test(command) || hasControlCharacter(command)) {
    return {
      ok: false,
      detail: {
        reason: "invalid_line",
        maxLength: 256
      }
    };
  }

  if (isDangerousServerCommand(consoleCommand)) {
    return {
      ok: false,
      detail: {
        reason: "blocked_command"
      }
    };
  }

  return {
    ok: true,
    command: consoleCommand
  };
}

function isDangerousServerCommand(command) {
  const [name = "", subcommand = ""] = command.toLowerCase().split(/\s+/);
  if ([
    "ban",
    "ban-ip",
    "deop",
    "execute",
    "kick",
    "op",
    "pardon",
    "pardon-ip",
    "reload",
    "save-off",
    "save-on",
    "stop"
  ].includes(name)) {
    return true;
  }

  return name === "whitelist" && !["add", "list", "remove"].includes(subcommand);
}

function hasControlCharacter(value) {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value);
}

function writeServerCommand(stdin, commandLine) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    try {
      stdin.write(commandLine, (error) => settle(error));
      if (stdin.write.length < 2) {
        settle();
      }
    } catch (error) {
      settle(error);
    }
  });
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

async function safeReadDirectory(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
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
