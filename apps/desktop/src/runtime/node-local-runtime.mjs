import { spawn as defaultSpawn } from "node:child_process";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize } from "node:path";
import { HostRuntimeActions } from "./host-runtime.mjs";
import { createLocalServerProcessIntent, createRoomMaterializationPlan } from "./local-runtime-adapter.mjs";

export const NodeLocalRuntimeFailureReasons = Object.freeze({
  INVALID_RUNTIME_PLAN: "invalid_runtime_plan",
  MOD_SOURCE_MISSING: "mod_source_missing",
  RUNTIME_ARTIFACT_MISSING: "runtime_artifact_missing",
  UNTRUSTED_LAUNCH_COMMAND: "untrusted_launch_command",
  UNSUPPORTED_LAUNCH_MODE: "unsupported_launch_mode"
});

const failureMessages = Object.freeze({
  [NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN]: "방 실행 계획을 먼저 준비해야 합니다.",
  [NodeLocalRuntimeFailureReasons.MOD_SOURCE_MISSING]: "고정팩 파일을 찾을 수 없습니다.",
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
