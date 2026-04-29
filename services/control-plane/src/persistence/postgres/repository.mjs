import { randomUUID } from "node:crypto";
import { ErrorStates, InviteStates, SessionStates } from "../../protocol.mjs";
import { hashSensitiveValue } from "../memory-store.mjs";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const SENSITIVE_KEY_NAMES = new Set([
  "accesstoken",
  "authorization",
  "cookie",
  "credential",
  "devicesignal",
  "ip",
  "ipaddress",
  "inviteurl",
  "invitetoken",
  "minecraftaccesstoken",
  "password",
  "rawtoken",
  "refreshtoken",
  "secret",
  "sessioncredential",
  "sessionid",
  "sessionkey",
  "sessiontoken",
  "token"
]);

export function createPostgresControlPlaneRepository(options = {}) {
  if (!options.pool) {
    throw new TypeError("postgres repository requires a pool");
  }

  const { pool } = options;
  const clock = options.clock ?? { now: () => Date.now() };

  return {
    saveRoom,
    readRoom,
    saveInvite,
    readInvite,
    readInviteByToken,
    saveApproval,
    readApproval,
    saveSession,
    readSession,
    savePresence,
    readPresence,
    incrementRateLimitCounter,
    readRateLimitCounter,
    cleanupExpiredState,
    recordAuditEvent,
    readAuditEvents
  };

  async function saveRoom(record) {
    const stored = sanitizeRecord(requireRecordId(record, "room"));
    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO rooms (id, host_id, alias, minecraft_version, pack_profile_name, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           alias = EXCLUDED.alias,
           minecraft_version = EXCLUDED.minecraft_version,
           pack_profile_name = EXCLUDED.pack_profile_name,
           state = EXCLUDED.state,
           updated_at = EXCLUDED.updated_at
         WHERE rooms.host_id = EXCLUDED.host_id
         RETURNING id`,
        [
          stored.id,
          stored.hostId,
          stored.alias ?? null,
          stored.minecraftVersion ?? null,
          stored.packProfileName ?? null,
          stored.state,
          stored.createdAt ?? clock.now(),
          stored.updatedAt ?? clock.now()
        ]
      ).then((result) => assertMutationSucceeded(result, "room identity conflict"));
    });

    return { ok: true, room: clone(stored) };
  }

  async function readRoom(roomId) {
    const result = await pool.query(
      `SELECT id, host_id AS "hostId", alias, minecraft_version AS "minecraftVersion",
              pack_profile_name AS "packProfileName", state, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM rooms
       WHERE id = $1`,
      [roomId]
    );
    const room = result.rows[0];
    return room ? { ok: true, room: clone(room) } : fail(ErrorStates.SESSION_UNAVAILABLE);
  }

  async function saveInvite(record) {
    const input = requireRecordId(record, "invite");
    const stored = sanitizeRecord(input);
    if (input.token && !stored.tokenHash) {
      stored.tokenHash = hashSensitiveValue(input.token);
    }

    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO invites (id, room_id, token_hash, state, created_at, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           state = EXCLUDED.state,
           expires_at = EXCLUDED.expires_at,
           revoked_at = EXCLUDED.revoked_at
         WHERE invites.room_id = EXCLUDED.room_id
           AND invites.token_hash = EXCLUDED.token_hash
         RETURNING id`,
        [
          stored.id,
          stored.roomId,
          stored.tokenHash,
          stored.state,
          stored.createdAt ?? clock.now(),
          stored.expiresAt ?? null,
          stored.revokedAt ?? null
        ]
      ).then((result) => assertMutationSucceeded(result, "invite identity conflict"));
    });

    return { ok: true, invite: clone(stored) };
  }

  async function readInvite(inviteId) {
    const invite = await selectInviteBy("id", inviteId);
    return invite ? { ok: true, invite } : fail(ErrorStates.INVITE_UNAVAILABLE);
  }

  async function readInviteByToken(token) {
    if (!token) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    const invite = await selectInviteBy("tokenHash", hashSensitiveValue(token));
    if (!isInviteUsable(invite)) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    return { ok: true, invite };
  }

  async function saveApproval(record) {
    const stored = sanitizeRecord(requireRecordId(record, "approval"));
    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO approval_requests
           (id, room_id, invite_id, friend_id, minecraft_uuid, display_name, state, created_at, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           state = EXCLUDED.state,
           decided_at = EXCLUDED.decided_at
         WHERE approval_requests.room_id = EXCLUDED.room_id
           AND approval_requests.invite_id = EXCLUDED.invite_id
           AND approval_requests.minecraft_uuid = EXCLUDED.minecraft_uuid
           AND COALESCE(approval_requests.friend_id, '') = COALESCE(EXCLUDED.friend_id, '')
         RETURNING id`,
        [
          stored.id,
          stored.roomId,
          stored.inviteId,
          stored.friendId ?? null,
          stored.minecraftUuid,
          stored.displayName ?? null,
          stored.state,
          stored.createdAt ?? clock.now(),
          stored.decidedAt ?? null
        ]
      ).then((result) => assertMutationSucceeded(result, "approval identity conflict"));
    });

    return { ok: true, approval: clone(stored) };
  }

  async function readApproval(approvalId) {
    const result = await pool.query(
      `SELECT id, room_id AS "roomId", invite_id AS "inviteId", friend_id AS "friendId",
              minecraft_uuid AS "minecraftUuid", display_name AS "displayName",
              state, created_at AS "createdAt", decided_at AS "decidedAt"
       FROM approval_requests
       WHERE id = $1`,
      [approvalId]
    );
    const approval = result.rows[0];
    return approval ? { ok: true, approval: clone(approval) } : fail(ErrorStates.SESSION_UNAVAILABLE);
  }

  async function saveSession(record) {
    const input = requireRecordId(record, "session");
    const stored = sanitizeRecord(input);
    if (input.sessionCredential && !stored.sessionCredentialHash) {
      stored.sessionCredentialHash = hashSensitiveValue(input.sessionCredential);
    }

    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO sessions
           (id, room_id, invite_id, request_id, minecraft_uuid, session_credential_hash, state, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           state = EXCLUDED.state,
           expires_at = EXCLUDED.expires_at
         WHERE sessions.room_id = EXCLUDED.room_id
           AND sessions.invite_id = EXCLUDED.invite_id
           AND sessions.request_id = EXCLUDED.request_id
           AND sessions.minecraft_uuid = EXCLUDED.minecraft_uuid
           AND COALESCE(sessions.session_credential_hash, '') = COALESCE(EXCLUDED.session_credential_hash, '')
         RETURNING id`,
        [
          stored.id,
          stored.roomId,
          stored.inviteId,
          stored.requestId,
          stored.minecraftUuid,
          stored.sessionCredentialHash ?? null,
          stored.state,
          stored.issuedAt ?? clock.now(),
          stored.expiresAt ?? null
        ]
      ).then((result) => assertMutationSucceeded(result, "session identity conflict"));
    });

    return { ok: true, session: clone(stored) };
  }

  async function readSession(sessionId) {
    const result = await pool.query(
      `SELECT id, room_id AS "roomId", invite_id AS "inviteId", request_id AS "requestId",
              minecraft_uuid AS "minecraftUuid", session_credential_hash AS "sessionCredentialHash",
              state, issued_at AS "issuedAt", expires_at AS "expiresAt"
       FROM sessions
       WHERE id = $1`,
      [sessionId]
    );
    const session = result.rows[0];
    if (!isSessionUsable(session)) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    return { ok: true, session: clone(session) };
  }

  async function savePresence(record) {
    const stored = sanitizeRecord(requirePresence(record));
    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO presence (room_id, host_id, state, last_seen_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_id) DO UPDATE SET
           state = EXCLUDED.state,
           last_seen_at = EXCLUDED.last_seen_at,
           expires_at = EXCLUDED.expires_at
         WHERE presence.host_id = EXCLUDED.host_id
         RETURNING room_id`,
        [stored.roomId, stored.hostId, stored.state, stored.lastSeenAt, stored.expiresAt]
      ).then((result) => assertMutationSucceeded(result, "presence identity conflict"));
    });

    return { ok: true, presence: clone(stored) };
  }

  async function readPresence(roomId) {
    const result = await pool.query(
      `SELECT room_id AS "roomId", host_id AS "hostId", state,
              last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
       FROM presence
       WHERE room_id = $1 AND expires_at > $2`,
      [roomId, clock.now()]
    );
    const presence = result.rows[0];
    return presence ? { ok: true, presence: clone(presence) } : fail(ErrorStates.ROOM_CLOSED);
  }

  async function incrementRateLimitCounter({ scope, signal, limit, windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS }) {
    if (!scope || !signal || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
      throw new TypeError("rate limit counters require scope, signal, positive integer limit, and windowMs");
    }

    const now = clock.now();
    const signalHash = hashSensitiveValue(signal);
    const id = `${scope}:${signalHash}`;
    const result = await pool.query(
      `INSERT INTO rate_limit_counters
         (id, scope, signal_hash, count, limit_value, window_ms, reset_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
       ON CONFLICT (scope, signal_hash) DO UPDATE SET
         count = CASE
           WHEN rate_limit_counters.reset_at <= EXCLUDED.updated_at THEN 1
           ELSE rate_limit_counters.count + 1
         END,
         limit_value = EXCLUDED.limit_value,
         window_ms = EXCLUDED.window_ms,
         reset_at = CASE
           WHEN rate_limit_counters.reset_at <= EXCLUDED.updated_at THEN EXCLUDED.reset_at
           ELSE rate_limit_counters.reset_at
         END,
         updated_at = EXCLUDED.updated_at
       RETURNING id, scope, signal_hash AS "signalHash", count, limit_value AS "limit",
                 window_ms AS "windowMs", reset_at AS "resetAt", updated_at AS "updatedAt"`,
      [id, scope, signalHash, limit, windowMs, now + windowMs, now]
    );
    const stored = result.rows[0];

    const remaining = Math.max(limit - stored.count, 0);
    if (stored.count > limit) {
      return {
        ok: false,
        reason: ErrorStates.RATE_LIMITED,
        scope,
        signalHash,
        count: stored.count,
        limit,
        remaining,
        resetAt: stored.resetAt
      };
    }

    return { ok: true, scope, signalHash, count: stored.count, limit, remaining, resetAt: stored.resetAt };
  }

  async function readRateLimitCounter({ scope, signal }) {
    if (!scope || !signal) {
      return fail(ErrorStates.RATE_LIMITED);
    }

    const result = await pool.query(
      `SELECT id, scope, signal_hash AS "signalHash", count, limit_value AS "limit",
              window_ms AS "windowMs", reset_at AS "resetAt", updated_at AS "updatedAt"
       FROM rate_limit_counters
       WHERE scope = $1 AND signal_hash = $2`,
      [scope, hashSensitiveValue(signal)]
    );
    const counter = result.rows[0];
    return counter ? { ok: true, counter: clone(counter) } : fail(ErrorStates.RATE_LIMITED);
  }

  async function cleanupExpiredState({ now = clock.now() } = {}) {
    return withTransaction(pool, async (client) => {
      const sessions = await client.query(
        `DELETE FROM sessions
         WHERE expires_at IS NOT NULL AND expires_at <= $1`,
        [now]
      );
      const invites = await client.query(
        `DELETE FROM invites
         WHERE expires_at IS NOT NULL
           AND expires_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM sessions WHERE sessions.invite_id = invites.id
           )`,
        [now]
      );
      const presence = await client.query(
        `DELETE FROM presence
         WHERE expires_at <= $1`,
        [now]
      );
      const rateLimits = await client.query(
        `DELETE FROM rate_limit_counters
         WHERE reset_at <= $1`,
        [now]
      );

      return {
        ok: true,
        sessions: sessions.rowCount ?? 0,
        invites: invites.rowCount ?? 0,
        presence: presence.rowCount ?? 0,
        rateLimits: rateLimits.rowCount ?? 0
      };
    });
  }

  async function recordAuditEvent(event) {
    if (!event?.type) {
      throw new TypeError("audit events require a type");
    }

    const stored = sanitizeRecord({
      id: event.id ?? `audit_${randomUUID()}`,
      occurredAt: event.occurredAt ?? clock.now(),
      ...event
    });

    await withTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO audit_events
           (id, type, actor_id, room_id, invite_id, request_id, session_id_hash, metadata, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          stored.id,
          stored.type,
          stored.actorId ?? null,
          stored.roomId ?? null,
          stored.inviteId ?? null,
          stored.requestId ?? null,
          stored.sessionIdHash ?? null,
          JSON.stringify(stored.metadata ?? {}),
          stored.occurredAt
        ]
      );
    });

    return { ok: true, event: clone(stored) };
  }

  async function readAuditEvents(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.type) {
      params.push(filter.type);
      conditions.push(`type = $${params.length}`);
    }
    if (filter.roomId) {
      params.push(filter.roomId);
      conditions.push(`room_id = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT id, type, actor_id AS "actorId", room_id AS "roomId", invite_id AS "inviteId",
              request_id AS "requestId", session_id_hash AS "sessionIdHash", metadata, occurred_at AS "occurredAt"
       FROM audit_events
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY occurred_at ASC`,
      params
    );

    return result.rows.map((event) => clone(event));
  }

  async function selectInviteBy(key, value) {
    const column = inviteLookupColumn(key);
    const result = await pool.query(
      `SELECT id, room_id AS "roomId", token_hash AS "tokenHash", state,
              created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"
       FROM invites
       WHERE ${column} = $1`,
      [value]
    );
    return result.rows[0] ? clone(result.rows[0]) : null;
  }

  function isInviteUsable(invite) {
    return Boolean(invite && invite.state === InviteStates.ACTIVE && (!invite.expiresAt || invite.expiresAt > clock.now()));
  }

  function isSessionUsable(session) {
    return Boolean(
      session &&
        session.state === SessionStates.ISSUED &&
        (!session.expiresAt || session.expiresAt > clock.now())
    );
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function sanitizeRecord(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecord(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (isSensitiveKey(key)) {
        return [hashKeyFor(key), hashSensitiveValue(nested)];
      }

      return [key, sanitizeRecord(nested)];
    })
  );
}

function isSensitiveKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !normalized.endsWith("hash") && SENSITIVE_KEY_NAMES.has(normalized);
}

function hashKeyFor(key) {
  return `${key}Hash`;
}

function requireRecordId(record, kind) {
  if (!record?.id) {
    throw new TypeError(`${kind} records require an id`);
  }

  return record;
}

function requirePresence(record) {
  if (!record?.roomId || !record.hostId) {
    throw new TypeError("presence records require roomId and hostId");
  }

  return record;
}

function assertMutationSucceeded(result, message) {
  if (result?.rowCount === 0 || (Array.isArray(result?.rows) && result.rows.length === 0)) {
    throw new Error(message);
  }
}

function inviteLookupColumn(key) {
  if (key === "id") {
    return "id";
  }

  if (key === "tokenHash") {
    return "token_hash";
  }

  throw new TypeError(`unsupported invite lookup key: ${key}`);
}

function fail(reason) {
  return { ok: false, reason };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
