#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyFirstPartyArtifactLocks,
  createFirstPartyArtifactLockFromFile,
  readMrpackTemplate,
  validateFirstPartyArtifactDownloadUrl,
  validateMrpackTemplate
} from "../packages/modpack-builder/src/mrpack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = Object.freeze({
  templatePath: "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json",
  artifactManifestPath: ".omc/artifacts/fabric-mods/manifest.json"
});

const firstPartyPaths = new Set([
  "mods/local-room-client-connection-0.1.0-alpha.jar",
  "mods/local-room-server-bridge-0.1.0-alpha.jar"
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const report = await checkM1MrpackReadiness(args);
  printReport(report, { json: args.json });
  process.exitCode = report.ok ? 0 : 1;
}

export async function checkM1MrpackReadiness(options = {}) {
  const templatePath = resolveFromRepo(options.templatePath ?? defaults.templatePath);
  const artifactManifestPath = resolveFromRepo(options.artifactManifestPath ?? defaults.artifactManifestPath);
  const blockers = [];
  const firstPartyArtifacts = [];

  const template = await readMrpackTemplate(templatePath);
  const requiredPaths = listRequiredFirstPartyArtifactPaths(template);

  if (requiredPaths.length === 0) {
    addBlocker(blockers, "<template>", "M1 template does not reference any known first-party room connection artifacts.");
  }

  const manifest = await readArtifactManifest(artifactManifestPath, blockers);

  if (manifest) {
    firstPartyArtifacts.push(...await collectFirstPartyArtifactLocks({
      manifest,
      requiredPaths,
      publishUrls: options.publishUrls ?? {},
      blockers
    }));
  }

  if (blockers.length > 0) {
    return {
      ok: false,
      blockers,
      requiredPaths,
      artifactManifestPath,
      templatePath
    };
  }

  const completed = applyFirstPartyArtifactLocks(template, firstPartyArtifacts);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts });
  if (!readiness.ok) {
    return {
      ok: false,
      blockers: readiness.blockers,
      requiredPaths,
      artifactManifestPath,
      templatePath
    };
  }

  return {
    ok: true,
    blockers: [],
    requiredPaths,
    artifactManifestPath,
    templatePath,
    fileCount: readiness.fileCount,
    dependencies: readiness.dependencies,
    firstPartyArtifacts
  };
}

function listRequiredFirstPartyArtifactPaths(template = {}) {
  const files = Array.isArray(template.files) ? template.files : [];
  return files
    .map((file) => file?.path)
    .filter((path) => firstPartyPaths.has(path));
}

async function readArtifactManifest(artifactManifestPath, blockers) {
  try {
    return JSON.parse(await readFile(artifactManifestPath, "utf8"));
  } catch {
    addBlocker(blockers, artifactManifestPath, "First-party artifact manifest is missing. Run npm.cmd run m1:artifacts first.");
    return null;
  }
}

async function collectFirstPartyArtifactLocks({ manifest, requiredPaths, publishUrls, blockers }) {
  const artifactLocks = [];

  for (const requiredPath of requiredPaths) {
    const artifact = findManifestArtifactForMrpackPath(manifest, requiredPath);
    if (!artifact) {
      addBlocker(blockers, requiredPath, "Built first-party artifact is missing from the local artifact manifest.");
      continue;
    }

    const downloadUrl = publishUrls[requiredPath] ?? artifact.publishUrl;
    if (!downloadUrl) {
      addBlocker(blockers, requiredPath, "Signed HTTPS publish URL is not set. Provide --publish-url after the artifact is published.");
      continue;
    }

    const urlReadiness = validateFirstPartyArtifactDownloadUrl(downloadUrl);
    if (!urlReadiness.ok) {
      addBlocker(blockers, requiredPath, urlReadiness.message);
      continue;
    }

    try {
      const artifactPath = resolveFromRepo(artifact.artifactPath);
      await access(artifactPath);
      artifactLocks.push(await createFirstPartyArtifactLockFromFile({
        path: requiredPath,
        artifactPath,
        downloadUrl
      }));
    } catch (error) {
      addBlocker(blockers, artifactLocalPathForReport(artifact, requiredPath), error instanceof Error ? error.message : String(error));
    }
  }

  return artifactLocks;
}

function findManifestArtifactForMrpackPath(manifest = {}, mrpackPath) {
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  return artifacts.find((artifact) => artifact?.mrpackPath === mrpackPath);
}

function addBlocker(blockers, path, message) {
  blockers.push({ path, message });
}

function artifactLocalPathForReport(artifact = {}, fallbackPath) {
  return typeof artifact.artifactPath === "string" && artifact.artifactPath
    ? resolveFromRepo(artifact.artifactPath)
    : fallbackPath;
}

function resolveFromRepo(path) {
  return resolve(repoRoot, path);
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    json: false,
    templatePath: defaults.templatePath,
    artifactManifestPath: defaults.artifactManifestPath,
    publishUrls: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--template") {
      parsed.templatePath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--artifact-manifest") {
      parsed.artifactManifestPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--publish-url") {
      const entry = parsePublishUrl(requireValue(argv, index, arg));
      parsed.publishUrls[entry.path] = entry.url;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parsePublishUrl(value) {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error("--publish-url must use <mrpack-path>=<signed-https-url>.");
  }

  return {
    path: value.slice(0, separatorIndex),
    url: value.slice(separatorIndex + 1)
  };
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printReport(report, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.ok) {
    console.log("[ready] M1 private .mrpack inputs are complete.");
    console.log(`Template files: ${report.fileCount}`);
    console.log(`Minecraft: ${report.dependencies.minecraft}`);
    console.log(`Fabric Loader: ${report.dependencies.fabricLoader}`);
    console.log("Next: run npm.cmd run m1:mrpack with the same published artifact URL.");
    console.log("Manual blocker remains: import the generated .mrpack in Modrinth App and reach Minecraft approval waiting.");
    return;
  }

  console.log("[blocked] M1 private .mrpack is not import-ready yet.");
  for (const blocker of report.blockers) {
    console.log(`- ${blocker.path}: ${blocker.message}`);
  }
  console.log("Next:");
  console.log("1. Run npm.cmd run m1:artifacts if the local artifact manifest is missing.");
  console.log("2. Publish the first-party client artifact to a signed public HTTPS URL. Local .omc jars are dev-only.");
  console.log("3. Re-run this check with --publish-url <mrpack-path>=<signed-https-url>.");
}

function printUsage() {
  console.log(`Usage:
  npm.cmd run m1:readiness
  npm.cmd run m1:readiness -- --publish-url mods/local-room-client-connection-0.1.0-alpha.jar=<signed-https-artifact-url>

Options:
  --template <path>           Modrinth index template.
  --artifact-manifest <path>  Manifest from npm.cmd run m1:artifacts.
  --publish-url <entry>       Repeatable <mrpack-path>=<signed-https-url> entry.
  --json                      Print machine-readable report.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[blocked] ${error.message}`);
    process.exitCode = 1;
  });
}
