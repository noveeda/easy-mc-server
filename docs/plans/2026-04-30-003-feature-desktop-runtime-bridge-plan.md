---
title: "Desktop Runtime Bridge Implementation Plan"
type: plan
status: completed
created: "2026-04-30"
source_request: "Implement only the remaining unimplemented desktop runtime work with workers"
---

# Desktop Runtime Bridge Implementation Plan

## Overview

M3 currently has Node runtime adapters for Java detection, Fabric bootstrap, room materialization, and local process lifecycle management. The desktop GUI is still a static prototype that simulates prepare/open actions. This plan implements the missing bridge layer between the GUI flow and the runtime adapters, without claiming that the packaged Tauri app or real Minecraft E2E is complete.

The goal is to make the host UI consume a production-shaped command contract: prepare room, open room, close room, restart room, surface blocked states, and display runtime diagnostics in room language.

---

## Scope Boundaries

- Implement a desktop runtime bridge contract that can be used by a future Tauri command boundary.
- Keep all side effects injectable so tests do not require Java, Fabric downloads, Tauri, or Minecraft.
- Update the static desktop prototype to use bridge-shaped async actions instead of pure fake reducer actions.
- Preserve the current file-based preview and runtime adapters.
- Do not add real Tauri/Rust packaging in this slice.
- Do not unblock `.mrpack`, first-party mod artifacts, deployed relay, or two-client Minecraft E2E in this slice.

### Deferred to Follow-Up Work

- Tauri `src-tauri` package setup and command registration.
- Real pinned Fabric server jar SHA256 success-path validation.
- Manual Windows host-only Fabric server run.
- Real friend `.mrpack` import and relay E2E.

---

## Context & Research

### Relevant Code and Patterns

- `apps/desktop/app.js` currently drives the GUI from local static state.
- `apps/desktop/state.js` currently exposes a small reducer for prepare/open/reset.
- `apps/desktop/src/runtime/node-java-detection.mjs` detects Java 21-compatible runtimes.
- `apps/desktop/src/runtime/node-fabric-bootstrap.mjs` verifies and installs Fabric server jars with pinned SHA256.
- `apps/desktop/src/runtime/node-local-runtime.mjs` materializes room files and manages process lifecycle.
- `scripts/mvp0-local-preview.mjs` shows how to create a preview runtime plan and report blocked states.

### Institutional Learnings

- `docs/solutions/workflow-issues/executable-contracts-must-not-close-infrastructure-gates-2026-04-30.md`: adapter progress must not be reported as full infrastructure completion.
- `docs/solutions/best-practices/node-runtime-adapters-must-bound-lifecycle-side-effects-2026-04-30.md`: side effects must be bounded, injectable, and fail-closed.
- `docs/solutions/workflow-issues/m1-mrpack-template-requires-first-party-artifacts-2026-04-29.md`: first-party placeholders must keep `.mrpack` blocked until real artifacts exist.

---

## Key Technical Decisions

- Add a Node-side desktop runtime bridge beside existing adapters instead of changing the adapters into GUI code.
- Add a browser-side bridge shim that prefers future Tauri `invoke` commands but falls back to local safe mock responses for static preview.
- Keep the GUI in room language. Internal details stay in diagnostics rows.
- Default GUI actions should show blocked/ready/opening/closing states, not pretend the server opened when runtime prerequisites are missing.

---

## Implementation Units

- U1. **Node Desktop Runtime Bridge**

**Goal:** Provide production-shaped command functions for prepare/open/close/restart/status that compose existing runtime adapters.

**Dependencies:** None

**Files:**
- Create: `apps/desktop/src/runtime/desktop-runtime-bridge.mjs`
- Create: `apps/desktop/tests/desktop-runtime-bridge.test.mjs`

**Approach:**
- Add bridge commands for preparing room files, resolving Java, optionally bootstrapping Fabric, starting lifecycle, stopping lifecycle, and reading status.
- Accept injected adapter functions, runtime plan factory, lifecycle manager factory, and fetch/process dependencies.
- Return plain DTOs safe for a future Tauri command boundary.
- Preserve fail-closed blocked states for missing Java, missing checksum, missing Fabric jar, forged commands, or process errors.

