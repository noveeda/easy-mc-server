# Client Fabric Mod

Client mod implementation starts after M2 protocol and control-plane contracts are stable.

The mod will use the invite/session protocol to show approval waiting states and connect through the approved room connection path.

## M4 Client Loopback Contract

`src/connection/loopback-plan.mjs` is the executable client-side connection contract for the later Fabric mod.

The client connects Minecraft to `127.0.0.1:25565` and lets the mod-owned loopback proxy connect to the approved `relay.m4` session. The relay open frame carries the room, invite, friend, Minecraft UUID, session, and local Minecraft target binding while blocking arbitrary local TCP targets.

`createLocalEchoSimulation()` and `createDisconnectRetryPlan()` are executable contracts for friend-to-host stream delivery and bounded disconnect retry/failure state without opening sockets. Diagnostic output must redact invite, session, and relay tokens before it can be logged or sent to support.
