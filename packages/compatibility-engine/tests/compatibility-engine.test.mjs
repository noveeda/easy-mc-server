import { test } from "node:test";
import assert from "node:assert/strict";
import { RiskDisplayLabels, RiskLabels, classifySide, evaluateCompatibility, resolveDependencyPlan } from "../src/index.mjs";

function requiredMetadata(projectId) {
  return {
    source: {
      provider: "modrinth",
      projectId,
      versionId: `${projectId}-version`,
      projectUrl: `https://modrinth.com/mod/${projectId}`
    },
    sourceUrl: `https://modrinth.com/mod/${projectId}`,
    license: "MIT",
    permission: {
      redistribution: "original_url_only",
      use: "allowed_by_license"
    },
    files: [
      {
        filename: `${projectId}.jar`,
        url: `https://cdn.modrinth.com/data/${projectId}/versions/${projectId}-version/${projectId}.jar`,
        size: 12345,
        hashes: {
          sha1: `${projectId}-sha1`,
          sha512: `${projectId}-sha512`
        }
      }
    ]
  };
}

const fabricApi = {
  projectId: "fabric-api",
  title: "Fabric API",
  ...requiredMetadata("fabric-api"),
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
  ...requiredMetadata("lithium"),
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
  ...requiredMetadata("ferrite-core"),
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
  assert.equal(result.userLabel, RiskDisplayLabels[RiskLabels.HIGH_CONFIDENCE]);
  assert.equal(result.verdict.canRecommend, true);
  assert.deepEqual(result.missingDependencies, []);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.metadataIssues, []);
  assert.equal(result.sideClassifications["fabric-api"], "both_sides");
});

test("incomplete selected mod metadata becomes likely_fail and cannot recommend", () => {
  const result = evaluateCompatibility({
    selectedMods: [
      {
        ...fabricApi,
        projectId: "incomplete-mod",
        title: "Incomplete Mod",
        sourceUrl: "",
        side: undefined,
        files: []
      }
    ],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.LIKELY_FAIL);
  assert.equal(result.userLabel, "실패 가능");
  assert.equal(result.verdict.canRecommend, false);
  assert.equal(result.sideClassifications["incomplete-mod"], "unknown");
  assert.deepEqual(
    result.metadataIssues[0].missing.map((issue) => issue.field).sort(),
    ["files", "side", "sourceUrl"]
  );
  assert.match(result.advice, /missing metadata/);
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

test("dependency candidates with incomplete metadata are not automatic add suggestions", () => {
  const result = evaluateCompatibility({
    selectedMods: [lithium],
    catalog: [{ ...fabricApi, files: [] }],
    minecraftVersion: "1.21.1",
    loader: "fabric"
  });

  assert.equal(result.label, RiskLabels.LIKELY_FAIL);
  assert.deepEqual(result.automaticAddSuggestions, []);
  assert.equal(result.missingDependencies[0].projectId, "fabric-api");
  assert.match(result.missingDependencies[0].reason, /metadata is incomplete/);
  assert.deepEqual(result.resolvedModIds, ["lithium"]);
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
        ...requiredMetadata("old-fabric-api"),
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
