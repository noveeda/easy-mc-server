---
title: "M3 Real Runtime Bootstrap Plan"
type: plan
status: active
created: "2026-04-30"
source_request: "Run the next MVP-0 development work in parallel from M3 local server execution"
---

# M3 Real Runtime Bootstrap Plan

## Overview

This plan advances M3 from a runnable preview into the first real local Fabric server bootstrap layer. The goal is not to claim full MVP-0 completion yet. The goal is to replace the current `Java/Fabric launch path: blocked` implementation gap with concrete adapters for Java detection, Fabric server artifact download/checksum/install, and local server process start/stop/restart control.

The implementation must preserve the product principle that non-developer hosts should not learn Java commands, Fabric server files, ports, Docker, VPNs, or firewall setup. Technical detail belongs in adapter diagnostics and usage docs, not the default room flow.

---

## Scope Boundaries

- Implement local Windows/Node runtime adapters and tests for M3 runtime bootstrap.
- Keep direct P2P, relay production deployment, and friend Minecraft E2E outside this plan.
- Do not weaken checksum-gated artifact policy. Real Fabric launch remains blocked unless the server jar is installed from an approved source and verified against the runtime plan.
- Do not turn first-party mod placeholders into distributable artifacts.
- Do not require network access for the test suite; use injectable fetch/process adapters.

### Deferred to Follow-Up Work

- Real Tauri shell command wiring from the static desktop UI.
- Real signed first-party mod artifact build and `.mrpack` unblock.
- Manual Windows Minecraft server start validation with a real Java runtime and pinned Fabric server jar.

---

## Context & Research

### Relevant Code and Patterns

- `apps/desktop/src/runtime/host-runtime.mjs` creates validated room plans and Java/Fabric policy contracts.
- `apps/desktop/src/runtime/local-runtime-adapter.mjs` creates materialization, Fabric download, and process intents without side effects.
- `apps/desktop/src/runtime/node-local-runtime.mjs` performs local file materialization and guarded real process launch.
- `apps/desktop/tests/node-local-runtime.test.mjs` and `apps/desktop/tests/local-runtime-adapter.test.mjs` use dependency-free Node tests.
- `scripts/mvp0-local-preview.mjs` is the current user-facing runnable preview command.

### Institutional Learnings

- `docs/solutions/workflow-issues/executable-contracts-must-not-close-infrastructure-gates-2026-04-30.md`: executable contracts must not be mistaken for real infrastructure completion.
- `docs/solutions/workflow-issues/mvp0-decision-lock-before-implementation-2026-04-29.md`: Java 21 and Fabric policy must remain locked for MVP-0.

---

## Key Technical Decisions

- Add real adapters beside existing pure contracts: this keeps existing contract tests stable while allowing Node/Tauri runtime work to consume those contracts.
- Make every external side effect injectable in tests: Java probing, network fetch, process spawn, timers, and filesystem writes must be testable without real Java or network.
- Keep fail-closed defaults: missing Java, missing checksum, checksum mismatch, unapproved source, and forged process commands must block launch.
- Add lifecycle management separately from artifact bootstrap: download/install errors and process runtime errors should be distinguishable in UI and diagnostics.

---

## Implementation Units

- U1. **Windows Java Detection Adapter**

**Goal:** Detect an existing Java 21-compatible runtime without asking the host to understand Java setup.

**Files:**
- Create: `apps/desktop/src/runtime/node-java-detection.mjs`
- Create: `apps/desktop/tests/node-java-detection.test.mjs`

**Approach:**
- Build candidates from configured path, `JAVA_HOME`, `PATH`, and Program Files-style roots.
- Probe candidates with injectable `execFile` using `java -version`.
- Parse Java version output for Java 21+ compatibility.
- Return room-language failure data when missing or incompatible.

**Test scenarios:**
- Happy path: Java 21 output from `JAVA_HOME` returns a compatible runtime.
- Edge case: Java 17 is detected but rejected as incompatible.
- Error path: missing candidates or probe failures return `java_missing`.
- Edge case: duplicate candidates are deduplicated and unsafe empty paths ignored.

**Verification:**
- Unit tests pass without a real Java installation.

---

- U2. **Fabric Server Artifact Bootstrap Adapter**

**Goal:** Download and install the Fabric server launcher jar only from the approved Fabric Meta source and only after checksum verification.

**Files:**
- Create: `apps/desktop/src/runtime/node-fabric-bootstrap.mjs`
- Create: `apps/desktop/tests/node-fabric-bootstrap.test.mjs`

