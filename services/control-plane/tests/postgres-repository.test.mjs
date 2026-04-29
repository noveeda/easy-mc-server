import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ApprovalStates, ErrorStates, InviteStates, SessionStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { hashSensitiveValue } from "../src/persistence/memory-store.mjs";
import { createPostgresControlPlaneRepository } from "../src/persistence/postgres/repository.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, "../src/persistence/postgres/schema.sql"), "utf8");
const alphaConstraintMigration = readFileSync(
  join(__dirname, "../src/persistence/postgres/migrations/0001-alpha-state-constraints.sql"),
  "utf8"
);

const ROOM_ID = "room-a";
const INVITE_ID = "invite-a";
const REQUEST_ID = "approval-a";
const SESSION_ID = "session-a";
const RAW_INVITE_TOKEN = "invite-token-secret";
const RAW_SESSION_CREDENTIAL = "session-credential-secret";

test("schema defines alpha persistence tables and expiry cleanup indexes", () => {
  for (const table of [
    "rooms",
    "invites",
    "approval_requests",
    "sessions",
    "presence",
    "rate_limit_counters",
    "audit_events"
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }

  assert.match(schema, /\btoken_hash TEXT NOT NULL UNIQUE\b/);
  assert.match(schema, /\bsession_credential_hash TEXT\b/);
  assert.match(schema, /\bsession_id_hash TEXT\b/);
  assert.doesNotMatch(schema, /\btoken TEXT\b/);
  assert.doesNotMatch(schema, /\bsession_credential TEXT\b/);
  assert.doesNotMatch(schema, /\bsession_id TEXT\b/);
  assert.match(schema, /UNIQUE \(id, host_id\)/);
  assert.match(schema, /UNIQUE \(id, room_id\)/);
  assert.match(schema, /UNIQUE \(id, room_id, invite_id\)/);
  assert.match(schema, /FOREIGN KEY \(room_id, host_id\) REFERENCES rooms\(id, host_id\) ON DELETE CASCADE/);
  assert.match(schema, /FOREIGN KEY \(invite_id, room_id\) REFERENCES invites\(id, room_id\) ON DELETE CASCADE/);
  assert.match(
    schema,
    /FOREIGN KEY \(request_id, room_id, invite_id\) REFERENCES approval_requests\(id, room_id, invite_id\) ON DELETE CASCADE/
  );
  assert.match(schema, /idx_invites_expires_at_ttl/);
  assert.match(schema, /idx_sessions_expires_at_ttl/);
  assert.match(schema, /idx_presence_expires_at_ttl/);
  assert.match(schema, /idx_rate_limit_counters_reset_at_ttl/);
  assert.match(schema, /idx_audit_events_session_id_hash_occurred_at/);
});

test("alpha migration retrofits existing databases with validated integrity constraints", () => {
  assert.match(alphaConstraintMigration, /ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id_hash TEXT/);
  assert.match(alphaConstraintMigration, /ALTER TABLE audit_events DROP COLUMN IF EXISTS session_id/);
  assert.match(alphaConstraintMigration, /DELETE FROM presence p/);
  assert.match(alphaConstraintMigration, /DELETE FROM sessions s/);
  assert.match(alphaConstraintMigration, /DELETE FROM approval_requests ar/);
  assert.match(alphaConstraintMigration, /ADD CONSTRAINT rooms_id_host_id_unique UNIQUE \(id, host_id\)/);
  assert.match(alphaConstraintMigration, /ADD CONSTRAINT approval_requests_invite_room_fk/);
  assert.match(alphaConstraintMigration, /NOT VALID/);
  assert.match(alphaConstraintMigration, /VALIDATE CONSTRAINT approval_requests_invite_room_fk/);
  assert.match(alphaConstraintMigration, /VALIDATE CONSTRAINT sessions_request_room_invite_fk/);
  assert.match(alphaConstraintMigration, /VALIDATE CONSTRAINT presence_room_host_fk/);
});

test("repository writes records in transactions without raw invite or session secrets", async () => {
  const clock = createMemoryClock();
  const { pool, calls } = createFakePool();
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  const invite = await repository.saveInvite({
    id: INVITE_ID,
    roomId: ROOM_ID,
    token: RAW_INVITE_TOKEN,
    state: InviteStates.ACTIVE,
    createdAt: clock.now(),
    expiresAt: clock.now() + 60_000
  });
  assert.equal(invite.ok, true);
  assert.equal(invite.invite.tokenHash, hashSensitiveValue(RAW_INVITE_TOKEN));
  assert.equal(Object.hasOwn(invite.invite, "token"), false);

  const session = await repository.saveSession({
    id: SESSION_ID,
    roomId: ROOM_ID,
    inviteId: INVITE_ID,
    requestId: REQUEST_ID,
    minecraftUuid: "uuid-a",
    sessionCredential: RAW_SESSION_CREDENTIAL,
    state: SessionStates.ISSUED,
    issuedAt: clock.now(),
    expiresAt: clock.now() + 60_000
  });
  assert.equal(session.ok, true);
  assert.equal(session.session.sessionCredentialHash, hashSensitiveValue(RAW_SESSION_CREDENTIAL));
  assert.equal(Object.hasOwn(session.session, "sessionCredential"), false);

  assert.equal(calls.filter((call) => call.sql === "BEGIN").length, 2);
  assert.equal(calls.filter((call) => call.sql === "COMMIT").length, 2);
  assert.equal(calls.some((call) => call.sql === "ROLLBACK"), false);

  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes(RAW_INVITE_TOKEN), false);
  assert.equal(serializedCalls.includes(RAW_SESSION_CREDENTIAL), false);
  assert.equal(serializedCalls.includes(hashSensitiveValue(RAW_INVITE_TOKEN)), true);
  assert.equal(serializedCalls.includes(hashSensitiveValue(RAW_SESSION_CREDENTIAL)), true);

  const insertInvite = calls.find((call) => call.sql.includes("INSERT INTO invites"));
  assert.equal(insertInvite.params[0], INVITE_ID);
  assert.equal(insertInvite.params[2], hashSensitiveValue(RAW_INVITE_TOKEN));
  assert.match(insertInvite.sql, /\$1/);
  assert.match(insertInvite.sql, /WHERE invites\.room_id = EXCLUDED\.room_id/);
});

