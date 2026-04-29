---
title: "M2 Control Plane HTTP Boundary"
type: feature
status: active
created: 2026-04-30
origin: "M2 contract MVP follow-up"
scope: standard
---

# M2 Control Plane HTTP Boundary Plan

## Problem Frame

The M2 contract MVP proved room, invite, approval, session, permission, and TTL behavior in a no-dependency domain simulation. The next slice should expose that behavior through HTTP-shaped handlers without committing to Fastify, PostgreSQL, or account infrastructure yet.

This keeps the API contract testable while preserving the earlier decision to avoid real backend infrastructure until the permission and privacy model is stable.

## Scope

In scope:

- No-dependency HTTP-like handler layer under `services/control-plane/src/http/`.
- Request/response shapes for room creation, invite creation, safe invite lookup, join request, approval decision, and session issuance.
- Tests that call handlers directly without opening sockets.
- Response redaction rules that prevent invite/session/host metadata leaks.

Out of scope:

- Fastify route registration.
- PostgreSQL persistence.
- Authentication provider integration.
- Network sockets or browser E2E tests.
- Relay implementation.

## Implementation Units

### U1. Handler Boundary

**Files:** `services/control-plane/src/http/handlers.mjs`

**Goal:** Wrap the existing in-memory domain simulation with HTTP-shaped handler functions that future Fastify routes can call.

**Scenarios:**

- Host creates room.
- Host creates invite.
- Friend reads safe invite metadata.
- Friend creates join request.
- Host approves or denies request.
- Service issues session only from an authorized approval.

### U2. HTTP Contract Tests

**Files:** `services/control-plane/tests/http-boundary.test.mjs`

**Goal:** Lock request/response shapes and privacy behavior before adding a real server.

**Scenarios:**

- Happy path returns expected status codes and safe response fields.
- Expired, revoked, missing, and invalid invite lookup responses do not expose room metadata.
- Cross-host approval queue or decision attempts fail closed.
- Session issuance does not expose raw invite token.
- Approved request cannot be replayed for a second session.

### U3. Documentation

**Files:** `services/control-plane/README.md`

**Goal:** Make clear that this is an HTTP boundary contract, not a production server.

## Verification

- `npm run test`
- `git diff --check`

## Residual Risks

- Actual Fastify middleware, authentication, rate limiting, and PostgreSQL persistence still need separate implementation and review.
- Handler tests do not prove transport security because no sockets are opened in this slice.
