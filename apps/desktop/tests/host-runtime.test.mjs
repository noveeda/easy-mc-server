import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ApprovalUiStates,
  HostRuntimeActions,
  HostRuntimeFailureReasons,
  HostRuntimeStates,
  createApprovalUiState,
  createBridgeApprovalEvent,
  createHostRuntimePlan,
  createRedactedLogEvent,
  createWindowsJavaDetectionPlan,
  redactHostLogLine,
  resolveFabricLoader,
  selectSupportedMinecraftVersion,
  simulateLifecycleTransition
} from "../src/runtime/host-runtime.mjs";

const baseInput = Object.freeze({
  room: {
    id: "room-a",
    hostId: "host-a",
    name: "Cozy Room",
    appDataRoot: "C:/Users/Alice/AppData/Roaming/RoomBuilder"
  },
  minecraft: {
    version: "1.21.1",
    supportedVersions: [
      {
        version: "1.21.1",
        channel: "stable",
        javaMajor: 21
      }
    ]
  },
  java: {
    path: "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
    majorVersion: 21,
    vendor: "Eclipse Adoptium",
    source: "ProgramFiles/Eclipse Adoptium"
  },
  fabric: {
    loaderVersion: "0.16.10",
    expectedInstallerSha256: "fabric-sha",
    installerSha256: "fabric-sha",
    loaders: [
      {
        minecraftVersion: "1.21.1",
        version: "0.16.10",
        launcherJar: "fabric-server-1.21.1-0.16.10.jar",
        installerSha256: "fabric-sha",
        serverJarSha256: "fabric-server-sha"
      }
    ]
  },
  cache: {
    reuseVerifiedDownloads: true
  },
  eula: {
    accepted: true
  },
  serverProperties: {
    maxPlayers: 8,
    motd: "Cozy Room",
    port: 25565
  },
  pack: {
    id: "mvp0-performance",
    fixed: true,
    expectedSha256: "pack-sha",
    sha256: "pack-sha",
    mods: [
      {
        id: "fabric-api",
        fileName: "fabric-api.jar",
        sha256: "fabric-api-sha",
        expectedSha256: "fabric-api-sha",
        source: "cache"
      },
      {
        id: "lithium",
        fileName: "lithium.jar",
        sha256: "lithium-sha",
        expectedSha256: "lithium-sha",
        source: "cache"
      }
    ]
  },
  runtime: {
    state: HostRuntimeStates.STOPPED
  }
});

test("supported version, Java, EULA, Fabric, cache, and fixed pack produce a runnable room plan", () => {
  const result = createHostRuntimePlan(baseInput);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.lifecycle, {
    current: HostRuntimeStates.STOPPED,
    next: HostRuntimeStates.READY,
    adapter: "simulated-process"
  });
  assert.deepEqual(result.plan.files, {
    root: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a",
    serverProperties: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/server.properties",
    eula: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/eula.txt",
    mods: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/mods",
    world: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/world"
  });
  assert.deepEqual(result.plan.layout, {
    appDataRoot: "C:/Users/Alice/AppData/Roaming/RoomBuilder",
    roomRoot: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a",
    runtime: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime",
    cache: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache",
    downloads: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads",
    metadata: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/metadata",
    serverProperties: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/server.properties",
    eula: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/eula.txt",
    mods: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/mods",
    world: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/world",
    logs: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/logs"
  });
  assert.deepEqual(result.plan.fabric, {
    loaderVersion: "0.16.10",
    installerVerified: true,
    installerSha256: "fabric-sha",
    serverJarSha256: "fabric-server-sha",
    launcherJar: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar",
    metadataPath: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/metadata/fabric-1.21.1.json"
  });
  assert.deepEqual(result.plan.cache, {
    root: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache",
    downloads: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads",
    metadata: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/metadata",
    checksumAlgorithm: "sha256",
    reuseVerifiedDownloads: true,
    requireChecksumBeforeInstall: true
  });
  assert.deepEqual(result.plan.eula, {
    path: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/eula.txt",
    accepted: true,
    writeText: "eula=true\n",
    requiresExplicitHostConsent: true
  });
  assert.equal(result.plan.serverProperties.values["white-list"], "true");
  assert.deepEqual(result.plan.serverProperties.advancedDiagnostics, {
    port: "25565",
    bindAddress: "default"
  });
  assert.deepEqual(result.plan.mods.entries.map((entry) => [entry.id, entry.target, entry.verified]), [
    [
      "fabric-api",
      "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/mods/fabric-api.jar",
      true
    ],
    [
      "lithium",
      "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/mods/lithium.jar",
      true
    ]
  ]);
  assert.deepEqual(result.plan.bridge, {
    approvalSource: "server_observed_uuid",
    claimedIdentityCanApprove: false
  });
  assert.deepEqual(result.plan.command, [
    "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
    "-jar",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar",
    "nogui"
  ]);
});