test("repository rolls back and releases client when a transactional write fails", async () => {
  const error = new Error("insert failed");
  const { pool, calls, clients } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.includes("INSERT INTO rooms"),
        result: () => {
          throw error;
        }
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool });

  await assert.rejects(
    () =>
      repository.saveRoom({
        id: ROOM_ID,
        hostId: "host-a",
        state: "open",
        createdAt: 1
      }),
    error
  );

  assert.deepEqual(
    calls.map((call) => call.sql),
    ["BEGIN", calls[1].sql, "ROLLBACK"]
  );
  assert.equal(clients[0].released, true);
});

test("repository rejects immutable identity reparenting on conflict", async () => {
  const { pool, calls } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.includes("INSERT INTO invites"),
        result: () => ({ rows: [], rowCount: 0 })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool });

  await assert.rejects(
    () =>
      repository.saveInvite({
        id: INVITE_ID,
        roomId: "different-room",
        token: RAW_INVITE_TOKEN,
        state: InviteStates.ACTIVE,
        createdAt: 1
      }),
    /invite identity conflict/
  );

  assert.equal(calls.some((call) => call.sql === "ROLLBACK"), true);
  const inviteInsert = calls.find((call) => call.sql.includes("INSERT INTO invites"));
  assert.match(inviteInsert.sql, /AND invites\.token_hash = EXCLUDED\.token_hash/);
});

test("repository rejects presence host reparenting on conflict", async () => {
  const { pool, calls } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.includes("INSERT INTO presence"),
        result: () => ({ rows: [], rowCount: 0 })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool });

  await assert.rejects(
    () =>
      repository.savePresence({
        roomId: ROOM_ID,
        hostId: "different-host",
        state: "online",
        lastSeenAt: 1,
        expiresAt: 2
      }),
    /presence identity conflict/
  );

  const presenceInsert = calls.find((call) => call.sql.includes("INSERT INTO presence"));
  assert.doesNotMatch(presenceInsert.sql, /SET host_id = EXCLUDED\.host_id/);
  assert.match(presenceInsert.sql, /WHERE presence\.host_id = EXCLUDED\.host_id/);
});

