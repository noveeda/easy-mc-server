import { execFile as defaultExecFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { HostRuntimeFailureReasons } from "./host-runtime.mjs";

export const NodeJavaDetectionSources = Object.freeze({
  CONFIGURED_PATH: "configuredPath",
  JAVA_HOME: "JAVA_HOME",
  PATH: "PATH",
  ADOPTIUM: "ProgramFiles/Eclipse Adoptium",
  JAVA: "ProgramFiles/Java"
});

const MINIMUM_JAVA_MAJOR = 21;

const failureMessages = Object.freeze({
  [HostRuntimeFailureReasons.JAVA_MISSING]: "Install Java 21 or newer before opening this room.",
  [HostRuntimeFailureReasons.JAVA_INCOMPATIBLE]: "Update Java before opening this room."
});

export async function detectWindowsJava(options = {}) {
  const minimumMajorVersion = options.minimumMajorVersion ?? MINIMUM_JAVA_MAJOR;
  const env = options.env ?? process.env;
  const execFile = options.execFile ?? execFileAsync;
  const exists = options.exists ?? defaultExists;
  const listDirectory = options.readdir ?? defaultReaddir;
  const candidates = await createWindowsJavaCandidates({
    configuredPath: options.configuredPath,
    env,
    pathCandidates: options.pathCandidates,
    programFilesRoots: options.programFilesRoots,
    allowPathCandidates: options.allowPathCandidates,
    allowNetworkPaths: options.allowNetworkPaths,
    exists,
    readdir: listDirectory
  });
  const trustedSources = options.trustedSources ? new Set(options.trustedSources) : null;
  const candidatesToProbe = trustedSources
    ? candidates.filter((candidate) => trustedSources.has(candidate.source))
    : candidates;

  let bestIncompatible = null;

  for (const candidate of candidatesToProbe) {
    const probe = await probeJavaCandidate(candidate, { execFile });

    if (!probe.ok) {
      continue;
    }

    if (probe.majorVersion >= minimumMajorVersion) {
      return {
        ok: true,
        java: {
          path: candidate.path,
          majorVersion: probe.majorVersion,
          version: probe.version,
          vendor: candidate.vendor,
          source: candidate.source
        }
      };
    }

    bestIncompatible ??= {
      ...probe,
      candidate
    };
  }

  if (bestIncompatible) {
    return fail(HostRuntimeFailureReasons.JAVA_INCOMPATIBLE, {
      path: bestIncompatible.candidate.path,
      majorVersion: bestIncompatible.majorVersion,
      minimumMajorVersion,
      source: bestIncompatible.candidate.source
    });
  }

  return fail(HostRuntimeFailureReasons.JAVA_MISSING, {
    minimumMajorVersion,
    searchedCandidates: candidatesToProbe.map((candidate) => candidate.path)
  });
}

export async function createWindowsJavaCandidates(options = {}) {
  const env = options.env ?? {};
  const exists = options.exists ?? defaultExists;
  const listDirectory = options.readdir ?? defaultReaddir;
  const rawCandidates = [];

  rawCandidates.push({
    path: options.configuredPath,
    source: NodeJavaDetectionSources.CONFIGURED_PATH
  });

  rawCandidates.push({
    path: javaExeFromHome(env.JAVA_HOME),
    source: NodeJavaDetectionSources.JAVA_HOME
  });

  if (options.allowPathCandidates !== false) {
    for (const pathCandidate of options.pathCandidates ?? pathCandidatesFromEnv(envValue(env, "PATH"))) {
      rawCandidates.push({
        path: javaExeFromPathEntry(pathCandidate),
        source: NodeJavaDetectionSources.PATH
      });
    }
  }

  for (const root of programFilesRoots(env, options.programFilesRoots)) {
    rawCandidates.push(...await programFilesJavaCandidates(root, {
      exists,
      readdir: listDirectory
    }));
  }

  return dedupeCandidates(rawCandidates, {
    allowNetworkPaths: options.allowNetworkPaths
  });
}

export function parseJavaVersionOutput(output) {
  const text = String(output ?? "");
  const quotedVersion = text.match(/version\s+"([^"]+)"/i)?.[1];
  const openJdkVersion = text.match(/openjdk\s+([0-9][^\s]*)/i)?.[1];
  const version = quotedVersion ?? openJdkVersion ?? null;

  if (!version) {
    return null;
  }

  const majorVersion = majorVersionFromJavaVersion(version);

  return Number.isInteger(majorVersion)
    ? {
        version,
        majorVersion
      }
    : null;
}

