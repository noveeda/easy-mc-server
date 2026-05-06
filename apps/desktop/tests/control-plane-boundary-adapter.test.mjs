import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates } from "../../../services/control-plane/src/protocol.mjs";
import { createControlPlaneBoundaryAdapter } from "../src/runtime/control-plane-boundary-adapter.mjs";

const HOST_ID = "host-a";
const FRIEND_ID = "friend-a";
const MINECRAFT_UUID = "uuid-a";

test("desktop control-plane adapter uses public invite handles instead of raw invite tokens", async () => {
  const controlPlane = createControlPlaneBoundaryAdapter();

  const room = await controlPlane.createRoom({
    hostId: HOST_ID,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room"
  });
  assert.equal(room.ok, true);
  assert.match(room.room.id, /^room_/);

  const heartbeat = await controlPlane.heartbeatHost({
    actorId: HOST_ID,
    roomId: room.room.id
  });
  assert.equal(heartbeat, true);

  const invite = await controlPlane.createInvite({
    actorId: HOST_ID,
    roomId: room.room.id
  });
  assert.equal(invite.ok, true);
  assert.match(invite.invite.id, /^invite_handle_/);
  assert.equal(invite.invite.publicHandle, invite.invite.id);

  const inviteStatus = await controlPlane.readSafeInviteStatus({
    inviteHandle: invite.invite.publicHandle
  });
  assert.equal(inviteStatus.ok, true);
  assert.deepEqual(inviteStatus.invite, {
    unavailable: false,
    roomAlias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    trustCopy: "No Microsoft or Minecraft password is required."
  });

  const join = await controlPlane.createJoinRequest({
    inviteHandle: invite.invite.publicHandle,
    friendId: FRIEND_ID,
    minecraftUuid: MINECRAFT_UUID,
    displayName: "MineFriend_27"
  });
  assert.equal(join.ok, true);
  assert.match(join.request.id, /^approval_/);

  const queue = await controlPlane.readApprovalQueue({
    actorId: HOST_ID,
    roomId: room.room.id
  });
  assert.deepEqual(queue.requests, [
    {
      id: join.request.id,
      displayName: "MineFriend_27",
      minecraftUuid: MINECRAFT_UUID,
      state: ApprovalStates.PENDING
    }
  ]);

  const decision = await controlPlane.decideJoinRequest({
    actorId: HOST_ID,
    requestId: join.request.id,
    decision: ApprovalStates.APPROVED
  });
  assert.equal(decision.request.state, ApprovalStates.APPROVED);

  const session = await controlPlane.issueSession({
    requestId: join.request.id,
    minecraftUuid: MINECRAFT_UUID
  });
  assert.equal(session.ok, true);
  assert.match(session.session.handle, /^session_handle_/);

  const serialized = JSON.stringify({
    room,
    invite,
    inviteStatus,
    join,
    queue,
    decision,
    session
  });
  assert.equal(serialized.includes("tokenHash"), false);
  assert.equal(serialized.includes("sessionId"), false);
  assert.equal(serialized.includes("hostLastSeenAt"), false);
});
