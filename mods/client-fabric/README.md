# Client Fabric Mod

Client mod implementation starts after M2 protocol and control-plane contracts are stable.

The mod will use the invite/session protocol to show approval waiting states and connect through the approved room connection path.

## M4 Client Loopback Contract

`src/connection/loopback-plan.mjs` is the executable client-side connection contract for the later Fabric mod.

The client connects Minecraft to `127.0.0.1` and lets the mod-owned loopback proxy connect to the approved relay session. Diagnostic output must redact invite, session, and relay tokens before it can be logged or sent to support.
