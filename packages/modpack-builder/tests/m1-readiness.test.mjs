import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkM1MrpackReadiness } from "../../../scripts/check-m1-mrpack-readiness.mjs";

const templatePath = "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json";

test("M1 readiness stays blocked before local first-party artifacts are built", async () => {
  const report = await checkM1MrpackReadiness({
    templatePath,
    artifactManifestPath: "missing/m1-artifacts-manifest.json"
  });

  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((blocker) => blocker.message.includes("Run npm.cmd run m1:artifacts")));
});

test("M1 readiness stays blocked until a signed HTTPS publish URL exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-readiness-"));
  const artifactPath = join(root, "local-room-client.jar");
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(artifactPath, firstPartyClientJarFixture());
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          publishUrl: null,
          publishState: "pending_signed_https_release"
        }
      ]
    })}\n`);

    const report = await checkM1MrpackReadiness({
      templatePath,
      artifactManifestPath: manifestPath
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.some((blocker) => blocker.message.includes("Signed HTTPS publish URL is not set")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 readiness reports the missing local artifact path when manifest metadata is stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-readiness-"));
  const artifactPath = join(root, "missing-local-room-client.jar");
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          publishUrl: "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar",
          publishState: "published_signed_https_release"
        }
      ]
    })}\n`);

    const report = await checkM1MrpackReadiness({
      templatePath,
      artifactManifestPath: manifestPath
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.some((blocker) => blocker.path === artifactPath && blocker.message.includes("ENOENT")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 readiness passes when local artifact bytes and public HTTPS metadata are complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-readiness-"));
  const artifactPath = join(root, "local-room-client.jar");
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(artifactPath, firstPartyClientJarFixture());
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          publishUrl: null,
          publishState: "pending_signed_https_release"
        }
      ]
    })}\n`);

    const report = await checkM1MrpackReadiness({
      templatePath,
      artifactManifestPath: manifestPath,
      publishUrls: {
        "mods/local-room-client-connection-0.1.0-alpha.jar":
          "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar"
      }
    });

    assert.equal(report.ok, true);
    assert.equal(report.fileCount, 4);
    assert.equal(report.firstPartyArtifacts[0].path, "mods/local-room-client-connection-0.1.0-alpha.jar");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 readiness rejects stale manifest entries that are not jar artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-readiness-"));
  const artifactPath = join(root, "local-room-client.jar");
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(artifactPath, Buffer.from("client artifact bytes", "utf8"));
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          publishUrl: "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar",
          publishState: "published_signed_https_release"
        }
      ]
    })}\n`);

    const report = await checkM1MrpackReadiness({
      templatePath,
      artifactManifestPath: manifestPath
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.some((blocker) => blocker.message.includes("jar is not readable")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("M1 readiness rejects placeholder publish URLs before treating local jars as ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-m1-readiness-"));
  const artifactPath = join(root, "local-room-client.jar");
  const manifestPath = join(root, "manifest.json");

  try {
    await writeFile(artifactPath, firstPartyClientJarFixture());
    await writeFile(manifestPath, `${JSON.stringify({
      artifacts: [
        {
          mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
          artifactPath,
          publishUrl: null,
          publishState: "pending_signed_https_release"
        }
      ]
    })}\n`);

    const report = await checkM1MrpackReadiness({
      templatePath,
      artifactManifestPath: manifestPath,
      publishUrls: {
        "mods/local-room-client-connection-0.1.0-alpha.jar":
          "https://artifacts.localroom.dev/releases/REPLACE_WITH_FIRST_PARTY_CLIENT_MOD.jar"
      }
    });

    assert.equal(report.ok, false);
    assert.ok(report.blockers.some((blocker) => (
      blocker.path === "mods/local-room-client-connection-0.1.0-alpha.jar"
      && blocker.message.includes("placeholder")
    )));
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
