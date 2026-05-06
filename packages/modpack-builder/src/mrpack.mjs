import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
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

const firstPartyArtifactPaths = new Set([
  "mods/local-room-client-connection-0.1.0-alpha.jar",
  "mods/local-room-server-bridge-0.1.0-alpha.jar"
]);

const firstPartyArtifactJarExpectations = Object.freeze({
  "mods/local-room-client-connection-0.1.0-alpha.jar": Object.freeze({
    className: "com/easymc/room/client/LocalRoomClientMod.class"
  }),
  "mods/local-room-server-bridge-0.1.0-alpha.jar": Object.freeze({
    className: "com/easymc/room/server/LocalRoomServerBridgeMod.class"
  })
});

export async function readMrpackTemplate(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function applyFirstPartyArtifactLocks(template = {}, firstPartyArtifacts = []) {
  const locks = normalizeFirstPartyArtifactLocks(firstPartyArtifacts);
  const next = structuredCloneJson(template);

  next.files = (Array.isArray(next.files) ? next.files : []).map((file) => {
    const lock = locks[file?.path];
    if (!lock) {
      return file;
    }

    return {
      ...file,
      downloads: lock.downloads,
      hashes: {
        sha1: lock.hashes.sha1,
        sha512: lock.hashes.sha512
      },
      fileSize: lock.fileSize
    };
  });

  return next;
}

export function createFirstPartyArtifactLock({ path, downloads, bytes } = {}) {
  const contents = Buffer.from(bytes ?? []);
  const hashes = {
    sha1: createHash("sha1").update(contents).digest("hex"),
    sha512: createHash("sha512").update(contents).digest("hex")
  };
  const issues = validateSingleFirstPartyArtifactLock({
    path,
    downloads,
    hashes,
    fileSize: contents.byteLength
  });

  if (issues.length > 0) {
    throw new Error(issues[0]);
  }

  return {
    path,
    downloads: [...(downloads ?? [])],
    hashes,
    fileSize: contents.byteLength
  };
}

export async function createFirstPartyArtifactLockFromFile({
  path,
  artifactPath,
  downloadUrl
} = {}) {
  if (!firstPartyArtifactPaths.has(path)) {
    throw new Error(`Unknown first-party artifact path: ${path ?? "<missing>"}`);
  }

  if (!artifactPath || typeof artifactPath !== "string" || artifactPath.startsWith("file:")) {
    throw new Error("First-party artifact bytes must come from an explicit local jar path.");
  }

  const urlReadiness = validateFirstPartyArtifactDownloadUrl(downloadUrl);

  if (!urlReadiness.ok) {
    throw new Error(urlReadiness.message);
  }

  const bytes = await readFile(artifactPath);
  const jarReadiness = validateFirstPartyArtifactJarBytes({ path, bytes });

  if (!jarReadiness.ok) {
    throw new Error(jarReadiness.message);
  }

  return createFirstPartyArtifactLock({
    path,
    downloads: [downloadUrl],
    bytes
  });
}

export function validateFirstPartyArtifactJarBytes({ path, bytes } = {}) {
  const expected = firstPartyArtifactJarExpectations[path];
  if (!expected) {
    return {
      ok: false,
      message: `Unknown first-party artifact path: ${path ?? "<missing>"}`
    };
  }

  const contents = Buffer.from(bytes ?? []);
  let entries;

  try {
    entries = listZipEntryNames(contents);
  } catch (error) {
    return {
      ok: false,
      message: `First-party artifact jar is not readable: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!entries.includes("fabric.mod.json")) {
    return {
      ok: false,
      message: "First-party artifact jar must include fabric.mod.json."
    };
  }

  if (!entries.includes(expected.className)) {
    return {
      ok: false,
      message: `First-party artifact jar must include ${expected.className}.`
    };
  }

  if (!entries.some((entry) => entry.endsWith(".class"))) {
    return {
      ok: false,
      message: "First-party artifact jar must include at least one compiled class."
    };
  }

  return {
    ok: true,
    entries
  };
}

export function validateFirstPartyArtifactDownloadUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      message: "First-party artifact download URL is required."
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      message: "First-party artifact download URL must be an absolute HTTPS URL."
    };
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return {
      ok: false,
      message: "First-party artifact download URL must be a credential-free HTTPS URL."
    };
  }

  if (value.includes("REPLACE_WITH_") || value.includes("<signed-https-artifact-url>")) {
    return {
      ok: false,
      message: "First-party artifact download URL must not contain placeholder values."
    };
  }

  if (isReservedArtifactHost(parsed.hostname)) {
    return {
      ok: false,
      message: "First-party artifact download URL must not use localhost, private IPs, or reserved example/test hosts."
    };
  }

  return {
    ok: true,
    href: parsed.href
  };
}

export function validateMrpackTemplate(template = {}, options = {}) {
  const blockers = [];
  const firstPartyArtifactIssues = collectFirstPartyArtifactLockIssues(options.firstPartyArtifacts);
  const approvedFiles = createApprovedFileLock(options.firstPartyArtifacts);

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

  blockers.push(...firstPartyArtifactIssues.map((issue) => metadataBlocker(issue.path, issue.message)));

  for (const file of files) {
    const path = file?.path ?? "<unknown>";
    const metadataIssues = validateFileMetadata(file, approvedFiles);
    blockers.push(...metadataIssues.map((message) => metadataBlocker(path, message)));

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

export function buildMrpackManifest(template = {}, options = {}) {
  const validation = validateMrpackTemplate(template, options);
  if (!validation.ok) {
    return fail(validation.blockers[0].reason, { blockers: validation.blockers });
  }

  return {
    ok: true,
    manifest: normalizeManifest(template)
  };
}

export async function writeMrpack(template = {}, outputPath, options = {}) {
  const manifest = buildMrpackManifest(template, options);
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

function validateFileMetadata(file = {}, approvedFiles = mvp0ApprovedFiles) {
  const issues = [];

  if (!file.path || file.path.includes("..") || file.path.startsWith("/") || file.path.includes("\\")) {
    issues.push("Pack file path must be a safe relative path.");
  }

  if (!hasOriginalHttpsDownloads(file.downloads)) {
    issues.push("Pack file must use original HTTPS download URLs.");
  }

  if (!isSha1(file.hashes?.sha1) || !isSha512(file.hashes?.sha512)) {
    issues.push("Pack file must include SHA1 and SHA512 hashes.");
  }

  if (!Number.isInteger(file.fileSize) || file.fileSize <= 0) {
    issues.push("Pack file must include a positive file size.");
  }

  if (!matchesApprovedFileLock(file, approvedFiles)) {
    issues.push("Pack file must match the MVP-0 approved source URL, hashes, and file size lock.");
  }

  return issues;
}

function isFirstPartyPlaceholder(file = {}) {
  const haystack = JSON.stringify(file);
  return firstPartyArtifactPaths.has(file.path)
    && (
      haystack.includes("REPLACE_WITH_")
      || haystack.includes("example.invalid")
      || file.fileSize === 0
    );
}

function matchesApprovedFileLock(file = {}, approvedFiles = mvp0ApprovedFiles) {
  const approved = approvedFiles[file.path];
  if (!approved) {
    return false;
  }

  return sameArray(file.downloads, approved.downloads)
    && file.hashes?.sha1 === approved.hashes.sha1
    && file.hashes?.sha512 === approved.hashes.sha512
    && file.fileSize === approved.fileSize;
}

function createApprovedFileLock(firstPartyArtifacts = []) {
  return Object.freeze({
    ...mvp0ApprovedFiles,
    ...normalizeFirstPartyArtifactLocks(firstPartyArtifacts)
  });
}

function normalizeFirstPartyArtifactLocks(firstPartyArtifacts = []) {
  const locks = {};

  if (!Array.isArray(firstPartyArtifacts)) {
    return Object.freeze(locks);
  }

  for (const artifact of firstPartyArtifacts) {
    if (validateSingleFirstPartyArtifactLock(artifact).length > 0) {
      continue;
    }

    locks[artifact.path] = Object.freeze({
      downloads: Object.freeze([...(artifact.downloads ?? [])]),
      hashes: Object.freeze({
        sha1: artifact.hashes?.sha1 ?? "",
        sha512: artifact.hashes?.sha512 ?? ""
      }),
      fileSize: artifact.fileSize
    });
  }

  return Object.freeze(locks);
}

function collectFirstPartyArtifactLockIssues(firstPartyArtifacts = []) {
  if (!Array.isArray(firstPartyArtifacts)) {
    return [{
      path: "<first-party-artifacts>",
      message: "First-party artifact locks must be provided as a list."
    }];
  }

  return firstPartyArtifacts.flatMap((artifact) => validateSingleFirstPartyArtifactLock(artifact).map((message) => ({
    path: artifact?.path ?? "<first-party-artifact>",
    message
  })));
}

function validateSingleFirstPartyArtifactLock(artifact = {}) {
  const issues = [];

  if (!firstPartyArtifactPaths.has(artifact?.path)) {
    issues.push(`Unknown first-party artifact path: ${artifact?.path ?? "<missing>"}`);
  }

  if (!Array.isArray(artifact?.downloads) || artifact.downloads.length === 0) {
    issues.push("First-party artifact download URL is required.");
  } else {
    for (const download of artifact.downloads) {
      const readiness = validateFirstPartyArtifactDownloadUrl(download);
      if (!readiness.ok) {
        issues.push(readiness.message);
      }
    }
  }

  if (!isSha1(artifact?.hashes?.sha1) || !isSha512(artifact?.hashes?.sha512)) {
    issues.push("First-party artifact lock must include SHA1 and SHA512 hashes.");
  }

  if (!Number.isInteger(artifact?.fileSize) || artifact.fileSize <= 0) {
    issues.push("First-party artifact lock must include a positive file size.");
  }

  return issues;
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

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function listZipEntryNames(buffer) {
  if (buffer.byteLength < 22) {
    throw new Error("zip archive is too small");
  }

  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);

  if (centralOffset + centralSize > buffer.byteLength) {
    throw new Error("central directory is outside the archive");
  }

  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("central directory entry is invalid");
    }

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd > buffer.byteLength) {
      throw new Error("central directory filename is outside the archive");
    }

    entries.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.byteLength - 0xffff - 22);

  for (let offset = buffer.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("end of central directory was not found");
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

function hasOriginalHttpsDownloads(downloads) {
  return Array.isArray(downloads) && downloads.length > 0 && downloads.every(isOriginalHttpsDownloadUrl);
}

function isOriginalHttpsDownloadUrl(value) {
  return typeof value === "string" && value.startsWith("https://") && !value.includes("example.invalid");
}

function metadataBlocker(path, message) {
  return {
    reason: MrpackFailureReasons.UNSAFE_DOWNLOAD_METADATA,
    path,
    message
  };
}

function isReservedArtifactHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const ipVersion = isIP(host);

  if (
    host === "localhost"
    || host.endsWith(".localhost")
    || host === "example.com"
    || host === "example.net"
    || host === "example.org"
    || host === "example.test"
    || host.endsWith(".example")
    || host.endsWith(".invalid")
    || host.endsWith(".test")
    || host.endsWith(".local")
    || host.endsWith(".lan")
  ) {
    return true;
  }

  if (ipVersion === 4) {
    const [first, second] = host.split(".").map((part) => Number.parseInt(part, 10));
    return first === 10
      || first === 127
      || first === 0
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254)
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 192 && second === 0)
      || (first === 198 && (second === 18 || second === 19))
      || (first === 198 && second === 51)
      || (first === 203 && second === 0)
      || first >= 224;
  }

  if (ipVersion === 6) {
    return host === "::1"
      || host === "::"
      || host.startsWith("::ffff:")
      || host.startsWith("fc")
      || host.startsWith("fd")
      || host.startsWith("fe80")
      || host.startsWith("2001:db8");
  }

  return false;
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
