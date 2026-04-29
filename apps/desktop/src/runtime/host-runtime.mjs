export const HostRuntimeStates = Object.freeze({
  STOPPED: "stopped",
  READY: "ready",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  RESTARTING: "restarting",
  CRASHED: "crashed",
  FAILED: "failed"
});

export const HostRuntimeFailureReasons = Object.freeze({
  UNSUPPORTED_VERSION: "unsupported_version",
  JAVA_MISSING: "java_missing",
  JAVA_INCOMPATIBLE: "java_incompatible",
  EULA_REQUIRED: "eula_required",
  FABRIC_CHECKSUM_FAILED: "fabric_checksum_failed",
  FABRIC_BOOTSTRAP_FAILED: "fabric_bootstrap_failed",
  PACK_NOT_FIXED: "pack_not_fixed",
  PACK_CHECKSUM_FAILED: "pack_checksum_failed",
  ROOM_CRASHED: "room_crashed",
  SERVER_UUID_MISSING: "server_uuid_missing",
  LOADER_UNAVAILABLE: "loader_unavailable",
  MOD_CHECKSUM_FAILED: "mod_checksum_failed",
  CACHE_LAYOUT_INVALID: "cache_layout_invalid"
});

export const ApprovalUiStates = Object.freeze({
  EMPTY: "empty",
  WAITING_FOR_SERVER_UUID: "waiting_for_server_uuid",
  NEEDS_REVIEW: "needs_review",
  APPROVED: "approved",
  DENIED: "denied",
  BLOCKED: "blocked",
  EXPIRED: "expired",
  HOST_UNAVAILABLE: "host_unavailable",
  ALREADY_ALLOWED: "already_allowed",
  IDENTITY_CHANGED: "identity_changed",
  ERROR: "error"
});

export const HostRuntimeActions = Object.freeze({
  PREPARE: "prepare",
  START: "start",
  STOP: "stop",
  RESTART: "restart"
});

const MINIMUM_JAVA_MAJOR = 21;
const REDACTED = "[redacted]";

const failureMessages = Object.freeze({
  [HostRuntimeFailureReasons.UNSUPPORTED_VERSION]: "Choose a supported Minecraft version before opening this room.",
  [HostRuntimeFailureReasons.JAVA_MISSING]: "Install Java 21 or newer before opening this room.",
  [HostRuntimeFailureReasons.JAVA_INCOMPATIBLE]: "Update Java before opening this room.",
  [HostRuntimeFailureReasons.EULA_REQUIRED]: "Accept the Minecraft EULA before opening this room.",
  [HostRuntimeFailureReasons.FABRIC_CHECKSUM_FAILED]: "Room setup files did not match the expected download.",
  [HostRuntimeFailureReasons.FABRIC_BOOTSTRAP_FAILED]: "Finish room setup before opening this room.",
  [HostRuntimeFailureReasons.PACK_NOT_FIXED]: "Use the fixed room pack before opening this room.",
  [HostRuntimeFailureReasons.PACK_CHECKSUM_FAILED]: "The selected room pack did not match the expected download.",
  [HostRuntimeFailureReasons.ROOM_CRASHED]: "The room stopped unexpectedly. Try opening it again.",
  [HostRuntimeFailureReasons.SERVER_UUID_MISSING]: "Wait for Minecraft to finish identifying the friend before approving.",
  [HostRuntimeFailureReasons.LOADER_UNAVAILABLE]: "Use a supported room version before opening this room.",
  [HostRuntimeFailureReasons.MOD_CHECKSUM_FAILED]: "One of the room setup files did not match the expected download.",
  [HostRuntimeFailureReasons.CACHE_LAYOUT_INVALID]: "Choose a room folder the app can use for setup files."
});

