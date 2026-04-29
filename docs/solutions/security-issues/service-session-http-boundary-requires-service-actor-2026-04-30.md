---
title: "Service session HTTP boundary requires service actor"
date: 2026-04-30
category: docs/solutions/security-issues
module: local-minecraft-room
problem_type: security_issue
component: service_object
symptoms:
  - "HTTP-like session issuance accepted requestId and minecraftUuid without validating a service actor"
root_cause: missing_permission
resolution_type: code_fix
severity: high
tags: [control-plane, session, permission, http-boundary, m2]
---

# Service session HTTP boundary requires service actor

## Problem

The M2 HTTP-like control-plane boundary initially exposed `POST /service/sessions` without validating that the caller was the service actor. The domain layer still required an authorized approval, but the HTTP boundary let any caller with `requestId` and `minecraftUuid` attempt first session issuance.

## Symptoms

- `services/control-plane/src/http/handlers.mjs` called `issueSession(body)` directly.
- Boundary tests covered replay protection but not missing or non-service actors.

## What Didn't Work

- Relying only on domain approval binding was insufficient. Approval binding prevents wrong room/invite/UUID and replay, but it does not prove that the HTTP caller is allowed to ask the service to mint a session.

## Solution

Require `x-actor-type: service` at the HTTP boundary before session issuance:

```js
if (actorType !== Actors.SERVICE) {
  return domainError(ErrorStates.SESSION_UNAVAILABLE);
}
```

Add boundary tests for:

- Missing actor type.
- Non-service actor type.
- Valid service actor type.
- Wrong Minecraft UUID before first issuance.
- Expired/revoked invite after approval but before session issuance.

## Why This Works

The invite link and approval request remain insufficient to mint a session. The boundary now requires both a valid domain authorization and the service actor marker before returning a session handle.

## Prevention

- Any future Fastify route for session issuance must derive service identity from trusted middleware, not from request body.
- Keep negative tests for missing actor, friend actor, wrong UUID, replay, expired invite, and revoked invite.
- Do not expose raw `sessionId` or invite token in HTTP response DTOs.

## Related Issues

- `services/control-plane/src/http/handlers.mjs`
- `services/control-plane/tests/http-boundary.test.mjs`
- `docs/plans/2026-04-30-002-m2-control-plane-http-boundary-plan.md`
