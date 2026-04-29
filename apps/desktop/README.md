# Desktop Host Prototype

This is the desktop-first M1 prototype for the local Minecraft room app. It is intentionally a static Tauri-ready frontend shell, not the final packaged Windows app.

Open `index.html` directly in a browser to review the host flow. `state.js` contains the prototype state reducer so the flow can be checked without a browser test dependency:

1. Select the fixed supported Minecraft version.
2. Prepare the room.
3. Open the room.
4. Copy the generated invite.
5. Approve or deny the sample friend request.

## Product Boundary

The host desktop app is the primary product surface. Invite web pages are secondary helper surfaces for friends who receive a link.

Default UI should keep using room language and avoid explaining ports, firewall rules, Docker, VPN tools, or relay details.

## M3 Host Runtime Contract

`src/runtime/host-runtime.mjs` is the executable M3 contract for later Tauri and Minecraft adapters. It is dependency-free and does not start Java or Fabric directly.

The contract requires:

1. A supported Minecraft version.
2. Java 21 or newer.
3. Accepted Minecraft EULA.
4. Verified Fabric setup files.
5. A fixed, checksum-verified room pack.
6. A non-crashed runtime state.

Failures return room-language messages that the desktop UI can show directly. Bridge approval events must use the server-observed Minecraft UUID; a claimed identity from the client can be displayed for context but cannot approve or bypass the room queue.
