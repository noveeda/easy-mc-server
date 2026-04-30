import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { HostRuntimeStates, createHostRuntimePlan } from "../src/runtime/host-runtime.mjs";
import { NodeLocalRuntimeFailureReasons } from "../src/runtime/node-local-runtime.mjs";
import {
  DesktopRuntimeBridgeFailureReasons,
  createDesktopRuntimeBridge
} from "../src/runtime/desktop-runtime-bridge.mjs";

test("desktop runtime bridge prepare materializes files and returns ready DTO", async () => {
  const fixture = await createRuntimeFixture();
  const materializedPlans = [];

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      materializeRoom: async (runtimePlan) => {
        materializedPlans.push(runtimePlan);
        return {
          ok: true,
          roomId: runtimePlan.room.id,
          writtenFiles: [runtimePlan.eula.path],
          preservedFiles: [],
          copiedMods: [],
          pendingMods: []
        };
      }
    });

    const result = await bridge.prepareRoom();

    assert.equal(result.state, HostRuntimeStates.READY);
    assert.equal(result.summary, "Room files are ready.");
    assert.equal(result.runtimePlan.room.id, "room-a");
    assert.equal(result.runtimePlan.java.detected, true);
    assert.equal(result.runtimePlan.java.majorVersion, 21);
    assert.equal(result.runtimePlan.java.path, undefined);
    assert.equal(materializedPlans.length, 1);
    assert.equal(materializedPlans[0].command[0], fixture.javaPath);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge blocks open when Java is missing", async () => {
  const fixture = await createRuntimeFixture();
  let startCalls = 0;

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: false,
        failure: {
          reason: "java_missing",
          message: "Install Java 21 or newer before opening this room.",
          detail: {
            searchedCandidates: ["C:/secret/token=abc/java.exe"]
          }
        }
      }),
      materializeRoom: async () => {
        throw new Error("materialize should not run");
      },
      createLifecycleManager: () => ({
        start: async () => {
          startCalls += 1;
          return { ok: true, state: HostRuntimeStates.STARTING };
        },
        status: () => ({ state: HostRuntimeStates.STOPPED, hasProcess: false, events: [] })
      })
    });

    const result = await bridge.openRoom();

    assert.equal(result.state, "blocked");
    assert.equal(result.failure.reason, DesktopRuntimeBridgeFailureReasons.JAVA_DETECTION_FAILED);
    assert.equal(result.failure.message, "Install Java 21 or newer before opening this room.");
    assert.equal(result.failure.detail.detail.searchedCandidates[0], "C:/secret/token=[redacted]");
    assert.equal(startCalls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge blocks open when Fabric jar is missing", async () => {
  const fixture = await createRuntimeFixture();

  try {
    await mkdir(dirname(fixture.javaPath), { recursive: true });
    await writeFile(fixture.javaPath, "fake java", "utf8");

    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      mode: "real"
    });

    const result = await bridge.openRoom({ downloadFabric: false });

    assert.equal(result.state, "blocked");
    assert.equal(result.failure.reason, DesktopRuntimeBridgeFailureReasons.LIFECYCLE_FAILED);
    assert.equal(result.failure.detail.reason, NodeLocalRuntimeFailureReasons.RUNTIME_ARTIFACT_MISSING);
    assert.ok(result.failure.detail.detail.missing.includes("fabric_server_jar"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge blocks required Fabric download before materialization", async () => {
  const fixture = await createRuntimeFixture();
  let materializeCalls = 0;
  let bootstrapCalls = 0;

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      bootstrapFabricServer: async () => {
        bootstrapCalls += 1;
        return { ok: true };
      },
      materializeRoom: async () => {
        materializeCalls += 1;
        return { ok: true, writtenFiles: [], preservedFiles: [], copiedMods: [], pendingMods: [] };
      }
    });

    const result = await bridge.openRoom({ requireFabricDownload: true });

    assert.equal(result.state, "blocked");
    assert.equal(result.failure.reason, DesktopRuntimeBridgeFailureReasons.FABRIC_DOWNLOAD_DISABLED);
    assert.equal(bootstrapCalls, 0);
    assert.equal(materializeCalls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge prevents duplicate opens with injected lifecycle manager", async () => {
  const fixture = await createRuntimeFixture();
  let startCalls = 0;
  const fakeLifecycle = {
    async start() {
      startCalls += 1;
      return { ok: true, state: HostRuntimeStates.STARTING };
    },
    async stop() {
      return { ok: true, state: HostRuntimeStates.STOPPED };
    },
    status() {
      return {
        state: startCalls > 0 ? HostRuntimeStates.STARTING : HostRuntimeStates.STOPPED,
        hasProcess: startCalls > 0,
        events: []
      };
    }
  };

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      materializeRoom: async () => ({ ok: true, writtenFiles: [], preservedFiles: [], copiedMods: [], pendingMods: [] }),
      createLifecycleManager: () => fakeLifecycle
    });

    const first = await bridge.openRoom();
    const second = await bridge.openRoom();

    assert.equal(first.state, HostRuntimeStates.STARTING);
    assert.equal(second.state, "blocked");
    assert.equal(second.failure.reason, DesktopRuntimeBridgeFailureReasons.DUPLICATE_OPEN);
    assert.equal(startCalls, 1);

    const status = bridge.status();
    assert.equal(status.state, HostRuntimeStates.STARTING);
    assert.equal(status.failure, undefined);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge close stops the active lifecycle manager", async () => {
  const fixture = await createRuntimeFixture();
  let running = false;
  let stopCalls = 0;

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      materializeRoom: async () => ({ ok: true, writtenFiles: [], preservedFiles: [], copiedMods: [], pendingMods: [] }),
      createLifecycleManager: () => ({
        async start() {
          running = true;
          return { ok: true, state: HostRuntimeStates.RUNNING };
        },
        async stop() {
          stopCalls += 1;
          running = false;
          return { ok: true, state: HostRuntimeStates.STOPPED };
        },
        status() {
          return {
            state: running ? HostRuntimeStates.RUNNING : HostRuntimeStates.STOPPED,
            hasProcess: running,
            events: []
          };
        }
      })
    });

    await bridge.openRoom();
    const closed = await bridge.closeRoom();

    assert.equal(closed.state, HostRuntimeStates.STOPPED);
    assert.equal(stopCalls, 1);
    assert.equal(bridge.status().state, HostRuntimeStates.STOPPED);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge restart uses the active lifecycle manager", async () => {
  const fixture = await createRuntimeFixture();
  let restartCalls = 0;

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava(fixture.javaPath)
      }),
      materializeRoom: async () => ({ ok: true, writtenFiles: [], preservedFiles: [], copiedMods: [], pendingMods: [] }),
      createLifecycleManager: () => ({
        async start() {
          return { ok: true, state: HostRuntimeStates.RUNNING };
        },
        async stop() {
          return { ok: true, state: HostRuntimeStates.STOPPED };
        },
        async restart() {
          restartCalls += 1;
          return { ok: true, state: HostRuntimeStates.STARTING };
        },
        status() {
          return {
            state: HostRuntimeStates.RUNNING,
            hasProcess: true,
            events: []
          };
        }
      })
    });

    await bridge.openRoom();
    const restarted = await bridge.restartRoom();

    assert.equal(restarted.state, HostRuntimeStates.STARTING);
    assert.equal(restartCalls, 1);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("desktop runtime bridge redacts lifecycle events and status DTOs", async () => {
  const fixture = await createRuntimeFixture();
  const lifecycleEvents = [
    {
      type: "runtime.log",
      roomId: "room-a",
      line: "token=abc invite=join-1 user=host@example.test secret=value",
      secret: "do-not-return"
    }
  ];

  try {
    const bridge = createDesktopRuntimeBridge(fixture.plan, {
      detectJava: async () => ({
        ok: true,
        java: createDetectedJava("C:/Java/jdk-21/bin/java.exe")
      }),
      materializeRoom: async () => ({ ok: true, writtenFiles: [], preservedFiles: [], copiedMods: [], pendingMods: [] }),
      createLifecycleManager: (_runtimePlan, lifecycleOptions) => ({
        async start() {
          lifecycleOptions.onEvent?.(lifecycleEvents[0]);
          return { ok: true, state: HostRuntimeStates.RUNNING };
        },
        async stop() {
          return { ok: true, state: HostRuntimeStates.STOPPED };
        },
        status() {
          return {
            state: HostRuntimeStates.RUNNING,
            hasProcess: true,
            events: lifecycleEvents
          };
        }
      })
    });

    await bridge.openRoom();
    const status = bridge.status();

    assert.equal(status.state, HostRuntimeStates.RUNNING);
    assert.equal(status.runtimePlan.java.path, undefined);
    assert.equal(status.events[0].line, "token=[redacted] invite=[redacted] user=[redacted] secret=[redacted]");
    assert.equal(status.events[0].secret, undefined);
    assert.equal(JSON.stringify(status).includes("host@example.test"), false);
    assert.equal(JSON.stringify(status).includes("join-1"), false);
    assert.equal(JSON.stringify(status).includes("do-not-return"), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createRuntimeFixture() {
  const root = (await mkdtemp(join(tmpdir(), "easy-mc-bridge-"))).replaceAll("\\", "/");
  const roomRoot = `${root}/rooms/room-a`;
  const modSource = `${root}/cache/downloads/fabric-api.jar`;
  const javaPath = `${root}/runtime/java/bin/java.exe`;

  await mkdir(dirname(modSource), { recursive: true });
  await writeFile(modSource, "fake mod jar", "utf8");

  const runtime = createHostRuntimePlan({
    room: {
      id: "room-a",
      hostId: "host-a",
      name: "Cozy Room",
      appDataRoot: root
    },
    minecraft: {
      version: "1.21.1",
      supportedVersions: [{ version: "1.21.1", channel: "stable", javaMajor: 21 }]
    },
    java: {
      path: "C:/Placeholder/Java/bin/java.exe",
      majorVersion: 21
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
    cache: { reuseVerifiedDownloads: true },
    eula: { accepted: true },
    serverProperties: { maxPlayers: 10, motd: "Cozy Room", port: 25565 },
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
          source: modSource
        }
      ]
    },
    runtime: { state: HostRuntimeStates.STOPPED }
  });

  assert.equal(runtime.ok, true);

  return {
    root,
    roomRoot,
    modSource,
    javaPath,
    plan: runtime.plan
  };
}

function createDetectedJava(path) {
  return {
    path,
    majorVersion: 21,
    version: "21.0.6",
    vendor: "Test JDK",
    source: "configuredPath"
  };
}
