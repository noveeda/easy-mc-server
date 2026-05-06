import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { validateFirstPartyArtifactJarBytes } from '../packages/modpack-builder/src/mrpack.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, '.omc', 'artifacts', 'fabric-mods');
const buildRoot = path.join(repoRoot, '.omc', 'build', 'fabric-mods');
const fixedJarDate = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : '2026-01-01T00:00:00Z';

const modules = [
  {
    name: 'client-fabric',
    root: path.join(repoRoot, 'mods', 'client-fabric'),
    mrpackPath: 'mods/local-room-client-connection-0.1.0-alpha.jar',
    entrypointKey: 'client',
    entrypointClass: 'com.easymc.room.client.LocalRoomClientMod',
    entrypointInterface: 'net.fabricmc.api.ClientModInitializer',
    entrypointMethod: 'onInitializeClient'
  },
  {
    name: 'server-bridge-fabric',
    root: path.join(repoRoot, 'mods', 'server-bridge-fabric'),
    mrpackPath: 'mods/local-room-server-bridge-0.1.0-alpha.jar',
    entrypointKey: 'server',
    entrypointClass: 'com.easymc.room.server.LocalRoomServerBridgeMod',
    entrypointInterface: 'net.fabricmc.api.DedicatedServerModInitializer',
    entrypointMethod: 'onInitializeServer'
  }
];

async function main() {
  console.log('[dev-only] Building local first-party Fabric verification jars.');
  console.log('[dev-only] These jars are not signed public release artifacts and are not friend-install artifacts.');

  const artifacts = [];
  const fabricApiStubClassesDir = await prepareFabricApiStubs();

  for (const module of modules) {
    artifacts.push(await buildModule(module, { fabricApiStubClassesDir }));
  }

  await writeArtifactManifest(artifacts);
  console.log('[blocked] M1 friend import still requires publishing the client jar to a signed public HTTPS URL.');
}

