import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const expectedPaths = [
  "apps/desktop",
  "apps/invite-web",
  "packages/protocol",
  "services/control-plane",
  "services/relay",
  "mods/client-fabric",
  "mods/server-bridge-fabric"
];

test("workspace boundaries exist", () => {
  for (const path of expectedPaths) {
    assert.equal(existsSync(path), true, `${path} should exist`);
  }
});

test("root package workspaces include every ownership boundary", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.deepEqual(packageJson.workspaces, ["apps/*", "packages/*", "services/*", "mods/*"]);
});

test("contract package manifests exist", () => {
  assert.equal(existsSync("packages/protocol/package.json"), true);
  assert.equal(existsSync("services/control-plane/package.json"), true);
});
