---
title: "M2 Contract Foundation"
type: feature
status: active
created: 2026-04-30
origin: "M2 milestone after desktop-first M1 validation"
scope: standard
---

# M2 Contract Foundation Plan

## Problem Frame

M2 needs room, invite, approval, session, permission, and TTL flows to be testable before the project commits to concrete Fastify/PostgreSQL endpoints. The safest first slice is a no-dependency contract MVP: shared protocol constants, executable permission rules, and an in-memory control-plane domain simulation that future desktop, invite web, Fabric mods, and relay code can all depend on.

## Requirements Trace

| ID | Requirement | Source |
|---|---|---|
| M2-R1 | Create repo boundaries for desktop, invite web, control plane, relay, protocol, and Fabric mods. | Milestone M2 / U1 |
| M2-R2 | Define shared contracts for room, invite, approval, session, transport, install, error, and risk states. | U2 |
| M2-R3 | Implement actor permission matrix as executable contract tests. | M2 completion criteria |
| M2-R4 | Simulate host room creation, invite creation/revocation, friend join request, host approval, and short-lived session issuance. | U3 |
| M2-R5 | Expired, revoked, missing, invalid, and cross-room state must fail closed and avoid sensitive metadata exposure. | Security review and M2 completion criteria |
| M2-R6 | Avoid introducing real backend infrastructure until contracts are stable. | Architecture review |

## Scope

In scope:

- npm workspace boundary and smoke test.
- `packages/protocol` executable constants and permission rules.
- `services/control-plane` in-memory domain model.
- Node built-in `node:test` coverage for permission, privacy, TTL, session replay, identity binding, and cross-room failures.
- Documentation for M2 architecture and package ownership.

Out of scope:

- Fastify routes.
- PostgreSQL schema or migrations.
- Account/login system.
- Relay TCP implementation.
- Tauri/Rust integration.
- Fabric mod code.
- Real `.mrpack` generation.

## Implementation Units

### U1. Workspace Boundaries

**Files:** `package.json`, `pnpm-workspace.yaml`, `tests/smoke/workspace-structure.test.mjs`, `services/relay/README.md`, `mods/client-fabric/README.md`, `mods/server-bridge-fabric/README.md`

**Goal:** Make ownership boundaries visible without adding infrastructure that is not needed yet.

**Scenarios:**

- Smoke test confirms expected directories exist.
- Root `npm run test` executes static prototype checks and M2 contract tests.
- Placeholder packages clearly state their later milestone ownership.

### U2. Protocol Contract Package

**Files:** `packages/protocol/package.json`, `packages/protocol/src/index.mjs`, `packages/protocol/tests/permission-contract.test.mjs`, `docs/architecture/protocol.md`

**Goal:** Put actors, actions, states, risk labels, and safe metadata rules in one executable place.

**Scenarios:**

- Host can create/revoke invites and approve/deny/block join requests for own room.
- Friend cannot create/revoke invites or approve/deny/block requests.
- Service can issue sessions only after authorization.
- Admin cannot approve/deny by default.
- Risk labels are limited to `high_confidence`, `caution`, `likely_fail`.

### U3. Control-Plane Domain Simulation

**Files:** `services/control-plane/package.json`, `services/control-plane/src/domain/simulation.mjs`, `services/control-plane/tests/room-flow.test.mjs`, `services/control-plane/tests/privacy-contract.test.mjs`

**Goal:** Prove the state flow without a server process.

**Scenarios:**

- Host online -> invite created -> friend requests join -> host approves -> short-lived session issued.
- Expired/revoked/invalid/missing invites return the same privacy-safe unavailable response.
- Host A cannot approve or read Host B room approvals.
- Approval is bound to room, invite, and Minecraft UUID.
- A request cannot issue multiple sessions.
- Host offline or expired presence prevents session issuance with safe room-closed response.

## Verification

- `npm run test`
- `git diff --check`

## Residual Risks

- This is a contract MVP, not a networked control plane.
- The in-memory model must not be mistaken for production storage.
- Fastify/PostgreSQL integration will need another review for endpoint, SQL, migration, and operational risks.
