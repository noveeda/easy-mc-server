import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MrpackFailureReasons,
  buildMrpackManifest,
  createMrpackArchive,
  readMrpackTemplate,
  validateMrpackTemplate,
  writeMrpack
} from "../src/mrpack.mjs";

const templatePath = "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json";

test("fixed MVP-0 template fails closed while first-party artifact placeholders remain", async () => {
  const template = await readMrpackTemplate(templatePath);
  const result = validateMrpackTemplate(template);

  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((blocker) => blocker.reason === MrpackFailureReasons.FIRST_PARTY_ARTIFACT_PENDING));
  assert.ok(result.blockers.some((blocker) => blocker.path === "mods/local-room-client-connection-0.1.0-alpha.jar"));
});

test("complete Modrinth pack metadata can build a manifest and archive", () => {
  const manifest = buildMrpackManifest(completeTemplate());

  assert.equal(manifest.ok, true);
  assert.equal(manifest.manifest.dependencies.minecraft, "1.21.1");
  assert.equal(manifest.manifest.files.length, 1);

  const archive = createMrpackArchive(manifest.manifest);
  assert.equal(archive.subarray(0, 2).toString("utf8"), "PK");
  assert.ok(archive.includes(Buffer.from("modrinth.index.json")));
});

test("pack generation rejects unsafe metadata", async () => {
  const invalid = completeTemplate();
  invalid.files[0].downloads = ["http://mirror.example.test/mod.jar"];
  invalid.files[0].hashes.sha512 = "";

  const result = buildMrpackManifest(invalid);

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, MrpackFailureReasons.UNSAFE_DOWNLOAD_METADATA);
  assert.ok(result.failure.detail.blockers.length >= 2);
});

test("pack generation rejects unapproved HTTPS metadata even when hashes look valid", () => {
  const invalid = completeTemplate();
  invalid.files[0].downloads = ["https://cdn.example.test/fabric-api-0.116.11+1.21.1.jar"];

  const result = buildMrpackManifest(invalid);

  assert.equal(result.ok, false);
  assert.equal(result.failure.reason, MrpackFailureReasons.UNSAFE_DOWNLOAD_METADATA);
  assert.ok(result.failure.detail.blockers.some((blocker) => blocker.message.includes("approved source URL")));
});

test("writeMrpack writes a zip only for complete metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-mrpack-"));
  const outputPath = join(root, "room.mrpack");

  try {
    const result = await writeMrpack(completeTemplate(), outputPath);

    assert.equal(result.ok, true);
    assert.equal(result.fileCount, 1);
    assert.equal((await readFile(outputPath)).subarray(0, 2).toString("utf8"), "PK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function completeTemplate() {
  return {
    formatVersion: 1,
    game: "minecraft",
    versionId: "mvp0-performance-room-1.21.1-alpha.0",
    name: "MVP-0 Performance Room 1.21.1",
    summary: "Fixed Fabric pack for MVP-0 validation.",
    files: [
      {
        path: "mods/fabric-api-0.116.11+1.21.1.jar",
        hashes: {
          sha1: "65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84",
          sha512: "756b8c086f4c911d012f2eb70ca792aef0439503b31bc52026b82830870a94d472de30d61a6a0a9988c02b8462d9c47aa6baa6cd84da1eaf00edb77249b3c413"
        },
        env: {
          client: "required",
          server: "required"
        },
        downloads: ["https://cdn.modrinth.com/data/P7dR8mSH/versions/IpaMcBLh/fabric-api-0.116.11%2B1.21.1.jar"],
        fileSize: 2426356
      }
    ],
    dependencies: {
      "fabric-loader": "0.19.2",
      minecraft: "1.21.1"
    }
  };
}
