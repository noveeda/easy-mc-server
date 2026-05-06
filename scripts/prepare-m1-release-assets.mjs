#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateFirstPartyArtifactJarBytes } from "../packages/modpack-builder/src/mrpack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = Object.freeze({
  artifactManifestPath: ".omc/artifacts/fabric-mods/manifest.json",
  outputDirectory: "dist/m1-release",
  repository: "noveeda/easy-mc-server"
});

const releaseArtifacts = Object.freeze([
  Object.freeze({
    mrpackPath: "mods/local-room-client-connection-0.1.0-alpha.jar",
    releaseFileName: "local-room-client-connection-0.1.0-alpha.jar",
    role: "friend-client"
  })
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const result = await prepareM1ReleaseAssets(args);
  printResult(result);
}

export async function prepareM1ReleaseAssets(options = {}) {
  const artifactManifestPath = resolveFromRepo(options.artifactManifestPath ?? defaults.artifactManifestPath);
  const outputDirectory = resolveFromRepo(options.outputDirectory ?? defaults.outputDirectory);
  const repository = options.repository ?? defaults.repository;
  const tag = options.tag ?? null;

  if (tag) {
    validateReleaseTag(tag);
  }

  const manifest = JSON.parse(await readFile(artifactManifestPath, "utf8"));
  const assets = [];

  await mkdir(outputDirectory, { recursive: true });

  for (const releaseArtifact of releaseArtifacts) {
    const artifact = findManifestArtifact(manifest, releaseArtifact.mrpackPath);
    if (!artifact) {
      throw new Error(`Missing release artifact in manifest: ${releaseArtifact.mrpackPath}`);
    }

    const sourcePath = resolveFromRepo(artifact.artifactPath);
    const bytes = await readFile(sourcePath);
    const jarReadiness = validateFirstPartyArtifactJarBytes({
      path: releaseArtifact.mrpackPath,
      bytes
    });

    if (!jarReadiness.ok) {
      throw new Error(`${releaseArtifact.mrpackPath} is not a valid first-party jar: ${jarReadiness.message}`);
    }

    const hashes = {
      sha1: createHash("sha1").update(bytes).digest("hex"),
      sha512: createHash("sha512").update(bytes).digest("hex")
    };

    if (artifact.fileSize !== bytes.byteLength || artifact.hashes?.sha1 !== hashes.sha1 || artifact.hashes?.sha512 !== hashes.sha512) {
      throw new Error(`${releaseArtifact.mrpackPath} does not match the local artifact manifest hashes.`);
    }

    const outputPath = resolve(outputDirectory, releaseArtifact.releaseFileName);
    await copyFile(sourcePath, outputPath);
    assets.push({
      role: releaseArtifact.role,
      mrpackPath: releaseArtifact.mrpackPath,
      releaseFileName: releaseArtifact.releaseFileName,
      localPath: outputPath,
      fileSize: bytes.byteLength,
      hashes,
      publishUrl: tag ? githubReleaseAssetUrl({ repository, tag, fileName: releaseArtifact.releaseFileName }) : null
    });
  }

  const releaseManifest = {
    generatedBy: "scripts/prepare-m1-release-assets.mjs",
    sourceManifest: artifactManifestPath,
    repository,
    tag,
    assets,
    status: tag ? "release_assets_prepared_with_expected_public_urls" : "release_assets_prepared_without_publish_urls",
    note: "Prepared files are not published until they are uploaded to a real GitHub Release or another signed public HTTPS host."
  };
  const releaseManifestPath = resolve(outputDirectory, "m1-release-manifest.json");

  await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);

  return {
    ok: true,
    outputDirectory,
    releaseManifestPath,
    assets
  };
}

function findManifestArtifact(manifest = {}, mrpackPath) {
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  return artifacts.find((artifact) => artifact?.mrpackPath === mrpackPath);
}

function githubReleaseAssetUrl({ repository, tag, fileName }) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

function validateReleaseTag(tag) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(tag)) {
    throw new Error("Release tag must be 1-80 characters and contain only letters, numbers, dots, underscores, or hyphens.");
  }
}

function resolveFromRepo(path) {
  return resolve(repoRoot, path);
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    artifactManifestPath: defaults.artifactManifestPath,
    outputDirectory: defaults.outputDirectory,
    repository: defaults.repository,
    tag: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--artifact-manifest") {
      parsed.artifactManifestPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--output") {
      parsed.outputDirectory = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--repository") {
      parsed.repository = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--tag") {
      parsed.tag = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printResult(result) {
  console.log(`[ready] Prepared M1 release assets: ${result.outputDirectory}`);
  console.log(`Manifest: ${result.releaseManifestPath}`);

  for (const asset of result.assets) {
    console.log(`- ${asset.releaseFileName}: ${asset.fileSize} bytes, sha1 ${asset.hashes.sha1}`);
    if (asset.publishUrl) {
      console.log(`  expected URL after upload: ${asset.publishUrl}`);
    }
  }

  console.log("Next: upload these exact files to a real public HTTPS release, then run m1:readiness with the published URL.");
}

function printUsage() {
  console.log(`Usage:
  npm.cmd run m1:release-assets -- --tag m1-first-party-0.1.0-alpha

Options:
  --artifact-manifest <path>  Manifest from npm.cmd run m1:artifacts.
  --output <path>             Directory for release assets. Defaults to dist/m1-release.
  --repository <owner/repo>    GitHub repository for expected URLs. Defaults to ${defaults.repository}.
  --tag <tag>                 Optional GitHub Release tag used to print expected public URLs.
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[blocked] ${error.message}`);
    process.exitCode = 1;
  });
}
