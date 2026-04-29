import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates, ErrorStates, InviteStates, RoomStates, SessionStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { hashSensitiveValue } from "../src/persistence/memory-store.mjs";
import { createRoomService } from "../src/services/room-service.mjs";

const HOST_ID = "host-a";
const ROOM_ID = "room-a";
const INVITE_ID = "invite-a";
const REQUEST_ID = "approval-a";
const SESSION_ID = "session-a";
const INVITE_TOKEN = "invite-token-secret";
const SESSION_CREDENTIAL = "session-credential-secret";
const MINECRAFT_UUID = "uuid-a";

test("approval decision and first session issuance happen in one service transaction", async () => {
  const clock = createMemoryClock();
  const repository = createFakeRepository({ clock });
  const service = createService({ clock, repository });

  seedApprovedFlow(repository, clock, { approvalState: ApprovalStates.PENDING });

  const result = await service.decideJoinRequest({
    actorId: HOST_ID,
    requestId: REQUEST_ID,
    decision: ApprovalStates.APPROVED,
    minecraftUuid: MINECRAFT_UUID,
    sessionCredential: SESSION_CREDENTIAL
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.request, {
    id: REQUEST_ID,
    state: ApprovalStates.APPROVED
  });
  assert.deepEqual(result.session, {
    id: SESSION_ID,
    expiresAt: clock.now() + 15 * 60 * 1000
  });

  const snapshot = repository.snapshot();
  assert.equal(snapshot.approvals[0].state, ApprovalStates.APPROVED);
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(snapshot.sessions[0].sessionCredentialHash, hashSensitiveValue(SESSION_CREDENTIAL));
  assert.equal(JSON.stringify(snapshot).includes(SESSION_CREDENTIAL), false);
  assert.deepEqual(repository.transactions, [["begin", "commit"]]);

  const retry = await service.decideJoinRequest({
    actorId: HOST_ID,
    requestId: REQUEST_ID,
    decision: ApprovalStates.APPROVED,
    minecraftUuid: MINECRAFT_UUID,
    sessionCredential: "different-secret"
  });
  assert.deepEqual(retry, {
    ok: false,
    reason: ErrorStates.APPROVAL_REQUIRED
  });
  assert.equal(repository.snapshot().sessions.length, 1);
});

test("join request rate-limit hooks are keyed by invite, ip-device, and minecraft identity", async () => {
  const clock = createMemoryClock();
  const repository = createFakeRepository({ clock });
  const service = createService({
    clock,
    repository,
    joinRequestLimit: 1,
    joinRequestWindowMs: 10_000
  });
  seedInvite(repository, clock);

  const first = await service.createJoinRequest({
    inviteToken: INVITE_TOKEN,
    friendId: "friend-a",
    minecraftUuid: MINECRAFT_UUID,
    displayName: "MineFriend_27",
    ipAddress: "203.0.113.7",
    deviceSignal: "desktop"
  });
  assert.equal(first.ok, true);
  assert.deepEqual(
    repository.rateLimitCalls.map((call) => [call.scope, call.signal]),
    [
      ["join_request.invite", INVITE_ID],
      ["join_request.ip_device", "203.0.113.7|desktop"],
      ["join_request.minecraft_identity", MINECRAFT_UUID]
    ]
  );

  const blocked = await service.createJoinRequest({
    inviteToken: INVITE_TOKEN,
    friendId: "friend-b",
    minecraftUuid: MINECRAFT_UUID,
    displayName: "MineFriend_28",
    ipAddress: "203.0.113.7",
    deviceSignal: "desktop"
  });
  assert.deepEqual(blocked, {
    ok: false,
    reason: ErrorStates.RATE_LIMITED
  });
  assert.equal(repository.snapshot().approvals.length, 1);

  const serialized = JSON.stringify(repository.snapshot());
  assert.equal(serialized.includes("203.0.113.7|desktop"), false);
});

test("invite revoke and regeneration produce audit events without raw invite tokens", async () => {
  const clock = createMemoryClock();
  const repository = createFakeRepository({ clock });
  const service = createService({
    clock,
    repository,
    ids: {
      inviteId: nextId(["invite-b"])
    },
    createInviteToken: () => "new-invite-token-secret"
  });
  seedInvite(repository, clock);

  const revoked = await service.revokeInvite({
    actorId: HOST_ID,
    inviteId: INVITE_ID,
    reason: "rotated"
  });
  assert.deepEqual(revoked, {
    ok: true,
    invite: {
      id: INVITE_ID,
      state: InviteStates.REVOKED
    }
  });

  repository.saveInvite({
    id: INVITE_ID,
    roomId: ROOM_ID,
    token: INVITE_TOKEN,
    state: InviteStates.ACTIVE,
    createdAt: clock.now(),
    expiresAt: clock.now() + 60_000
  });
  const regenerated = await service.regenerateInvite({
    actorId: HOST_ID,
    inviteId: INVITE_ID
  });
  assert.equal(regenerated.ok, true);
  assert.equal(regenerated.invite.id, "invite-b");
  assert.equal(regenerated.invite.token, "new-invite-token-secret");

  const events = repository.readAuditEvents({ roomId: ROOM_ID });
  assert.deepEqual(
    events.map((event) => event.type),
    ["invite_revoked", "invite_regenerated"]
  );
  assert.deepEqual(events[1].metadata, {
    revokedInviteId: INVITE_ID,
    expiresAt: clock.now() + 24 * 60 * 60 * 1000
  });

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(INVITE_TOKEN), false);
  assert.equal(serialized.includes("new-invite-token-secret"), false);
});

