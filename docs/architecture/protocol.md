---
title: "Protocol Contracts"
type: architecture
status: draft
created: 2026-04-30
---

# Protocol Contracts

M2 starts with executable protocol contracts in `packages/protocol`. The package intentionally uses dependency-free JavaScript modules so desktop, invite web, control-plane, Fabric mod build tooling, and relay implementation can agree on names and permission behavior before any specific server framework is introduced.

## Primary Contracts

- Actors: `host`, `friend`, `service`, `service_admin`
- Room states: `created`, `open`, `closed`, `host_offline`
- Invite states: `active`, `expired`, `revoked`, `unavailable`
- Approval states: `pending`, `approved`, `denied`, `blocked`, `expired`, `host_unavailable`, `already_allowed`, `identity_changed`
- Session states: `issued`, `expired`, `revoked`
- Risk labels: `high_confidence`, `caution`, `likely_fail`

## Privacy Rule

Inactive, invalid, missing, expired, and revoked invites must collapse to the same safe response shape:

```json
{
  "unavailable": true,
  "reason": "invite_unavailable"
}
```

This avoids making invite status responses an oracle for room existence, host availability, approval queue state, pack URLs, or session credentials.

## Permission Rule

The invite link is not a session credential. It can create a join request, but it cannot grant room access. A session is issued only after an approved request is bound to the same room, invite, and Minecraft UUID.