async function probeJavaCandidate(candidate, options = {}) {
  try {
    const result = await options.execFile(candidate.path, ["-version"], {
      windowsHide: true,
      timeout: 5000
    });
    const parsed = parseJavaVersionOutput(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);

    if (!parsed) {
      return { ok: false };
    }

    return {
      ok: true,
      ...parsed
    };
  } catch (error) {
    const parsed = parseJavaVersionOutput(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}`);
    return parsed
      ? {
          ok: true,
          ...parsed
        }
      : { ok: false };
  }
}

async function programFilesJavaCandidates(root, options = {}) {
  if (!isSafeCandidatePath(root)) {
    return [];
  }

  const candidates = [];
  const roots = [
    {
      path: joinWindows(root, "Eclipse Adoptium"),
      source: NodeJavaDetectionSources.ADOPTIUM,
      vendor: "Eclipse Adoptium"
    },
    {
      path: joinWindows(root, "Java"),
      source: NodeJavaDetectionSources.JAVA,
      vendor: "Oracle"
    }
  ];

  for (const vendorRoot of roots) {
    let entries = [];

    try {
      entries = await options.readdir(vendorRoot.path);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : entry?.name;
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
        continue;
      }

      const javaPath = joinWindows(vendorRoot.path, name, "bin", "java.exe");
      if (await options.exists(javaPath)) {
        candidates.push({
          path: javaPath,
          source: vendorRoot.source,
          vendor: vendorRoot.vendor
        });
      }
    }
  }

  return candidates;
}

function dedupeCandidates(candidates, options = {}) {
  const seen = new Set();
  const result = [];

  for (const candidate of candidates) {
    if (!isSafeCandidatePath(candidate.path, options)) {
      continue;
    }

    const path = normalizeWindows(candidate.path);
    const key = path.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({
      path,
      source: candidate.source,
      vendor: candidate.vendor ?? null
    });
  }

  return result;
}

function javaExeFromHome(javaHome) {
  return isSafeCandidatePath(javaHome) ? joinWindows(javaHome, "bin", "java.exe") : null;
}

function javaExeFromPathEntry(pathEntry) {
  return isSafeCandidatePath(pathEntry) ? joinWindows(pathEntry, "java.exe") : null;
}

function pathCandidatesFromEnv(pathValue) {
  return String(pathValue ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function programFilesRoots(env, explicitRoots) {
  if (explicitRoots) {
    return explicitRoots;
  }

  return [
    envValue(env, "ProgramFiles"),
    envValue(env, "ProgramFiles(x86)")
  ];
}

function majorVersionFromJavaVersion(version) {
  const parts = String(version).split(".");
  const first = Number.parseInt(parts[0], 10);

  if (!Number.isInteger(first)) {
    return null;
  }

  if (first === 1 && parts.length > 1) {
    const legacyMajor = Number.parseInt(parts[1], 10);
    return Number.isInteger(legacyMajor) ? legacyMajor : null;
  }

  return first;
}

function isSafeCandidatePath(value, options = {}) {
  if (typeof value !== "string") {
    return false;
  }

  const path = value.trim();

  return path.length > 0
    && !path.includes("\0")
    && !hasParentPathSegment(path)
    && (
      /^[A-Za-z]:[\\/]/.test(path)
      || (options.allowNetworkPaths === true && (/^\\\\[^\\]+\\[^\\]+/.test(path) || /^\/\/[^/]+\/[^/]+/.test(path)))
    );
}

function envValue(env, key) {
  if (Object.hasOwn(env, key)) {
    return env[key];
  }

  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

function hasParentPathSegment(path) {
  return String(path)
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function normalizeWindows(path) {
  const normalized = String(path)
    .trim()
    .replaceAll("\\", "/");
  const uncPrefix = normalized.startsWith("//") ? "//" : "";
  const body = uncPrefix ? normalized.slice(2) : normalized;

  return `${uncPrefix}${body.replaceAll(/\/+/g, "/")}`
    .replace(/^([A-Z]):\//i, "$1:/");
}

function joinWindows(...parts) {
  return normalizeWindows(parts.filter(Boolean).join("/"));
}

async function defaultExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultReaddir(path) {
  return readdir(path, { withFileTypes: true });
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    defaultExecFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
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
