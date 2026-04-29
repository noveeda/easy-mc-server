import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostRuntimeFailureReasons,
  HostRuntimeStates,
  createBridgeApprovalEvent,
  createHostRuntimePlan
} from "../src/runtime/host-runtime.mjs";

const baseInput = Object.freeze({
  room: {
    id: "room-a",
    hostId: "host-a",
    name: "Cozy Room",
    dataRoot: "C:/Rooms/cozy"
  },
  minecraft: {
    version: "1.21.1",
    supportedVersions: ["1.21.1"]
  },
  java: {
    path: "C:/Program Files/Java/bin/java.exe",
    majorVersion: 21
  },
  fabric: {
    loaderVersion: "0.16.10",
    expectedInstallerSha256: "fabric-sha",
    installerSha256: "fabric-sha"
  },
  eula: {
    accepted: true
  },
  pack: {
    id: "mvp0-performance",
    fixed: true,
    expectedSha256: "pack-sha",
    sha256: "pack-sha"
  },
  runtime: {
    state: HostRuntimeStates.STOPPED
  }
});

test("supported version, Java, EULA, Fabric, and fixed pack produce a runnable room plan", () => {
  const result = createHostRuntimePlan(baseInput);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.lifecycle, {
    current: HostRuntimeStates.STOPPED,
    next: HostRuntimeStates.READY
  });
  assert.deepEqual(result.plan.files, {
    root: "C:/Rooms/cozy/room-a",
    serverProperties: "C:/Rooms/cozy/room-a/server.properties",
    eula: "C:/Rooms/cozy/room-a/eula.txt",
    mods: "C:/Rooms/cozy/room-a/mods",
    world: "C:/Rooms/cozy/room-a/world"
  });
  assert.deepEqual(result.plan.fabric, {
    loaderVersion: "0.16.10",
    installerVerified: true
  });
  assert.deepEqual(result.plan.pack, {
    id: "mvp0-performance",
    fixed: true,
    checksumVerified: true
  });
  assert.deepEqual(result.plan.bridge, {
    approvalSource: "server_observed_uuid",
    claimedIdentityCanApprove: false
  });
  assert.deepEqual(result.plan.command, [
    "C:/Program Files/Java/bin/java.exe",
    "-jar",
    "fabric-server-launch.jar",
    "nogui"
  ]);
});

test("runtime failures return room-language failure reasons", () => {
  const cases = [
    {
      name: "missing Java",
      patch: { java: null },
      reason: HostRuntimeFailureReasons.JAVA_MISSING,
      message: "Install Java 21 or newer before opening this room."
    },
    {
      name: "incompatible Java",
      patch: { java: { path: "java", majorVersion: 17 } },
      reason: HostRuntimeFailureReasons.JAVA_INCOMPATIBLE,
      message: "Update Java before opening this room."
    },
    {
      name: "missing EULA",
      patch: { eula: { accepted: false } },
      reason: HostRuntimeFailureReasons.EULA_REQUIRED,
      message: "Accept the Minecraft EULA before opening this room."
    },
    {
      name: "Fabric checksum failure",
      patch: { fabric: { ...baseInput.fabric, installerSha256: "wrong" } },
      reason: HostRuntimeFailureReasons.FABRIC_CHECKSUM_FAILED,
      message: "Room setup files did not match the expected download."
    },
    {
      name: "Fabric bootstrap failure",
      patch: { fabric: { ...baseInput.fabric, bootstrapState: "failed" } },
      reason: HostRuntimeFailureReasons.FABRIC_BOOTSTRAP_FAILED,
      message: "Finish room setup before opening this room."
    },
    {
      name: "pack checksum failure",
      patch: { pack: { ...baseInput.pack, sha256: "wrong" } },
      reason: HostRuntimeFailureReasons.PACK_CHECKSUM_FAILED,
      message: "The selected room pack did not match the expected download."
    },
    {
      name: "crashed room",
      patch: { runtime: { state: HostRuntimeStates.CRASHED, exitCode: 1 } },
      reason: HostRuntimeFailureReasons.ROOM_CRASHED,
      message: "The room stopped unexpectedly. Try opening it again."
    }
  ];

  for (const { name, patch, reason, message } of cases) {
    const result = createHostRuntimePlan({ ...baseInput, ...patch });

    assert.deepEqual(
      result,
      {
        ok: false,
        failure: {
          reason,
          message
        }
      },
      name
    );
  }
});

test("unsupported versions and unfixed packs fail closed", () => {
  assert.deepEqual(
    createHostRuntimePlan({
      ...baseInput,
      minecraft: {
        version: "1.20.6",
        supportedVersions: ["1.21.1"]
      }
    }),
    {
      ok: false,
      failure: {
        reason: HostRuntimeFailureReasons.UNSUPPORTED_VERSION,
        message: "Choose a supported Minecraft version before opening this room."
      }
    }
  );

  assert.deepEqual(
    createHostRuntimePlan({
      ...baseInput,
      pack: {
        ...baseInput.pack,
        fixed: false
      }
    }),
    {
      ok: false,
      failure: {
        reason: HostRuntimeFailureReasons.PACK_NOT_FIXED,
        message: "Use the fixed room pack before opening this room."
      }
    }
  );
});

test("server-observed UUID creates approval event and claimed identity cannot bypass it", () => {
  const event = createBridgeApprovalEvent({
    roomId: "room-a",
    connectionId: "conn-a",
    displayName: "MineFriend_27",
    claimedIdentity: {
      friendId: "friend-a",
      minecraftUuid: "claimed-uuid"
    },
    serverObservedUuid: "server-observed-uuid"
  });

  assert.deepEqual(event, {
    type: "bridge.approval_requested",
    roomId: "room-a",
    connectionId: "conn-a",
    friendId: "friend-a",
    displayName: "MineFriend_27",
    minecraftUuid: "server-observed-uuid",
    claimedMinecraftUuid: "claimed-uuid",
    requiresHostApproval: true,
    identityMismatch: true
  });
});

test("bridge approval event requires the server-observed UUID", () => {
  assert.deepEqual(
    createBridgeApprovalEvent({
      roomId: "room-a",
      connectionId: "conn-a",
      displayName: "MineFriend_27",
      claimedIdentity: {
        friendId: "friend-a",
        minecraftUuid: "claimed-uuid"
      }
    }),
    {
      ok: false,
      failure: {
        reason: HostRuntimeFailureReasons.SERVER_UUID_MISSING,
        message: "Wait for Minecraft to finish identifying the friend before approving."
      }
    }
  );
});
