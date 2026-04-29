import { createHash, randomUUID } from "node:crypto";
import { ErrorStates, InviteStates, SessionStates } from "../protocol.mjs";

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

export function createMemoryControlPlaneStore(options = {}) {
  const clock = options.clock ?? { now: () => Date.now() };
  const rooms = new Map();
  const invites = new Map();
  const inviteTokenIndex = new Map();
  const approvals = new Map();
  const sessions = new Map();
  const rateLimits = new Map();
  const auditEvents = [];

  function saveRoom(record) {
    const stored = sanitizeRecord(requireRecordId(record, "room"));
    rooms.set(stored.id, stored);
    return { ok: true, room: clone(stored) };
  }

  function readRoom(roomId) {
    const room = rooms.get(roomId);
    return room ? { ok: true, room: clone(room) } : fail(ErrorStates.SESSION_UNAVAILABLE);
  }

  function saveInvite(record) {
    const input = requireRecordId(record, "invite");
    const stored = sanitizeRecord(input);

    if (input.token && !stored.tokenHash) {
      stored.tokenHash = hashSensitiveValue(input.token);
    }

    if (stored.tokenHash) {
      inviteTokenIndex.set(stored.tokenHash, stored.id);
    }

    invites.set(stored.id, stored);
    return { ok: true, invite: clone(stored) };
  }

  function readInvite(inviteId) {
    const invite = invites.get(inviteId);
    return invite ? { ok: true, invite: clone(invite) } : fail(ErrorStates.INVITE_UNAVAILABLE);
  }

  function readInviteByToken(token) {
    if (!token) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    const inviteId = inviteTokenIndex.get(hashSensitiveValue(token));
    const invite = inviteId ? invites.get(inviteId) : null;
    if (!isInviteUsable(invite)) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    return { ok: true, invite: clone(invite) };
  }

  function saveApproval(record) {
    const stored = sanitizeRecord(requireRecordId(record, "approval"));
    approvals.set(stored.id, stored);
    return { ok: true, approval: clone(stored) };
  }

  function readApproval(approvalId) {
    const approval = approvals.get(approvalId);
    return approval ? { ok: true, approval: clone(approval) } : fail(ErrorStates.SESSION_UNAVAILABLE);
  }

  function saveSession(record) {
    const stored = sanitizeRecord(requireRecordId(record, "session"));
    sessions.set(stored.id, stored);
    return { ok: true, session: clone(stored) };
  }

  function readSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!isSessionUsable(session)) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    return { ok: true, session: clone(session) };
  }

  function incrementRateLimitCounter({ scope, signal, limit, windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS }) {
    if (!scope || !signal || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
      throw new TypeError("rate limit counters require scope, signal, positive integer limit, and windowMs");
    }

    const now = clock.now();
    const signalHash = hashSensitiveValue(signal);
    const id = `${scope}:${signalHash}`;
    let counter = rateLimits.get(id);

    if (!counter || counter.resetAt <= now) {
      counter = {
        id,
        scope,
        signalHash,
        count: 0,
        limit,
        windowMs,
        resetAt: now + windowMs,
        updatedAt: now
      };
    }

    counter.count += 1;
    counter.limit = limit;
    counter.windowMs = windowMs;
    counter.updatedAt = now;
    rateLimits.set(id, counter);

    const remaining = Math.max(limit - counter.count, 0);
    if (counter.count > limit) {
      return {
        ok: false,
        reason: ErrorStates.RATE_LIMITED,
        scope,
        signalHash,
        count: counter.count,
        limit,
        remaining,
        resetAt: counter.resetAt
      };
    }

    return {
      ok: true,
      scope,
      signalHash,
      count: counter.count,
      limit,
      remaining,
      resetAt: counter.resetAt
    };
  }

  function readRateLimitCounter({ scope, signal }) {
    if (!scope || !signal) {
      return fail(ErrorStates.RATE_LIMITED);
    }

    const counter = rateLimits.get(`${scope}:${hashSensitiveValue(signal)}`);
    return counter ? { ok: true, counter: clone(counter) } : fail(ErrorStates.RATE_LIMITED);
  }

  function recordAuditEvent(event) {
    if (!event?.type) {
      throw new TypeError("audit events require a type");
    }

    const stored = sanitizeRecord({
      id: event.id ?? `audit_${randomUUID()}`,
      occurredAt: event.occurredAt ?? clock.now(),
      ...event
    });
    auditEvents.push(stored);

    return { ok: true, event: clone(stored) };
  }

  function readAuditEvents(filter = {}) {
    return auditEvents
      .filter((event) => !filter.type || event.type === filter.type)
      .filter((event) => !filter.roomId || event.roomId === filter.roomId)
      .map((event) => clone(event));
  }

  function snapshotForTest() {
    return {
      rooms: [...rooms.values()].map((record) => clone(record)),
      invites: [...invites.values()].map((record) => clone(record)),
      approvals: [...approvals.values()].map((record) => clone(record)),
      sessions: [...sessions.values()].map((record) => clone(record)),
      rateLimits: [...rateLimits.values()].map((record) => clone(record)),
      auditEvents: readAuditEvents()
    };
  }

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
    incrementRateLimitCounter,
    readRateLimitCounter,
    recordAuditEvent,
    readAuditEvents,
    snapshotForTest
  };

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

export function hashSensitiveValue(value) {
  return createHash("sha256").update(String(value)).digest("hex");
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

function fail(reason) {
  return {
    ok: false,
    reason
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
