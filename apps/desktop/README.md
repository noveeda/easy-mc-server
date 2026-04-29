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

`src/runtime/host-runtime.mjs` is the executable M3 contract for later Tauri and Minecraft adapters. It is dependency-free and does not start Java, Fabric, or Minecraft directly.

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

Failures return room-language messages that the desktop UI can show directly. Bridge approval events must use the server-observed Minecraft UUID; a claimed identity from the client can be displayed for context but cannot approve or bypass the room queue.

Server and network terms should stay in advanced diagnostics. The main host flow should keep using room language.
