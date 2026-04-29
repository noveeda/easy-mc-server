import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { HostRuntimeStates, createHostRuntimePlan } from "../src/runtime/host-runtime.mjs";
import {
  NodeLocalRuntimeFailureReasons,
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
