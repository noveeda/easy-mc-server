---
title: "M2 Foundation Protocol Control Plane TODO"
type: todo
status: in_progress
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

## Remaining TODO

### Fastify Boundary

- [ ] Choose the minimal Fastify package layout under `services/control-plane/`.
- [x] Add a dependency-free router adapter that calls the existing HTTP-shaped handlers without changing DTOs.
- [ ] Add a real Fastify adapter that calls the existing HTTP-shaped handlers without changing DTOs.
- [ ] Derive host actor identity from trusted request context or middleware, not from request body.
- [ ] Derive service actor identity for session issuance from trusted middleware.
- [ ] Add route tests with Fastify `inject` for room creation, invite creation, safe invite lookup, join request, approval queue, approval decision, invite revoke, and session issuance.
- [ ] Keep the no-dependency handler tests as contract tests beneath the Fastify adapter.

### PostgreSQL Alpha State

- [ ] Define PostgreSQL tables for rooms, invites, approval requests, sessions, presence, and rate-limit counters.
- [ ] Store invite tokens as hashes only.
- [ ] Store session credentials as short-lived, redacted records.
- [ ] Add TTL columns and indexes for invite expiry, presence expiry, and session expiry.
- [ ] Add transaction boundaries for approval decision and one-time session issuance.
- [ ] Add persistence repository tests that prove missing or invalid state fails closed.
- [ ] Add a migration strategy that can run from an empty alpha database.

### Rate Limit And Audit Hooks

- [x] Add dependency-free rate-limit counter contracts with redacted signals.
- [ ] Add join request rate-limit hook points by invite, IP/device signal, and Minecraft identity signal.
- [ ] Add invite regeneration/revocation audit events.
- [ ] Add approval decision audit events without logging tokens or session credentials.
- [ ] Add room/session quota hook points for M4 relay enforcement.
- [ ] Add tests that repeated join attempts can be blocked without exposing room metadata.

### Documentation

- [ ] Document control-plane route ownership and actor derivation rules.
- [ ] Document the persistence model and TTL behavior.
- [ ] Document which errors are safe for friend-facing surfaces.
- [ ] Update M2 milestone status after Fastify and PostgreSQL slices are complete.

## Completion Gate

- [ ] U1 smoke test confirms expected workspace packages and test targets.
- [ ] U2 schema/permission tests pass for host, friend, and service-admin boundaries.
- [ ] U3 room-flow test passes: host online -> invite created -> friend join request -> host approves -> short-lived session issued.
- [ ] Expired/revoked invite tests confirm sensitive room metadata is not exposed.
- [ ] Missing or invalid state fails closed.
- [ ] Fastify route tests preserve the same safe DTOs as the no-dependency handler tests.
- [ ] PostgreSQL-backed alpha state exists for rooms, invites, approvals, sessions, and TTL expiry.

## Validation

- [ ] `npm run test`
- [ ] `git diff --check`
- [ ] Fastify route tests pass.
- [ ] PostgreSQL repository/migration tests pass.

## Stop Or Pivot

- Stop if the control plane cannot express host approval without exposing session credentials early.
- Stop if permission enforcement requires a full account system before closed-alpha validation.
- Pivot if PostgreSQL persistence makes TTL/presence behavior less reliable than the current contract model.