test("approval decision audit excludes tokens and session credentials", async () => {
  const clock = createMemoryClock();
  const repository = createFakeRepository({ clock });
  const service = createService({ clock, repository });
  seedApprovedFlow(repository, clock, { approvalState: ApprovalStates.PENDING });

  await service.decideJoinRequest({
    actorId: HOST_ID,
    requestId: REQUEST_ID,
    decision: ApprovalStates.APPROVED,
    minecraftUuid: MINECRAFT_UUID,
    sessionCredential: SESSION_CREDENTIAL
  });

  const events = repository.readAuditEvents({ type: "approval_decided" });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].metadata, {
    decision: ApprovalStates.APPROVED,
    decidedAt: clock.now()
  });
  assert.equal(Object.hasOwn(events[0].metadata, "sessionCredentialHash"), false);

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(INVITE_TOKEN), false);
  assert.equal(serialized.includes(SESSION_CREDENTIAL), false);
});

test("room and session quota hooks block before persistence mutations", async () => {
  const clock = createMemoryClock();
  const repository = createFakeRepository({ clock });
  const calls = [];
  const service = createService({
    clock,
    repository,
    hooks: {
      checkRoomQuota(context) {
        calls.push(["room", context.actorId]);
        return { ok: false, reason: ErrorStates.RATE_LIMITED };
      },
      checkSessionQuota(context) {
        calls.push(["session", context.requestId]);
        return { ok: false, reason: ErrorStates.RATE_LIMITED };
      }
    }
  });

  const room = await service.createRoom({
    actorId: HOST_ID,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room"
  });
  assert.deepEqual(room, {
    ok: false,
    reason: ErrorStates.RATE_LIMITED
  });
  assert.equal(repository.snapshot().rooms.length, 0);

  seedApprovedFlow(repository, clock, { approvalState: ApprovalStates.PENDING });
  const session = await service.decideJoinRequest({
    actorId: HOST_ID,
    requestId: REQUEST_ID,
    decision: ApprovalStates.APPROVED,
    minecraftUuid: MINECRAFT_UUID,
    sessionCredential: SESSION_CREDENTIAL
  });
  assert.deepEqual(session, {
    ok: false,
    reason: ErrorStates.RATE_LIMITED
  });
  assert.equal(repository.snapshot().sessions.length, 0);
  assert.deepEqual(calls, [
    ["room", HOST_ID],
    ["session", REQUEST_ID]
  ]);
});

function createService(options) {
  return createRoomService({
    ids: {
      roomId: nextId([ROOM_ID]),
      inviteId: nextId([INVITE_ID]),
      approvalId: nextId([REQUEST_ID]),
      sessionId: nextId([SESSION_ID]),
      ...options.ids
    },
    createInviteToken: () => INVITE_TOKEN,
    ...options
  });
}

function seedApprovedFlow(repository, clock, { approvalState }) {
  seedInvite(repository, clock);
  repository.saveApproval({
    id: REQUEST_ID,
    roomId: ROOM_ID,
    inviteId: INVITE_ID,
    friendId: "friend-a",
    minecraftUuid: MINECRAFT_UUID,
    displayName: "MineFriend_27",
    state: approvalState,
    createdAt: clock.now(),
    decidedAt: null
  });
}

function seedInvite(repository, clock) {
  repository.saveRoom({
    id: ROOM_ID,
    hostId: HOST_ID,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    state: RoomStates.OPEN,
    createdAt: clock.now(),
    updatedAt: clock.now()
  });
  repository.saveInvite({
    id: INVITE_ID,
    roomId: ROOM_ID,
    token: INVITE_TOKEN,
    state: InviteStates.ACTIVE,
    createdAt: clock.now(),
    expiresAt: clock.now() + 60_000
  });
}

