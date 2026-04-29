---
title: "Local Minecraft Mod Room Milestones"
type: milestones
status: active
source_plan: "../plans/2026-04-29-001-feature-local-minecraft-room-plan.md"
---

# Local Minecraft Mod Room Milestones

**Source plan:** [2026-04-29-001-feature-local-minecraft-room-plan.md](../plans/2026-04-29-001-feature-local-minecraft-room-plan.md)

## Milestone Principles

- Milestones are development gates, not calendar estimates.
- A milestone is complete only when its completion criteria are demonstrably met.
- MVP-0 proves the local room loop with relay-only transport; it does not include direct P2P or generalized mod compatibility.
- User-facing language must keep using "room" terms and avoid server/network terms outside advanced diagnostics.
- MVP-0 keeps the closed-alpha total room size at 10 players including the host.

## Milestone Overview

| Milestone | Gate | Plan Coverage | Outcome |
|---|---|---|---|
| M0 | MVP-0 Decision Lock | Open MVP-0 decisions | Implementation can start without product/policy blockers. |
| M1 | Desktop Host Invite Flow Validation | Gate 0, U4/U8/U9 slice | Host creates an invite from desktop app and a first-time friend can reach approval waiting state. |
| M2 | Foundation, Protocol, Control Plane | U1, U2, U3 | Room, invite, approval, session, permission, TTL flow is testable. |
| M3 | Host App And Local Room Runtime | U4, U5 | Windows host can create and run a local Fabric room. |
| M4 | Relay Join End-To-End | U6, U7 | Friend client mod joins host room through loopback proxy and relay. |
| M5 | Closed Alpha Safety Hardening | U9, U10 | Invite, privacy, policy, and abuse guardrails are alpha-ready. |
| M6 | Curated Catalog Beta | U11 | Fixed packs can expand into curated recommended/popular mods. |
| M7 | Direct P2P Beta | U13 | Direct connection can be attempted with relay fallback. |

---

## M0. MVP-0 Decision Lock

**Status:** Completed by [2026-04-29-mvp0-decision-lock.md](../decisions/2026-04-29-mvp0-decision-lock.md).

**Goal:** Lock the remaining MVP-0 inputs before implementation begins.

**Deliverables:**

- Initial app-supported Minecraft version list.
- Fixed verified Fabric pack list for each supported Minecraft version.
- Alpha relay limits applied as defaults:
  - One active room per host account/device.
  - Up to 9 invited friends, 10 total players including host.
  - Six-hour room session.
  - 20-minute idle timeout when no approved friends are connected.
  - 25 GB room-session warning and 40 GB hard cap.
  - 150 GB monthly relay cap per host during closed alpha.
  - 24-hour invite expiry.
  - Rate limits by invite, IP/device signal, and Minecraft identity signal.
  - `noindex` invite pages and no public discovery.
- Approved unofficial-product wording for app surfaces, invite pages, and release notes.
- Mod reference policy: no third-party mod rehosting in MVP-0; use original allowed download URLs plus pinned hashes.
- Connection mod alpha artifact policy: signed HTTPS release artifact with SHA1/SHA512, immutable version, rollback, and revocation metadata.

**Completion Criteria:**

- The source plan's `Resolve Before MVP-0 Implementation` items are resolved or replaced by explicit defaults.
- Every fixed pack has a supported Minecraft version, stable Fabric Loader mapping, Java compatibility rule, and mod source/permission record.
- The implementation team can begin U1-U3 without choosing product, policy, or relay-limit values.

**Stop/Pivot Criteria:**

- No fixed pack can satisfy mod source, license, and redistribution/use conditions.
- A chosen Minecraft version cannot support the required Fabric room bootstrap and Modrinth pack import flow.
- The relay limits are too low to validate a 10-player room or too high to operate safely in closed alpha.

---

## M1. Desktop Host Invite Flow Validation

**Status:** In progress. Desktop host GUI prototype, secondary invite helper, fixed-pack metadata, and validation checklist exist; completion is blocked until the first-party client connection mod has signed artifact metadata and at least three non-developer tester runs pass.

