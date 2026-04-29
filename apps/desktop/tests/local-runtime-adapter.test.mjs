import { test } from "node:test";
import assert from "node:assert/strict";
import { HostRuntimeActions, HostRuntimeStates, createHostRuntimePlan } from "../src/runtime/host-runtime.mjs";
import {
  LocalRuntimeAdapterFailureReasons,
  createFabricServerDownloadPlan,
  createLocalServerProcessIntent,
  createRoomMaterializationPlan,
  serializeServerProperties
} from "../src/runtime/local-runtime-adapter.mjs";

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
    maxPlayers: 10,
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
        source: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads/fabric-api.jar"
      },
      {
        id: "lithium",
        fileName: "lithium.jar",
        sha256: "lithium-sha",
        expectedSha256: "lithium-sha",
        source: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads/lithium.jar"
      }
    ]
  },
  runtime: {
    state: HostRuntimeStates.STOPPED
  }
});

function createPlan() {
  const result = createHostRuntimePlan(baseInput);
  assert.equal(result.ok, true);
  return result.plan;
}

test("room materialization plan creates local files without wiping the allowlist", () => {
  const result = createRoomMaterializationPlan(createPlan());

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.directories, [
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/mods",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/world",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/logs",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads",
    "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/metadata"
  ]);

  const filesByKind = new Map(result.plan.files.map((file) => [file.kind, file]));

  assert.equal(filesByKind.get("eula").contents, "eula=true\n");
  assert.match(filesByKind.get("server-properties").contents, /white-list=true/);
  assert.equal(filesByKind.get("minecraft-whitelist").path, "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/whitelist.json");
  assert.equal(filesByKind.get("minecraft-whitelist").overwrite, false);
  assert.match(filesByKind.get("server-bridge-config").contents, /"approvalSource": "server_observed_uuid"/);
  assert.equal(result.plan.safety.preserveAllowlist, true);
  assert.deepEqual(result.plan.modOperations.map((operation) => [operation.type, operation.modId, operation.verified]), [
    ["copy-verified-mod", "fabric-api", true],
    ["copy-verified-mod", "lithium", true]
  ]);
});

test("Fabric server download plan uses the known Fabric Meta source and checksum gate", () => {
  const result = createFabricServerDownloadPlan(createPlan());

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.source, {
    provider: "Fabric Meta",
    url: "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.16.10/server/jar"
  });
  assert.deepEqual(result.plan.install, {
    target: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar"
  });
  assert.deepEqual(result.plan.verification, {
    algorithm: "sha256",
    expectedSha256: "fabric-server-sha",
    requiredBeforeInstall: true
  });
  assert.equal(result.plan.offlineFallback, "reuse_verified_cache_only");
});

test("Fabric server download plan fails closed without a pinned checksum", () => {
  const plan = createPlan();
  const result = createFabricServerDownloadPlan({
    ...plan,
    fabric: {
      ...plan.fabric,
      installerSha256: null,
      serverJarSha256: null
    }
  });

  assert.deepEqual(result, {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.FABRIC_CHECKSUM_MISSING,
      message: "Room setup files need a verified checksum before use."
    }
  });
});

test("Fabric server download plan rejects non-approved artifact sources", () => {
  const result = createFabricServerDownloadPlan(createPlan(), {
    provider: "Unknown mirror",
    fabricServerJarUrl: "https://mirror.example.test/fabric-server.jar"
  });

  assert.deepEqual(result, {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.UNKNOWN_FABRIC_SOURCE,
      message: "Use the app-approved Fabric setup source."
    }
  });
});

test("local process intent describes start, stop, and restart without spawning Java", () => {
  const plan = createPlan();

  assert.deepEqual(createLocalServerProcessIntent(plan, HostRuntimeActions.START).intent, {
    type: "process.start",
    roomId: "room-a",
    cwd: "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a",
    command: "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
    args: [
      "-jar",
      "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar",
      "nogui"
    ],
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
      redactedCommand: [
        "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
        "-jar",
        "C:/Users/Alice/AppData/Roaming/RoomBuilder/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar",
        "nogui"
      ]
    }
  });

  assert.deepEqual(createLocalServerProcessIntent(plan, HostRuntimeActions.STOP).intent, {
    type: "process.stop",
    roomId: "room-a",
    gracefulCommand: "stop\n",
    timeoutMs: 30000,
    fallbackSignal: "terminate"
  });

  const restart = createLocalServerProcessIntent(plan, HostRuntimeActions.RESTART).intent;
  assert.equal(restart.type, "process.restart");
  assert.deepEqual(restart.sequence.map((step) => step.type), ["process.stop", "process.start"]);
});

test("local process intent rejects invalid plans and unsupported actions", () => {
  assert.deepEqual(createLocalServerProcessIntent({}, HostRuntimeActions.START), {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN,
      message: "Prepare the room before opening it."
    }
  });

  assert.deepEqual(createLocalServerProcessIntent(createPlan(), "pause"), {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.UNSUPPORTED_ACTION,
      message: "This room action is not supported yet."
    }
  });
});

test("local adapter rejects materialization paths outside app data root", () => {
  const traversalPlan = {
    ...createPlan(),
    mods: {
      ...createPlan().mods,
      entries: [
        {
          ...createPlan().mods.entries[0],
          source: "C:/Users/Alice/AppData/Roaming/RoomBuilder/cache/downloads/fabric-api.jar",
          target: "C:/Users/Alice/AppData/Roaming/Other/mods/fabric-api.jar"
        }
      ]
    }
  };

  assert.deepEqual(createRoomMaterializationPlan(traversalPlan), {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN,
      message: "Prepare the room before opening it."
    }
  });

  const outsideSourcePlan = {
    ...createPlan(),
    mods: {
      ...createPlan().mods,
      entries: [
        {
          ...createPlan().mods.entries[0],
          source: "C:/Temp/fabric-api.jar"
        }
      ]
    }
  };

  assert.deepEqual(createRoomMaterializationPlan(outsideSourcePlan), {
    ok: false,
    failure: {
      reason: LocalRuntimeAdapterFailureReasons.INVALID_RUNTIME_PLAN,
      message: "Prepare the room before opening it."
    }
  });
});

test("server properties serializer keeps Minecraft properties file format", () => {
  assert.equal(
    serializeServerProperties({
      "online-mode": "true",
      "white-list": "true",
      "max-players": "10"
    }),
    "online-mode=true\nwhite-list=true\nmax-players=10\n"
  );
});
