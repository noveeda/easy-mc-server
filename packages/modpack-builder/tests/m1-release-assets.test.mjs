import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareM1ReleaseAssets } from "../../../scripts/prepare-m1-release-assets.mjs";

test("M1 release asset preparation copies the verified client jar without marking it published", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-release-"));
  const artifactPath = join(root, "client.jar");
  const manifestPath = join(root, "manifest.json");
  const outputDirectory = join(root, "release");
  const bytes = firstPartyClientJarFixture();
  const hashes = {
    sha1: createHash("sha1").update(bytes).digest("hex"),
    sha512: createHash("sha512").update(bytes).digest("hex")
  };

  try {
    await writeFile(artifactPath, bytes);
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          fileSize: bytes.byteLength,
          hashes,
          publishUrl: null,
          publishState: "pending_signed_https_release"
        }
      ]
    })}\n`);

    const result = await prepareM1ReleaseAssets({
      artifactManifestPath: manifestPath,
      outputDirectory,
      repository: "noveeda/easy-mc-server",
      tag: "m1-first-party-0.1.0-alpha"
    });
    const releaseManifest = JSON.parse(await readFile(result.releaseManifestPath, "utf8"));

    assert.equal(result.ok, true);
    assert.equal((await stat(join(outputDirectory, "local-room-client-connection-0.1.0-alpha.jar"))).size, bytes.byteLength);
    assert.equal(releaseManifest.assets[0].publishUrl, "https://github.com/noveeda/easy-mc-server/releases/download/m1-first-party-0.1.0-alpha/local-room-client-connection-0.1.0-alpha.jar");
    assert.equal(releaseManifest.status, "release_assets_prepared_with_expected_public_urls");
    assert.match(releaseManifest.note, /not published/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 release asset preparation rejects manifest hash drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-release-"));
  const artifactPath = join(root, "client.jar");
  const manifestPath = join(root, "manifest.json");
  const bytes = firstPartyClientJarFixture();

  try {
    await writeFile(artifactPath, bytes);
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          fileSize: bytes.byteLength,
          hashes: {
            sha1: "0".repeat(40),
            sha512: "0".repeat(128)
          },
          publishUrl: null,
          publishState: "pending_signed_https_release"
        }
      ]
    })}\n`);

    await assert.rejects(
      () => prepareM1ReleaseAssets({
        artifactManifestPath: manifestPath,
        outputDirectory: join(root, "release")
      }),
      /does not match the local artifact manifest hashes/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 release asset preparation rejects shell-shaped release tags", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-release-"));
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(manifestPath, `${JSON.stringify({ artifacts: [] })}\n`);

    await assert.rejects(
      () => prepareM1ReleaseAssets({
        artifactManifestPath: manifestPath,
        outputDirectory: join(root, "release"),
        tag: "release\"; echo injected"
      }),
      /Release tag must/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function firstPartyClientJarFixture() {
  return createZipFixture({
    "fabric.mod.json": Buffer.from(JSON.stringify({ schemaVersion: 1, id: "easy_mc_room_client" }), "utf8"),
    "com/easymc/room/client/LocalRoomClientMod.class": Buffer.from([0xca, 0xfe, 0xba, 0xbe])
  });
}

function createZipFixture(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(entries)) {
    const filename = Buffer.from(name, "utf8");
    const bytes = Buffer.from(contents);
    const crc = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(bytes.byteLength, 18);
    localHeader.writeUInt32LE(bytes.byteLength, 22);
    localHeader.writeUInt16LE(filename.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(bytes.byteLength, 20);
    centralHeader.writeUInt32LE(bytes.byteLength, 24);
    centralHeader.writeUInt16LE(filename.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localRecords.push(localHeader, filename, bytes);
    centralRecords.push(centralHeader, filename);
    offset += localHeader.byteLength + filename.byteLength + bytes.byteLength;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const entryCount = Object.keys(entries).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
