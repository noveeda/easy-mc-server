#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyFirstPartyArtifactLocks,
  createFirstPartyArtifactLockFromFile,
  readMrpackTemplate,
  validateMrpackTemplate,
  writeMrpack
} from "../packages/modpack-builder/src/mrpack.mjs";

const defaults = Object.freeze({
  templatePath: "packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json"
});

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.outputPath || args.artifacts.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const firstPartyArtifacts = [];
  for (const artifact of args.artifacts) {
    firstPartyArtifacts.push(await createFirstPartyArtifactLockFromFile({
      path: artifact.mrpackPath,
      artifactPath: artifact.localJarPath,
      downloadUrl: artifact.downloadUrl
    }));
  }

  const template = await readMrpackTemplate(args.templatePath);
  const completed = applyFirstPartyArtifactLocks(template, firstPartyArtifacts);
  const readiness = validateMrpackTemplate(completed, { firstPartyArtifacts });

  if (!readiness.ok) {
    for (const blocker of readiness.blockers) {
      console.error(`[blocked] ${blocker.path}: ${blocker.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const outputPath = resolve(args.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  const result = await writeMrpack(completed, outputPath, { firstPartyArtifacts });
  if (!result.ok) {
    console.error(`[blocked] ${result.failure.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Wrote private .mrpack: ${result.outputPath}`);
  console.log(`Files: ${result.fileCount}`);
  console.log("Manual blocker remains: import this .mrpack in Modrinth App and reach Minecraft approval waiting before marking M1 complete.");
  console.log("The local jar path was used only to compute pinned hashes; friends must download from the signed HTTPS URL.");
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    templatePath: defaults.templatePath,
    outputPath: null,
    artifacts: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--template") {
      parsed.templatePath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--output") {
      parsed.outputPath = requireValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--artifact") {
      parsed.artifacts.push(parseArtifact(requireValue(argv, index, arg)));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function parseArtifact(value) {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("--artifact must use <mrpack-path>=<local-jar-path>,<https-download-url>");
  }

  const mrpackPath = value.slice(0, separatorIndex);
  const rest = value.slice(separatorIndex + 1);
  const commaIndex = rest.lastIndexOf(",");

  if (commaIndex <= 0 || commaIndex === rest.length - 1) {
    throw new Error("--artifact must include both a local jar path and HTTPS download URL.");
  }

  return {
    mrpackPath,
    localJarPath: rest.slice(0, commaIndex),
    downloadUrl: rest.slice(commaIndex + 1)
  };
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printUsage() {
  console.log(`Usage:
  node scripts/build-private-mrpack.mjs \\
    --output dist/private-room.mrpack \\
    --artifact mods/local-room-client-connection-0.1.0-alpha.jar=<signed-client-jar-path>,<signed-https-artifact-url>

Options:
  --template <path>   Modrinth index template. Defaults to the fixed M1 MVP-0 template.
  --output <path>     Output .mrpack path.
  --artifact <spec>   Repeatable <mrpack-path>=<local-jar-path>,<https-download-url> entry.
`);
}

main().catch((error) => {
  console.error(`[blocked] ${error.message}`);
  process.exitCode = 1;
});