export function createHostRuntimePlan(input = {}) {
  const failure = validateHostRuntime(input);

  if (failure) {
    return fail(failure);
  }

  const selectedMinecraft = selectSupportedMinecraftVersion(input.minecraft);
  const loader = resolveFabricLoader({
    minecraftVersion: selectedMinecraft.version,
    loaders: input.fabric?.loaders,
    defaultLoaderVersion: input.fabric?.loaderVersion
  });

  if (!loader.ok) {
    return loader;
  }

  const layout = createAppDataLayout(input.room);
  const java = createWindowsJavaDetectionPlan(input.java);
  const mods = createModInstallPlan(input.pack, layout);

  return {
    ok: true,
    plan: {
      room: {
        id: input.room.id,
        hostId: input.room.hostId,
        name: input.room.name,
        minecraftVersion: selectedMinecraft.version,
        channel: selectedMinecraft.channel
      },
      lifecycle: {
        current: input.runtime.state,
        next: HostRuntimeStates.READY,
        adapter: "simulated-process"
      },
      files: {
        root: layout.roomRoot,
        serverProperties: layout.serverProperties,
        eula: layout.eula,
        mods: layout.mods,
        world: layout.world
      },
      layout,
      java: {
        ...java,
        path: input.java.path,
        majorVersion: input.java.majorVersion
      },
      fabric: {
        loaderVersion: loader.loader.version,
        installerVerified: true,
        launcherJar: joinPath(layout.runtime, loader.loader.launcherJar),
        metadataPath: joinPath(layout.metadata, `fabric-${selectedMinecraft.version}.json`)
      },
      cache: createCachePlan(input.cache, layout),
      eula: createEulaPlan(input.eula, layout),
      serverProperties: createServerPropertiesPlan(input.serverProperties, layout),
      mods,
      pack: {
        id: input.pack.id,
        fixed: true,
        checksumVerified: true
      },
      bridge: {
        approvalSource: "server_observed_uuid",
        claimedIdentityCanApprove: false
      },
      command: [
        input.java.path,
        "-jar",
        joinPath(layout.runtime, loader.loader.launcherJar),
        "nogui"
      ]
    }
  };
}

export function selectSupportedMinecraftVersion(minecraft = {}) {
  const supportedVersions = minecraft.supportedVersions ?? [];
  const selected = supportedVersions.find((candidate) => candidate.version === minecraft.version || candidate === minecraft.version);

  if (!selected) {
    return fail(HostRuntimeFailureReasons.UNSUPPORTED_VERSION);
  }

  if (typeof selected === "string") {
    return {
      ok: true,
      version: selected,
      channel: "stable"
    };
  }

  return {
    ok: true,
    version: selected.version,
    channel: selected.channel ?? "stable",
    javaMajor: selected.javaMajor ?? MINIMUM_JAVA_MAJOR
  };
}

export function resolveFabricLoader(input = {}) {
  const loaders = input.loaders ?? [];
  const loader = loaders.find((candidate) => candidate.minecraftVersion === input.minecraftVersion)
    ?? loaders.find((candidate) => candidate.version === input.defaultLoaderVersion)
    ?? (input.defaultLoaderVersion
      ? {
          minecraftVersion: input.minecraftVersion,
          version: input.defaultLoaderVersion,
          launcherJar: "fabric-server-launch.jar"
        }
      : null);

  if (!loader) {
    return fail(HostRuntimeFailureReasons.LOADER_UNAVAILABLE);
  }

  return {
    ok: true,
    loader: {
      minecraftVersion: loader.minecraftVersion ?? input.minecraftVersion,
      version: loader.version,
      installerSha256: loader.installerSha256,
      launcherJar: loader.launcherJar ?? `fabric-server-${input.minecraftVersion}-${loader.version}.jar`
    }
  };
}

export function createAppDataLayout(room = {}) {
  const appDataRoot = room.appDataRoot ?? room.dataRoot;
  const roomRoot = joinPath(appDataRoot, "rooms", room.id);

  return {
    appDataRoot: normalizePath(appDataRoot),
    roomRoot,
    runtime: joinPath(roomRoot, "runtime"),
    cache: joinPath(appDataRoot, "cache"),
    downloads: joinPath(appDataRoot, "cache", "downloads"),
    metadata: joinPath(appDataRoot, "cache", "metadata"),
    serverProperties: joinPath(roomRoot, "server.properties"),
    eula: joinPath(roomRoot, "eula.txt"),
    mods: joinPath(roomRoot, "mods"),
    world: joinPath(roomRoot, "world"),
    logs: joinPath(roomRoot, "logs")
  };
}

export function createWindowsJavaDetectionPlan(java = {}) {
  return {
    platform: "windows",
    minimumMajorVersion: MINIMUM_JAVA_MAJOR,
    searchOrder: [
      "configuredPath",
      "JAVA_HOME",
      "PATH",
      "ProgramFiles/Eclipse Adoptium",
      "ProgramFiles/Java"
    ],
    adapterContract: {
      command: "detectJava",
      returns: ["path", "majorVersion", "vendor", "source"]
    },
    detected: Boolean(java.path && Number.isInteger(java.majorVersion)),
    source: java.source ?? (java.path ? "configuredPath" : null),
    vendor: java.vendor ?? null
  };
}

export function createCachePlan(cache = {}, layout = {}) {
  return {
    root: layout.cache,
    downloads: layout.downloads,
    metadata: layout.metadata,
    checksumAlgorithm: "sha256",
    reuseVerifiedDownloads: cache.reuseVerifiedDownloads !== false,
    requireChecksumBeforeInstall: true
  };
}

