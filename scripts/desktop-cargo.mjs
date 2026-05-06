import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const task = process.argv[2] ?? "check";
const extraArgs = process.argv.slice(3);
const cargo = resolveCargo();
const cargoArgs = [
  task,
  "--manifest-path",
  "apps/desktop/src-tauri/Cargo.toml",
  "--locked",
  ...defaultTargetDirArgs(extraArgs),
  ...extraArgs
];

const child = spawn(cargo, cargoArgs, {
  cwd: process.cwd(),
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`cargo ${task} stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(`cargo ${task} could not start: ${error.message}`);
  console.error("Install Rust, or make sure cargo is available on PATH or at %USERPROFILE%\\.cargo\\bin\\cargo.exe.");
  process.exitCode = 1;
});

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

function defaultTargetDirArgs(extraArgs) {
  if (process.env.CARGO_TARGET_DIR || extraArgs.includes("--target-dir")) {
    return [];
  }

  return ["--target-dir", resolve(".local", "desktop-cargo-target")];
}
