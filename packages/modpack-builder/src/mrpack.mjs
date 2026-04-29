import { readFile, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";

export const MrpackFailureReasons = Object.freeze({
  INVALID_TEMPLATE: "invalid_template",
  FIRST_PARTY_ARTIFACT_PENDING: "first_party_artifact_pending",
  UNSAFE_DOWNLOAD_METADATA: "unsafe_download_metadata"
});

const failureMessages = Object.freeze({
  [MrpackFailureReasons.INVALID_TEMPLATE]: "Modrinth pack template is not complete.",
  [MrpackFailureReasons.FIRST_PARTY_ARTIFACT_PENDING]: "First-party connection mod artifact metadata is still pending.",
  [MrpackFailureReasons.UNSAFE_DOWNLOAD_METADATA]: "Pack files must keep original HTTPS downloads, hashes, and file sizes."
});

const mvp0ApprovedFiles = Object.freeze({
  "mods/fabric-api-0.116.11+1.21.1.jar": Object.freeze({
    downloads: Object.freeze(["https://cdn.modrinth.com/data/P7dR8mSH/versions/IpaMcBLh/fabric-api-0.116.11%2B1.21.1.jar"]),
    hashes: Object.freeze({
      sha1: "65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84",
      sha512: "756b8c086f4c911d012f2eb70ca792aef0439503b31bc52026b82830870a94d472de30d61a6a0a9988c02b8462d9c47aa6baa6cd84da1eaf00edb77249b3c413"
    }),
    fileSize: 2426356
  }),
  "mods/lithium-fabric-0.15.3+mc1.21.1.jar": Object.freeze({
    downloads: Object.freeze(["https://cdn.modrinth.com/data/gvQqBUqZ/versions/XQJtuOTA/lithium-fabric-0.15.3%2Bmc1.21.1.jar"]),
    hashes: Object.freeze({
      sha1: "c4a1c2b6de9915ac77ae46a005509d4acf09535d",
      sha512: "8c576d519121b0c2521101d2209eccd85d560b097fcb847aa54c51cd0d3f3947676f01c8d99913f514487c8e0972a1cf5f3da0c9ef0ec9bacdf2baeb4eb7d1a7"
    }),
    fileSize: 797398
  }),
  "mods/ferritecore-7.0.3-fabric.jar": Object.freeze({
    downloads: Object.freeze(["https://cdn.modrinth.com/data/uXXizFIs/versions/sOzRw3CG/ferritecore-7.0.3-fabric.jar"]),
    hashes: Object.freeze({
      sha1: "a8a6a34fcda177da2828cedef44e0e538cf78aad",
      sha512: "3ad31620fac4ff44327dc7dedbe162b2d978f3f246dc16255a6e400ce9592a0d326fe36a626f3c1bf30a11f813093cbb4dcc107af039cff724d0cdf648541fdf"
    }),
    fileSize: 123450
  })
});

export async function readMrpackTemplate(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateMrpackTemplate(template = {}) {
  const blockers = [];

  if (template.formatVersion !== 1 || template.game !== "minecraft" || !template.dependencies?.minecraft || !template.dependencies?.["fabric-loader"]) {
    blockers.push({
      reason: MrpackFailureReasons.INVALID_TEMPLATE,
      path: "<manifest>",
      message: failureMessages[MrpackFailureReasons.INVALID_TEMPLATE]
    });
  }

  const files = Array.isArray(template.files) ? template.files : [];
  if (files.length === 0) {
    blockers.push({
      reason: MrpackFailureReasons.INVALID_TEMPLATE,
      path: "<files>",
      message: "Pack must include at least one file."
    });
  }

  for (const file of files) {
    const path = file?.path ?? "<unknown>";
    const metadataIssues = validateFileMetadata(file);
    blockers.push(...metadataIssues.map((message) => ({
      reason: MrpackFailureReasons.UNSAFE_DOWNLOAD_METADATA,
      path,
      message
    })));

    if (isFirstPartyPlaceholder(file)) {
      blockers.push({
        reason: MrpackFailureReasons.FIRST_PARTY_ARTIFACT_PENDING,
        path,
        message: failureMessages[MrpackFailureReasons.FIRST_PARTY_ARTIFACT_PENDING]
      });
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    fileCount: files.length,
    dependencies: {
      minecraft: template.dependencies?.minecraft ?? null,
      fabricLoader: template.dependencies?.["fabric-loader"] ?? null
    }
  };
}

export function buildMrpackManifest(template = {}) {
  const validation = validateMrpackTemplate(template);
  if (!validation.ok) {
    return fail(validation.blockers[0].reason, { blockers: validation.blockers });
  }

  return {
    ok: true,
    manifest: normalizeManifest(template)
  };
}

export async function writeMrpack(template = {}, outputPath) {
  const manifest = buildMrpackManifest(template);
  if (!manifest.ok) {
    return manifest;
  }

  const archive = createMrpackArchive(manifest.manifest);
  await writeFile(outputPath, archive);

  return {
    ok: true,
    outputPath,
    byteLength: archive.byteLength,
    fileCount: manifest.manifest.files.length
  };
}

export function createMrpackArchive(manifest) {
  return createZipArchive([
    {
      name: "modrinth.index.json",
      contents: Buffer.from(`${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`, "utf8")
    }
  ]);
}

function validateFileMetadata(file = {}) {
  const issues = [];

  if (!file.path || file.path.includes("..") || file.path.startsWith("/") || file.path.includes("\\")) {
    issues.push("Pack file path must be a safe relative path.");
  }

  if (!Array.isArray(file.downloads) || file.downloads.length === 0 || !file.downloads.every(isHttpsUrl)) {
    issues.push("Pack file must use original HTTPS download URLs.");
  }

  if (!isSha1(file.hashes?.sha1) || !isSha512(file.hashes?.sha512)) {
    issues.push("Pack file must include SHA1 and SHA512 hashes.");
  }

  if (!Number.isInteger(file.fileSize) || file.fileSize <= 0) {
    issues.push("Pack file must include a positive file size.");
  }

  if (!matchesApprovedFileLock(file)) {
    issues.push("Pack file must match the MVP-0 approved source URL, hashes, and file size lock.");
  }

  return issues;
}

function isFirstPartyPlaceholder(file = {}) {
  const haystack = JSON.stringify(file);
  return file.path?.includes("local-room-client")
    && (
      haystack.includes("REPLACE_WITH_")
      || haystack.includes("example.invalid")
      || file.fileSize === 0
    );
}

function matchesApprovedFileLock(file = {}) {
  const approved = mvp0ApprovedFiles[file.path];
  if (!approved) {
    return false;
  }

  return sameArray(file.downloads, approved.downloads)
    && file.hashes?.sha1 === approved.hashes.sha1
    && file.hashes?.sha512 === approved.hashes.sha512
    && file.fileSize === approved.fileSize;
}

function sameArray(left = [], right = []) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeManifest(template) {
  return {
    formatVersion: template.formatVersion,
    game: template.game,
    versionId: template.versionId,
    name: template.name,
    summary: template.summary,
    files: template.files,
    dependencies: template.dependencies
  };
}

function createZipArchive(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const entry of entries) {
    const filename = Buffer.from(entry.name, "utf8");
    const uncompressed = Buffer.from(entry.contents);
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed);
    const localHeader = createLocalHeader({ filename, crc, compressed, uncompressed });
    const centralHeader = createCentralHeader({ filename, crc, compressed, uncompressed, offset });

    localRecords.push(localHeader, compressed);
    centralRecords.push(centralHeader);
    offset += localHeader.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = createEndOfCentralDirectory({
    entryCount: entries.length,
    centralSize: centralDirectory.byteLength,
    centralOffset: offset
  });

  return Buffer.concat([...localRecords, centralDirectory, end]);
}

function createLocalHeader({ filename, crc, compressed, uncompressed }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.byteLength, 18);
  header.writeUInt32LE(uncompressed.byteLength, 22);
  header.writeUInt16LE(filename.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, filename]);
}

function createCentralHeader({ filename, crc, compressed, uncompressed, offset }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressed.byteLength, 20);
  header.writeUInt32LE(uncompressed.byteLength, 24);
  header.writeUInt16LE(filename.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, filename]);
}

function createEndOfCentralDirectory({ entryCount, centralSize, centralOffset }) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
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

function isHttpsUrl(value) {
  return typeof value === "string" && value.startsWith("https://") && !value.includes("example.invalid");
}

function isSha1(value) {
  return /^[a-f0-9]{40}$/i.test(value ?? "");
}

function isSha512(value) {
  return /^[a-f0-9]{128}$/i.test(value ?? "");
}

function fail(reason, detail = {}) {
  return {
    ok: false,
    failure: {
      reason,
      message: failureMessages[reason],
      detail
    }
  };
}