export function createEulaPlan(eula = {}, layout = {}) {
  return {
    path: layout.eula,
    accepted: eula.accepted === true,
    writeText: eula.accepted === true ? "eula=true\n" : null,
    requiresExplicitHostConsent: true
  };
}

export function createServerPropertiesPlan(serverProperties = {}, layout = {}) {
  const values = {
    "enable-command-block": "false",
    "enforce-secure-profile": "true",
    "max-players": String(serverProperties.maxPlayers ?? 10),
    "motd": serverProperties.motd ?? "Cozy Performance Room",
    "online-mode": "true",
    "server-ip": "",
    "server-port": String(serverProperties.port ?? 25565),
    "white-list": "true"
  };

  return {
    path: layout.serverProperties,
    values,
    advancedDiagnostics: {
      port: values["server-port"],
      bindAddress: values["server-ip"] || "default"
    }
  };
}

export function createModInstallPlan(pack = {}, layout = {}) {
  const mods = pack.mods ?? [];

  return {
    directory: layout.mods,
    strategy: "replace-with-fixed-pack",
    removeUnknownMods: true,
    entries: mods.map((mod) => ({
      id: mod.id,
      fileName: mod.fileName,
      sha256: mod.sha256,
      source: mod.source,
      target: joinPath(layout.mods, mod.fileName),
      verified: checksumsMatch(mod.expectedSha256 ?? mod.sha256, mod.sha256)
    }))
  };
}

export function simulateLifecycleTransition(state = {}, action) {
  const current = state.current ?? state.state ?? HostRuntimeStates.STOPPED;

  if (current === HostRuntimeStates.CRASHED || current === HostRuntimeStates.FAILED) {
    return {
      current,
      next: current,
      allowed: false,
      reason: HostRuntimeFailureReasons.ROOM_CRASHED
    };
  }

  const transitions = {
    [HostRuntimeActions.PREPARE]: {
      [HostRuntimeStates.STOPPED]: HostRuntimeStates.READY
    },
    [HostRuntimeActions.START]: {
      [HostRuntimeStates.READY]: HostRuntimeStates.STARTING,
      [HostRuntimeStates.STOPPED]: HostRuntimeStates.STARTING,
      [HostRuntimeStates.STARTING]: HostRuntimeStates.RUNNING
    },
    [HostRuntimeActions.STOP]: {
      [HostRuntimeStates.RUNNING]: HostRuntimeStates.STOPPING,
      [HostRuntimeStates.STARTING]: HostRuntimeStates.STOPPING,
      [HostRuntimeStates.STOPPING]: HostRuntimeStates.STOPPED
    },
    [HostRuntimeActions.RESTART]: {
      [HostRuntimeStates.RUNNING]: HostRuntimeStates.RESTARTING,
      [HostRuntimeStates.RESTARTING]: HostRuntimeStates.STARTING
    }
  };

  const next = transitions[action]?.[current];

  return {
    current,
    next: next ?? current,
    allowed: Boolean(next),
    action
  };
}

export function createRedactedLogEvent(input = {}) {
  return {
    type: "runtime.log",
    roomId: input.roomId,
    level: input.level ?? "info",
    stream: input.stream ?? "stdout",
    line: redactHostLogLine(input.line ?? ""),
    sequence: input.sequence ?? 0
  };
}

export function redactHostLogLine(line) {
  return String(line)
    .replaceAll(/(token=)[^\s&]+/gi, `$1${REDACTED}`)
    .replaceAll(/(invite=)[^\s&]+/gi, `$1${REDACTED}`)
    .replaceAll(/(secret=)[^\s&]+/gi, `$1${REDACTED}`)
    .replaceAll(/([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})/gi, REDACTED)
    .replaceAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/gi, REDACTED);
}

export function createBridgeApprovalEvent(input = {}) {
  if (!input.serverObservedUuid) {
    return fail(HostRuntimeFailureReasons.SERVER_UUID_MISSING);
  }

  const claimedMinecraftUuid = input.claimedIdentity?.minecraftUuid;

  return {
    type: "bridge.approval_requested",
    roomId: input.roomId,
    connectionId: input.connectionId,
    friendId: input.claimedIdentity?.friendId,
    displayName: input.displayName,
    minecraftUuid: input.serverObservedUuid,
    claimedMinecraftUuid,
    requiresHostApproval: true,
    identityMismatch: claimedMinecraftUuid !== input.serverObservedUuid
  };
}

