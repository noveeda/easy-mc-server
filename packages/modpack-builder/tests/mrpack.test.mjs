import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MrpackFailureReasons,
  applyFirstPartyArtifactLocks,
  buildMrpackManifest,
  createFirstPartyArtifactLock,
  createFirstPartyArtifactLockFromFile,
  createMrpackArchive,
  readMrpackTemplate,
  validateFirstPartyArtifactDownloadUrl,
  validateFirstPartyArtifactJarBytes,
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

test("fixed MVP-0 template can build when first-party artifact lock is supplied", async () => {
  const template = await readMrpackTemplate(templatePath);
  const firstPartyArtifacts = [firstPartyClientArtifactLock()];
  const completed = applyFirstPartyArtifactLocks(template, firstPartyArtifacts);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts });

  assert.equal(readiness.ok, true);
  assert.equal(readiness.fileCount, 4);

  const manifest = buildMrpackManifest(completed, { firstPartyArtifacts });

  assert.equal(manifest.ok, true);
  assert.equal(manifest.manifest.files.length, 4);
  assert.equal(JSON.stringify(manifest.manifest).includes("REPLACE_WITH_"), false);
  assert.equal(JSON.stringify(manifest.manifest).includes("example.invalid"), false);
});

test("first-party artifact lock can be derived from immutable artifact bytes", async () => {
  const template = await readMrpackTemplate(templatePath);
  const firstPartyArtifacts = [
    createFirstPartyArtifactLock({
      path: "mods/local-room-client-connection-0.1.0-alpha.jar",
      downloads: ["https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar"],
      bytes: Buffer.from("first-party-client-artifact-v0.1.0-alpha", "utf8")
    })
  ];
  const completed = applyFirstPartyArtifactLocks(template, firstPartyArtifacts);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts });

  assert.equal(readiness.ok, true);
  assert.equal(firstPartyArtifacts[0].hashes.sha1, "2858c62aa7259c7880a8a4a9bff57d613256e63d");
  assert.equal(firstPartyArtifacts[0].hashes.sha512.length, 128);
  assert.equal(firstPartyArtifacts[0].fileSize, 40);
});

test("first-party artifact metadata must be explicitly locked", async () => {
  const template = await readMrpackTemplate(templatePath);
  const completed = applyFirstPartyArtifactLocks(template, [firstPartyClientArtifactLock()]);
  const readiness = validateMrpackTemplate(completed);

  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.path === "mods/local-room-client-connection-0.1.0-alpha.jar"));
  assert.ok(readiness.blockers.some((blocker) => blocker.message.includes("approved source URL")));
});

