import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HostRuntimeStates, createHostRuntimePlan } from "./host-runtime.mjs";
import { createDesktopCuratedPackMods } from "./desktop-curated-catalog.mjs";

export const DESKTOP_DEV_ROOT_ENV = "EASY_MC_DESKTOP_DEV_ROOT";

const workspaceRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url))).replaceAll("\\", "/");
const FABRIC_LOADER_VERSION = "0.19.2";
const FABRIC_INSTALLER_VERSION = "1.1.1";
const FABRIC_INSTALLER_SHA256 = "2487a69dd6f9d9c2605265a7142d77c26ab62edc620e6bcf810d581d2ee31b79";
const FABRIC_SERVER_SHA256 = "00187ef8c7c402f028d897c285d42b326b2ae9c432bec9f1142ae0114b7208fa";

export async function createDesktopDevRuntimePlan(options = {}) {
  const appDataRoot = normalizePath(
    options.appDataRoot
      ?? process.env[DESKTOP_DEV_ROOT_ENV]
      ?? `${workspaceRoot}/.local/desktop-tauri-dev`
  );
  const roomId = options.roomId ?? "mvp0-room";
  const roomName = options.roomName ?? "MVP-0 Desktop Room";
  const minecraftVersion = options.minecraftVersion ?? "1.21.1";
  const catalogModId = options.catalogModId ?? "performance-core";
  const packId = options.packId ?? `mvp1-curated-${catalogModId}-1.21.1`;
  const downloadsDirectory = `${appDataRoot}/cache/downloads`;
  const mods = options.mods ?? (
    options.includePlaceholderMods === true
      ? await prepareDevModPlaceholders(appDataRoot)
      : createDesktopCuratedPackMods({
          selectionId: catalogModId,
          downloadsDirectory
        })
  );

  const runtime = createHostRuntimePlan({
    room: {
      id: roomId,
      hostId: options.hostId ?? "desktop-host",
      name: roomName,
      appDataRoot
    },
    minecraft: {
      version: minecraftVersion,
      supportedVersions: [{ version: "1.21.1", channel: "stable", javaMajor: 21 }]
    },
    java: {
      path: `${appDataRoot}/runtime/java/bin/java.exe`,
      majorVersion: 21,
      source: "desktop-dev-placeholder"
    },
    fabric: {
      loaderVersion: FABRIC_LOADER_VERSION,
      expectedInstallerSha256: FABRIC_INSTALLER_SHA256,
      installerSha256: FABRIC_INSTALLER_SHA256,
      loaders: [
        {
          minecraftVersion: "1.21.1",
          version: FABRIC_LOADER_VERSION,
          installerVersion: FABRIC_INSTALLER_VERSION,
          launcherJar: `fabric-server-1.21.1-${FABRIC_LOADER_VERSION}-${FABRIC_INSTALLER_VERSION}.jar`,
          installerSha256: FABRIC_INSTALLER_SHA256,
          serverJarSha256: FABRIC_SERVER_SHA256
        }
      ]
    },
    cache: { reuseVerifiedDownloads: true },
    eula: { accepted: true },
    serverProperties: {
      maxPlayers: 10,
      motd: roomName,
      port: 25565
    },
    pack: {
      id: packId,
      fixed: true,
      expectedSha256: "desktop-dev-pack-sha256",
      sha256: "desktop-dev-pack-sha256",
      mods
    },
    runtime: { state: HostRuntimeStates.STOPPED }
  });

  if (!runtime.ok) {
    throw new Error(runtime.failure?.message ?? "Desktop dev runtime plan could not be created.");
  }

  return runtime.plan;
}

async function prepareDevModPlaceholders(appDataRoot) {
  const downloads = `${appDataRoot}/cache/downloads`;
  await mkdir(toNativePath(downloads), { recursive: true });

  const mods = [
    {
      id: "fabric-api",
      fileName: "fabric-api-0.116.11-1.21.1.jar",
      sha256: "desktop-dev-fabric-api-sha256"
    },
    {
      id: "lithium",
      fileName: "lithium-fabric-0.15.3-mc1.21.1.jar",
      sha256: "desktop-dev-lithium-sha256"
    },
    {
      id: "ferritecore",
      fileName: "ferritecore-7.0.3-fabric.jar",
      sha256: "desktop-dev-ferritecore-sha256"
    }
  ];

  for (const mod of mods) {
    const source = `${downloads}/${mod.fileName}`;
    const contents = `Desktop dev placeholder for ${mod.id}\n`;
    const sha256 = createHash("sha256").update(contents).digest("hex");
    await writeFile(toNativePath(source), contents, "utf8");
    mod.source = source;
    mod.sha256 = sha256;
    mod.expectedSha256 = sha256;
  }

  return mods;
}

function normalizePath(path) {
  return String(path).replaceAll("\\", "/").replaceAll(/\/+/g, "/").replace(/^([A-Z]):\//i, "$1:/");
}

function toNativePath(path) {
  return process.platform === "win32" ? String(path).replaceAll("/", "\\") : path;
}