export function createApprovalUiState(input = {}) {
  if (input.error) {
    return {
      state: ApprovalUiStates.ERROR,
      title: "승인 상태를 확인할 수 없습니다.",
      primaryAction: null
    };
  }

  if (input.decision === "approved") {
    return {
      state: ApprovalUiStates.APPROVED,
      title: `${input.displayName} 님을 승인했습니다.`,
      primaryAction: null
    };
  }

  if (input.decision === "denied") {
    return {
      state: ApprovalUiStates.DENIED,
      title: "요청을 거절했습니다.",
      primaryAction: null
    };
  }

  if (input.decision === "blocked") {
    return {
      state: ApprovalUiStates.BLOCKED,
      title: "이 친구의 요청을 차단했습니다.",
      primaryAction: null
    };
  }

  if (input.status === "expired") {
    return {
      state: ApprovalUiStates.EXPIRED,
      title: "승인 시간이 지났습니다.",
      primaryAction: "request_again"
    };
  }

  if (input.status === "host_unavailable") {
    return {
      state: ApprovalUiStates.HOST_UNAVAILABLE,
      title: "방을 다시 열면 승인할 수 있습니다.",
      primaryAction: null
    };
  }

  if (input.status === "already_allowed") {
    return {
      state: ApprovalUiStates.ALREADY_ALLOWED,
      title: "이미 들어올 수 있는 친구입니다.",
      primaryAction: null
    };
  }

  if (input.status === "identity_changed" || (input.serverObservedUuid && input.claimedMinecraftUuid && input.claimedMinecraftUuid !== input.serverObservedUuid)) {
    return {
      state: ApprovalUiStates.IDENTITY_CHANGED,
      title: "친구의 Minecraft 계정이 초대 정보와 다릅니다.",
      primaryAction: "review_again",
      secondaryAction: "deny",
      identityMismatch: true
    };
  }

  if (!input.connectionId) {
    return {
      state: ApprovalUiStates.EMPTY,
      title: "대기 중인 친구가 없습니다.",
      primaryAction: null
    };
  }

  if (!input.serverObservedUuid) {
    return {
      state: ApprovalUiStates.WAITING_FOR_SERVER_UUID,
      title: "친구를 확인하는 중입니다.",
      primaryAction: null
    };
  }

  return {
    state: ApprovalUiStates.NEEDS_REVIEW,
    title: `${input.displayName} 님이 기다리고 있습니다.`,
    primaryAction: "approve",
    secondaryAction: "deny",
    identityMismatch: input.claimedMinecraftUuid !== input.serverObservedUuid
  };
}

function validateHostRuntime(input) {
  const selectedMinecraft = selectSupportedMinecraftVersion(input.minecraft);

  if (!selectedMinecraft.ok) {
    return selectedMinecraft.failure.reason;
  }

  if (!input.java?.path || !Number.isInteger(input.java.majorVersion)) {
    return HostRuntimeFailureReasons.JAVA_MISSING;
  }

  if (input.java.majorVersion < (selectedMinecraft.javaMajor ?? MINIMUM_JAVA_MAJOR)) {
    return HostRuntimeFailureReasons.JAVA_INCOMPATIBLE;
  }

  if (!input.eula?.accepted) {
    return HostRuntimeFailureReasons.EULA_REQUIRED;
  }

  if (input.fabric?.bootstrapState === "failed") {
    return HostRuntimeFailureReasons.FABRIC_BOOTSTRAP_FAILED;
  }

  if (!checksumsMatch(input.fabric?.expectedInstallerSha256, input.fabric?.installerSha256)) {
    return HostRuntimeFailureReasons.FABRIC_CHECKSUM_FAILED;
  }

  if (!input.pack?.fixed) {
    return HostRuntimeFailureReasons.PACK_NOT_FIXED;
  }

  if (!checksumsMatch(input.pack?.expectedSha256, input.pack?.sha256)) {
    return HostRuntimeFailureReasons.PACK_CHECKSUM_FAILED;
  }

  if ((input.pack?.mods ?? []).some((mod) => !checksumsMatch(mod.expectedSha256 ?? mod.sha256, mod.sha256))) {
    return HostRuntimeFailureReasons.MOD_CHECKSUM_FAILED;
  }

  if (input.runtime?.state === HostRuntimeStates.CRASHED || input.runtime?.state === HostRuntimeStates.FAILED) {
    return HostRuntimeFailureReasons.ROOM_CRASHED;
  }

  if (!input.room?.id || !(input.room?.appDataRoot ?? input.room?.dataRoot)) {
    return HostRuntimeFailureReasons.CACHE_LAYOUT_INVALID;
  }

  return null;
}

function checksumsMatch(expected, actual) {
  return Boolean(expected && actual && expected === actual);
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
