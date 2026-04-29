import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostRuntimeStates, createHostRuntimePlan } from "../src/runtime/host-runtime.mjs";
import {
  NodeFabricBootstrapFailureReasons,
  bootstrapFabricServer
} from "../src/runtime/node-fabric-bootstrap.mjs";

test("node Fabric bootstrap downloads verified bytes, installs launcher jar, and writes metadata", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("verified fabric server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));
  const calls = [];

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return okResponse(jarBytes);
      },
      now: new Date("2026-04-30T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.sha256, sha256(jarBytes));
    assert.deepEqual(calls.map((call) => call.url), [
      "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.16.10/server/jar"
    ]);
    assert.equal(await readFile(toNative(result.cachePath), "utf8"), jarBytes.toString("utf8"));
    assert.equal(await readFile(toNative(result.launcherJar), "utf8"), jarBytes.toString("utf8"));
    assert.deepEqual(JSON.parse(await readFile(toNative(result.metadataPath), "utf8")), {
      roomId: "room-a",
      provider: "Fabric Meta",
      sourceUrl: "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.16.10/server/jar",
      cachePath: `${fixture.root}/cache/downloads/fabric-server-1.21.1-0.16.10-${sha256(jarBytes)}.jar`,
      launcherJar: `${fixture.root}/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar`,
      sha256: sha256(jarBytes),
      installedAt: "2026-04-30T00:00:00.000Z"
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed before download when checksum is missing", async () => {
  const fixture = await createRuntimeFixture();
  let fetchCalls = 0;

  try {
    const plan = createRuntimePlan(fixture.root, null);
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => {
        fetchCalls += 1;
        return okResponse(Buffer.from("jar"));
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN);
    assert.equal(result.failure.detail.reason, "fabric_checksum_missing");
    assert.equal(fetchCalls, 0);
    assert.equal(await exists(`${fixture.root}/rooms/room-a/runtime/fabric-server-1.21.1-0.16.10.jar`), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed before download when checksum is not a SHA256 lock", async () => {
  const fixture = await createRuntimeFixture();
  let fetchCalls = 0;

  try {
    const plan = createRuntimePlan(fixture.root, "preview-fabric-server-sha256");
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => {
        fetchCalls += 1;
        return okResponse(Buffer.from("jar"));
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN);
    assert.equal(result.failure.detail.reason, "checksum_required");
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap rejects unknown sources without downloading", async () => {
  const fixture = await createRuntimeFixture();
  let fetchCalls = 0;

  try {
    const plan = createRuntimePlan(fixture.root, sha256(Buffer.from("jar")));
    const result = await bootstrapFabricServer(plan, {
      sources: {
        provider: "Unknown mirror",
        fabricServerJarUrl: "https://mirror.example.test/fabric-server.jar"
      },
      fetch: async () => {
        fetchCalls += 1;
        return okResponse(Buffer.from("jar"));
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN);
    assert.equal(result.failure.detail.reason, "unknown_fabric_source");
    assert.equal(fetchCalls, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed when download is not OK", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        arrayBuffer: async () => jarBytes
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.equal(result.failure.detail.status, 503);
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed when fetch throws", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => {
        throw new Error("network unavailable");
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.match(result.failure.detail.error, /network unavailable/);
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap times out stalled downloads", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      timeoutMs: 0,
      fetch: async () => new Promise(() => {})
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.match(result.failure.detail.error, /download timeout/);
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed when response bytes cannot be read", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => {
          throw new Error("body stream failed");
        }
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.match(result.failure.detail.error, /body stream failed/);
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap fails closed when download is larger than the safety cap", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      maxBytes: 4,
      fetch: async () => okResponse(jarBytes, {
        headers: new Map([["content-length", String(jarBytes.byteLength)]])
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.match(result.failure.detail.error, /download exceeds maximum size/);
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap rejects redirected final response URLs", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("server jar");
  const plan = createRuntimePlan(fixture.root, sha256(jarBytes));

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => ({
        ...okResponse(jarBytes),
        url: "https://mirror.example.test/fabric-server.jar"
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED);
    assert.equal(result.failure.detail.reason, "unapproved_redirect_target");
    assert.equal(await exists(plan.fabric.launcherJar), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("node Fabric bootstrap refuses checksum mismatch and writes no launcher jar", async () => {
  const fixture = await createRuntimeFixture();
  const jarBytes = Buffer.from("tampered server jar");
  const plan = createRuntimePlan(fixture.root, sha256(Buffer.from("expected server jar")));

  try {
    const result = await bootstrapFabricServer(plan, {
      fetch: async () => okResponse(jarBytes)
    });

    assert.equal(result.ok, false);
    assert.equal(result.failure.reason, NodeFabricBootstrapFailureReasons.CHECKSUM_MISMATCH);
    assert.equal(result.failure.detail.actualSha256, sha256(jarBytes));
    assert.equal(await exists(plan.fabric.launcherJar), false);
    assert.equal(await exists(`${fixture.root}/cache/downloads/fabric-server-1.21.1-0.16.10-${plan.fabric.serverJarSha256}.jar`), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createRuntimeFixture() {
  const root = (await mkdtemp(join(tmpdir(), "easy-mc-fabric-"))).replaceAll("\\", "/");
  return { root };
}

function createRuntimePlan(root, serverJarSha256) {
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
          serverJarSha256
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
      mods: []
    },
    runtime: { state: HostRuntimeStates.STOPPED }
  });

  assert.equal(runtime.ok, true);
  return runtime.plan;
}

function okResponse(bytes, overrides = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes,
    ...overrides
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function exists(path) {
  try {
    await access(toNative(path));
    return true;
  } catch {
    return false;
  }
}

function toNative(path) {
  return String(path).replaceAll("/", "\\");
}