**Test scenarios:**
- Happy path: prepare materializes files and returns ready state.
- Happy path: open with Java ready but Fabric download disabled returns a launch blocker instead of claiming success.
- Error path: missing Java returns blocked state with room-language message.
- Error path: duplicate open does not start a second process.
- Integration: lifecycle events are converted to redacted runtime DTO events.

**Verification:**
- `apps/desktop/tests/desktop-runtime-bridge.test.mjs` passes without Java, network, Tauri, or Minecraft.

---

- U2. **Static GUI Bridge Integration**

**Goal:** Make the desktop prototype call bridge-shaped async actions and render blocked/running/closing states.

**Dependencies:** U1 command DTO shape

**Files:**
- Create: `apps/desktop/bridge.js`
- Modify: `apps/desktop/index.html`
- Modify: `apps/desktop/app.js`
- Modify: `apps/desktop/state.js`
- Modify: `apps/desktop/styles.css`
- Modify: `scripts/verify-static-prototypes.mjs`

**Approach:**
- Add browser bridge functions that call `window.__TAURI__.core.invoke` when available.
- Provide a static fallback for file-preview mode so non-Tauri browser checks still work.
- Replace the pure simulated open flow with async prepare/open/close/restart actions.
- Render blocked states clearly, with a default message and advanced diagnostics.
- Keep invite copy disabled until the bridge says the room is open or preview-open.

**Test scenarios:**
- Happy path: static fallback prepare enables open.
- Error path: static fallback open shows blocked runtime state instead of fabricating a real server.
- Edge case: reset clears blocker, invite, diagnostics, and request state.
- Integration: `verify-static-prototypes` confirms bridge script order and state transitions.

**Verification:**
- Static prototype verification passes.
- Browser snapshot exposes prepare/open/close controls and blocked state copy.

---

- U3. **Documentation And Status Updates**

**Goal:** Keep M3 status accurate after bridge implementation.

**Dependencies:** U1, U2

**Files:**
- Modify: `docs/todos/M3-host-app-local-room-runtime.md`
- Modify: `docs/usage/mvp0-local-preview.md`
- Modify: `docs/reports/2026-04-30-project-status-and-next-plan-report.md`

**Approach:**
- Mark desktop bridge contract complete, but keep real Tauri packaging and manual Windows server start unchecked.
- Explain that GUI now has a bridge-shaped command contract but still uses static fallback outside Tauri.
- Preserve the distinction between adapter/bridge implementation and MVP-0 completion.

**Test scenarios:**
- Test expectation: none -- documentation-only changes, verified by diff review and `git diff --check`.

**Verification:**
- Documentation accurately says real Tauri shell and host-only Fabric start remain pending.

---

## System-Wide Impact

- **Interaction graph:** GUI actions will flow through a bridge DTO contract before reaching Node adapters or future Tauri commands.
- **Error propagation:** Java/Fabric/process failures must remain machine-readable and room-language-friendly.
- **State lifecycle risks:** Duplicate opens, stale blocked state, and fake invite creation are the main risks.
- **API surface parity:** Future Tauri commands should mirror the Node bridge DTOs.
- **Integration coverage:** Static VM checks and Node bridge tests cover the contract without requiring a packaged desktop app.
- **Unchanged invariants:** No Docker, no cloud host, no direct P2P, no unverified `.mrpack`, no arbitrary TCP proxy, and no user-facing firewall setup.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Static fallback could be mistaken for real server launch | Label fallback state as blocked/preview and keep docs explicit. |
| Future Tauri command shape diverges from tests | Keep bridge DTOs simple and test them as the command contract. |
| GUI hides important blockers | Render blocker message in room language and keep details in diagnostics. |

---

## Documentation / Operational Notes

- The final report must say M3 bridge implementation moved forward, but real Tauri shell packaging and manual Windows Fabric start are still not complete.
- The usage guide remains focused on `mvp0:preview`; GUI bridge docs should avoid implying MVP-0 is ready for non-developer testers.
