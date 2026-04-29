import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { HostRuntimeStates, createHostRuntimePlan } from "../src/runtime/host-runtime.mjs";
import {
  NodeLocalRuntimeFailureReasons,
  createLocalServerLifecycleManager,
  launchLocalServer,
  materializeRoom,
  readRuntimeManifest
} from "../src/runtime/node-local-runtime.mjs";

test("node local runtime materializes room files and preserves allowlist", async () => {
  const fixture = await createRuntimeFixture();

  try {
    await mkdir(fixture.roomRoot, { recursive: true });
    await writeFile(join(fixture.roomRoot, "whitelist.json"), "[\"existing\"]\n", "utf8");

    const result = await materializeRoom(fixture.plan);

    assert.equal(result.ok, true);
    assert.ok(result.writtenFiles.includes(fixture.plan.eula.path));
    assert.ok(result.writtenFiles.includes(fixture.plan.serverProperties.path));
    assert.ok(result.preservedFiles.includes(`${fixture.plan.files.root}/whitelist.json`));
    assert.deepEqual(result.copiedMods.map((mod) => mod.modId), ["fabric-api"]);

    assert.equal(await readFile(join(fixture.roomRoot, "eula.txt"), "utf8"), "eula=true\n");
    assert.match(await readFile(join(fixture.roomRoot, "server.properties"), "utf8"), /white-list=true/);
    assert.equal(await readFile(join(fixture.roomRoot, "whitelist.json"), "utf8"), "[\"existing\"]\n");
    assert.deepEqual(await readRuntimeManifest(fixture.plan), {
      roomId: "room-a",
      minecraftVersion: "1.21.1",
      fabricLoaderVersion: "0.16.10",
      launcherJar: `${fixture.roomRoot}/runtime/fabric-server-1.21.1-0.16.10.jar`,
      packId: "mvp0-performance",
      modCount: 1
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime fails closed when a verified mod source is missing", async () => {
  const fixture = await createRuntimeFixture({ createModSource: false });

  try {
    assert.deepEqual(await materializeRoom(fixture.plan), {
      ok: false,
      failure: {
        reason: NodeLocalRuntimeFailureReasons.MOD_SOURCE_MISSING,
        message: "고정팩 파일을 찾을 수 없습니다.",
        detail: {
          modId: "fabric-api",
          source: fixture.modSource
        }
      }
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime rejects materialization outside the app-data root", async () => {
  const fixture = await createRuntimeFixture();
  const outsideRoot = `${fixture.root}-outside`;

  try {
    const escapedPlan = cloneJson(fixture.plan);
    escapedPlan.files.root = outsideRoot;

    const result = await materializeRoom(escapedPlan);

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeLocalRuntimeFailureReasons.INVALID_RUNTIME_PLAN);
    assert.equal(await exists(outsideRoot), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("node local runtime launch dry-run returns the process intent without spawning", async () => {
  const fixture = await createRuntimeFixture();

  try {
    await materializeRoom(fixture.plan);
    const result = await launchLocalServer(fixture.plan);

    assert.equal(result.ok, true);
    assert.equal(result.launched, false);
    assert.equal(result.intent.type, "process.start");
    assert.equal(result.intent.cwd, fixture.roomRoot);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime real launch rejects forged non-Java commands", async () => {
  const fixture = await createRuntimeFixture();

  try {
    await materializeRoom(fixture.plan);
    const forgedPlan = cloneJson(fixture.plan);
    forgedPlan.java.path = "C:/Windows/System32/cmd.exe";
    forgedPlan.command = ["C:/Windows/System32/cmd.exe", "/c", "calc.exe"];

    const result = await launchLocalServer(forgedPlan, { mode: "real" });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeLocalRuntimeFailureReasons.UNTRUSTED_LAUNCH_COMMAND);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime real launch reports missing server artifacts", async () => {
  const fixture = await createRuntimeFixture();

  try {
    await materializeRoom(fixture.plan);
    const result = await launchLocalServer(fixture.plan, { mode: "real" });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeLocalRuntimeFailureReasons.RUNTIME_ARTIFACT_MISSING);
    assert.ok(result.failure.detail.missing.includes("fabric_server_jar"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager marks running after Done log", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process
    });

    const result = await manager.start();

    assert.equal(result.ok, true);
    assert.equal(manager.status().state, HostRuntimeStates.STARTING);

    process.stdout.emit("data", "[Server thread/INFO]: Done (1.234s)! For help, type \"help\"\n");

    assert.equal(manager.status().state, HostRuntimeStates.RUNNING);
    assert.ok(manager.status().events.some((event) => event.type === "runtime.ready"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager waits for complete log lines before readiness", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process
    });

    await manager.start();
    process.stdout.emit("data", "Do");

    assert.equal(manager.status().state, HostRuntimeStates.STARTING);

    process.stdout.emit("data", "ne\n");

    assert.equal(manager.status().state, HostRuntimeStates.RUNNING);
    assert.ok(manager.status().events.some((event) => event.type === "runtime.ready"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager rejects duplicate starts", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();
  const spawned = [];

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => {
        spawned.push(process);
        return process;
      }
    });

    assert.equal((await manager.start()).ok, true);
    const duplicate = await manager.start();

    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.failure.reason, NodeLocalRuntimeFailureReasons.PROCESS_ALREADY_RUNNING);
    assert.equal(spawned.length, 1);
    assert.equal(manager.status().hasProcess, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager emits failure when launch validation fails", async () => {
  const fixture = await createRuntimeFixture();
  let spawnCalls = 0;

  try {
    await materializeRoom(fixture.plan);
    const forgedPlan = cloneJson(fixture.plan);
    forgedPlan.java.path = "C:/Windows/System32/cmd.exe";
    forgedPlan.command = ["C:/Windows/System32/cmd.exe", "/c", "calc.exe"];

    const manager = createLocalServerLifecycleManager(forgedPlan, {
      mode: "real",
      spawn: () => {
        spawnCalls += 1;
        return createFakeProcess();
      }
    });

    const result = await manager.start();
    const status = manager.status();

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeLocalRuntimeFailureReasons.UNTRUSTED_LAUNCH_COMMAND);
    assert.equal(status.state, HostRuntimeStates.FAILED);
    assert.equal(spawnCalls, 0);
    assert.equal(status.events.at(-1).type, "runtime.failure");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager stops with stdin command and waits for exit", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess({
    onStdinWrite() {
      process.exit(0, null);
    }
  });

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process
    });

    await manager.start();
    process.stdout.emit("data", "Done\n");

    const result = await manager.stop();

    assert.equal(result.ok, true);
    assert.equal(result.state, HostRuntimeStates.STOPPED);
    assert.deepEqual(process.stdinWrites, ["stop\n"]);
    assert.equal(process.killed, false);
    assert.deepEqual(result.exit, { code: 0, signal: null });
    assert.equal(manager.status().hasProcess, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager falls back to kill after stop timeout", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess({
    onKill() {
      process.exit(null, "SIGTERM");
    }
  });

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process,
      stopTimeoutMs: 0
    });

    await manager.start();
    const result = await manager.stop();

    assert.equal(result.ok, true);
    assert.equal(result.killed, true);
    assert.deepEqual(process.stdinWrites, ["stop\n"]);
    assert.equal(process.killed, true);
    assert.deepEqual(result.exit, { code: null, signal: "SIGTERM" });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager fails stop when hard timeout elapses", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process,
      stopTimeoutMs: 0,
      hardStopTimeoutMs: 0
    });

    await manager.start();
    const result = await manager.stop();

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeLocalRuntimeFailureReasons.PROCESS_STOP_TIMEOUT);
    assert.equal(result.failure.detail.killed, true);
    assert.equal(process.killed, true);
    assert.equal(manager.status().state, HostRuntimeStates.FAILED);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager restarts by stopping then starting a new process", async () => {
  const fixture = await createRuntimeFixture();
  const firstProcess = createFakeProcess({
    onStdinWrite() {
      firstProcess.exit(0, null);
    }
  });
  const secondProcess = createFakeProcess();
  const spawned = [];

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => {
        const process = spawned.length === 0 ? firstProcess : secondProcess;
        spawned.push(process);
        return process;
      }
    });

    await manager.start();
    const result = await manager.restart();

    assert.equal(result.ok, true);
    assert.equal(spawned.length, 2);
    assert.deepEqual(firstProcess.stdinWrites, ["stop\n"]);
    assert.equal(manager.status().state, HostRuntimeStates.STARTING);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager records child process errors", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process
    });

    await manager.start();
    process.emit("error", new Error("spawn EACCES"));

    const status = manager.status();
    const failure = status.events.find((event) => event.type === "runtime.failure");

    assert.equal(status.state, HostRuntimeStates.FAILED);
    assert.equal(status.hasProcess, false);
    assert.equal(failure.failure.reason, NodeLocalRuntimeFailureReasons.PROCESS_ERROR);
    assert.match(failure.failure.detail.error, /spawn EACCES/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node local runtime lifecycle manager marks crash pattern and redacts log events", async () => {
  const fixture = await createRuntimeFixture();
  const process = createFakeProcess();

  try {
    await materializeRoom(fixture.plan);
    await createLaunchArtifacts(fixture.plan);

    const manager = createLocalServerLifecycleManager(fixture.plan, {
      mode: "real",
      spawn: () => process
    });

    await manager.start();
    process.stderr.emit(
      "data",
      "Exception failed token=secret invite=abc user=host@example.test uuid=123e4567-e89b-12d3-a456-426614174000\n"
    );

    const status = manager.status();
    const logEvent = status.events.find((event) => event.type === "runtime.log");
    const crashEvent = status.events.find((event) => event.type === "runtime.crashed");

    assert.equal(status.state, HostRuntimeStates.CRASHED);
    assert.equal(logEvent.line, "Exception failed token=[redacted] invite=[redacted] user=[redacted] uuid=[redacted]");
    assert.equal(crashEvent.line, "Exception failed token=[redacted] invite=[redacted] user=[redacted] uuid=[redacted]");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createRuntimeFixture(options = {}) {
  const root = (await mkdtemp(join(tmpdir(), "easy-mc-room-"))).replaceAll("\\", "/");
  const modSource = `${root}/cache/downloads/fabric-api.jar`;
  const roomRoot = `${root}/rooms/room-a`;

  if (options.createModSource !== false) {
    await mkdir(dirname(modSource), { recursive: true });
    await writeFile(modSource, "fake mod jar", "utf8");
  }

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
      path: `${root}/runtime/java/bin/java.exe`,
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
    plan: runtime.plan
  };
}

async function createLaunchArtifacts(plan) {
  await mkdir(dirname(plan.java.path), { recursive: true });
  await mkdir(dirname(plan.fabric.launcherJar), { recursive: true });
  await writeFile(plan.java.path, "fake java", "utf8");
  await writeFile(plan.fabric.launcherJar, "fake fabric server jar", "utf8");
}

function createFakeProcess(options = {}) {
  const process = new EventEmitter();
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.stdinWrites = [];
  process.exitCode = undefined;
  process.killed = false;
  process.stdin = {
    write(command) {
      process.stdinWrites.push(command);
      options.onStdinWrite?.(command);
      return true;
    }
  };
  process.kill = () => {
    process.killed = true;
    options.onKill?.();
    return true;
  };
  process.exit = (code, signal) => {
    process.exitCode = code;
    process.emit("exit", code, signal);
  };
  return process;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