**Approach:**
- Consume `createFabricServerDownloadPlan`.
- Use injectable `fetch` to download bytes from the approved source URL.
- Compute SHA256 and compare against the pinned `runtimePlan.fabric.serverJarSha256`.
- Write the verified cache file, install the launcher jar into the room runtime directory, and write minimal metadata.
- Fail closed when checksum is missing, source is not approved, download fails, or checksum mismatches.

**Test scenarios:**
- Happy path: matching bytes are cached and copied to the launcher jar path.
- Error path: missing expected checksum blocks before download.
- Error path: checksum mismatch writes no launcher jar.
- Error path: non-OK download returns a room setup failure.

**Verification:**
- Tests prove no network is required and no unverified jar can be installed.

---

- U3. **Local Server Process Lifecycle Manager**

**Goal:** Control real Java/Fabric process lifecycle through start, stop, restart, readiness, crash detection, and redacted logs.

**Files:**
- Modify: `apps/desktop/src/runtime/node-local-runtime.mjs`
- Modify: `apps/desktop/tests/node-local-runtime.test.mjs`

**Approach:**
- Keep `launchLocalServer` as the guarded low-level launch primitive.
- Add a lifecycle manager that wraps start/stop/restart around the guarded launch path.
- Detect readiness from the existing `Done` health log pattern.
- Detect crash/failure from the existing crash log pattern.
- Send `stop\n` to stdin and fall back to `kill` after a timeout.
- Emit redacted log events using existing host runtime redaction.

**Test scenarios:**
- Happy path: fake process emits `Done` and manager marks running.
- Happy path: stop writes `stop\n` and resolves on exit.
- Happy path: restart stops then starts a new fake process.
- Error path: forged command remains blocked before spawn.
- Error path: crash-pattern log marks the process crashed and redacts sensitive values.

**Verification:**
- Lifecycle tests pass with fake process objects; no real Java process is required.

---

- U4. **Preview Command And Documentation Integration**

**Goal:** Surface the new bootstrap capabilities through the existing preview command and docs without pretending external artifacts are complete.

**Files:**
- Modify: `scripts/mvp0-local-preview.mjs`
- Modify: `docs/usage/mvp0-local-preview.md`
- Modify: `docs/todos/M3-host-app-local-room-runtime.md`
- Modify: `docs/reports/2026-04-30-project-status-and-next-plan-report.md`

**Approach:**
- Add a preview path that can run Java detection and Fabric bootstrap checks with clear blocked states.
- Keep default preview offline-friendly.
- Explain that real launch still requires a real Java runtime plus a pinned Fabric server jar checksum/artifact.
- Update M3 TODO progress to distinguish adapter implementation from manual Windows server validation.

**Test scenarios:**
- Happy path: default preview still runs without network or Java.
- Error path: bootstrap check reports missing Java or missing pinned artifact clearly.
- Integration: existing smoke tests cover preview status object shape.

**Verification:**
- `npm.cmd run mvp0:preview`, `npm.cmd run test`, and browser smoke checks remain green.

---

## System-Wide Impact

- **Interaction graph:** `scripts/mvp0-local-preview.mjs` consumes desktop runtime adapters; later Tauri commands can use the same adapters.
- **Error propagation:** adapter failures should preserve machine-readable reasons and room-language messages.
- **State lifecycle risks:** partial downloads must not install a launcher jar; process stop must not leave a stale running state.
- **API surface parity:** pure contracts remain in `host-runtime.mjs` and `local-runtime-adapter.mjs`; Node adapters add side effects beside them.
- **Integration coverage:** tests must exercise Java detection, download verification, process lifecycle, and preview summary without real Java or network.
- **Unchanged invariants:** no Docker, no direct P2P, no arbitrary TCP proxy, no unverified `.mrpack`, no user-facing network setup.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Real Java/Fabric cannot be validated on every machine | Keep unit tests injectable and document manual validation separately. |
| Downloaded server jar is trusted without a pin | Require `serverJarSha256` before install and fail closed on mismatch. |
| Process manager executes arbitrary commands | Reuse guarded `launchLocalServer` command validation. |
| Preview output could imply MVP-0 completion | Keep docs and output explicit that this is adapter progress, not final MVP-0. |

---

## Documentation / Operational Notes

- Update the Korean usage guide with the new blocked/ready meanings.
- M3 TODO should show adapter implementation progress separately from manual Windows validation.
- The final report should state whether real server launch remains blocked by missing external artifacts.

