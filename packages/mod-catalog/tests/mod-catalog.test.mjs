import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogEntryHasRequiredMetadata, createCuratedPack, normalizeModrinthVersion } from "../src/index.mjs";

const fabricApiProject = {
  id: "P7dR8mSH",
  slug: "fabric-api",
  title: "Fabric API",
  description: "Core hooks for Fabric mods.",
  source_url: "https://github.com/FabricMC/fabric",
  license: { id: "Apache-2.0" },
  client_side: "required",
  server_side: "required"
};

const fabricApiVersion = {
  id: "IpaMcBLh",
  project_id: "P7dR8mSH",
  name: "0.116.11+1.21.1",
  version_number: "0.116.11+1.21.1",
  game_versions: ["1.21.1"],
  loaders: ["fabric"],
  dependencies: [],
  files: [
    {
      filename: "fabric-api-0.116.11+1.21.1.jar",
      url: "https://cdn.modrinth.com/data/P7dR8mSH/versions/IpaMcBLh/fabric-api-0.116.11%2B1.21.1.jar",
      size: 2426356,
      primary: true,
      hashes: {
        sha1: "65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84",
        sha512: "756b8c086f4c911d012f2eb70ca792aef0439503b31bc52026b82830870a94d472de30d61a6a0a9988c02b8462d9c47aa6baa6cd84da1eaf00edb77249b3c413"
      }
    }
  ]
};

test("normalizes Modrinth-like project and version metadata", () => {
  const entry = normalizeModrinthVersion({
    project: fabricApiProject,
    version: fabricApiVersion
  });

  assert.equal(entry.projectId, "P7dR8mSH");
  assert.equal(entry.slug, "fabric-api");
  assert.equal(entry.license, "Apache-2.0");
  assert.deepEqual(entry.side, { client: "required", server: "required" });
  assert.deepEqual(entry.version.gameVersions, ["1.21.1"]);
  assert.deepEqual(entry.version.loaders, ["fabric"]);
  assert.equal(entry.files[0].url, fabricApiVersion.files[0].url);
  assert.deepEqual(entry.files[0].hashes, fabricApiVersion.files[0].hashes);
  assert.equal(catalogEntryHasRequiredMetadata(entry), true);
});

test("detects incomplete metadata before recommendation", () => {
  const entry = normalizeModrinthVersion({
    project: { ...fabricApiProject, source_url: "", license: null },
    version: { ...fabricApiVersion, files: [{ ...fabricApiVersion.files[0], hashes: { sha1: "abc" } }] },
    permission: null
  });

  assert.equal(catalogEntryHasRequiredMetadata(entry), false);
});

test("curated pack output preserves original URLs and hashes", () => {
  const entry = normalizeModrinthVersion({
    project: fabricApiProject,
    version: fabricApiVersion
  });

  const pack = createCuratedPack({
    name: "Curated Alpha Pack",
    versionId: "curated-alpha-1.21.1",
    summary: "Recommended Fabric alpha pack.",
    minecraftVersion: "1.21.1",
    fabricLoaderVersion: "0.19.2",
    mods: [entry]
  });

  assert.equal(pack.files[0].downloads[0], fabricApiVersion.files[0].url);
  assert.deepEqual(pack.files[0].hashes, fabricApiVersion.files[0].hashes);
  assert.equal(pack.files[0].metadata.sourceUrl, fabricApiProject.source_url);
  assert.deepEqual(pack.dependencies, {
    minecraft: "1.21.1",
    "fabric-loader": "0.19.2"
  });
});
