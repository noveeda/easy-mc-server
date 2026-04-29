# Server Bridge Fabric Mod

This directory currently contains the dependency-free M3 server bridge contract plus a minimal Fabric metadata/Java entrypoint skeleton before the full Fabric Java/Kotlin implementation.

`src/server-bridge.mjs` models the bridge behavior that the Fabric mod must preserve:

1. Use the server-observed authenticated Minecraft UUID for approval.
2. Treat claimed client identity as display context only.
3. Persist approved UUIDs into the room `whitelist.json` payload.
4. Return clear in-game messages for pending, denied, blocked, and control-plane outage states.
5. Let previously approved players join during a temporary control-plane outage while denying new players until approval can be checked.
6. Report bridge health events for the desktop host app.

The future Fabric mod should be a thin adapter around these contracts: read join events from Minecraft/Fabric, call this state model, write the whitelist payload, and emit health/approval events to the desktop runtime.