test("supported Minecraft selection accepts stable object versions and rejects unknown versions", () => {
  assert.deepEqual(selectSupportedMinecraftVersion(baseInput.minecraft), {
    ok: true,
    version: "1.21.1",
    channel: "stable",
    javaMajor: 21
  });

  assert.deepEqual(
    selectSupportedMinecraftVersion({
      version: "1.20.6",
      supportedVersions: baseInput.minecraft.supportedVersions
    }),
    {
      ok: false,
      failure: {
        reason: HostRuntimeFailureReasons.UNSUPPORTED_VERSION,
        message: "Choose a supported Minecraft version before opening this room."
      }
    }
  );
});

test("Fabric loader resolution is stable for selected Minecraft version", () => {
  assert.deepEqual(
    resolveFabricLoader({
      minecraftVersion: "1.21.1",
      loaders: baseInput.fabric.loaders
    }),
    {
      ok: true,
      loader: {
        minecraftVersion: "1.21.1",
        version: "0.16.10",
        installerSha256: "fabric-sha",
        serverJarSha256: "fabric-server-sha",
        launcherJar: "fabric-server-1.21.1-0.16.10.jar"
      }
    }
  );

  assert.deepEqual(resolveFabricLoader({ minecraftVersion: "1.21.1", loaders: [] }), {
    ok: false,
    failure: {
      reason: HostRuntimeFailureReasons.LOADER_UNAVAILABLE,
      message: "Use a supported room version before opening this room."
    }
  });
});

