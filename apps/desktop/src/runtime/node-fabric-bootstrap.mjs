import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { createFabricServerDownloadPlan } from "./local-runtime-adapter.mjs";

export const NodeFabricBootstrapFailureReasons = Object.freeze({
  INVALID_DOWNLOAD_PLAN: "invalid_download_plan",
  FETCH_MISSING: "fetch_missing",
  DOWNLOAD_FAILED: "download_failed",
  CHECKSUM_MISMATCH: "checksum_mismatch"
});

const failureMessages = Object.freeze({
  [NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN]: "방 실행 파일 다운로드 계획을 먼저 검증해야 합니다.",
  [NodeFabricBootstrapFailureReasons.FETCH_MISSING]: "검증된 다운로드 어댑터가 필요합니다.",
  [NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED]: "방 실행 파일을 내려받지 못했습니다.",
  [NodeFabricBootstrapFailureReasons.CHECKSUM_MISMATCH]: "방 실행 파일 검증에 실패했습니다."
});

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const FABRIC_META_BASE_URL = "https://meta.fabricmc.net/";

export async function bootstrapFabricServer(runtimePlan = {}, options = {}) {
  const downloadPlan = createFabricServerDownloadPlan(runtimePlan, options.sources);
  if (!downloadPlan.ok) {
    return fail(NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN, downloadPlan.failure);
  }

  const plan = downloadPlan.plan;
  const expectedSha256 = plan.verification?.expectedSha256;
  const fetchImpl = options.fetch;

  if (!isSha256(expectedSha256) || plan.verification?.algorithm !== "sha256" || plan.verification?.requiredBeforeInstall !== true) {
    return fail(NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN, {
      reason: "checksum_required",
      plan: summarizePlan(plan)
    });
  }

  const cachePath = toNativePath(plan.cache.path);
  const launcherJarPath = toNativePath(plan.install.target);
  const metadataPath = toNativePath(`${runtimePlan.layout.metadata}/fabric-server-bootstrap.json`);
  const installedAt = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const maxBytes = options.maxBytes ?? options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const boundary = await verifyWriteBoundary(runtimePlan.layout.appDataRoot, [
    cachePath,
    launcherJarPath,
    metadataPath
  ]);
  if (!boundary.ok) {
    return fail(NodeFabricBootstrapFailureReasons.INVALID_DOWNLOAD_PLAN, boundary.detail);
  }

  let existing;
  try {
    existing = {
      launcher: await readVerifiedArtifact(launcherJarPath, expectedSha256, { maxBytes }),
      cache: await readVerifiedArtifact(cachePath, expectedSha256, { maxBytes })
    };
  } catch (error) {
    return fail(NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED, {
      sourceUrl: plan.source.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (existing.launcher.ok) {
    await installFabricArtifact({
      bytes: existing.launcher.bytes,
      plan,
      cachePath,
      launcherJarPath,
      metadataPath,
      installedAt,
      actualSha256: expectedSha256
    });
    return bootstrapResult(plan, runtimePlan, expectedSha256, {
      reused: true,
      artifactSource: "launcher"
    });
  }

  if (existing.cache.ok) {
    await installFabricArtifact({
      bytes: existing.cache.bytes,
      plan,
      cachePath,
      launcherJarPath,
      metadataPath,
      installedAt,
      actualSha256: expectedSha256
    });
    return bootstrapResult(plan, runtimePlan, expectedSha256, {
      reused: true,
      artifactSource: "cache"
    });
  }

  if (typeof fetchImpl !== "function") {
    return fail(NodeFabricBootstrapFailureReasons.FETCH_MISSING, {
      sourceUrl: plan.source.url
    });
  }

  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, plan.source.url, {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/java-archive, application/octet-stream"
      }
    }, options);
  } catch (error) {
    return fail(NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED, {
      sourceUrl: plan.source.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (!response?.ok) {
    return fail(NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED, {
      sourceUrl: plan.source.url,
      status: response?.status ?? null,
      statusText: response?.statusText ?? ""
    });
  }

  if (response.url && !String(response.url).startsWith(FABRIC_META_BASE_URL)) {
    return fail(NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED, {
      sourceUrl: plan.source.url,
      responseUrl: response.url,
      reason: "unapproved_redirect_target"
    });
  }

  let bytes;
  try {
    bytes = await responseBytes(response, { maxBytes });
  } catch (error) {
    return fail(NodeFabricBootstrapFailureReasons.DOWNLOAD_FAILED, {
      sourceUrl: plan.source.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const actualSha256 = sha256(bytes);

  if (actualSha256 !== expectedSha256) {
    return fail(NodeFabricBootstrapFailureReasons.CHECKSUM_MISMATCH, {
      sourceUrl: plan.source.url,
      expectedSha256,
      actualSha256
    });
  }

  await installFabricArtifact({
    bytes,
    plan,
    cachePath,
    launcherJarPath,
    metadataPath,
    installedAt,
    actualSha256
  });

  return bootstrapResult(plan, runtimePlan, actualSha256, {
    reused: false,
    artifactSource: "download"
  });
}

async function fetchWithTimeout(fetchImpl, url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
  const controller = typeof AbortController === "function" ? new AbortController() : null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeoutImpl(timer);
      }
      callback(value);
    };
    const timer = Number.isFinite(timeoutMs) && timeoutMs >= 0
      ? setTimeoutImpl(() => {
          controller?.abort?.();
          finish(reject, new Error(`download timeout after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    Promise.resolve(fetchImpl(url, {
      ...init,
      signal: controller?.signal
    })).then(
      (response) => finish(resolve, response),
      (error) => finish(reject, error)
    );
  });
}

async function writeFileAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;

  try {
    await writeFile(tempPath, contents);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function responseBytes(response, { maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES } = {}) {
  const contentLength = Number(response.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`download exceeds maximum size (${contentLength} > ${maxBytes})`);
  }

  if (typeof response.arrayBuffer === "function") {
    return ensureMaxBytes(Buffer.from(await response.arrayBuffer()), maxBytes);
  }

  if (typeof response.bytes === "function") {
    return ensureMaxBytes(Buffer.from(await response.bytes()), maxBytes);
  }

  throw new TypeError("fetch response must expose arrayBuffer() or bytes()");
}

async function readVerifiedArtifact(path, expectedSha256, { maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES } = {}) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maxBytes) {
      return {
        ok: false,
        bytes: null
      };
    }

    const bytes = await readFile(path);
    return {
      ok: sha256(bytes) === expectedSha256,
      bytes: ensureMaxBytes(bytes, maxBytes)
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return {
        ok: false,
        bytes: null
      };
    }

    throw error;
  }
}

async function installFabricArtifact({ bytes, plan, cachePath, launcherJarPath, metadataPath, installedAt, actualSha256 }) {
  await mkdir(dirname(cachePath), { recursive: true });
  await mkdir(dirname(launcherJarPath), { recursive: true });
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFileAtomic(cachePath, bytes);
  await writeFileAtomic(launcherJarPath, bytes);
  await writeFileAtomic(metadataPath, serializeJson({
    roomId: plan.roomId,
    provider: plan.source.provider,
    sourceUrl: plan.source.url,
    cachePath: plan.cache.path,
    launcherJar: plan.install.target,
    sha256: actualSha256,
    installedAt
  }));
}

function bootstrapResult(plan, runtimePlan, actualSha256, detail = {}) {
  return {
    ok: true,
    roomId: plan.roomId,
    sourceUrl: plan.source.url,
    cachePath: plan.cache.path,
    launcherJar: plan.install.target,
    metadataPath: `${runtimePlan.layout.metadata}/fabric-server-bootstrap.json`,
    sha256: actualSha256,
    ...detail
  };
}

function ensureMaxBytes(bytes, maxBytes) {
  if (bytes.byteLength > maxBytes) {
    throw new Error(`download exceeds maximum size (${bytes.byteLength} > ${maxBytes})`);
  }

  return bytes;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(value ?? "");
}

async function verifyWriteBoundary(root, paths) {
  if (!root) {
    return { ok: true };
  }

  const rootPath = toNativePath(root);
  const rootStat = await safeLstat(rootPath);
  const rootReal = await safeRealpath(rootPath);
  if (!rootStat || rootStat.isSymbolicLink() || !rootReal) {
    return {
      ok: false,
      detail: { reason: "unsafe_app_data_root" }
    };
  }

  for (const path of paths) {
    const relation = relative(rootPath, path);
    if (relation.startsWith("..") || isAbsolute(relation)) {
      return {
        ok: false,
        detail: { reason: "path_outside_app_data_root" }
      };
    }

    const symlink = await findExistingSymlinkSegment(rootPath, path);
    if (symlink) {
      return {
        ok: false,
        detail: { reason: "managed_path_reparse_point" }
      };
    }

    const parentReal = await safeRealpath(await nearestExistingPath(dirname(path)));
    if (!parentReal || !isSubPath(rootReal, parentReal)) {
      return {
        ok: false,
        detail: { reason: "managed_path_escape" }
      };
    }
  }

  return { ok: true };
}

async function findExistingSymlinkSegment(rootPath, targetPath) {
  const segments = relative(rootPath, targetPath).split(/[\\/]+/).filter(Boolean);
  let current = rootPath;
  for (const segment of segments) {
    current = join(current, segment);
    const stat = await safeLstat(current);
    if (stat?.isSymbolicLink()) {
      return current;
    }
  }

  return null;
}

async function nearestExistingPath(path) {
  let current = path;
  while (current && current !== dirname(current)) {
    if (await safeLstat(current)) {
      return current;
    }
    current = dirname(current);
  }

  return current;
}

async function safeLstat(path) {
  try {
    return await lstat(path);
  } catch {
    return null;
  }
}

async function safeRealpath(path) {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

function isSubPath(root, path) {
  const relation = relative(root, path);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function summarizePlan(plan) {
  return {
    type: plan.type,
    roomId: plan.roomId,
    sourceUrl: plan.source?.url,
    target: plan.install?.target
  };
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toNativePath(path) {
  return normalize(String(path));
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
