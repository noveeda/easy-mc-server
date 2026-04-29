import { HostRuntimeActions, redactHostLogLine } from "./host-runtime.mjs";

export const LocalRuntimeAdapterFailureReasons = Object.freeze({
  INVALID_RUNTIME_PLAN: "invalid_runtime_plan",
  FABRIC_CHECKSUM_MISSING: "fabric_checksum_missing",
  UNKNOWN_FABRIC_SOURCE: "unknown_fabric_source",
  UNSUPPORTED_ACTION: "unsupported_action"
});

const failureMessages = Object.freeze({
  [LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN]: "Prepare the room before opening it.",
  [LocalRuntimeAdapterFailureReasons.FABRIC_CHECKSUM_MISSING]: "Room setup files need a verified checksum before use.",
  [LocalRuntimeAdapterFailureReasons.UNKNOWN_FABRIC_SOURCE]: "Use the app-approved Fabric setup source.",
  [LocalRuntimeAdapterFailureReasons.UNSUPPORTED_ACTION]: "This room action is not supported yet."
});

const FABRIC_META_BASE_URL = "https://meta.fabricmc.net/";

export function createRoomMaterializationPlan(runtimePlan = {}) {
  const failure = validateRuntimePlan(runtimePlan);

  if (failure) {
    return fail(failure);
  }

  const allowlistPath = joinPath(runtimePlan.files.root, "whitelist.json");
  const bridgeConfigPath = joinPath(runtimePlan.layout.runtime, "server-bridge.json");
  const manifestPath = joinPath(runtimePlan.layout.runtime, "room-runtime-manifest.json");

  return {
    ok: true,
    plan: {
      type: "room.materialize",
      roomId: runtimePlan.room.id,
      directories: uniquePaths([
        runtimePlan.files.root,
        runtimePlan.layout.runtime,
        runtimePlan.files.mods,
        runtimePlan.files.world,
        runtimePlan.layout.logs,
        runtimePlan.layout.cache,
        runtimePlan.layout.downloads,
        runtimePlan.layout.metadata
      ]),
      files: [
        {
          kind: "eula",
          path: runtimePlan.eula.path,
          contents: runtimePlan.eula.writeText,
          overwrite: true,
          requiresExplicitHostConsent: runtimePlan.eula.requiresExplicitHostConsent
        },
        {
          kind: "server-properties",
          path: runtimePlan.serverProperties.path,
          contents: serializeServerProperties(runtimePlan.serverProperties.values),
          overwrite: true
        },
        {
          kind: "minecraft-whitelist",
          path: allowlistPath,
          contents: "[]\n",
          overwrite: false
        },
        {
          kind: "server-bridge-config",
          path: bridgeConfigPath,
          contents: serializeJson({
            roomId: runtimePlan.room.id,
            approvalSource: runtimePlan.bridge.approvalSource,
            claimedIdentityCanApprove: runtimePlan.bridge.claimedIdentityCanApprove,
            allowlistPath,
            healthEvent: "bridge.health"
          }),
          overwrite: true
        },
        {
          kind: "runtime-manifest",
          path: manifestPath,
          contents: serializeJson({
            roomId: runtimePlan.room.id,
            minecraftVersion: runtimePlan.room.minecraftVersion,
            fabricLoaderVersion: runtimePlan.fabric.loaderVersion,
            launcherJar: runtimePlan.fabric.launcherJar,
            packId: runtimePlan.pack.id,
            modCount: runtimePlan.mods.entries.length
          }),
          overwrite: true
        }
      ],
      modOperations: runtimePlan.mods.entries.map((entry) => ({
        type: "copy-verified-mod",
        modId: entry.id,
        fileName: entry.fileName,
        source: entry.source,
        target: entry.target,
        expectedSha256: entry.sha256,
        verified: entry.verified
      })),
      safety: {
        removeUnknownMods: runtimePlan.mods.removeUnknownMods === true,
        preserveAllowlist: true,
        requireVerifiedMods: true
      }
    }
  };
}

export function createFabricServerDownloadPlan(runtimePlan = {}, sources = {}) {
  const failure = validateRuntimePlan(runtimePlan);

  if (failure) {
    return fail(failure);
  }

  const expectedSha256 = runtimePlan.fabric.serverJarSha256;

  if (!expectedSha256) {
    return fail(LocalRuntimeAdapterFailureReasons.FABRIC_CHECKSUM_MISSING);
  }

  const sourceUrl = sources.fabricServerJarUrl
    ?? `https://meta.fabricmc.net/v2/versions/loader/${runtimePlan.room.minecraftVersion}/${runtimePlan.fabric.loaderVersion}/server/jar`;

  if (!sourceUrl.startsWith(FABRIC_META_BASE_URL)) {
    return fail(LocalRuntimeAdapterFailureReasons.UNKNOWN_FABRIC_SOURCE);
  }

  const cachePath = joinPath(
    runtimePlan.layout.downloads,
    `fabric-server-${runtimePlan.room.minecraftVersion}-${runtimePlan.fabric.loaderVersion}-${expectedSha256}.jar`
  );

  return {
    ok: true,
    plan: {
      type: "fabric-server.download",
      roomId: runtimePlan.room.id,
      source: {
        provider: sources.provider ?? "Fabric Meta",
        url: sourceUrl
      },
      cache: {
        path: cachePath,
        reuseVerifiedDownloads: runtimePlan.cache.reuseVerifiedDownloads
      },
      install: {
        target: runtimePlan.fabric.launcherJar
      },
      verification: {
        algorithm: runtimePlan.cache.checksumAlgorithm,
        expectedSha256,
        requiredBeforeInstall: true
      },
      offlineFallback: "reuse_verified_cache_only"
    }
  };
}