**Goal:** Validate the highest-risk user behavior before building the full relay/control-plane stack from the correct product entry point: a non-developer host can prepare a room and create an invite from the desktop app, then a non-developer friend can apply the generated Modrinth pack and reach an approval waiting state.

**Deliverables:**

- Desktop host GUI prototype for room setup, fixed-pack selection, invite creation, and approval request handling.
- Minimal secondary invite helper using safe room metadata and trust copy.
- Private `.mrpack` for at least one fixed verified pack.
- Modrinth-first install guidance covering missing Modrinth App, pack downloaded, import failed, unsupported device/browser, host offline, and approval timeout states.
- Lightweight validation script/checklist for observing friend install and first launch.
- Recorded outcomes for time-to-launch, import completion, support interventions, and drop-off points.

**Completion Criteria:**

- At least three non-developer hosts can open the desktop app prototype, prepare a room, and create an invite without interpreting server/network concepts.
- At least three non-developer testers can open an invite, apply the friend modpack, launch Minecraft Java, and reach a clear approval waiting state.
- No tester needs Hamachi/Tailscale/ZeroTier, port forwarding, Docker, or firewall instructions.
- Drop-off points are recorded with enough detail to update invite copy or pack generation.
- P2P and generalized compatibility work remain out of scope for this milestone.

**Stop/Pivot Criteria:**

- The desktop app flow cannot make room creation feel simpler than manual Minecraft setup.
- Modrinth App import is too confusing for first-time friends even with guided copy.
- The `.mrpack` cannot include or reference the alpha connection mod with stable URL/hash metadata.
- The trust panel fails to make the friend comfortable installing the generated pack.

---

## M2. Foundation, Protocol, Control Plane

**Status:** Completed for the MVP-0 executable foundation. Workspace boundaries, executable protocol permissions, safe invite metadata, in-memory room/invite/approval/session flow tests, HTTP request/response redaction tests, persistence redaction tests, rate-limit counter tests, audit-event tests, router-adapter DTO tests, Fastify `inject` route tests, trusted actor derivation, PostgreSQL schema/repository/migration contract tests, existing-alpha constraint hardening SQL, and service-level approval/session transaction integration exist. Running PostgreSQL deployment wiring and production auth middleware remain deployment work, not M2 contract blockers.

**Goal:** Create the repo foundation and shared contracts that make room, invite, approval, session, permission, and TTL flows testable.

**Deliverables:**

- Greenfield workspace layout for desktop app, invite web, control plane, relay, shared protocol, and Fabric mods.
- Protocol schemas for room, approval, transport, modpack, install state, error state, and risk labels.
- Actor permission matrix implemented as a contract test target.
- Control plane MVP with room creation, invite TTL/revocation, approval queue, presence heartbeat, session credentials, and rate-limit hooks.
- PostgreSQL-backed alpha state for rooms, invites, approvals, sessions, and TTL expiry.

**Completion Criteria:**

- U1 smoke test confirms expected workspace packages and test targets.
- U2 schema/permission tests pass for host, friend, and service-admin boundaries.
- U3 room-flow test passes: host online -> invite created -> friend join request -> host approves -> short-lived session issued.
- Expired/revoked invite tests confirm sensitive room metadata is not exposed.
- Missing or invalid state fails closed.

**Stop/Pivot Criteria:**

- The control plane cannot express host approval without exposing session credentials early.
- The permission model requires a full account system before closed-alpha validation.
- TTL/presence state cannot be made reliable enough for invite and approval flows.

---

## M3. Host App And Local Room Runtime

**Status:** In progress. Dependency-free host runtime, app data layout, version/loader/Java selection, checksum/cache/EULA/server-properties/fixed-pack install planning, lifecycle simulation, redacted logs, bridge approval, and approval UI state contracts exist. Real Tauri shell, Windows process control, Fabric server bootstrap downloads, actual server start, and manual Minecraft validation remain pending before full M3 completion.

**Goal:** Let the host create and run a local Fabric room from the Windows desktop app.

**Deliverables:**