test("first-party artifact lock can be derived from a local jar and real HTTPS publish URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-artifact-"));
  const artifactPath = join(root, "local-room-client.jar");

  try {
    await writeFile(artifactPath, firstPartyClientJarFixture());

    const lock = await createFirstPartyArtifactLockFromFile({
      path: "mods/local-room-client-connection-0.1.0-alpha.jar",
      artifactPath,
      downloadUrl: "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar"
    });

    assert.equal(lock.fileSize, firstPartyClientJarFixture().byteLength);
    assert.equal(lock.downloads[0], "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar");
    assert.equal(lock.hashes.sha1.length, 40);
    assert.equal(lock.hashes.sha512.length, 128);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("first-party artifact lock from file rejects jars missing Fabric metadata or class entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "easy-mc-artifact-"));
  const artifactPath = join(root, "local-room-client.jar");

  try {
    await writeFile(artifactPath, createZipFixture({
      "fabric.mod.json": Buffer.from("{}", "utf8")
    }));

    await assert.rejects(
      () => createFirstPartyArtifactLockFromFile({
        path: "mods/local-room-client-connection-0.1.0-alpha.jar",
        artifactPath,
        downloadUrl: "https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar"
      }),
      /LocalRoomClientMod\.class/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("first-party artifact jar validator requires fabric.mod.json and compiled classes", () => {
  assert.equal(validateFirstPartyArtifactJarBytes({
    path: "mods/local-room-client-connection-0.1.0-alpha.jar",
    bytes: Buffer.from("not a jar", "utf8")
  }).ok, false);

  assert.equal(validateFirstPartyArtifactJarBytes({
    path: "mods/local-room-client-connection-0.1.0-alpha.jar",
    bytes: firstPartyClientJarFixture()
  }).ok, true);
});

test("first-party artifact publish URL rejects local and reserved success paths", () => {
  const blockedUrls = [
    "file:///C:/tmp/local-room-client.jar",
    "https://localhost/releases/local-room-client.jar",
    "https://127.0.0.1/releases/local-room-client.jar",
    "https://192.168.0.10/releases/local-room-client.jar",
    "https://100.64.0.1/releases/local-room-client.jar",
    "https://198.18.0.1/releases/local-room-client.jar",
    "https://224.0.0.1/releases/local-room-client.jar",
    "https://240.0.0.1/releases/local-room-client.jar",
    "https://[::1]/releases/local-room-client.jar",
    "https://[fc00::1]/releases/local-room-client.jar",
    "https://[2001:db8::1]/releases/local-room-client.jar",
    "https://downloads.local/releases/local-room-client.jar",
    "https://downloads.example.test/releases/local-room-client.jar",
    "https://example.invalid/releases/local-room-client.jar",
    "https://artifacts.localroom.dev/releases/REPLACE_WITH_FIRST_PARTY_CLIENT_MOD.jar",
    "https://artifacts.localroom.dev/releases/<signed-https-artifact-url>"
  ];

  for (const url of blockedUrls) {
    assert.equal(validateFirstPartyArtifactDownloadUrl(url).ok, false, url);
  }
});

test("direct first-party artifact locks cannot bypass publish URL validation", async () => {
  const template = await readMrpackTemplate(templatePath);
  const unsafeLock = {
    ...firstPartyClientArtifactLock(),
    downloads: ["https://127.0.0.1/releases/local-room-client-connection-0.1.0-alpha.jar"]
  };
  const completed = applyFirstPartyArtifactLocks(template, [unsafeLock]);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts: [unsafeLock] });

  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.message.includes("localhost, private IPs")));
  assert.equal(JSON.stringify(completed).includes("https://127.0.0.1/"), false);
});

test("first-party artifact lock option fails closed when it is not a list", async () => {
  const template = await readMrpackTemplate(templatePath);
  const readiness = validateMrpackTemplate(template, { firstPartyArtifacts: {} });

  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.path === "<first-party-artifacts>"));
});

test("first-party artifact lock helper rejects unsafe publish URLs", () => {
  assert.throws(
    () => createFirstPartyArtifactLock({
      path: "mods/local-room-client-connection-0.1.0-alpha.jar",
      downloads: ["https://localhost/releases/local-room-client-connection-0.1.0-alpha.jar"],
      bytes: Buffer.from("first-party-client-artifact-v0.1.0-alpha", "utf8")
    }),
    /localhost, private IPs/
  );
});

test("first-party artifact lock keeps unsafe publish metadata blocked", async () => {
  const template = await readMrpackTemplate(templatePath);
  const firstPartyArtifacts = [
    {
      ...firstPartyClientArtifactLock(),
      downloads: ["http://downloads.example.test/local-room-client-connection-0.1.0-alpha.jar"]
    }
  ];
  const completed = applyFirstPartyArtifactLocks(template, firstPartyArtifacts);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts });

  assert.equal(readiness.ok, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.message.includes("HTTPS")));
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

function firstPartyClientArtifactLock() {
  return {
    path: "mods/local-room-client-connection-0.1.0-alpha.jar",
    hashes: {
      sha1: "0c98c677a85f3e6c7a203839f0f8f49727b14355",
      sha512: "64e269025e7cf47881d050412e341cb34c8edb582f5a28e3984ad51777839da3032fd6604b66236d8d00f582ae8c28a0f4c66e3563e9db5b6da7453f82c56d6a"
    },
    downloads: ["https://artifacts.localroom.dev/releases/local-room-client-connection-0.1.0-alpha.jar"],
    fileSize: 4096
  };
}

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
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
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
