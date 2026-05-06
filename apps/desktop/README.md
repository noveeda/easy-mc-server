# Desktop Host App

This is the desktop-first M3 host app for the local Minecraft room project. The static HTML preview is still useful for quick UI review, but the runnable desktop program path is the Tauri shell.

For the current Korean runnable developer preview guide, see `../../docs/usage/mvp0-local-preview.md`.

## Run The Desktop Program

From the repository root on Windows PowerShell:

```powershell
npm.cmd run desktop:dev
```

This opens the Tauri desktop window and loads the Korean host GUI through the local hot reload server. When you edit `apps/desktop/index.html`, `styles.css`, `bridge.js`, `state.js`, `app.js`, or `dev-hot-reload.js`, the open desktop window reloads automatically.

Use the plain Cargo-backed launcher only when debugging the hot reload wrapper itself:

```powershell
npm.cmd run desktop:dev:plain
```

The renderer calls registered Tauri commands, and the Rust command broker forwards those commands to the long-lived Node runtime command host.

Use these commands for verification:

```powershell
npm.cmd run desktop:check
npm.cmd run desktop:smoke
```

`desktop:check` verifies the Tauri/Rust compile path. `desktop:smoke` verifies the same Node command host used by Tauri can answer multiple runtime command frames without creating a fake invite link.

The current Tauri dev bridge requires Node.js to be available on `PATH`. If the app cannot find Node, set `EASY_MC_NODE_PATH` to the full `node.exe` path before launching:

```powershell
$env:EASY_MC_NODE_PATH = "C:\Program Files\nodejs\node.exe"
npm.cmd run desktop:dev
```

## Static Preview

Open `index.html` directly in a browser only to review the host flow. `state.js` contains the prototype state reducer so the flow can be checked without a browser test dependency:

1. Select the fixed supported Minecraft version.
2. Prepare the room.
3. Review the simulated room runtime plan.
4. Try to open the room and confirm the static preview shows the desktop-runtime blocker.
5. Confirm invite copy stays disabled until a real desktop runtime reports an open room.
6. Approve or deny the sample friend request.

The static preview must not create a dummy invite link. A real invite link can appear only after the Tauri shell, local runtime bridge, Java/Fabric server readiness, control-plane invite, and relay/session readiness are all complete.

## Product Boundary

The host desktop app is the primary product surface. Invite web pages are secondary helper surfaces for friends who receive a link.

Default UI should keep using room language and avoid explaining ports, firewall rules, Docker, VPN tools, or relay details.

## M3 Host Runtime Contract

`src/runtime/host-runtime.mjs` is the executable M3 contract for later Tauri and Minecraft adapters. `src/runtime/local-runtime-adapter.mjs` turns that validated room plan into concrete file materialization, Fabric download, and local process intents. `src/runtime/node-java-detection.mjs`, `src/runtime/node-fabric-bootstrap.mjs`, and `src/runtime/node-local-runtime.mjs` are the Node-side adapter layer for Java detection, checksum-gated Fabric server installation, local file materialization, and process lifecycle management. `src/runtime/desktop-runtime-bridge.mjs` composes those adapters into prepare/open/close/restart/status DTOs for the future Tauri command boundary. `bridge.js` lets the static browser prototype call future Tauri commands while using a safe blocked fallback under `file://`. `src/tunnel/host-tunnel.mjs` adds the M4 host-side room connection intent for the later relay adapter.

The contract covers:

1. App data directory layout under a room root plus shared cache folders.
2. Supported Minecraft version selection.
3. Stable Fabric loader and launcher jar resolution.
4. Windows Java detection adapter shape for Java 21 or newer.
5. Checksum-gated cache reuse, EULA write plan, `server.properties`, and fixed mod install plan.
6. Start, stop, and restart lifecycle simulation with no process launch.
7. Redacted log streaming for tokens, invites, email addresses, and UUIDs.
8. Room-language failure states.
9. Approval UI states that require a server-observed Minecraft UUID before host approval.
10. Local room materialization for EULA, `server.properties`, preserved `whitelist.json`, bridge config, runtime manifest, and fixed-pack mod copy operations.
11. Checksum-gated Fabric server download from Fabric Meta metadata.
12. Tauri process intents for start, stop, and restart.
13. Host tunnel intent that binds the active room to `127.0.0.1:25565`, closes when the local room stops, and shows room-language connection/quota states.
14. Node runtime adapters for Java 21 detection, approved Fabric Meta download, pinned SHA256 verification, process start/stop/restart, ready/crash log detection, timeout kill fallback, and redacted log events.
15. Desktop runtime bridge DTOs for prepare/open/close/restart/status and static GUI fallback states that do not fake a real room launch.

Failures return room-language messages that the desktop UI can show directly. Bridge approval events must use the server-observed Minecraft UUID; a claimed identity from the client can be displayed for context but cannot approve or bypass the room queue.

Server and network terms should stay in advanced diagnostics. The main host flow should keep using room language.
