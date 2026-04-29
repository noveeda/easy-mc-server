---
title: "M2 Foundation Protocol Control Plane TODO"
type: todo
status: completed
milestone: M2
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M2 Foundation, Protocol, Control Plane TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Related plans:**

- [M2 Contract Foundation](../plans/2026-04-30-001-m2-contract-foundation-plan.md)
- [M2 Control Plane HTTP Boundary](../plans/2026-04-30-002-m2-control-plane-http-boundary-plan.md)

## Goal

Make room, invite, approval, session, permission, and TTL flows testable and ready to back the desktop host app, invite helper, relay, and Fabric mods.

## Current State

- [x] Workspace boundaries exist for desktop, invite web, control plane, relay, protocol, and Fabric mods.
- [x] Root `npm run test` covers static prototype checks and protocol/control-plane tests.
- [x] Shared protocol constants and permission rules exist.
- [x] Permission tests cover host, friend, service, and admin boundaries.
- [x] In-memory control-plane simulation covers room, invite, approval, presence, session, TTL, replay, and cross-host failures.
- [x] Privacy tests keep invalid, missing, expired, and revoked invite states safe.
- [x] HTTP-shaped boundary fixes request/response DTOs without opening sockets.
- [x] HTTP boundary redacts raw invite tokens, invite ids, session ids, host ids, and internal timestamps.
- [x] Service session issuance requires a service actor marker at the boundary.
- [x] The service actor boundary issue is documented under `docs/solutions/security-issues/`.
- [x] Dependency-free memory persistence contracts cover rooms, invites, approvals, sessions, rate-limit counters, and audit events.
- [x] Fastify-like router adapter contract preserves the existing HTTP boundary DTOs.
- [x] Persistence contracts redact raw invite tokens, session credentials, invite URLs, and rate-limit signals.
- [x] Missing and expired persistence records fail closed.
- [x] Real Fastify app factory preserves the HTTP DTOs while deriving actors from trusted middleware context.
- [x] PostgreSQL alpha schema and repository contract cover rooms, invites, approvals, sessions, presence, rate-limit counters, and audit events.
- [x] PostgreSQL repository tests cover parameterized SQL, token/session hashing, fail-closed reads, transactions, atomic rate-limit upserts, cleanup, and rollback.
- [x] PostgreSQL migration SQL retrofits existing alpha databases with composite constraints and hashed audit session identifiers.
- [x] Service-level room service contract wraps room, invite, approval, and first session issuance flows.
- [x] Approval decision and first session issuance happen in one service-level transaction when the repository supports transactions.
- [x] Join request rate-limit hooks cover invite, IP/device signal, and Minecraft identity signal.
- [x] Invite revoke/regeneration, approval decision, and quota hook contracts exist without logging raw tokens or session credentials.

## Remaining TODO

### Fastify Boundary

- [x] Choose the minimal Fastify package layout under `services/control-plane/`.
- [x] Add a dependency-free router adapter that calls the existing HTTP-shaped handlers without changing DTOs.
- [x] Add a real Fastify adapter that calls the existing HTTP-shaped handlers without changing DTOs.
- [x] Derive host actor identity from trusted request context or middleware, not from request body.
- [x] Derive service actor identity for session issuance from trusted middleware.
- [x] Add route tests with Fastify `inject` for room creation, invite creation, safe invite lookup, join request, approval queue, approval decision, invite revoke, and session issuance.
- [x] Keep the no-dependency handler tests as contract tests beneath the Fastify adapter.

### PostgreSQL Alpha State

- [x] Define PostgreSQL tables for rooms, invites, approval requests, sessions, presence, and rate-limit counters.
- [x] Store invite tokens as hashes only.
- [x] Store session credentials as short-lived, redacted records.
- [x] Add TTL columns and indexes for invite expiry, presence expiry, and session expiry.
- [x] Add repository transaction boundaries, session `request_id` uniqueness, and atomic rate-limit upserts.
- [x] Add service-level transaction that updates approval decision and issues a one-time session in one operation.
- [x] Add persistence repository tests that prove missing or invalid state fails closed.
- [x] Add a migration strategy that can run from an empty alpha database.
- [x] Add a migration strategy that can harden an already-created alpha database.

### Rate Limit And Audit Hooks

- [x] Add dependency-free rate-limit counter contracts with redacted signals.
- [x] Add join request rate-limit hook points by invite, IP/device signal, and Minecraft identity signal.
- [x] Add invite regeneration/revocation audit events.
- [x] Add approval decision audit events without logging tokens or session credentials.
- [x] Add room/session quota hook points for M4 relay enforcement.
- [x] Add tests that repeated join attempts can be blocked without exposing room metadata.

### Documentation

- [x] Document control-plane route ownership and actor derivation rules.
- [x] Document the persistence model and TTL behavior.
- [x] Document which errors are safe for friend-facing surfaces.
- [x] Update M2 milestone status after Fastify and PostgreSQL slices are complete.

## Completion Gate

- [x] U1 smoke test confirms expected workspace packages and test targets.
- [x] U2 schema/permission tests pass for host, friend, and service-admin boundaries.
- [x] U3 room-flow test passes: host online -> invite created -> friend join request -> host approves -> short-lived session issued.
- [x] Expired/revoked invite tests confirm sensitive room metadata is not exposed.
- [x] Missing or invalid state fails closed.
- [x] Fastify route tests preserve the same safe DTOs as the no-dependency handler tests.
- [x] PostgreSQL-backed alpha state exists for rooms, invites, approvals, sessions, and TTL expiry.

## Validation

- [x] `npm run test`
- [x] `git diff --check`
- [x] Fastify route tests pass.
- [x] PostgreSQL repository/migration tests pass.

## Stop Or Pivot

- Stop if the control plane cannot express host approval without exposing session credentials early.
- Stop if permission enforcement requires a full account system before closed-alpha validation.
- Pivot if PostgreSQL persistence makes TTL/presence behavior less reliable than the current contract model.
