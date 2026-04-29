import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorStates } from "../src/protocol.mjs";
import { createControlPlaneSimulation, createInviteToken, createMemoryClock, hashInviteToken } from "../src/domain/simulation.mjs";

process.env.NODE_ENV = "test";

function createRoomAndInvite(sim, { token = "invite-token" } = {}) {
  const room = sim.createRoom({
    hostId: "host-a",
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room"
  });
  const invite = sim.createInviteForTest({ actorId: "host-a", roomId: room.id, token });
  return { room, invite };
}

test("invalid, missing, expired, and revoked invites share safe unavailable response", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, inviteTtlMs: 1000 });
  const { invite } = createRoomAndInvite(sim);
  const safeUnavailable = {
    unavailable: true,
    reason: ErrorStates.INVITE_UNAVAILABLE
  };

  assert.deepEqual(sim.readSafeInviteStatus({ token: "wrong" }), safeUnavailable);
  assert.deepEqual(sim.readSafeInviteStatus({ token: undefined }), safeUnavailable);

  clock.advance(1001);
  assert.deepEqual(sim.readSafeInviteStatus({ token: invite.token }), safeUnavailable);

  const fresh = createRoomAndInvite(sim, { token: "revoked-token" });
  sim.revokeInvite({ actorId: "host-a", inviteId: fresh.invite.inviteId });
  assert.deepEqual(sim.readSafeInviteStatus({ token: fresh.invite.token }), safeUnavailable);
});

test("active invite status exposes only safe friend metadata", () => {
  const sim = createControlPlaneSimulation();
  const { invite } = createRoomAndInvite(sim);

  assert.deepEqual(sim.readSafeInviteStatus({ token: invite.token }), {
    unavailable: false,
    roomAlias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    trustCopy: "No Microsoft or Minecraft password is required."
  });
});

test("raw invite token is not stored in invite record", () => {
  const sim = createControlPlaneSimulation();
  const { invite } = createRoomAndInvite(sim, { token: "raw-secret-token" });
  const storedInvite = sim.snapshotInviteForTest(invite.inviteId);

  assert.equal(storedInvite.hasRawToken, false);
  assert.equal(storedInvite.tokenHash, hashInviteToken("raw-secret-token"));
});

test("public invite creation generates high-entropy token", () => {
  const token = createInviteToken();
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);

  const sim = createControlPlaneSimulation();
  const room = sim.createRoom({
    hostId: "host-a",
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room"
  });
  const invite = sim.createInvite({ actorId: "host-a", roomId: room.id });

  assert.match(invite.token, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(invite.token, token);
});

test("revoked invite cannot create pending request or session", () => {
  const sim = createControlPlaneSimulation();
  const { invite } = createRoomAndInvite(sim, { token: "revoked-before-request" });

  sim.revokeInvite({ actorId: "host-a", inviteId: invite.inviteId });

  assert.deepEqual(
    sim.createJoinRequest({
      token: invite.token,
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      displayName: "MineFriend_27"
    }),
    {
      ok: false,
      reason: ErrorStates.INVITE_UNAVAILABLE
    }
  );
});

test("revoked invite blocks approved but not yet issued request", () => {
  const sim = createControlPlaneSimulation();
  const { room, invite } = createRoomAndInvite(sim, { token: "revoke-after-approval" });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27"
  });

  sim.decideJoinRequest({
    actorId: "host-a",
    requestId: request.requestId,
    decision: "approved"
  });
  sim.revokeInvite({ actorId: "host-a", inviteId: invite.inviteId });

  assert.deepEqual(
    sim.issueSession({
      requestId: request.requestId,
      roomId: room.id,
      inviteId: invite.inviteId,
      minecraftUuid: "uuid-a"
    }),
    {
      ok: false,
      reason: ErrorStates.SESSION_UNAVAILABLE
    }
  );
});

test("expired invite cannot create pending request", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, inviteTtlMs: 1000 });
  const { invite } = createRoomAndInvite(sim, { token: "expired-before-request" });

  clock.advance(1001);

  assert.deepEqual(
    sim.createJoinRequest({
      token: invite.token,
      friendId: "friend-a",
      minecraftUuid: "uuid-a",
      displayName: "MineFriend_27"
    }),
    {
      ok: false,
      reason: ErrorStates.INVITE_UNAVAILABLE
    }
  );
});

test("expired invite blocks approved but not yet issued request", () => {
  const clock = createMemoryClock();
  const sim = createControlPlaneSimulation({ clock, inviteTtlMs: 1000 });
  const { room, invite } = createRoomAndInvite(sim, { token: "expired-after-approval" });
  const request = sim.createJoinRequest({
    token: invite.token,
    friendId: "friend-a",
    minecraftUuid: "uuid-a",
    displayName: "MineFriend_27"
  });

  sim.decideJoinRequest({
    actorId: "host-a",
    requestId: request.requestId,
    decision: "approved"
  });
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
      reason: ErrorStates.SESSION_UNAVAILABLE
    }
  );
});
