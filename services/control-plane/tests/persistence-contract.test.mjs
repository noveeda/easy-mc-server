import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates, ErrorStates, InviteStates, SessionStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { createMemoryControlPlaneStore, hashSensitiveValue } from "../src/persistence/memory-store.mjs";

const HOST_ID = "host-a";
const ROOM_ID = "room-a";
const INVITE_ID = "invite-a";
const REQUEST_ID = "approval-a";
const SESSION_ID = "session-a";
const RAW_INVITE_TOKEN = "invite-token-secret";
const RAW_SESSION_CREDENTIAL = "session-credential-secret";

test("room, invite, approval, and session records persist without raw token exposure", () => {
  const clock = createMemoryClock();
  const store = createMemoryControlPlaneStore({ clock });

  const room = store.saveRoom({
    id: ROOM_ID,
    hostId: HOST_ID,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    state: "open",
    createdAt: clock.now()
  });
  assert.equal(room.ok, true);

  const invite = store.saveInvite({
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

  const approval = store.saveApproval({
    id: REQUEST_ID,
    roomId: ROOM_ID,
    inviteId: INVITE_ID,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27",
    state: ApprovalStates.APPROVED,
    createdAt: clock.now()
  });
  assert.equal(approval.ok, true);

  const session = store.saveSession({
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

  assert.deepEqual(store.readRoom(ROOM_ID).room.alias, "Cozy Room");
  assert.equal(store.readInviteByToken(RAW_INVITE_TOKEN).invite.id, INVITE_ID);
  assert.equal(store.readApproval(REQUEST_ID).approval.state, ApprovalStates.APPROVED);
  assert.equal(store.readSession(SESSION_ID).session.minecraftUuid, "uuid-a");

  const snapshot = JSON.stringify(store.snapshotForTest());
  assert.equal(snapshot.includes(RAW_INVITE_TOKEN), false);
  assert.equal(snapshot.includes(RAW_SESSION_CREDENTIAL), false);
});

test("missing and expired persistence reads fail closed", () => {
  const clock = createMemoryClock();
  const store = createMemoryControlPlaneStore({ clock });

  assert.deepEqual(store.readRoom("missing-room"), { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE });
  assert.deepEqual(store.readInvite("missing-invite"), { ok: false, reason: ErrorStates.INVITE_UNAVAILABLE });
  assert.deepEqual(store.readInviteByToken("missing-token"), { ok: false, reason: ErrorStates.INVITE_UNAVAILABLE });
  assert.deepEqual(store.readApproval("missing-approval"), { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE });
  assert.deepEqual(store.readSession("missing-session"), { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE });

  store.saveInvite({
    id: INVITE_ID,
    roomId: ROOM_ID,
    token: RAW_INVITE_TOKEN,
    state: InviteStates.ACTIVE,
    expiresAt: clock.now() + 1000
  });
  store.saveSession({
    id: SESSION_ID,
    roomId: ROOM_ID,
    inviteId: INVITE_ID,
    requestId: REQUEST_ID,
    minecraftUuid: "uuid-a",
    state: SessionStates.ISSUED,
    expiresAt: clock.now() + 1000
  });

  clock.advance(1001);

  assert.deepEqual(store.readInviteByToken(RAW_INVITE_TOKEN), {
    ok: false,
    reason: ErrorStates.INVITE_UNAVAILABLE
  });
  assert.deepEqual(store.readSession(SESSION_ID), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});

test("repeated join attempts trip a redacted rate-limit counter", () => {
  const clock = createMemoryClock();
  const store = createMemoryControlPlaneStore({ clock });
  const signal = "invite-a|ip:203.0.113.7|device:desktop|uuid-a";

  const first = store.incrementRateLimitCounter({
    scope: "join_request",
    signal,
    limit: 2,
    windowMs: 10_000
  });
  assert.equal(first.ok, true);
  assert.equal(first.count, 1);
  assert.equal(first.remaining, 1);

  const second = store.incrementRateLimitCounter({
    scope: "join_request",
    signal,
    limit: 2,
    windowMs: 10_000
  });
  assert.equal(second.ok, true);
  assert.equal(second.count, 2);
  assert.equal(second.remaining, 0);

  const blocked = store.incrementRateLimitCounter({
    scope: "join_request",
    signal,
    limit: 2,
    windowMs: 10_000
  });
  assert.deepEqual(blocked, {
    ok: false,
    reason: ErrorStates.RATE_LIMITED,
    scope: "join_request",
    signalHash: hashSensitiveValue(signal),
    count: 3,
    limit: 2,
    remaining: 0,
    resetAt: first.resetAt
  });

  const snapshot = JSON.stringify(store.snapshotForTest());
  assert.equal(snapshot.includes(signal), false);

  clock.advance(10_001);
  assert.equal(
    store.incrementRateLimitCounter({
      scope: "join_request",
      signal,
      limit: 2,
      windowMs: 10_000
    }).count,
    1
  );
});

test("audit events preserve minimal facts and redact credentials", () => {
  const clock = createMemoryClock();
  const store = createMemoryControlPlaneStore({ clock });

  store.recordAuditEvent({
    type: "room_created",
    actorId: HOST_ID,
    roomId: ROOM_ID,
    metadata: {
      alias: "Cozy Room"
    }
  });
  store.recordAuditEvent({
    type: "invite_created",
    actorId: HOST_ID,
    roomId: ROOM_ID,
    inviteId: INVITE_ID,
    metadata: {
      token: RAW_INVITE_TOKEN,
      inviteUrl: `https://invite.local/${RAW_INVITE_TOKEN}`
    }
  });
  store.recordAuditEvent({
    type: "approval_decided",
    actorId: HOST_ID,
    roomId: ROOM_ID,
    requestId: REQUEST_ID,
    metadata: {
      decision: ApprovalStates.APPROVED,
      sessionCredential: RAW_SESSION_CREDENTIAL
    }
  });

  const events = store.readAuditEvents({ roomId: ROOM_ID });
  assert.deepEqual(
    events.map((event) => event.type),
    ["room_created", "invite_created", "approval_decided"]
  );
  assert.equal(events[1].metadata.tokenHash, hashSensitiveValue(RAW_INVITE_TOKEN));
  assert.equal(events[2].metadata.sessionCredentialHash, hashSensitiveValue(RAW_SESSION_CREDENTIAL));

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(RAW_INVITE_TOKEN), false);
  assert.equal(serialized.includes(RAW_SESSION_CREDENTIAL), false);
  assert.equal(store.readAuditEvents({ type: "invite_created" }).length, 1);
});

test("persistence redacts common camelCase sensitive fields", () => {
  const store = createMemoryControlPlaneStore();
  const rawFields = {
    sessionToken: "session-token-secret",
    inviteToken: "invite-token-secret",
    ipAddress: "203.0.113.10",
    deviceSignal: "device-signal-secret",
    cookie: "cookie-secret",
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret"
  };

  const event = store.recordAuditEvent({
    type: "relay_usage",
    roomId: ROOM_ID,
    metadata: rawFields
  });

  assert.equal(event.event.metadata.sessionTokenHash, hashSensitiveValue(rawFields.sessionToken));
  assert.equal(event.event.metadata.inviteTokenHash, hashSensitiveValue(rawFields.inviteToken));
  assert.equal(event.event.metadata.ipAddressHash, hashSensitiveValue(rawFields.ipAddress));
  assert.equal(event.event.metadata.deviceSignalHash, hashSensitiveValue(rawFields.deviceSignal));
  assert.equal(event.event.metadata.cookieHash, hashSensitiveValue(rawFields.cookie));
  assert.equal(event.event.metadata.accessTokenHash, hashSensitiveValue(rawFields.accessToken));
  assert.equal(event.event.metadata.refreshTokenHash, hashSensitiveValue(rawFields.refreshToken));

  const serialized = JSON.stringify(store.snapshotForTest());
  for (const value of Object.values(rawFields)) {
    assert.equal(serialized.includes(value), false, value);
  }
});