- Windows desktop shell with room-language setup flow.
- Minecraft version selection from the app-supported list.
- Automatic stable Fabric Loader selection for the selected Minecraft version.
- Java runtime detection that uses a compatible installed runtime or prompts installation only when none is available.
- Fabric server bootstrap with checksum verification, cache layout, and persisted EULA consent.
- Server bridge mod integration for join events, authenticated UUID confirmation, allowlist behavior, and room health.
- Host approval panel covering pending, approved, denied, blocked, expired, host unavailable, already allowed, and identity changed states.

**Completion Criteria:**

- Selected Minecraft version and fixed pack create room files and start the local Fabric server.
- Missing Java, offline download failure, checksum failure, and crash states show room-language recovery.
- Server bridge emits approval events based on server-observed authenticated Minecraft UUID.
- Default host UI avoids server/network terminology except in advanced diagnostics.

**Stop/Pivot Criteria:**

- Java/Fabric bootstrap fails too often for the selected version and fixed pack.
- Server bridge cannot reliably distinguish claimed client identity from authenticated server-observed UUID.
- Host approval UI cannot be made clear enough for non-developer hosts.

---

## M4. Relay Join End-To-End

**Status:** In progress. Dependency-free relay protocol, session validation boundary, replay refusal, quota, open-proxy guard, metrics, host-tunnel lifecycle simulation, bounded disconnect retry, and client loopback contracts exist. Real relay sockets, host tunnel integration, Fabric client mod runtime, and manual multiplayer validation remain pending before full M4 completion.

**Goal:** Prove that a friend client mod can join the host room through loopback proxy and relay-only transport.

**Deliverables:**

- Fabric client connection mod that opens `127.0.0.1:<ephemeral>` and binds it to a relay session.
- Relay MVP that forwards authenticated Minecraft TCP streams only for valid room/session targets.
- Host app tunnel integration.
- Relay quota and abuse guardrails before closed-alpha traffic is allowed.
- E2E relay room flow test from friend client mod to host local room.

**Completion Criteria:**

- Friend client mod reaches the host room through relay in a small multiplayer session.
- Relay refuses unauthenticated, expired, cross-room, and arbitrary TCP proxy attempts.
- Total room size, session duration, idle timeout, bandwidth caps, monthly cap, invite expiry, and approval-request rate limits are enforced.
- Relay disconnects trigger bounded retry and a user-facing room-connection failure state.
- Minimal metrics are emitted for active rooms, room-hours, disconnects, bytes, and quota stops.

**Stop/Pivot Criteria:**

- Relay latency or disconnect rate prevents acceptable small-room play.
- Relay cannot be prevented from acting like a general TCP proxy.
- Guardrails cannot fail closed without breaking normal joins.

---

## M5. Closed Alpha Safety Hardening

**Status:** In progress. Dependency-free invite recovery, invite helper safety metadata, `noindex`/no-discovery surface, support redaction, retention defaults, unofficial-product wording, generated-pack permission gate, privacy map, audit-event contracts, closed-alpha release gate contract, and release checklist exist. Manual accessibility validation, real support bundle export wiring, and real M3/M4 runtime/relay completion remain pending before full M5 completion.

**Goal:** Make MVP-0 safe enough for closed-alpha use beyond local development.

**Deliverables:**

- Invite web failure states and trust panel finalized.
- `noindex` invite pages and no public discovery.
- Support bundle redaction for tokens, IPs, session keys, raw invite URLs, and credential-bearing logs.
- Privacy data map for invite token hashes, session credentials, IP/device rate signals, relay metrics, and Minecraft UUIDs.
- Mod permission policy gate for source, license, redistribution/use conditions, and unofficial-product wording.
- Abuse controls for repeated join requests, invite regeneration/revocation, and block/report-ready metadata.
- Closed-alpha release checklist and executable gate for no public discovery, deployed `X-Robots-Tag`, support redaction probes, and invite accessibility contract.

**Completion Criteria:**

