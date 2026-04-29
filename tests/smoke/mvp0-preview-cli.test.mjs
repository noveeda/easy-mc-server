import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeFabricBootstrapFailureReasons } from "../../apps/desktop/src/runtime/node-fabric-bootstrap.mjs";
import { runMvp0Preview } from "../../scripts/mvp0-local-preview.mjs";

test("MVP-0 preview CLI reports dry-run status and pack blocker", async () => {
  const result = await withMutedConsole(() => runMvp0Preview());

  assert.equal(result.packStatus.state, "blocked");
  assert.equal(result.bootstrapStatus.state, "skipped");
  assert.equal(result.launchStatus.state, "dry-run");
  assert.equal(result.relayStatus.state, "passed");
});

test("MVP-0 preview CLI reports real-launch artifact blockers", async () => {
  const result = await withMutedConsole(() => runMvp0Preview({
    realLaunch: true,
    detectJava: async () => ({
      ok: false,
      failure: {
        reason: "java_missing",
        message: "Install Java 21 or newer before opening this room.",
        detail: {}
      }
    })
  }));

  assert.equal(result.packStatus.state, "blocked");
  assert.equal(result.bootstrapStatus.state, "blocked");
  assert.equal(result.launchStatus.state, "blocked");
  assert.equal(result.relayStatus.state, "passed");
});

test("MVP-0 preview CLI can use detected Java for launch intent checks", async () => {
  const result = await withMutedConsole(() => runMvp0Preview({
    realLaunch: true,
    detectJava: async () => ({
      ok: true,
      java: {
        path: "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
        majorVersion: 21,
        version: "21.0.6",
        vendor: "Eclipse Adoptium",
        source: "JAVA_HOME"
      }
    })
  }));

  assert.equal(result.bootstrapStatus.state, "java-ready");
  assert.equal(result.launchStatus.state, "blocked");
  assert.deepEqual(result.launchStatus.missing, ["fabric_server_jar", "java_runtime"]);
});

test("MVP-0 preview CLI blocks Fabric download before network when server jar checksum is not pinned", async () => {
  let fetchCalls = 0;
  const result = await withMutedConsole(() => runMvp0Preview({
    realLaunch: true,
    downloadFabric: true,
    detectJava: async () => ({
      ok: true,
      java: {
        path: "C:/Program Files/Eclipse Adoptium/jdk-21/bin/java.exe",
        majorVersion: 21,
        version: "21.0.6",
        vendor: "Eclipse Adoptium",
        source: "JAVA_HOME"
      }
    }),
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    }
  }));

  assert.equal(result.bootstrapStatus.state, "blocked");
  assert.equal(result.bootstrapStatus.fabricFailure.reason, NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN);
  assert.equal(result.bootstrapStatus.fabricFailure.detail.reason, "checksum_required");
  assert.equal(result.launchStatus.state, "blocked");
  assert.equal(fetchCalls, 0);
});

async function withMutedConsole(run) {
  const originalLog = console.log;
  try {
    console.log = () => {};
    return await run();
  } finally {
    console.log = originalLog;
  }
}
