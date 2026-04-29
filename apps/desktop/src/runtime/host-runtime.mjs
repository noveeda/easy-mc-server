export const HostRuntimeStates = Object.freeze({
  STOPPED: "stopped",
  READY: "ready",
  STARTING: "starting",
  RUNNING: "running",
  CRASHED: "crashed"
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
  SERVER_UUID_MISSING: "server_uuid_missing"
});

const MINIMUM_JAVA_MAJOR = 21;

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
  [HostRuntimeFailureReasons.SERVER_UUID_MISSING]: "Wait for Minecraft to finish identifying the friend before approving."
});

export function createHostRuntimePlan(input = {}) {
  const failure = validateHostRuntime(input);

  if (failure) {
    return fail(failure);
  }

  const root = joinPath(input.room.dataRoot, input.room.id);

  return {
    ok: true,
    plan: {
      room: {
        id: input.room.id,
        hostId: input.room.hostId,
        name: input.room.name,
        minecraftVersion: input.minecraft.version
      },
      lifecycle: {
        current: input.runtime.state,
        next: HostRuntimeStates.READY
      },
      files: {
        root,
        serverProperties: joinPath(root, "server.properties"),
        eula: joinPath(root, "eula.txt"),
        mods: joinPath(root, "mods"),
        world: joinPath(root, "world")
      },
      java: {
        path: input.java.path,
        majorVersion: input.java.majorVersion
      },
      fabric: {
        loaderVersion: input.fabric.loaderVersion,
        installerVerified: true
      },
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
        "fabric-server-launch.jar",
        "nogui"
      ]
    }
  };
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

function validateHostRuntime(input) {
  if (!input.minecraft?.supportedVersions?.includes(input.minecraft.version)) {
    return HostRuntimeFailureReasons.UNSUPPORTED_VERSION;
  }

  if (!input.java?.path || !Number.isInteger(input.java.majorVersion)) {
    return HostRuntimeFailureReasons.JAVA_MISSING;
  }

  if (input.java.majorVersion < MINIMUM_JAVA_MAJOR) {
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

  if (input.runtime?.state === HostRuntimeStates.CRASHED) {
    return HostRuntimeFailureReasons.ROOM_CRASHED;
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

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .join("/")
    .replaceAll("\\", "/")
    .replaceAll(/\/+/g, "/")
    .replace(/^([A-Z]):\//i, "$1:/");
}
