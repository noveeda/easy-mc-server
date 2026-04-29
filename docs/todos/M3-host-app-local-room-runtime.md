---
title: "M3 Host App Local Room Runtime TODO"
type: todo
status: in_progress
milestone: M3
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M3 Host App And Local Room Runtime TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Source units:** U4 Server Bootstrap And Desktop Host App, U5 Fabric Server Bridge Mod

## Goal

Let the host create and run a local Fabric room from the Windows desktop app without learning Java, Fabric Loader, EULA files, logs, firewall, or server process details.

## Start Conditions

- [ ] M2 control-plane contracts are stable enough for room/invite/approval/session integration.
- [ ] M1 fixed pack metadata is available for Minecraft `1.21.1`.
- [ ] The first-party client connection mod artifact policy is ready enough to reference from local packs.

## Executable Contract Progress

- [x] Host runtime contract validates supported Minecraft version, compatible Java, EULA, Fabric checksum, fixed pack, and crash state.
- [x] Host runtime contract produces a room file plan without starting a real process.
- [x] Failure states return room-language recovery messages.
- [x] Server bridge approval event contract uses server-observed Minecraft UUID.
- [x] Claimed client identity cannot bypass server-observed UUID approval.

## Desktop Runtime TODO

- [ ] Create the real desktop app shell from the existing `apps/desktop/` prototype.
- [ ] Keep the default UI in room language, not server/network language.
- [ ] Add app data directory layout for downloads, cache, generated room files, logs, and support bundles.
- [ ] Add supported Minecraft version selection from the app-owned list.
- [ ] Add stable Fabric Loader resolution for the selected Minecraft version.
- [ ] Detect compatible Java runtimes on Windows.
- [ ] Apply the Java compatibility rule for the selected Minecraft version.
- [ ] Prompt Java installation only when no compatible runtime exists.
- [ ] Download Fabric server artifacts from known sources.
- [ ] Verify Fabric/server artifact checksums before use.
- [ ] Cache verified downloads with immutable version metadata.
- [ ] Generate local room folder structure.
- [ ] Persist EULA consent from the GUI before server start.
- [ ] Generate `server.properties` from room-safe defaults.
- [ ] Install the selected fixed pack into the local room folder.
- [ ] Start, stop, and restart the local Fabric server process.
- [ ] Stream redacted server logs to the host UI.
- [ ] Detect crash, offline download, checksum failure, missing Java, and incompatible Java states.
- [ ] Show room-language recovery actions for each failure state.

## Approval UI TODO

- [ ] Add pending approval queue UI backed by M2 approval contracts.
- [ ] Support approve, deny, and block actions.
- [ ] Show expired, host unavailable, already allowed, and identity changed states.
- [ ] Avoid showing credentials, raw invite tokens, IPs, or internal session ids.
- [ ] Keep advanced diagnostics separate from the default host flow.

## Fabric Server Bridge TODO

- [ ] Add Fabric server bridge mod skeleton for the supported Minecraft/Fabric version.
- [ ] Capture server-observed authenticated Minecraft UUID on join.
- [ ] Prevent claimed client identity from bypassing server-observed UUID.
- [ ] Emit pending approval events for unapproved UUIDs.
- [ ] Persist approved UUIDs to the room allowlist.
- [ ] Handle denied and blocked UUIDs with clear in-game messages.
- [ ] Define behavior during temporary control-plane outage for previously approved players.
- [ ] Report local room health to the desktop app.

## Completion Gate

- [ ] Selected Minecraft version and fixed pack create room files.
- [ ] Local Fabric server starts from the Windows desktop app.
- [ ] Missing Java, offline download failure, checksum failure, and crash states show recoverable UI.
- [ ] EULA consent is required and persisted before start.
- [ ] Server bridge emits approval events based on server-observed authenticated Minecraft UUID.
- [ ] Default host UI avoids server/network terminology except in advanced diagnostics.

## Validation

- [ ] Desktop runtime unit tests for Java detection and version compatibility.
- [ ] Desktop runtime tests for cache layout, checksum failure, and EULA behavior.
- [ ] Server lifecycle test for start/stop/crash handling.
- [ ] Approval UI tests for pending, approved, denied, blocked, expired, already allowed, and identity changed states.
- [ ] Server bridge unit or gametest coverage for UUID confirmation and allowlist behavior.
- [ ] Manual Windows run from room creation to local server start.

## Stop Or Pivot

- Stop if Java/Fabric bootstrap is unreliable for the selected version and fixed pack.
- Stop if the bridge cannot reliably distinguish claimed client identity from authenticated server-observed UUID.
- Pivot if the desktop app cannot make local room creation feel simpler than manual Minecraft setup.
