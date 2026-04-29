---
title: "MVP-0 Runnable Preview Implementation Plan"
type: plan
status: active
created: "2026-04-30"
source_request: "Run the five-step MVP-0 path and provide usage instructions"
---

# MVP-0 Runnable Preview Implementation Plan

## Overview

This plan turns the existing MVP-0 contracts into a runnable local developer preview that exercises the same product path as the intended user MVP:

1. Host prepares a local room.
2. Host starts or previews a local Fabric server runtime.
3. Friend pack generation is validated.
4. Friend connection path is exercised through a relay-capable local loop.
5. Usage instructions explain how to run the preview and what remains blocked for a true closed-alpha MVP.

The current repo does not yet contain signed first-party mod artifacts, a packaged Tauri app, or a deployed relay service. Therefore this plan does not pretend those external prerequisites are complete. It adds real local filesystem/process/socket adapters and a runnable preview harness while keeping external-artifact requirements explicit.

---

## Scope Boundaries

- Build a dependency-free Node-based runnable preview path using the existing contracts.
- Do not introduce Docker, cloud hosting, or network setup requirements.
- Do not claim closed-alpha MVP completion until real Windows app packaging, signed mod artifacts, and manual Minecraft E2E validation pass.
- Keep direct P2P out of MVP-0.
- Preserve the user-facing product direction: desktop app first, invite helper second, relay-first transport.

---

## Context & Existing Patterns

- Desktop runtime contracts live in `apps/desktop/src/runtime/host-runtime.mjs`.
- Local file/process intent contracts live in `apps/desktop/src/runtime/local-runtime-adapter.mjs`.
- Host tunnel contracts live in `apps/desktop/src/tunnel/host-tunnel.mjs`.
- Relay contracts live in `services/relay/src/relay-simulation.mjs`.
- Client loopback contracts live in `mods/client-fabric/src/connection/loopback-plan.mjs`.
- Fixed pack template lives in `packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json`.
- Safety gates live in `packages/safety/src/index.mjs`.

Institutional learnings to preserve:

- Executable contracts must not close infrastructure gates by themselves.
- The `.mrpack` template must not be zipped into an importable pack while first-party artifact placeholders remain.
- Test runner should use `--test-isolation=none` in this workspace.

---

## Key Technical Decisions

- Add real adapters beside the existing contracts instead of replacing contracts.
  - Rationale: tests and prior milestones depend on pure dependency-free contracts; real adapters should consume those contracts.
- Make process launch optional and explicit.
  - Rationale: CI and local machines may not have Java/Fabric artifacts. The preview can materialize and validate without pretending Java launched.
- Add a local TCP relay preview as a harness, not the production relay service.
  - Rationale: this proves byte forwarding and API shape without hiding that production deployment is still separate.
- Add a Modrinth pack validator/generator that fails closed on first-party artifact placeholders.
  - Rationale: user trust and mod redistribution policy require not generating a misleading pack.
- Add one usage document for the current runnable preview and true MVP blockers.
  - Rationale: the user needs clear instructions, not scattered engineering notes.

---

## Implementation Units

### U1. Local Runtime Filesystem And Process Adapter

**Goal:** Materialize a validated room plan into real local files and optionally launch Java when artifacts exist.

**Files:**

- Create: `apps/desktop/src/runtime/node-local-runtime.mjs`
- Test: `apps/desktop/tests/node-local-runtime.test.mjs`
- Modify: `apps/desktop/README.md`

**Approach:**

- Consume `createRoomMaterializationPlan` and `createLocalServerProcessIntent`.
- Create directories.
- Write EULA, `server.properties`, `whitelist.json`, bridge config, and runtime manifest.
- Copy verified mod files when source files exist.
- Provide a launch function that can run in dry-run mode by default and real spawn mode when Java and launcher jar exist.

**Test scenarios:**

- Happy path: materialization writes expected files under an app-data root.
- Edge case: existing `whitelist.json` is preserved.
- Error path: paths outside app-data root are rejected before writing.
- Error path: real launch fails closed when launcher jar is missing.

**Verification:**

- Node tests prove the local runtime adapter writes real files without requiring Java.

---

### U2. First-Party Artifact And `.mrpack` Gate

**Goal:** Add a pack generator/validator that can create a pack only after first-party artifact placeholders are replaced.

**Files:**