test("invite and session reads fail closed for missing, invalid, expired, and revoked rows", async () => {
  const clock = createMemoryClock();
  const now = clock.now();
  const { pool } = createFakePool({
    handlers: [
      {
        match: (sql, params) => sql.includes("FROM invites") && params[0] === hashSensitiveValue("active-token"),
        result: () => ({
          rows: [
            {
              id: INVITE_ID,
              roomId: ROOM_ID,
              tokenHash: hashSensitiveValue("active-token"),
              state: InviteStates.ACTIVE,
              expiresAt: now + 1000
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM invites") && params[0] === hashSensitiveValue("expired-token"),
        result: () => ({
          rows: [
            {
              id: INVITE_ID,
              roomId: ROOM_ID,
              tokenHash: hashSensitiveValue("expired-token"),
              state: InviteStates.ACTIVE,
              expiresAt: now - 1
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM invites") && params[0] === hashSensitiveValue("revoked-token"),
        result: () => ({
          rows: [
            {
              id: INVITE_ID,
              roomId: ROOM_ID,
              tokenHash: hashSensitiveValue("revoked-token"),
              state: InviteStates.REVOKED,
              expiresAt: now + 1000
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM sessions") && params[0] === "issued-session",
        result: () => ({
          rows: [
            {
              id: "issued-session",
              roomId: ROOM_ID,
              inviteId: INVITE_ID,
              requestId: REQUEST_ID,
              minecraftUuid: "uuid-a",
              state: SessionStates.ISSUED,
              expiresAt: now + 1000
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM sessions") && params[0] === "expired-session",
        result: () => ({
          rows: [
            {
              id: "expired-session",
              state: SessionStates.ISSUED,
              expiresAt: now - 1
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM sessions") && params[0] === "revoked-session",
        result: () => ({
          rows: [
            {
              id: "revoked-session",
              state: SessionStates.REVOKED,
              expiresAt: now + 1000
            }
          ]
        })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  assert.equal((await repository.readInviteByToken("active-token")).invite.id, INVITE_ID);
  assert.deepEqual(await repository.readInviteByToken(""), { ok: false, reason: ErrorStates.INVITE_UNAVAILABLE });
  assert.deepEqual(await repository.readInviteByToken("missing-token"), {
    ok: false,
    reason: ErrorStates.INVITE_UNAVAILABLE
  });
  assert.deepEqual(await repository.readInviteByToken("expired-token"), {
    ok: false,
    reason: ErrorStates.INVITE_UNAVAILABLE
  });
  assert.deepEqual(await repository.readInviteByToken("revoked-token"), {
    ok: false,
    reason: ErrorStates.INVITE_UNAVAILABLE
  });

  assert.equal((await repository.readSession("issued-session")).session.id, "issued-session");
  assert.deepEqual(await repository.readSession("missing-session"), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
  assert.deepEqual(await repository.readSession("expired-session"), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
  assert.deepEqual(await repository.readSession("revoked-session"), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});

test("rate limit counters use hashed signals and atomic conflict increments", async () => {
  const clock = createMemoryClock();
  const signal = "invite-a|ip:203.0.113.7|device:desktop|uuid-a";
  const signalHash = hashSensitiveValue(signal);
  const { pool, calls } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.includes("INSERT INTO rate_limit_counters"),
        result: () => ({
          rows: [
            {
              id: `join_request:${signalHash}`,
              scope: "join_request",
              signalHash,
              count: 1,
              limit: 2,
              windowMs: 10_000,
              resetAt: clock.now() + 10_000
            }
          ],
          rowCount: 1
        })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  const first = await repository.incrementRateLimitCounter({
    scope: "join_request",
    signal,
    limit: 2,
    windowMs: 10_000
  });

  assert.deepEqual(first, {
    ok: true,
    scope: "join_request",
    signalHash,
    count: 1,
    limit: 2,
    remaining: 1,
    resetAt: clock.now() + 10_000
  });
  assert.equal(JSON.stringify(calls).includes(signal), false);
  assert.equal(JSON.stringify(calls).includes(signalHash), true);
  const upsert = calls.find((call) => call.sql.includes("INSERT INTO rate_limit_counters"));
  assert.match(upsert.sql, /ON CONFLICT \(scope, signal_hash\) DO UPDATE SET/);
  assert.match(upsert.sql, /rate_limit_counters\.count \+ 1/);
  assert.match(upsert.sql, /RETURNING id, scope, signal_hash AS "signalHash"/);
  assert.equal(calls.some((call) => call.sql.includes("FOR UPDATE")), false);
});

test("audit events redact sensitive metadata and use parameterized filters", async () => {
  const clock = createMemoryClock();
  const { pool, calls } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.includes("FROM audit_events"),
        result: () => ({
          rows: [
            {
              id: "audit-a",
              type: "invite_created",
              roomId: ROOM_ID,
              metadata: { tokenHash: hashSensitiveValue(RAW_INVITE_TOKEN) },
              occurredAt: clock.now()
            }
          ]
        })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  const event = await repository.recordAuditEvent({
    id: "audit-a",
    type: "invite_created",
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    metadata: {
      token: RAW_INVITE_TOKEN,
      sessionCredential: RAW_SESSION_CREDENTIAL
    }
  });

  assert.equal(event.event.metadata.tokenHash, hashSensitiveValue(RAW_INVITE_TOKEN));
  assert.equal(event.event.metadata.sessionCredentialHash, hashSensitiveValue(RAW_SESSION_CREDENTIAL));
  assert.equal(event.event.sessionIdHash, hashSensitiveValue(SESSION_ID));
  assert.equal(Object.hasOwn(event.event, "sessionId"), false);
  assert.equal(JSON.stringify(event).includes(RAW_INVITE_TOKEN), false);
  assert.equal(JSON.stringify(event).includes(SESSION_ID), false);
  assert.equal(JSON.stringify(calls).includes(RAW_SESSION_CREDENTIAL), false);
  assert.equal(JSON.stringify(calls).includes(hashSensitiveValue(SESSION_ID)), true);

  const events = await repository.readAuditEvents({ type: "invite_created", roomId: ROOM_ID });
  assert.equal(events.length, 1);
  const read = calls.find((call) => call.sql.includes("FROM audit_events"));
  assert.match(read.sql, /type = \$1/);
  assert.match(read.sql, /room_id = \$2/);
  assert.deepEqual(read.params, ["invite_created", ROOM_ID]);
});

test("approval and presence repository methods preserve expected closed behavior", async () => {
  const clock = createMemoryClock();
  const { pool } = createFakePool({
    handlers: [
      {
        match: (sql, params) => sql.includes("FROM approval_requests") && params[0] === REQUEST_ID,
        result: () => ({
          rows: [
            {
              id: REQUEST_ID,
              roomId: ROOM_ID,
              inviteId: INVITE_ID,
              minecraftUuid: "uuid-a",
              state: ApprovalStates.APPROVED
            }
          ]
        })
      },
      {
        match: (sql, params) => sql.includes("FROM presence") && params[0] === ROOM_ID,
        result: () => ({
          rows: [
            {
              roomId: ROOM_ID,
              hostId: "host-a",
              state: "online",
              lastSeenAt: clock.now(),
              expiresAt: clock.now() + 1000
            }
          ]
        })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  assert.equal((await repository.readApproval(REQUEST_ID)).approval.state, ApprovalStates.APPROVED);
  assert.deepEqual(await repository.readApproval("missing-approval"), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
  assert.equal((await repository.readPresence(ROOM_ID)).presence.hostId, "host-a");
  assert.deepEqual(await repository.readPresence("missing-room"), {
    ok: false,
    reason: ErrorStates.ROOM_CLOSED
  });
});

test("cleanupExpiredState removes expired transient rows without raw identifiers", async () => {
  const clock = createMemoryClock();
  const { pool, calls } = createFakePool({
    handlers: [
      {
        match: (sql) => sql.startsWith("DELETE FROM sessions"),
        result: () => ({ rows: [], rowCount: 2 })
      },
      {
        match: (sql) => sql.startsWith("DELETE FROM invites"),
        result: () => ({ rows: [], rowCount: 1 })
      },
      {
        match: (sql) => sql.startsWith("DELETE FROM presence"),
        result: () => ({ rows: [], rowCount: 1 })
      },
      {
        match: (sql) => sql.startsWith("DELETE FROM rate_limit_counters"),
        result: () => ({ rows: [], rowCount: 3 })
      }
    ]
  });
  const repository = createPostgresControlPlaneRepository({ pool, clock });

  assert.deepEqual(await repository.cleanupExpiredState(), {
    ok: true,
    sessions: 2,
    invites: 1,
    presence: 1,
    rateLimits: 3
  });

  assert.equal(calls.filter((call) => call.sql === "BEGIN").length, 1);
  assert.equal(calls.filter((call) => call.sql === "COMMIT").length, 1);
  assert.equal(calls.every((call) => JSON.stringify(call.params).includes(RAW_INVITE_TOKEN) === false), true);
  assert.match(
    calls.find((call) => call.sql.startsWith("DELETE FROM invites")).sql,
    /NOT EXISTS \( SELECT 1 FROM sessions WHERE sessions\.invite_id = invites\.id \)/
  );
});

function createFakePool({ handlers = [] } = {}) {
  const calls = [];
  const clients = [];

  const execute = async (sql, params = []) => {
    calls.push({ sql: normalizeSql(sql), params });
    const handler = handlers.find((candidate) => candidate.match(sql, params));
    if (!handler) {
      return defaultFakeResult(sql, params);
    }

    return handler.result(sql, params);
  };

  return {
    calls,
    clients,
    pool: {
      query: execute,
      async connect() {
        const client = {
          released: false,
          query: execute,
          release() {
            this.released = true;
          }
        };
        clients.push(client);
        return client;
      }
    }
  };
}

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function defaultFakeResult(sql, params) {
  const normalized = normalizeSql(sql);
  if (normalized.startsWith("INSERT INTO") && normalized.includes("RETURNING id")) {
    return { rows: [{ id: params[0] }], rowCount: 1 };
  }

  if (normalized.startsWith("INSERT INTO") && normalized.includes("RETURNING room_id")) {
    return { rows: [{ roomId: params[0] }], rowCount: 1 };
  }

  if (normalized.startsWith("DELETE FROM")) {
    return { rows: [], rowCount: 0 };
  }

  return { rows: [] };
}
