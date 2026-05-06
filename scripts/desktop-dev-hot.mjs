import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

const port = Number(process.env.EASY_MC_HOT_RELOAD_PORT ?? 39411);
const host = "127.0.0.1";
const desktopRoot = resolve("apps", "desktop");
const devUrl = `http://${host}:${port}/index.html`;
const reloadDebounceMs = Number(process.env.EASY_MC_HOT_RELOAD_DEBOUNCE_MS ?? 250);
const frontendFiles = [
  "index.html",
  "styles.css",
  "bridge.js",
  "state.js",
  "app.js",
  "dev-hot-reload.js"
];
const backendWatchTargets = [
  { label: "Tauri source", path: join(desktopRoot, "src-tauri", "src"), recursive: true },
  { label: "Tauri config", path: join(desktopRoot, "src-tauri", "tauri.conf.json"), recursive: false },
  { label: "Tauri Cargo", path: join(desktopRoot, "src-tauri", "Cargo.toml"), recursive: false },
  { label: "Node runtime", path: join(desktopRoot, "src", "runtime"), recursive: true }
];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"]
]);

let version = Date.now();
let reloadTimer = null;
let cargoChild = null;
let cargoRestartTimer = null;
let restartingCargo = false;
let shuttingDown = false;
let devServerClosed = false;

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");

  const url = new URL(request.url ?? "/", devUrl);
  if (url.pathname === "/easy-mc-hot-reload") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ app: "easy-mc-desktop", version }));
    return;
  }

  const filePath = safeFrontendPath(url.pathname);
  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    const body = await readFrontendFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await listen(server, port, host);
const watchers = frontendFiles.map((file) => {
  const path = join(desktopRoot, file);
  return watch(path, { persistent: true }, () => scheduleReload(file));
});
watchers.push(...createBackendWatchers());

console.log(`[desktop:dev] hot reload server: ${devUrl}`);
console.log("[desktop:dev] watching apps/desktop HTML/CSS/JS files");
console.log("[desktop:dev] watching Tauri and runtime backend files; backend changes restart the desktop app");

const cargo = resolveCargo();
const cargoArgs = [
  "run",
  "--manifest-path",
  "apps/desktop/src-tauri/Cargo.toml",
  "--locked",
  ...defaultTargetDirArgs()
];
startCargo();

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

function safeFrontendPath(pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const relativePath = normalize(decoded).replace(/^[/\\]+/, "");
  if (!frontendFiles.includes(relativePath)) {
    return null;
  }

  const filePath = resolve(desktopRoot, relativePath);
  const relation = relative(desktopRoot, filePath);
  if (relation.startsWith("..") || relation.includes(`..${sep}`)) {
    return null;
  }

  return filePath;
}

async function readFrontendFile(filePath) {
  const body = await readFile(filePath);
  if (filePath !== resolve(desktopRoot, "index.html")) {
    return body;
  }

  return Buffer.from(
    String(body).replace(
      "</body>",
      '    <script src="./dev-hot-reload.js"></script>\n  </body>'
    ),
    "utf8"
  );
}

function scheduleReload(file) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    const readable = await waitForReadableFrontendFile(file);
    if (!readable) {
      console.warn(`[desktop:dev] reload skipped; ${file} was not readable after save debounce`);
      return;
    }

    version = Date.now();
    console.log(`[desktop:dev] reload queued: ${file}`);
  }, reloadDebounceMs);
}

function createBackendWatchers() {
  const backendWatchers = [];

  for (const target of backendWatchTargets) {
    try {
      backendWatchers.push(watch(target.path, {
        persistent: true,
        recursive: target.recursive
      }, (_eventType, fileName) => {
        scheduleCargoRestart(`${target.label}${fileName ? `/${fileName}` : ""}`);
      }));
    } catch (error) {
      console.warn(`[desktop:dev] backend watch disabled for ${target.label}: ${error.message}`);
    }
  }

  return backendWatchers;
}

function scheduleCargoRestart(reason) {
  if (shuttingDown) {
    return;
  }

  clearTimeout(cargoRestartTimer);
  cargoRestartTimer = setTimeout(() => restartCargo(reason), 500);
}

function restartCargo(reason) {
  if (shuttingDown) {
    return;
  }

  console.log(`[desktop:dev] backend changed; restarting desktop app (${reason})`);
  restartingCargo = true;

  if (!cargoChild) {
    restartingCargo = false;
    startCargo();
    return;
  }

  cargoChild.kill();
}

async function waitForReadableFrontendFile(file) {
  const path = join(desktopRoot, file);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await readFile(path);
      return true;
    } catch {
      await delay(75);
    }
  }

  return false;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function listen(httpServer, listenPort, listenHost) {
  return new Promise((resolveListen, rejectListen) => {
    httpServer.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        rejectListen(new Error(`Hot reload port ${listenPort} is already in use. Close the previous desktop:dev process first.`));
        return;
      }

      rejectListen(error);
    });
    httpServer.listen(listenPort, listenHost, resolveListen);
  });
}

function resolveCargo() {
  const explicit = process.env.CARGO;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const rustupCargo = join(userProfile, ".cargo", "bin", "cargo.exe");
    if (existsSync(rustupCargo)) {
      return rustupCargo;
    }
  }

  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

function defaultTargetDirArgs() {
  if (process.env.CARGO_TARGET_DIR) {
    return [];
  }

  return ["--target-dir", resolve(".local", "desktop-cargo-target")];
}

function startCargo() {
  const child = spawn(cargo, cargoArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EASY_MC_HOT_RELOAD_PORT: String(port),
      TAURI_CONFIG: tauriConfigWithDevUrl(devUrl)
    },
    stdio: "inherit",
    windowsHide: false
  });

  cargoChild = child;

  child.on("exit", (code, signal) => {
    if (cargoChild === child) {
      cargoChild = null;
    }

    if (restartingCargo && !shuttingDown) {
      restartingCargo = false;
      startCargo();
      return;
    }

    closeDevServer();
    if (signal) {
      console.error(`desktop dev stopped by ${signal}`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code ?? 1;
  });

  child.on("error", (error) => {
    console.error(`desktop dev could not start: ${error.message}`);
    console.error("Install Rust, or make sure cargo is available on PATH or at %USERPROFILE%\\.cargo\\bin\\cargo.exe.");
    shutdown(1);
  });
}

function tauriConfigWithDevUrl(url) {
  const base = safeJsonParse(process.env.TAURI_CONFIG) ?? {};
  return JSON.stringify({
    ...base,
    build: {
      ...(base.build ?? {}),
      devUrl: url
    }
  });
}

function safeJsonParse(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimeout(cargoRestartTimer);
  cargoChild?.kill();
  closeDevServer();
  process.exitCode = exitCode;
}

function closeDevServer() {
  if (devServerClosed) {
    return;
  }

  devServerClosed = true;
  for (const watcher of watchers) {
    watcher.close();
  }

  server.close(() => {});
}
