---
title: "PostgreSQL alpha state needs relationship constraints"
date: 2026-04-30
category: docs/solutions/database-issues
module: local-minecraft-room
problem_type: database_issue
component: database
symptoms:
  - "PostgreSQL repository contract allowed room, invite, request, and presence identities to drift"
root_cause: missing_validation
resolution_type: migration
severity: high
tags: [postgres, migrations, data-integrity, control-plane, m2]
---

# PostgreSQL alpha state needs relationship constraints

## Problem

The first PostgreSQL alpha schema described the required tables, but it did not fully enforce cross-table identity relationships or existing-database migrations. A buggy write could create rows that looked valid individually while tying a session or presence heartbeat to the wrong room/host relationship.

## Symptoms

- `approval_requests` and `sessions` had separate foreign keys instead of composite constraints that prove the invite/request belongs to the same room.
- `presence` could update `host_id` on `room_id` conflict, diverging from the canonical room host.
- The bootstrap schema used `CREATE TABLE IF NOT EXISTS`, which does not retrofit constraints into an already-created alpha database.
- Top-level audit `sessionId` was sanitized into `sessionIdHash`, but the insert still read `stored.sessionId`, dropping session audit correlation.

## What Didn't Work

- Relying on repository call order was insufficient. Tests can prove happy-path writes, but the database still needs constraints for bad writes, replayed writes, and future service code.
- Calling expiry indexes "TTL indexes" was imprecise. PostgreSQL indexes help cleanup queries, but they do not expire data by themselves.

## Solution

Add the integrity rules at both schema and repository levels:

- `rooms(id, host_id)`, `invites(id, room_id)`, and `approval_requests(id, room_id, invite_id)` composite uniqueness.
- Composite foreign keys from `approval_requests` to `invites`, from `sessions` to `approval_requests`, and from `presence` to `rooms`.
- Conflict updates that refuse immutable identity changes by using `WHERE ... = EXCLUDED... RETURNING ...` and treating no returned row as an identity conflict.
- Atomic `INSERT ... ON CONFLICT ... DO UPDATE` rate-limit increments instead of read-then-write counters.
- `cleanupExpiredState()` for expired sessions, invites, presence, and rate-limit counters.
- A migration file using cleanup, `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID`, and `VALIDATE CONSTRAINT` for existing alpha databases.
- Hashed audit `session_id_hash` storage instead of raw or dropped session identifiers.

## Why This Works

The database now validates the same authorization facts that the domain simulation depends on: a session must point to a request for the same room and invite, and presence must point to the room's real host. Repository guards stop accidental reparenting before the write is considered successful, while migrations make those constraints apply to early alpha databases too.

## Prevention

- Treat `schema.sql` as empty-database bootstrap only; add explicit migrations for already-created alpha databases.
- Use composite foreign keys when authorization depends on more than one identifier.
- Do not update parent identity columns in upserts unless the operation is explicitly a reparenting workflow.
- Test SQL shape for privacy and integrity, not just returned DTOs.

## Related Issues

- `services/control-plane/src/persistence/postgres/schema.sql`
- `services/control-plane/src/persistence/postgres/migrations/0001-alpha-state-constraints.sql`
- `services/control-plane/src/persistence/postgres/repository.mjs`
- `services/control-plane/tests/postgres-repository.test.mjs`
