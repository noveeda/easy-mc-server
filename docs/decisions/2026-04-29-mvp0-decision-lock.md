---
title: "MVP-0 Decision Lock"
type: decision
status: accepted
date: 2026-04-29
source_plan: "../plans/2026-04-29-001-feature-local-minecraft-room-plan.md"
source_milestones: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# MVP-0 Decision Lock

This document closes the inputs required before starting MVP-0 implementation for the Local Minecraft Mod Room project.

## Decisions

| Area | Decision |
|---|---|
| Initial supported Minecraft version | `1.21.1` only for MVP-0 closed alpha |
| Loader | Fabric only |
| Fabric Loader version | Select the latest stable Fabric Loader compatible with the selected Minecraft version at pack/server generation time, then lock the resolved version into the generated room manifest |
| Java runtime | Java 21 required for `1.21.1`; use an existing compatible runtime when present and prompt installation only when none is available |
| Initial fixed pack count | One fixed verified pack for MVP-0 |
| Initial fixed pack name | `mvp0-performance-room-1.21.1` |
| Connection transport | Relay-only for MVP-0; direct P2P remains deferred |
| Room size | 10 total players including the host |
| Mod distribution | Do not rehost third-party mod files; reference original allowed download URLs plus pinned hashes |
| Connection mod distribution | Signed HTTPS release artifact referenced by generated `.mrpack`; public Modrinth publishing deferred |

## Initial Fixed Pack

`mvp0-performance-room-1.21.1` is a conservative performance-focused pack intended to validate the local room and friend join loop without adding content-mod complexity.

| Mod | Source | Environment | License | MVP-0 role |
|---|---|---|---|---|
| Fabric API | `https://modrinth.com/mod/fabric-api` | Client and server | Apache-2.0 | Common Fabric compatibility baseline |
| Lithium | `https://modrinth.com/mod/lithium` | Client and server | LGPL-3.0-only | Game-logic performance optimization |
| FerriteCore | `https://modrinth.com/mod/ferrite-core` | Client and server | MIT | Memory usage optimization |
| Local room client connection mod | First-party alpha artifact | Client | Project-defined | Friend room connection |
| Local room server bridge mod | First-party alpha artifact | Server | Project-defined | Approval and room state bridge |

MVP-0 deliberately excludes higher-risk or less necessary mods such as networking-stack optimizers, content mods, world-generation mods, voice chat, shaders, and minimaps. Those can be reconsidered after the room loop is validated.

## Alpha Relay Limits

The closed-alpha relay defaults are accepted as the initial implementation values:

- One active room per host account/device.
- Up to 9 invited friends, 10 total players including the host.
- Six-hour room session.
- 20-minute idle timeout when no approved friends are connected.
- 25 GB soft warning and 40 GB hard cap per room session.
- 150 GB monthly relay cap per host during closed alpha.
- 24-hour invite expiry unless the host regenerates the invite.
- Approval requests rate-limited by invite, IP/device signal, and Minecraft identity signal.
- At the hard cap, block new joins, show a room-language warning, allow a short grace period, then close the relay session fail-closed.
- No public discovery; invite pages are `noindex`.

## Policy Defaults

- Public app surfaces, invite pages, and release notes must state that the app is not an official Minecraft, Mojang, or Microsoft product and is not endorsed by them.
- MVP-0 generated packs must not rehost third-party mod files through the app service.
- Recommended packs may include only mods with source, license, and redistribution/use conditions recorded.
- Generated `.mrpack` files must reference original allowed download URLs with pinned SHA1/SHA512 hashes and file sizes.
- First-party connection artifacts must be signed, immutable by version, revocable, and rollback-ready.

## Implementation Notes

- The app can expose Minecraft version choice only within the app-supported list. MVP-0 starts with one supported version, so the UI may show it as the default locked alpha option.
- Fabric Loader should not be a user-facing choice. Resolve it from Fabric metadata and persist the exact resolved version in generated room artifacts.
- Java should not be presented as a setup step unless a compatible runtime is missing.
- Pack builder work in M1/M2 must pin exact Modrinth file versions for the selected Minecraft version before generating the first `.mrpack`.

## References

- [Fabric install documentation](https://wiki.fabricmc.net/install)
- [Fabric API on Modrinth](https://modrinth.com/mod/fabric-api)
- [Lithium on Modrinth](https://modrinth.com/mod/lithium)
- [FerriteCore on Modrinth](https://modrinth.com/mod/ferrite-core)
