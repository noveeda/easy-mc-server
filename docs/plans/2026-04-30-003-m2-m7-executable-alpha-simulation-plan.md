---
title: "M2-M7 Executable Alpha Simulation"
type: feature
status: active
created: 2026-04-30
origin: "User request to develop M2 through M7"
scope: deep
---

# M2-M7 Executable Alpha Simulation Plan

## Problem Frame

M2-M7 describe a full local Minecraft room product: control plane persistence, Windows host runtime, Fabric bridge/client behavior, relay transport, alpha safety, curated catalog, and direct P2P fallback. The repository currently contains no real Tauri, Fastify, PostgreSQL, Rust relay, or Fabric build system, so this implementation must advance the product through executable contracts and simulations that can run with the existing dependency-free Node test setup.

The goal of this slice is not to claim production readiness for every milestone. The goal is to turn each milestone into testable code paths and durable contracts so later real adapters can be plugged in without re-deciding product behavior.

---

## Scope Boundaries

- In scope: dependency-free JavaScript modules, tests, docs, and checklist updates for M2-M7 behavior.
- In scope: simulated Fastify-like routing, PostgreSQL-like persistence contracts, desktop runtime bootstrap contracts, relay guardrails, support redaction, curated catalog compatibility, and direct P2P fallback selection.
- Out of scope: installing new packages, opening sockets, running Minecraft, building real Fabric jars, packaging a Windows app, provisioning PostgreSQL, or deploying a relay.
- Out of scope: marking M2-M7 production-complete; these remain implementation gates until real adapters and manual Minecraft validation exist.

---

## Implementation Units

- U1. **M2 Durable Control-Plane Contracts**

**Goal:** Add persistence, rate-limit, audit, and route-adapter contracts around the existing control-plane simulation.

**Files:**
- Create: `services/control-plane/src/persistence/memory-store.mjs`
- Create: `services/control-plane/src/http/router-adapter.mjs`
- Create: `services/control-plane/tests/persistence-contract.test.mjs`
- Create: `services/control-plane/tests/router-adapter.test.mjs`
- Modify: `services/control-plane/package.json`

**Test scenarios:**
- Happy path: room, invite, approval, and session records can be persisted and read without raw token exposure.
- Error path: missing records fail closed.
- Edge case: repeated join attempts trip a rate-limit counter.
- Integration: route adapter preserves current HTTP boundary DTOs.

- U2. **M3 Host Runtime Contracts**

**Goal:** Model the desktop runtime decisions for Java detection, Fabric bootstrap, EULA, room file layout, server lifecycle, and bridge approval events.

**Files:**
- Create: `apps/desktop/src/runtime/host-runtime.mjs`
- Create: `apps/desktop/tests/host-runtime.test.mjs`
- Modify: `apps/desktop/README.md`

**Test scenarios:**
- Happy path: supported version, compatible Java, EULA, and fixed pack produce a runnable room plan.
- Error path: missing Java, incompatible Java, missing EULA, checksum failure, and crash states return room-language failures.
- Integration: server-observed UUID creates an approval event while claimed identity cannot bypass it.

- U3. **M4 Relay And Client Connection Contracts**

**Goal:** Add relay session authorization, open-proxy guardrails, quotas, client loopback planning, and host tunnel lifecycle simulation.

**Files:**
- Create: `services/relay/src/relay-simulation.mjs`
- Create: `services/relay/tests/relay-simulation.test.mjs`
- Create: `mods/client-fabric/src/connection/loopback-plan.mjs`
- Create: `mods/client-fabric/tests/loopback-plan.test.mjs`
- Modify: `services/relay/README.md`
- Modify: `mods/client-fabric/README.md`

**Test scenarios:**
- Happy path: approved relay session pairs friend stream with host room target.
- Error path: unauthenticated, expired, cross-room, wrong-UUID, and arbitrary TCP attempts fail closed.
- Edge case: room size, duration, idle, room bandwidth, and monthly host caps are enforced.
- Integration: client loopback plan never logs invite or session tokens.

- U4. **M5 Alpha Safety Contracts**

**Goal:** Add invite failure-state copy, support redaction, privacy data map, mod permission gates, and audit event contracts.

**Files:**
- Create: `packages/safety/src/index.mjs`
- Create: `packages/safety/tests/safety-contract.test.mjs`
- Create: `packages/safety/package.json`
- Create: `docs/security/privacy-data-map.md`
- Create: `docs/product/mod-permission-policy.md`
- Modify: `package.json`

**Test scenarios:**
- Happy path: safe invite states produce button-focused recovery actions.
- Error path: support bundle redacts tokens, raw invite URLs, IPs, session keys, and credential-like strings.
- Edge case: pack policy fails when source, license, permission, or hash metadata is missing.

- U5. **M6 Curated Catalog Contracts**

**Goal:** Add Modrinth-style metadata ingestion and compatibility risk evaluation for curated mods.

**Files:**
- Create: `packages/mod-catalog/src/index.mjs`
- Create: `packages/mod-catalog/tests/mod-catalog.test.mjs`
- Create: `packages/mod-catalog/package.json`
- Create: `packages/compatibility-engine/src/index.mjs`
- Create: `packages/compatibility-engine/tests/compatibility-engine.test.mjs`
- Create: `packages/compatibility-engine/package.json`

**Test scenarios:**
- Happy path: compatible Fabric mods are labeled `high_confidence`.
- Error path: missing dependencies become `likely_fail` with automatic add suggestions.
- Edge case: known conflicts become `caution` with plain-language advice.
- Integration: curated pack output preserves original URLs and hashes.

- U6. **M7 Direct P2P Fallback Contracts**

**Goal:** Add transport candidate exchange and selection rules that prefer direct only when safe, otherwise relay fallback.

**Files:**
- Create: `services/control-plane/src/transport/candidates.mjs`
- Create: `services/control-plane/tests/transport-candidates.test.mjs`
- Create: `docs/architecture/p2p-risk.md`

**Test scenarios:**
- Happy path: common home-network candidate selects direct path.
- Error path: expired or cross-room candidates are rejected.
- Edge case: restricted networks fall back to relay within timeout.
- Integration: selected path exposes privacy copy for direct mode and never makes direct failure a join failure.

---

## Key Technical Decisions

- Keep this slice dependency-free so the current repo can test it immediately.
- Treat real Tauri/Fastify/PostgreSQL/Rust/Fabric adapters as later adapters over these contracts.
- Keep user-facing failure text in room language; restrict network/server terms to diagnostics docs.
- Preserve relay-only MVP-0 as the required path; direct P2P remains a beta optimization with relay fallback.

---

## Verification

- `npm run test`
- `git diff --check`
- Manual review that M2-M7 TODO documents still distinguish executable contracts from production completion gates.

---

## Residual Risks

- Real Minecraft, Fabric, relay socket, and Windows packaging validation still require separate implementation and manual/E2E testing.
- PostgreSQL and Fastify production adapters still need dependency decisions and security review before alpha traffic.
- Direct P2P privacy defaults must be approved before broad enablement.