test("Windows Java detection contract describes adapter inputs without probing the host", () => {
  assert.deepEqual(createWindowsJavaDetectionPlan(baseInput.java), {
    platform: "windows",
    minimumMajorVersion: 21,
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
    detected: true,
    source: "ProgramFiles/Eclipse Adoptium",
    vendor: "Eclipse Adoptium"
  });
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
      name: "mod checksum failure",
      patch: {
        pack: {
          ...baseInput.pack,
          mods: [{ ...baseInput.pack.mods[0], sha256: "wrong" }]
        }
      },
      reason: HostRuntimeFailureReasons.MOD_CHECKSUM_FAILED,
      message: "One of the room setup files did not match the expected download."
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

test("start, stop, and restart lifecycle simulation never launches a process", () => {
  assert.deepEqual(simulateLifecycleTransition({ current: HostRuntimeStates.STOPPED }, HostRuntimeActions.PREPARE), {
    current: HostRuntimeStates.STOPPED,
    next: HostRuntimeStates.READY,
    allowed: true,
    action: HostRuntimeActions.PREPARE
  });
  assert.deepEqual(simulateLifecycleTransition({ current: HostRuntimeStates.READY }, HostRuntimeActions.START), {
    current: HostRuntimeStates.READY,
    next: HostRuntimeStates.STARTING,
    allowed: true,
    action: HostRuntimeActions.START
  });
  assert.deepEqual(simulateLifecycleTransition({ current: HostRuntimeStates.RUNNING }, HostRuntimeActions.RESTART), {
    current: HostRuntimeStates.RUNNING,
    next: HostRuntimeStates.RESTARTING,
    allowed: true,
    action: HostRuntimeActions.RESTART
  });
  assert.deepEqual(simulateLifecycleTransition({ current: HostRuntimeStates.CRASHED }, HostRuntimeActions.START), {
    current: HostRuntimeStates.CRASHED,
    next: HostRuntimeStates.CRASHED,
    allowed: false,
    reason: HostRuntimeFailureReasons.ROOM_CRASHED
  });
});

test("redacted log streaming removes secrets, invite tokens, email, and UUID values", () => {
  const rawLine = "token=abc123 invite=COZY user=alice@example.com uuid=123e4567-e89b-12d3-a456-426614174000";

  assert.equal(
    redactHostLogLine(rawLine),
    "token=[redacted] invite=[redacted] user=[redacted] uuid=[redacted]"
  );
  assert.deepEqual(createRedactedLogEvent({ roomId: "room-a", sequence: 7, line: rawLine }), {
    type: "runtime.log",
    roomId: "room-a",
    level: "info",
    stream: "stdout",
    line: "token=[redacted] invite=[redacted] user=[redacted] uuid=[redacted]",
    sequence: 7
  });
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

test("approval UI state model separates waiting, review, and terminal states", () => {
  assert.deepEqual(createApprovalUiState({}), {
    state: ApprovalUiStates.EMPTY,
    title: "대기 중인 친구가 없습니다.",
    primaryAction: null
  });
  assert.deepEqual(createApprovalUiState({ connectionId: "conn-a" }), {
    state: ApprovalUiStates.WAITING_FOR_SERVER_UUID,
    title: "친구를 확인하는 중입니다.",
    primaryAction: null
  });
  assert.deepEqual(
    createApprovalUiState({
      connectionId: "conn-a",
      displayName: "MineFriend_27",
      serverObservedUuid: "server-uuid"
    }),
    {
      state: ApprovalUiStates.NEEDS_REVIEW,
      title: "MineFriend_27 님이 기다리고 있습니다.",
      primaryAction: "approve",
      secondaryAction: "deny",
      identityMismatch: false
    }
  );
  assert.deepEqual(
    createApprovalUiState({
      connectionId: "conn-a",
      displayName: "MineFriend_27",
      claimedMinecraftUuid: "server-uuid",
      serverObservedUuid: "server-uuid"
    }),
    {
      state: ApprovalUiStates.NEEDS_REVIEW,
      title: "MineFriend_27 님이 기다리고 있습니다.",
      primaryAction: "approve",
      secondaryAction: "deny",
      identityMismatch: false
    }
  );
  assert.deepEqual(
    createApprovalUiState({
      connectionId: "conn-a",
      displayName: "MineFriend_27",
      claimedMinecraftUuid: "claimed-uuid",
      serverObservedUuid: "server-uuid"
    }),
    {
      state: ApprovalUiStates.IDENTITY_CHANGED,
      title: "친구의 Minecraft 계정이 초대 정보와 다릅니다.",
      primaryAction: "review_again",
      secondaryAction: "deny",
      identityMismatch: true
    }
  );
  assert.deepEqual(createApprovalUiState({ displayName: "MineFriend_27", decision: "approved" }), {
    state: ApprovalUiStates.APPROVED,
    title: "MineFriend_27 님을 승인했습니다.",
    primaryAction: null
  });
  assert.deepEqual(createApprovalUiState({ decision: "denied" }), {
    state: ApprovalUiStates.DENIED,
    title: "요청을 거절했습니다.",
    primaryAction: null
  });
  assert.deepEqual(createApprovalUiState({ decision: "blocked" }), {
    state: ApprovalUiStates.BLOCKED,
    title: "이 친구의 요청을 차단했습니다.",
    primaryAction: null
  });
  assert.deepEqual(createApprovalUiState({ status: "expired" }), {
    state: ApprovalUiStates.EXPIRED,
    title: "승인 시간이 지났습니다.",
    primaryAction: "request_again"
  });
  assert.deepEqual(createApprovalUiState({ status: "host_unavailable" }), {
    state: ApprovalUiStates.HOST_UNAVAILABLE,
    title: "방을 다시 열면 승인할 수 있습니다.",
    primaryAction: null
  });
  assert.deepEqual(createApprovalUiState({ status: "already_allowed" }), {
    state: ApprovalUiStates.ALREADY_ALLOWED,
    title: "이미 들어올 수 있는 친구입니다.",
    primaryAction: null
  });
});