- Create: `packages/modpack-builder/src/mrpack.mjs`
- Create: `packages/modpack-builder/tests/mrpack.test.mjs`
- Modify: `packages/modpack-builder/package.json`
- Modify: `packages/modpack-builder/m1/README.md`

**Approach:**

- Read the fixed pack template.
- Detect placeholder or non-HTTPS first-party artifact entries.
- Validate source URL, hashes, file sizes, and download URLs.
- Generate an `.mrpack` zip only when all required metadata is present.
- In this workspace, fail closed until signed first-party artifacts exist.

**Test scenarios:**

- Happy path: complete pack metadata produces a deterministic manifest payload.
- Error path: placeholder first-party artifact blocks pack generation.
- Error path: missing SHA1/SHA512 or non-HTTPS URL blocks pack generation.

**Verification:**

- Tests prove the pack path cannot produce a misleading importable `.mrpack`.

---

### U3. Local Relay Socket Preview

**Goal:** Add a real local TCP byte-forwarding preview harness that follows the relay contract shape.

**Files:**

- Create: `services/relay/src/local-tcp-relay-preview.mjs`
- Create: `services/relay/tests/local-tcp-relay-preview.test.mjs`
- Modify: `services/relay/README.md`

**Approach:**

- Start a local host target TCP server for test usage.
- Start a local relay preview listener.
- Require an allowlisted session descriptor before forwarding.
- Pipe bytes between friend socket and host target.
- Keep this explicitly scoped as a local preview, not production relay.

**Test scenarios:**

- Happy path: friend bytes reach host target and response returns.
- Error path: unknown session is rejected.
- Error path: arbitrary target cannot be selected by the friend.
- Cleanup: listeners close after tests.

**Verification:**

- Node socket tests prove real local byte forwarding in the MVP-0 relay shape.

---

### U4. Runnable MVP-0 Preview Script

**Goal:** Provide one command that prepares the room preview, validates pack readiness, and runs relay smoke behavior.

**Files:**

- Create: `scripts/mvp0-local-preview.mjs`
- Modify: `package.json`
- Test: covered through U1-U3 plus script dry-run check in `scripts/verify-static-prototypes.mjs` or a smoke test.

**Approach:**

- Build a known-good runtime input for Minecraft `1.21.1`.
- Materialize into `.local/mvp0-preview`.
- Validate pack metadata.
- Run relay local preview in smoke mode.
- Print clear Korean usage/status output.
- Do not require real Java unless the user requests real launch mode.

**Test scenarios:**

- Happy path: dry-run preview exits successfully and prints output paths.
- Error path: real launch mode reports missing Java/server jar clearly.
- Error path: pack generation reports first-party artifact blocker clearly.

**Verification:**

- `npm run mvp0:preview` works without external downloads.

---

### U5. Usage Guide And Current MVP Status

**Goal:** Explain how to run the current preview and what must still happen for true MVP-0.

**Files:**

- Create: `docs/usage/mvp0-local-preview.md`
- Modify: `docs/reports/2026-04-30-project-status-and-next-plan-report.md`
- Modify: `docs/todos/M3-host-app-local-room-runtime.md`
- Modify: `docs/todos/M4-relay-join-end-to-end.md`

**Approach:**

- Give exact commands for dry-run preview.
- Explain where files are generated.
- Explain real launch prerequisites.
- Explain why `.mrpack` remains blocked.
- Explain next manual validation steps.

**Test scenarios:**

- Test expectation: documentation only; verify links and referenced script names match repo files.

**Verification:**

- The final response can point to one Korean usage guide.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User expects a complete closed-alpha MVP after this pass | Mark generated preview as runnable developer preview and list hard blockers clearly. |
| Real Java/Fabric launch cannot run in this environment | Make launch mode explicit and dry-run default. |
| `.mrpack` generation could mislead users | Fail closed until signed first-party artifact metadata is available. |
| Relay preview could be mistaken for production relay | Name and document it as local preview only. |
| New adapters may weaken existing contracts | Keep existing contracts pure and add adapters/tests beside them. |

---

## Verification Plan

- `npm.cmd run test`
- `npm.cmd run mvp0:preview`
- `git diff --check`

---

## Expected Outcome

After implementation, the repo will have a runnable local MVP-0 preview command and usage guide. This is not yet the final user-facing MVP because real Windows packaging, first-party signed mod artifacts, and manual Minecraft E2E validation remain required. However, it will provide the first concrete executable path that prepares room files, validates the pack blocker, and proves local relay byte forwarding.
