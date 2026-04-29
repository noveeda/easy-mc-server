import { test } from "node:test";
import assert from "node:assert/strict";
import { runMvp0Preview } from "../../scripts/mvp0-local-preview.mjs";

test("MVP-0 preview CLI reports dry-run status and pack blocker", async () => {
  const result = await withMutedConsole(() => runMvp0Preview());

  assert.equal(result.packStatus.state, "blocked");
  assert.equal(result.launchStatus.state, "dry-run");
  assert.equal(result.relayStatus.state, "passed");
});

test("MVP-0 preview CLI reports real-launch artifact blockers", async () => {
  const result = await withMutedConsole(() => runMvp0Preview({ realLaunch: true }));

  assert.equal(result.packStatus.state, "blocked");
  assert.equal(result.launchStatus.state, "blocked");
  assert.equal(result.relayStatus.state, "passed");
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