function createFakeRepository({ clock }) {
  const rooms = new Map();
  const invites = new Map();
  const inviteTokenIndex = new Map();
  const approvals = new Map();
  const sessions = new Map();
  const rateLimits = new Map();
  const auditEvents = [];
  const transactions = [];
  const rateLimitCalls = [];

  const repository = {
    transactions,
    rateLimitCalls,
    async withTransaction(operation) {
      transactions.push(["begin"]);
      try {
        const result = await operation(repository);
        transactions[transactions.length - 1].push("commit");
        return result;
      } catch (error) {
        transactions[transactions.length - 1].push("rollback");
        throw error;
      }
    },
    saveRoom(record) {
      const stored = clone(record);
      rooms.set(stored.id, stored);
      return { ok: true, room: clone(stored) };
    },
    readRoom(roomId) {
      const room = rooms.get(roomId);
      return room ? { ok: true, room: clone(room) } : { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE };
    },
    saveInvite(record) {
      const stored = sanitizeRecord(record);
      invites.set(stored.id, stored);
      if (stored.tokenHash) {
        inviteTokenIndex.set(stored.tokenHash, stored.id);
      }
      return { ok: true, invite: clone(stored) };
    },
    readInvite(inviteId) {
      const invite = invites.get(inviteId);
      return invite ? { ok: true, invite: clone(invite) } : { ok: false, reason: ErrorStates.INVITE_UNAVAILABLE };
    },
    readInviteByToken(token) {
      const inviteId = inviteTokenIndex.get(hashSensitiveValue(token));
      const invite = inviteId ? invites.get(inviteId) : null;
      if (!invite || invite.state !== InviteStates.ACTIVE || invite.expiresAt <= clock.now()) {
        return { ok: false, reason: ErrorStates.INVITE_UNAVAILABLE };
      }
      return { ok: true, invite: clone(invite) };
    },
    saveApproval(record) {
      const stored = clone(record);
      approvals.set(stored.id, stored);
      return { ok: true, approval: clone(stored) };
    },
    readApproval(approvalId) {
      const approval = approvals.get(approvalId);
      return approval ? { ok: true, approval: clone(approval) } : { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE };
    },
    saveSession(record) {
      const stored = sanitizeRecord(record);
      sessions.set(stored.id, stored);
      return { ok: true, session: clone(stored) };
    },
    incrementRateLimitCounter({ scope, signal, limit, windowMs }) {
      rateLimitCalls.push({ scope, signal, limit, windowMs });
      const signalHash = hashSensitiveValue(signal);
      const key = `${scope}:${signalHash}`;
      const counter = rateLimits.get(key) ?? {
        scope,
        signalHash,
        count: 0,
        limit,
        windowMs,
        resetAt: clock.now() + windowMs
      };
      counter.count += 1;
      rateLimits.set(key, counter);

      if (counter.count > limit) {
        return {
          ok: false,
          reason: ErrorStates.RATE_LIMITED,
          scope,
          signalHash,
          count: counter.count,
          limit,
          remaining: 0,
          resetAt: counter.resetAt
        };
      }

      return {
        ok: true,
        scope,
        signalHash,
        count: counter.count,
        limit,
        remaining: Math.max(limit - counter.count, 0),
        resetAt: counter.resetAt
      };
    },
    recordAuditEvent(event) {
      const stored = sanitizeRecord({
        id: `audit-${auditEvents.length + 1}`,
        occurredAt: clock.now(),
        ...event
      });
      auditEvents.push(stored);
      return { ok: true, event: clone(stored) };
    },
    readAuditEvents(filter = {}) {
      return auditEvents
        .filter((event) => !filter.type || event.type === filter.type)
        .filter((event) => !filter.roomId || event.roomId === filter.roomId)
        .map((event) => clone(event));
    },
    snapshot() {
      return {
        rooms: [...rooms.values()].map((record) => clone(record)),
        invites: [...invites.values()].map((record) => clone(record)),
        approvals: [...approvals.values()].map((record) => clone(record)),
        sessions: [...sessions.values()].map((record) => clone(record)),
        rateLimits: [...rateLimits.values()].map((record) => clone(record)),
        auditEvents: repository.readAuditEvents()
      };
    }
  };

  return repository;
}

function sanitizeRecord(record) {
  const stored = clone(record);
  if (stored.token) {
    stored.tokenHash = hashSensitiveValue(stored.token);
    delete stored.token;
  }
  if (stored.sessionCredential) {
    stored.sessionCredentialHash = hashSensitiveValue(stored.sessionCredential);
    delete stored.sessionCredential;
  }
  return stored;
}

function nextId(values) {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
