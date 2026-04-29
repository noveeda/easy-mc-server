# Desktop Host Prototype

This is the desktop-first M3 prototype for the local Minecraft room app. It is intentionally a static Tauri-ready frontend shell, not the final packaged Windows app.

Open `index.html` directly in a browser to review the host flow. `state.js` contains the prototype state reducer so the flow can be checked without a browser test dependency:

1. Select the fixed supported Minecraft version.
2. Prepare the room.
3. Review the simulated room runtime plan.
4. Open the room.
5. Copy the generated invite.
6. Approve or deny the sample friend request.

## Product Boundary

The host desktop app is the primary product surface. Invite web pages are secondary helper surfaces for friends who receive a link.

Default UI should keep using room language and avoid explaining ports, firewall rules, Docker, VPN tools, or relay details.

## M3 Host Runtime Contract

`src/runtime/host-runtime.mjs` is the executable M3 contract for later Tauri and Minecraft adapters. `src/runtime/local-runtime-adapter.mjs` turns that validated room plan into concrete file materialization, Fabric download, and local process intents. `src/tunnel/host-tunnel.mjs` adds the M4 host-side room connection intent for the later relay adapter. These modules are dependency-free and do not start Java, Fabric, Minecraft, or network sockets directly.

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

Failures return room-language messages that the desktop UI can show directly. Bridge approval events must use the server-observed Minecraft UUID; a claimed identity from the client can be displayed for context but cannot approve or bypass the room queue.

Server and network terms should stay in advanced diagnostics. The main host flow should keep using room language.