export function createLocalServerProcessIntent(runtimePlan = {}, action = HostRuntimeActions.START) {
  const failure = validateRuntimePlan(runtimePlan);

  if (failure) {
    return fail(failure);
  }

  if (action === HostRuntimeActions.START) {
    return {
      ok: true,
      intent: {
        type: "process.start",
        roomId: runtimePlan.room.id,
        cwd: runtimePlan.files.root,
        command: runtimePlan.command[0],
        args: runtimePlan.command.slice(1),
        stdio: {
          stdout: "runtime.log",
          stderr: "runtime.log",
          stdin: "command"
        },
        healthCheck: {
          readyLogPattern: "Done",
          crashLogPattern: "crash|exception|failed",
          bridgeHealthEvent: "bridge.health"
        },
        requires: [
          "materialized_room",
          "verified_fabric_server_jar",
          "compatible_java",
          "accepted_eula",
          "fixed_pack_installed"
        ],
        diagnostics: {
          adapter: "tauri-process",
          redactedCommand: runtimePlan.command.map((part) => redactHostLogLine(part))
        }
      }
    };
  }

  if (action === HostRuntimeActions.STOP) {
    return {
      ok: true,
      intent: {
        type: "process.stop",
        roomId: runtimePlan.room.id,
        gracefulCommand: "stop\n",
        timeoutMs: 30000,
        fallbackSignal: "terminate"
      }
    };
  }

  if (action === HostRuntimeActions.RESTART) {
    return {
      ok: true,
      intent: {
        type: "process.restart",
        roomId: runtimePlan.room.id,
        sequence: [
          createLocalServerProcessIntent(runtimePlan, HostRuntimeActions.STOP).intent,
          createLocalServerProcessIntent(runtimePlan, HostRuntimeActions.START).intent
        ]
      }
    };
  }

  return fail(LocalRuntimeAdapterFailureReasons.UNSUPPORTED_ACTION);
}

export function serializeServerProperties(values = {}) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");
}

function validateRuntimePlan(runtimePlan) {
  if (
    !runtimePlan?.room?.id
    || !runtimePlan?.files?.root
    || !runtimePlan?.layout?.runtime
    || !runtimePlan?.layout?.downloads
    || !runtimePlan?.layout?.metadata
    || !runtimePlan?.fabric?.launcherJar
    || !runtimePlan?.serverProperties?.values
    || !runtimePlan?.eula?.accepted
    || !Array.isArray(runtimePlan?.command)
    || runtimePlan.command.length === 0
  ) {
    return LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN;
  }

  const appDataRoot = runtimePlan.layout.appDataRoot;
  const managedPaths = [
    runtimePlan.files.root,
    runtimePlan.files.mods,
    runtimePlan.files.world,
    runtimePlan.layout.runtime,
    runtimePlan.layout.logs,
    runtimePlan.layout.cache,
    runtimePlan.layout.downloads,
    runtimePlan.layout.metadata,
    runtimePlan.fabric.launcherJar,
    runtimePlan.eula.path,
    runtimePlan.serverProperties.path,
    ...(runtimePlan.mods?.entries ?? []).map((entry) => entry.target)
  ];
  const modSources = (runtimePlan.mods?.entries ?? [])
    .map((entry) => entry.source)
    .filter((source) => typeof source === "string" && isPathLike(source));

  if (
    !isSafeRoot(appDataRoot)
    || managedPaths.some((path) => !isManagedPath(appDataRoot, path))
    || modSources.some((path) => !isManagedPath(appDataRoot, path))
  ) {
    return LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN;
  }

  return null;
}

function fail(reason) {
  return {
    ok: false,
    failure: {
      reason,
      message: failureMessages[reason]
    }
  };
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function isSafeRoot(path) {
  return typeof path === "string" && path.trim().length > 0 && !path.includes("\0") && !hasParentPathSegment(path);
}

function isManagedPath(root, path) {
  if (typeof path !== "string" || path.trim().length === 0 || path.includes("\0") || hasParentPathSegment(path)) {
    return false;
  }

  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function isPathLike(value) {
  return value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value);
}

function hasParentPathSegment(path) {
  return String(path)
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function normalizePath(path) {
  return joinPath(path);
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^([A-Z]):\//i, "$1:/");
}
