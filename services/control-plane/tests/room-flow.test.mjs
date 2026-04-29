import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates, ErrorStates } from "../src/protocol.mjs";
import { createControlPlaneSimulation, createMemoryClock } from "../src/domain/simulation.mjs";

process.env.NODE_ENV = "test";

function createOpenRoom(sim, hostId = "host-a") {
  return sim.createRoom({
    hostId,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room"
  });
}

function createApprovedRequest(sim, { hostId = "host-a", friendId = "friend-a", minecraftUuid = "uuid-a" } = {}) {
  const room = createOpenRoom(sim, hostId);
  const invite = sim.createInviteForTest({ actorId: hostId, roomId: room.id, token: `token-${hostId}-${friendId}` });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId,
    minecraftUuid,
    displayName: "MineFriend_27"
  });

  assert.equal(request.ok, true);
  const decision = sim.decideJoinRequest({
    actorId: hostId,
    requestId: request.requestId,
    decision: ApprovalStates.APPROVED
  });

  assert.equal(decision.ok, true);

  return { room, invite, request };
}

test("host invite approval flow issues a short-lived session", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock });
  const { room, invite, request } = createApprovedRequest(sim);

  const session = sim.issueSession({
    requestId: request.requestId,
    roomId: room.id,
    inviteId: invite.inviteId,
    minecraftUuid: "uuid-a"
  });

  assert.equal(session.ok, true);
  assert.match(session.sessionId, /^session_/);

  const readable = sim.readSession({ sessionId: session.sessionId });
  assert.deepEqual(readable, {
    ok: true,
    roomId: room.id,
    minecraftUuid: "uuid-a",
    expiresAt: session.expiresAt
  });
});

test("host A cannot approve host B approval request", () => {
  const sim = createControlPlaneSimulation();
  const room = createOpenRoom(sim, "host-b");
  const invite = sim.createInviteForTest({ actorId: "host-b", roomId: room.id, token: "host-b-token" });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27"
  });

  const result = sim.decideJoinRequest({
    actorId: "host-a",
    requestId: request.requestId,
    decision: ApprovalStates.APPROVED
  });

  assert.deepEqual(result, {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});

test("denied request cannot issue session", () => {
  const sim = createControlPlaneSimulation();
  const room = createOpenRoom(sim);
  const invite = sim.createInviteForTest({ actorId: "host-a", roomId: room.id, token: "token-deny" });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27"
  });

  sim.decideJoinRequest({
    actorId: "host-a",
    requestId: request.requestId,
    decision: ApprovalStates.DENIED
  });

  const session = sim.issueSession({
    requestId: request.requestId,
    roomId: room.id,
    inviteId: invite.inviteId,
    minecraftUuid: "uuid-a"
  });

  assert.deepEqual(session, {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});

test("session issuance is bound to room, invite, uuid, and one-time request", () => {
  const sim = createControlPlaneSimulation();
  const { room, invite, request } = createApprovedRequest(sim);
  const otherRoom = createOpenRoom(sim, "host-b");

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: otherRoom.id,
      inviteId: invite.inviteId,
      minecraftUuid: "uuid-a"
    }),
    { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE }
  );

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: room.id,
      inviteId: "wrong-invite",
      minecraftUuid: "uuid-a"
    }),
    { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE }
  );

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: room.id,
      inviteId: invite.inviteId,
      minecraftUuid: "uuid-b"
    }),
    { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE }
  );

  const first = sim.issueSession({
    requestId: request.requestId,
    roomId: room.id,
    inviteId: invite.inviteId,
    minecraftUuid: "uuid-a"
  });
  assert.equal(first.ok, true);

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: room.id,
      inviteId: invite.inviteId,
      minecraftUuid: "uuid-a"
    }),
    { ok: false, reason: ErrorStates.SESSION_UNAVAILABLE }
  );
});

test("host presence expiry prevents join and session issuance", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, presenceTtlMs: 1000 });
  const room = createOpenRoom(sim);
  const invite = sim.createInviteForTest({ actorId: "host-a", roomId: room.id, token: "presence-token" });

  clock.advance(1001);

  assert.deepEqual(
    sim.createJoinRequest({
      token: invite.token,
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      displayName: "MineFriend_27"
    }),
    { ok: false, reason: ErrorStates.ROOM_CLOSED }
  );
});

test("host A cannot read host B approval queue", () => {
  const sim = createControlPlaneSimulation();
  const room = createOpenRoom(sim, "host-b");
  const invite = sim.createInviteForTest({ actorId: "host-b", roomId: room.id, token: "queue-token" });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27"
  });
  assert.equal(request.ok, true);

  assert.deepEqual(sim.readApprovalQueue({ actorId: "host-a", roomId: room.id }), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});

test("host presence expiry after approval returns room closed for session issuance", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, presenceTtlMs: 1000 });
  const { room, invite, request } = createApprovedRequest(sim);

  clock.advance(1001);

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: room.id,
      inviteId: invite.inviteId,
      minecraftUuid: "uuid-a"
    }),
    {
      ok: false,
      reason: ErrorStates.ROOM_CLOSED
    }
  );
});

test("session expires after ttl", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, sessionTtlMs: 1000 });
  const { room, invite, request } = createApprovedRequest(sim);
  const session = sim.issueSession({
    requestId: request.requestId,
    roomId: room.id,
    inviteId: invite.inviteId,
    minecraftUuid: "uuid-a"
  });

  clock.advance(1001);

  assert.deepEqual(sim.readSession({ sessionId: session.sessionId }), {
    ok: false,
    reason: ErrorStates.SESSION_UNAVAILABLE
  });
});
