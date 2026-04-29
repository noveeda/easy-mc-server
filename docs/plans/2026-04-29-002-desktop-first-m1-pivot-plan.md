---
title: "Desktop-First M1 Pivot"
type: feature
status: active
created: 2026-04-29
origin: "user feedback on apps/invite-web/index.html"
scope: standard
---

# Desktop-First M1 Pivot Plan

## Problem Frame

The product was planned as a Windows desktop GUI app, but the first M1 artifact over-emphasized a static invite web page. That creates the wrong product signal: the host's main experience should be a desktop room control app, while the invite page should be a thin helper surface for friends.

## Requirements Trace

| ID | Requirement | Source |
|---|---|---|
| P1 | The primary user-facing product is a desktop GUI app for the host. | Original product direction and latest user feedback |
| P2 | The host should not need to understand server, firewall, port forwarding, Docker, or VPN concepts. | Existing source plan |
| P3 | The web invite surface must be secondary and button-focused. | Latest user feedback |
| P4 | M1 should not be marked complete without real friend install validation. | Milestone completion criteria |
| P5 | Any issue discovered during milestone execution should be captured with `ce-compound`. | Latest user instruction |

## Scope

In scope:

- Add a desktop-first GUI prototype under `apps/desktop/`.
- Show the host room flow: choose supported Minecraft version, choose fixed pack, prepare room, create invite, approve/deny friend request.
- Reduce `apps/invite-web/` to a secondary friend helper, not the main product surface.
- Update M1 milestone/validation docs to reflect the desktop-first correction.
- Add lightweight static verification that does not require new dependencies.
- Record the invite-page-first mistake as a compound workflow learning.

Out of scope:

- Real Tauri/Rust process control.
- Real Minecraft server bootstrap.
- Real Modrinth import automation.
- Real relay/control-plane integration.
- Real `.mrpack` generation before first-party artifact metadata exists.

## Implementation Units

### U1. Desktop Host GUI Prototype

**Files:** `apps/desktop/index.html`, `apps/desktop/styles.css`, `apps/desktop/app.js`, `apps/desktop/README.md`

**Goal:** Provide the first screen a host would expect: a room control app, not a web documentation page.

**Scenarios:**

- Host can see current room status without network/server terminology.
- Host can select Minecraft `1.21.1` and the fixed performance pack.
- Host can prepare/open a room in the prototype state machine.
- Host can create a friend invite from the desktop app.
- Host can approve or deny a sample friend request.

### U2. Invite Web Demotion

**Files:** `apps/invite-web/index.html`, `apps/invite-web/styles.css`, `apps/invite-web/app.js`, `apps/invite-web/README.md`

**Goal:** Make the invite page a thin friend helper with minimal Korean copy and no visible developer validation state picker by default.

**Scenarios:**

- Friend sees one main action and one fallback action.
- Expired/unavailable state hides room details.
- Debug state switching is available only through URL query state or development documentation, not visible UI controls.

### U3. M1 Documentation Correction

**Files:** `docs/milestones/2026-04-29-local-minecraft-room-milestones.md`, `docs/validation/m1-friend-install-join-validation.md`, `docs/solutions/workflow-issues/m1-invite-page-first-wrong-product-signal-2026-04-29.md`

**Goal:** Make the milestone record clear that desktop GUI is primary and the invite page is secondary.

**Scenarios:**

- M1 status explains that desktop-first prototype exists but final completion remains blocked by first-party mod artifacts and tester validation.
- Validation flow starts from the host desktop app.
- The workflow issue is documented for future agents.

### U4. Static Verification

**Files:** `package.json`, `scripts/verify-static-prototypes.mjs`

**Goal:** Provide a no-dependency check for the static prototypes.

**Scenarios:**

- Desktop HTML references existing CSS and JS assets.
- Invite HTML remains `noindex,nofollow`.
- Browser JavaScript files parse with Node syntax checks.
- The Modrinth template remains valid JSON.

## Verification

- `npm run test`
- `git diff --check`
- Manual open of `apps/desktop/index.html`

## Residual Risks

- The prototype is still not a packaged Windows app.
- Real M1 completion still requires first-party client connection mod artifact metadata.
- Actual non-developer validation is still required after an importable pack exists.