async function buildModule(module, { fabricApiStubClassesDir }) {
  const metadataPath = path.join(module.root, 'src', 'main', 'resources', 'fabric.mod.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assertFabricMetadataEntrypoint({ module, metadata });
  const javaRoot = path.join(module.root, 'src', 'main', 'java');
  const resourcesRoot = path.join(module.root, 'src', 'main', 'resources');
  const classesDir = path.join(buildRoot, module.name, 'classes');
  const jarPath = path.join(outputRoot, `${metadata.id}-${metadata.version}.jar`);
  const javaSources = listFiles(javaRoot, '.java');
  const resourceFiles = listFiles(resourcesRoot);

  if (javaSources.length === 0) {
    throw new Error(`${module.name} has no Java sources under ${javaRoot}`);
  }

  await recreateDirectory(classesDir);
  await mkdir(outputRoot, { recursive: true });

  run('javac', [
    '--release',
    '21',
    '-encoding',
    'UTF-8',
    '-cp',
    fabricApiStubClassesDir,
    '-d',
    classesDir,
    ...javaSources.map((file) => path.join(javaRoot, file))
  ]);

  const classFiles = listFiles(classesDir, '.class');
  if (classFiles.length === 0) {
    throw new Error(`${module.name} produced no class files`);
  }
  await assertCompiledEntrypointContract({ module, classesDir });

  await rm(jarPath, { force: true });

  run('jar', [
    '--create',
    '--file',
    jarPath,
    '--no-manifest',
    '--no-compress',
    `--date=${fixedJarDate}`,
    ...jarEntries(classesDir, classFiles),
    ...jarEntries(resourcesRoot, resourceFiles)
  ]);

  const artifact = await describeArtifact({ module, metadata, jarPath });
  console.log(`${module.name}: ${artifact.artifactPath} (${artifact.fileSize} bytes, sha1 ${artifact.hashes.sha1})`);

  return artifact;
}

function assertFabricMetadataEntrypoint({ module, metadata }) {
  const entrypoints = metadata?.entrypoints?.[module.entrypointKey];

  if (!Array.isArray(entrypoints) || entrypoints.length !== 1 || entrypoints[0] !== module.entrypointClass) {
    throw new Error(`${module.name} fabric.mod.json must point ${module.entrypointKey} to ${module.entrypointClass}`);
  }
}

async function prepareFabricApiStubs() {
  const sourceRoot = path.join(buildRoot, 'fabric-api-stubs', 'src');
  const classesDir = path.join(buildRoot, 'fabric-api-stubs', 'classes');
  const stubs = [
    {
      relativePath: path.join('net', 'fabricmc', 'api', 'ClientModInitializer.java'),
      contents: [
        'package net.fabricmc.api;',
        'public interface ClientModInitializer {',
        '  void onInitializeClient();',
        '}',
        ''
      ].join('\n')
    },
    {
      relativePath: path.join('net', 'fabricmc', 'api', 'DedicatedServerModInitializer.java'),
      contents: [
        'package net.fabricmc.api;',
        'public interface DedicatedServerModInitializer {',
        '  void onInitializeServer();',
        '}',
        ''
      ].join('\n')
    }
  ];

  await recreateDirectory(sourceRoot);
  await recreateDirectory(classesDir);

  for (const stub of stubs) {
    const stubPath = path.join(sourceRoot, stub.relativePath);
    await mkdir(path.dirname(stubPath), { recursive: true });
    await writeFile(stubPath, stub.contents);
  }

  run('javac', [
    '--release',
    '21',
    '-encoding',
    'UTF-8',
    '-d',
    classesDir,
    ...stubs.map((stub) => path.join(sourceRoot, stub.relativePath))
  ]);

  return classesDir;
}

async function assertCompiledEntrypointContract({ module, classesDir }) {
  const classPath = path.join(classesDir, ...module.entrypointClass.split('.')) + '.class';
  const classInfo = parseClassFile(await readFile(classPath));
  const expectedInterface = module.entrypointInterface.replaceAll('.', '/');

  if (!classInfo.interfaces.includes(expectedInterface)) {
    throw new Error(`${module.name} entrypoint must implement ${module.entrypointInterface}`);
  }

  if (!classInfo.methods.some((method) => method.name === module.entrypointMethod && method.descriptor === '()V')) {
    throw new Error(`${module.name} entrypoint must declare ${module.entrypointMethod}()`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function listFiles(root, extension) {
  const files = [];

  visit(root);

  return files.sort((a, b) => a.localeCompare(b, 'en'));

  function visit(current) {
    for (const entry of readdirSync(current).sort((a, b) => a.localeCompare(b, 'en'))) {
      const absolute = path.join(current, entry);
      const stats = statSync(absolute);

      if (stats.isDirectory()) {
        visit(absolute);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      if (extension && path.extname(entry) !== extension) {
        continue;
      }

      files.push(path.relative(root, absolute));
    }
  }
}

function jarEntries(root, relativeFiles) {
  return relativeFiles.flatMap((file) => ['-C', root, file]);
}

function parseClassFile(bytes) {
  const buffer = Buffer.from(bytes);
  let offset = 0;

  const readU1 = () => buffer.readUInt8(offset++);
  const readU2 = () => {
    const value = buffer.readUInt16BE(offset);
    offset += 2;
    return value;
  };
  const readU4 = () => {
    const value = buffer.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const readBytes = (length) => {
    const value = buffer.subarray(offset, offset + length);
    offset += length;
    return value;
  };

  if (readU4() !== 0xcafebabe) {
    throw new Error('Entrypoint class file is not a valid Java class.');
  }

  readU2();
  readU2();
  const constantPoolCount = readU2();
  const constantPool = Array.from({ length: constantPoolCount });

  for (let index = 1; index < constantPoolCount; index += 1) {
    const tag = readU1();

    switch (tag) {
      case 1: {
        const length = readU2();
        constantPool[index] = { tag, value: readBytes(length).toString('utf8') };
        break;
      }
      case 3:
      case 4:
        offset += 4;
        break;
      case 5:
      case 6:
        offset += 8;
        index += 1;
        break;
      case 7:
      case 8:
      case 16:
      case 19:
      case 20:
        constantPool[index] = { tag, nameIndex: readU2() };
        break;
      case 9:
      case 10:
      case 11:
      case 12:
      case 17:
      case 18:
        offset += 4;
        break;
      case 15:
        offset += 3;
        break;
      default:
        throw new Error(`Unsupported Java constant pool tag: ${tag}`);
    }
  }

  readU2();
  readU2();
  readU2();
  const interfaces = [];
  const interfaceCount = readU2();

  for (let index = 0; index < interfaceCount; index += 1) {
    interfaces.push(resolveClassName(readU2()));
  }

  skipMembers();
  const methods = readMembers();

  return { interfaces, methods };

  function resolveClassName(classIndex) {
    const classEntry = constantPool[classIndex];
    const nameEntry = constantPool[classEntry?.nameIndex];
    return nameEntry?.value ?? '';
  }

  function readMembers() {
    const members = [];
    const count = readU2();

    for (let index = 0; index < count; index += 1) {
      readU2();
      const name = constantPool[readU2()]?.value ?? '';
      const descriptor = constantPool[readU2()]?.value ?? '';
      skipAttributes();
      members.push({ name, descriptor });
    }

    return members;
  }

  function skipMembers() {
    const count = readU2();

    for (let index = 0; index < count; index += 1) {
      readU2();
      readU2();
      readU2();
      skipAttributes();
    }
  }

  function skipAttributes() {
    const count = readU2();

    for (let index = 0; index < count; index += 1) {
      readU2();
      const length = readU4();
      offset += length;
    }
  }
}

async function recreateDirectory(target) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedTarget = path.resolve(target);

  if (!resolvedTarget.startsWith(`${resolvedRepoRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove a path outside the repository: ${target}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

async function describeArtifact({ module, metadata, jarPath }) {
  const bytes = await readFile(jarPath);
  const jarReadiness = validateFirstPartyArtifactJarBytes({
    path: module.mrpackPath,
    bytes
  });

  if (!jarReadiness.ok) {
    throw new Error(`${module.name} artifact is not a valid M1 jar: ${jarReadiness.message}`);
  }

  return {
    module: module.name,
    artifactKind: 'first_party_fabric_mod',
    releaseCandidate: true,
    modId: metadata.id,
    version: metadata.version,
    artifactPath: path.relative(repoRoot, jarPath),
    mrpackPath: module.mrpackPath,
    fileSize: bytes.byteLength,
    hashes: {
      sha1: createHash('sha1').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('hex')
    },
    publishUrl: null,
    publishState: 'pending_signed_https_release',
    modrinthImportState: 'not_run'
  };
}

async function writeArtifactManifest(artifacts) {
  const manifestPath = path.join(outputRoot, 'manifest.json');

  await writeFile(manifestPath, `${JSON.stringify({
    generatedBy: 'scripts/build-first-party-fabric-mods.mjs',
    sourceDate: fixedJarDate,
    artifacts
  }, null, 2)}\n`);

  console.log(`manifest: ${path.relative(repoRoot, manifestPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