- U9 invite tests pass for valid, expired, revoked, unsupported device, import failure, host offline, and approval timeout states.
- U10 audit, invite-safety, and support redaction tests pass.
- Generated packs fail when a mod lacks required source/permission metadata.
- Public app surfaces and invite pages include unofficial-product wording.
- Router mounting, audit metadata, and local materialization path boundaries fail closed.
- Closed-alpha release can run without exposing public discovery or unredacted support data.

**Stop/Pivot Criteria:**

- The app cannot explain the generated pack and connection mod in a way users trust.
- Mod permission policy blocks all useful fixed packs.
- Abuse/rate-limit signals require more personal data than the privacy model allows.

---

## M6. Curated Catalog Beta

**Status:** In progress. Dependency-free Modrinth-style metadata, curated pack, dependency, side classification, and compatibility-label contracts exist. Real catalog ingestion, operator review workflow, and beta rollout remain pending before full M6 completion.

**Goal:** Expand beyond fixed packs into curated recommended and popular mods after the MVP-0 room loop is validated.

**Deliverables:**

- Modrinth metadata ingestion.
- Loader/version/dependency verification.
- Client-only, server-only, and both-side classification.
- Compatibility labels: `high_confidence`, `caution`, `likely_fail`.
- Known conflict guidance and automatic dependency suggestions.
- Catalog inclusion rules and reviewer/approver role.

**Completion Criteria:**

- A supported Minecraft/Fabric version returns curated mods marked with stable compatibility labels.
- Missing required dependencies are detected and produce an automatic add suggestion.
- Known conflict pairs are shown as caution with plain-language advice.
- Fixed pack generation can be replaced by curated pack generation without changing the invite or room connection model.

**Stop/Pivot Criteria:**

- Compatibility guidance creates false confidence for common mod combinations.
- Catalog curation cost is too high relative to MVP-0 usage.
- Mod source/license metadata is too incomplete for safe recommendations.

---

## M7. Direct P2P Beta

**Status:** In progress. Dependency-free transport candidate exchange, direct selection, privacy copy, and relay fallback contracts exist. Real host/client P2P adapter, privacy approval, and network-pair validation remain pending before full M7 completion.

**Goal:** Reduce relay cost and latency by attempting direct connection with automatic relay fallback.

**Deliverables:**

- Transport candidate exchange through control plane.
- Direct P2P adapter for host app and client mod.
- Relay fallback when direct path fails within the configured timeout.
- User-language IP privacy notice and opt-in/default policy.
- Metrics for direct success rate, fallback rate, latency, disconnects, and relay bytes per room-hour.

**Completion Criteria:**

- Common home-network cases can select a direct path.
- Restricted networks fall back to relay without becoming join failures.
- Direct-mode privacy copy is visible before broad enablement.
- Relay remains available as the reliability fallback.

**Stop/Pivot Criteria:**

- Direct success rate is not high enough to justify added complexity.
- IP privacy expectations conflict with default direct mode.
- Native/Java transport choice increases install friction for friends.

---

## MVP-0 Start Checklist

- [x] Initial app-supported Minecraft versions are selected.
- [x] Fixed verified Fabric packs are selected for each supported Minecraft version.
- [x] Stable Fabric Loader mapping policy is defined.
- [x] Java compatibility and installation prompt policy is defined.
- [x] Alpha relay limits are accepted: one active room, 10 total players, six-hour session, 20-minute idle timeout, 25/40 GB room cap, 150 GB monthly host cap, 24-hour invites.
- [x] Unofficial-product wording is approved.
- [x] Mod reference policy is approved: no third-party rehosting, original allowed URLs plus pinned hashes.
- [x] Connection mod alpha artifact hosting and signing policy is ready.
- [x] MVP-0 explicitly excludes direct P2P, Forge/NeoForge, CurseForge, Prism, generalized compatibility, and public discovery.

## Manual Cross-Check

- `Gate 0` maps to M1.
- `MVP-0` maps to M0-M5.
- `MVP-1` maps to M6.
- `MVP-2` maps to M7.
- U1-U10 are MVP-0 gates.
- U11-U12 are post-MVP-0 beta/operations gates.
- U13 is the direct P2P beta gate.
