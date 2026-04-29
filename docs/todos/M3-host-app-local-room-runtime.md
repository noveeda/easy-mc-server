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

- [x] M2 control-plane contracts are stable enough for room/invite/approval/session integration.
- [x] M1 fixed pack metadata is available for Minecraft `1.21.1`.
- [ ] The first-party client connection mod artifact policy is ready enough to reference from local packs.

## Executable Contract Progress

- [x] Host runtime contract validates supported Minecraft version, compatible Java, EULA, Fabric checksum, fixed pack, and crash state.
- [x] Host runtime contract produces a room file plan without starting a real process.
- [x] Host runtime contract includes app data layout, version selection, Fabric loader resolution, Java detection adapter input, cache, EULA, `server.properties`, and fixed-pack install plans.
- [x] Host runtime lifecycle simulation covers start, stop, restart, and crash transitions without launching a real process.
- [x] Redacted log event contract removes secrets, invite tokens, email, and UUID values from host UI log lines.
- [x] Failure states return room-language recovery messages.
- [x] Server bridge approval event contract uses server-observed Minecraft UUID.
- [x] Claimed client identity cannot bypass server-observed UUID approval.
- [x] Approval UI state model covers waiting, pending review, approved, denied, blocked, expired, host unavailable, already allowed, and identity changed states.
- [x] Local runtime adapter contract materializes EULA, `server.properties`, preserved `whitelist.json`, bridge config, runtime manifest, and fixed-pack mod copy operations.
- [x] Fabric server artifact download contract uses the known Fabric Meta source and fails closed without a pinned server JAR checksum.
- [x] Local process intent contract covers start, stop, and restart for the later Tauri process adapter.
- [x] Server bridge state model covers allowlist persistence, denied/blocked messages, outage behavior, and health snapshots.

## Desktop Runtime TODO

Checked items in this section are executable runtime contracts unless they explicitly mention the real desktop shell or local Fabric server process.

- [ ] Create the real desktop app shell from the existing `apps/desktop/` prototype.
- [x] Keep the default UI in room language, not server/network language.
- [x] Add app data directory layout for downloads, cache, generated room files, logs, and support bundles.
- [x] Add supported Minecraft version selection from the app-owned list.
- [x] Add stable Fabric Loader resolution for the selected Minecraft version.
- [x] Detect compatible Java runtimes on Windows.
- [x] Apply the Java compatibility rule for the selected Minecraft version.
- [x] Prompt Java installation only when no compatible runtime exists.
- [ ] Download Fabric server artifacts from known sources.
- [x] Define checksum-gated Fabric server artifact download intent from known sources.
- [ ] Verify downloaded Fabric/server artifact checksums before use in the real bootstrap adapter.
- [x] Cache verified downloads with immutable version metadata.
- [x] Generate local room folder structure.
- [x] Persist EULA consent from the GUI before server start.
- [x] Generate `server.properties` from room-safe defaults.
- [x] Install the selected fixed pack into the local room folder.
- [ ] Start, stop, and restart the local Fabric server process.
- [x] Define local process start, stop, and restart intents for the desktop adapter.
- [x] Stream redacted server logs to the host UI.
- [x] Detect crash, offline download, checksum failure, missing Java, and incompatible Java states.
- [x] Show room-language recovery actions for each failure state.

## Approval UI TODO

- [x] Add pending approval queue UI backed by M2 approval contracts.
- [x] Support approve, deny, and block actions.
- [x] Show expired, host unavailable, already allowed, and identity changed states.
- [x] Avoid showing credentials, raw invite tokens, IPs, or internal session ids.
- [x] Keep advanced diagnostics separate from the default host flow.

## Fabric Server Bridge TODO

- [x] Add Fabric server bridge mod skeleton for the supported Minecraft/Fabric version.
- [x] Capture server-observed authenticated Minecraft UUID on join.
- [x] Prevent claimed client identity from bypassing server-observed UUID.
- [x] Emit pending approval events for unapproved UUIDs.
- [x] Persist approved UUIDs to the room allowlist.
- [x] Handle denied and blocked UUIDs with clear in-game messages.
- [x] Define behavior during temporary control-plane outage for previously approved players.
- [x] Report local room health to the desktop app.

## Completion Gate

- [x] Selected Minecraft version and fixed pack create room files.
- [ ] Local Fabric server starts from the Windows desktop app.
- [x] Missing Java, offline download failure, checksum failure, and crash states show recoverable UI.
- [x] EULA consent is required and persisted before start.
- [x] Server bridge emits approval events based on server-observed authenticated Minecraft UUID.
- [x] Default host UI avoids server/network terminology except in advanced diagnostics.

## Validation

- [x] Desktop runtime unit tests for Java detection and version compatibility.
- [x] Desktop runtime tests for cache layout, checksum failure, and EULA behavior.
- [x] Server lifecycle test for start/stop/crash handling.
- [x] Approval UI tests for pending, approved, denied, blocked, expired, already allowed, and identity changed states.
- [x] Server bridge unit or gametest coverage for UUID confirmation and allowlist behavior.
- [ ] Manual Windows run from room creation to local server start.

## Stop Or Pivot

- Stop if Java/Fabric bootstrap is unreliable for the selected version and fixed pack.
- Stop if the bridge cannot reliably distinguish claimed client identity from authenticated server-observed UUID.
- Pivot if the desktop app cannot make local room creation feel simpler than manual Minecraft setup.
