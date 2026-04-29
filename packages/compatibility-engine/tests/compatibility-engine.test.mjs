import { test } from "node:test";
import assert from "node:assert/strict";
import { RiskLabels, classifySide, evaluateCompatibility, resolveDependencyPlan } from "../src/index.mjs";

const fabricApi = {
  projectId: "fabric-api",
  title: "Fabric API",
  side: { client: "required", server: "required" },
  version: {
    gameVersions: ["1.21.1"],
    loaders: ["fabric"],
    dependencies: []
  }
};

const lithium = {
  projectId: "lithium",
  title: "Lithium",
  side: { client: "unsupported", server: "required" },
  version: {
    gameVersions: ["1.21.1"],
    loaders: ["fabric"],
    dependencies: [{ projectId: "fabric-api", type: "required" }]
  }
};

const ferriteCore = {
  projectId: "ferrite-core",
  title: "FerriteCore",
  side: { client: "required", server: "required" },
  version: {
    gameVersions: ["1.21.1"],
    loaders: ["fabric"],
    dependencies: []
  }
};

test("compatible Fabric mods are labeled high_confidence", () => {
  const result = evaluateCompatibility({
    selectedMods: [fabricApi, ferriteCore],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.HIGH_CONFIDENCE);
  assert.deepEqual(result.missingDependencies, []);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.sideClassifications["fabric-api"], "both_sides");
});

test("missing dependencies become likely_fail with automatic add suggestions", () => {
  const result = evaluateCompatibility({
    selectedMods: [lithium],
    catalog: [fabricApi],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.LIKELY_FAIL);
  assert.deepEqual(result.automaticAddSuggestions, [
    {
      projectId: "fabric-api",
      title: "Fabric API",
      requiredBy: "lithium",
      reason: "Lithium requires Fabric API."
    }
  ]);
  assert.deepEqual(result.resolvedModIds, ["lithium", "fabric-api"]);
});

test("unavailable required dependencies become likely_fail", () => {
  const result = evaluateCompatibility({
    selectedMods: [lithium],
    catalog: [],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.LIKELY_FAIL);
  assert.deepEqual(result.missingDependencies, [
    {
      projectId: "fabric-api",
      requiredBy: "lithium",
      reason: "Lithium has a required dependency that is not in the curated catalog."
    }
  ]);
  assert.match(result.advice, /required dependencies/);
});

test("unsupported Minecraft or loader versions become likely_fail with version advice", () => {
  const result = evaluateCompatibility({
    selectedMods: [
      {
        ...fabricApi,
        projectId: "old-fabric-api",
        title: "Old Fabric API",
        version: {
          gameVersions: ["1.20.1"],
          loaders: ["quilt"],
          dependencies: []
        }
      }
    ],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.LIKELY_FAIL);
  assert.deepEqual(result.unsupported, [
    {
      projectId: "old-fabric-api",
      title: "Old Fabric API",
      reason: "Not marked compatible with Minecraft 1.21.1 and fabric."
    }
  ]);
  assert.match(result.advice, /selected Minecraft version and Fabric loader/);
});

test("known conflicts become caution with plain-language advice", () => {
  const result = evaluateCompatibility({
    selectedMods: [fabricApi, ferriteCore],
    minecraftVersion: "1.21.1",
    loader: "fabric",
    knownConflicts: [
      {
        mods: ["fabric-api", "ferrite-core"],
        advice: "Keep Fabric API, but remove FerriteCore for this alpha pack."
      }
    ]
  });

  assert.equal(result.label, RiskLabels.CAUTION);
  assert.deepEqual(result.conflicts, [
    {
      mods: ["fabric-api", "ferrite-core"],
      advice: "Keep Fabric API, but remove FerriteCore for this alpha pack."
    }
  ]);
  assert.equal(result.advice, "Keep Fabric API, but remove FerriteCore for this alpha pack.");
});

test("dependency resolver and side classifier expose pack planning metadata", () => {
  const plan = resolveDependencyPlan({
    selectedMods: [lithium],
    catalog: [fabricApi],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.deepEqual(plan.resolvedMods.map((mod) => mod.projectId), ["lithium", "fabric-api"]);
  assert.equal(classifySide(lithium), "server_only");
});
