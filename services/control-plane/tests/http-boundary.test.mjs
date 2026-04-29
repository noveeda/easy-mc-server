import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates, ErrorStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { createControlPlaneHttpBoundary } from "../src/http/handlers.mjs";

process.env.NODE_ENV = "test";

const HOST_ID = "host-a";
const FRIEND_ID = "friend-a";
const MINECRAFT_UUID = "uuid-a";

function createBoundary(options = {}) {
  return createControlPlaneHttpBoundary(options);
}

async function createRoom(boundary, hostId = HOST_ID) {
  return boundary.handle({
    method: "POST",
    path: "/host/rooms",
    headers: {
      "x-actor-id": hostId
    },
    body: {
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    }
  });
}

async function createInvite(boundary, roomId, hostId = HOST_ID) {
  return boundary.handle({
    method: "POST",
    path: `/host/rooms/${roomId}/invites`,
    headers: {
      "x-actor-id": hostId
    }
  });
}

async function createJoinRequest(boundary, inviteHandle) {
  return boundary.handle({
    method: "POST",
    path: "/friend/join-requests",
    body: {
      inviteHandle,
      friendId: FRIEND_ID,
      minecraftUuid: MINECRAFT_UUID,
      displayName: "MineFriend_27"
    }
  });
}

async function approveJoinRequest(boundary, requestId, hostId = HOST_ID) {
  return boundary.handle({
    method: "POST",
    path: `/host/join-requests/${requestId}/decision`,
    headers: {
      "x-actor-id": hostId
    },
    body: {
      decision: ApprovalStates.APPROVED
    }
  });
}

function assertNoSensitiveFields(value) {
  const forbiddenKeys = new Set(["token", "tokenHash", "sessionId", "inviteId", "hostId", "createdAt", "hostLastSeenAt"]);
  const stack = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      assert.equal(forbiddenKeys.has(key), false, `response leaked sensitive field: ${key}`);
      stack.push(nested);
    }
  }
}

test("HTTP boundary exposes host invite approval flow with redacted response DTOs", async () => {
  const boundary = createBoundary();

  const roomResponse = await createRoom(boundary);
  assert.equal(roomResponse.status, 201);
  assert.deepEqual(roomResponse.body.room, {
    id: roomResponse.body.room.id,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    state: "open"
  });
  assert.match(roomResponse.body.room.id, /^room_/);
  assertNoSensitiveFields(roomResponse.body);

  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  assert.equal(inviteResponse.status, 201);
  assert.match(inviteResponse.body.invite.handle, /^invite_handle_/);
  assert.equal(typeof inviteResponse.body.invite.expiresAt, "number");
  assertNoSensitiveFields(inviteResponse.body);

  const safeInviteResponse = await boundary.handle({
    method: "GET",
    path: `/friend/invites/${inviteResponse.body.invite.handle}`
  });
  assert.deepEqual(safeInviteResponse, {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    body: {
      invite: {
        unavailable: false,
        roomAlias: "Cozy Room",
        minecraftVersion: "1.21.1",
        packProfileName: "MVP-0 Performance Room",
        trustCopy: "No Microsoft or Minecraft password is required."
      }
    }
  });
  assertNoSensitiveFields(safeInviteResponse.body);

  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);
  assert.equal(joinResponse.status, 202);
  assert.deepEqual(joinResponse.body.request, {
    id: joinResponse.body.request.id,
    state: ApprovalStates.PENDING
  });
  assert.match(joinResponse.body.request.id, /^approval_/);
  assertNoSensitiveFields(joinResponse.body);

  const queueResponse = await boundary.handle({
    method: "GET",
    path: `/host/rooms/${roomResponse.body.room.id}/approval-queue`,
    headers: {
      "x-actor-id": HOST_ID
    }
  });
  assert.equal(queueResponse.status, 200);
  assert.deepEqual(queueResponse.body.requests, [
    {
      id: joinResponse.body.request.id,
      displayName: "MineFriend_27",
      minecraftUuid: MINECRAFT_UUID,
      state: ApprovalStates.PENDING
    }
  ]);
  assertNoSensitiveFields(queueResponse.body);

  const approvalResponse = await approveJoinRequest(boundary, joinResponse.body.request.id);
  assert.deepEqual(approvalResponse.body.request, {
    id: joinResponse.body.request.id,
    state: ApprovalStates.APPROVED
  });
  assert.equal(approvalResponse.status, 200);
  assertNoSensitiveFields(approvalResponse.body);

  const sessionResponse = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.equal(sessionResponse.status, 201);
  assert.match(sessionResponse.body.session.handle, /^session_handle_/);
  assert.equal(typeof sessionResponse.body.session.expiresAt, "number");
  assertNoSensitiveFields(sessionResponse.body);
});

test("invalid and expired invite handles return the same safe unavailable response", async () => {
  const clock = createMemoryClock();
  const boundary = createBoundary({
    simulationOptions: {
      clock,
      inviteTtlMs: 1000
    }
  });
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);

  const invalid = await boundary.handle({
    method: "GET",
    path: "/friend/invites/not-a-known-handle"
  });
  assert.deepEqual(invalid, {
    status: 404,
    headers: {
      "content-type": "application/json"
    },
    body: {
      unavailable: true,
      reason: ErrorStates.INVITE_UNAVAILABLE
    }
  });
  assertNoSensitiveFields(invalid.body);

  clock.advance(1001);

  const expired = await boundary.handle({
    method: "GET",
    path: `/friend/invites/${inviteResponse.body.invite.handle}`
  });
  assert.deepEqual(expired, invalid);

  const missing = await boundary.handle({
    method: "GET",
    path: "/friend/invites"
  });
  assert.deepEqual(missing, invalid);
});

test("revoked invite handle returns the same safe unavailable response", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  const unavailable = {
    status: 404,
    headers: {
      "content-type": "application/json"
    },
    body: {
      unavailable: true,
      reason: ErrorStates.INVITE_UNAVAILABLE
    }
  };

  const revokeResponse = await boundary.handle({
    method: "POST",
    path: `/host/invites/${inviteResponse.body.invite.handle}/revoke`,
    headers: {
      "x-actor-id": HOST_ID
    }
  });
  assert.equal(revokeResponse.status, 200);
  assertNoSensitiveFields(revokeResponse.body);

  assert.deepEqual(
    await boundary.handle({
      method: "GET",
      path: `/friend/invites/${inviteResponse.body.invite.handle}`
    }),
    unavailable
  );
});

test("cross-host approval reads and decisions fail closed", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary, "host-b");
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id, "host-b");
  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);

  const queueResponse = await boundary.handle({
    method: "GET",
    path: `/host/rooms/${roomResponse.body.room.id}/approval-queue`,
    headers: {
      "x-actor-id": HOST_ID
    }
  });
  assert.deepEqual(queueResponse.body, {
    error: {
      reason: ErrorStates.SESSION_UNAVAILABLE
    }
  });
  assert.equal(queueResponse.status, 403);

  const decisionResponse = await approveJoinRequest(boundary, joinResponse.body.request.id, HOST_ID);
  assert.deepEqual(decisionResponse.body, {
    error: {
      reason: ErrorStates.SESSION_UNAVAILABLE
    }
  });
  assert.equal(decisionResponse.status, 403);
  assertNoSensitiveFields(queueResponse.body);
  assertNoSensitiveFields(decisionResponse.body);
});

test("session issuance is one-time and does not require external invite identifiers", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);
  await approveJoinRequest(boundary, joinResponse.body.request.id);

  const first = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.equal(first.status, 201);
  assertNoSensitiveFields(first.body);

  const replay = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.deepEqual(replay, {
    status: 403,
    headers: {
      "content-type": "application/json"
    },
    body: {
      error: {
        reason: ErrorStates.SESSION_UNAVAILABLE
      }
    }
  });
  assertNoSensitiveFields(replay.body);
});

test("service session issuance requires service actor header", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);
  await approveJoinRequest(boundary, joinResponse.body.request.id);

  const missingActor = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.deepEqual(missingActor, {
    status: 403,
    headers: {
      "content-type": "application/json"
    },
    body: {
      error: {
        reason: ErrorStates.SESSION_UNAVAILABLE
      }
    }
  });

  const friendActor = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "friend"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.deepEqual(friendActor, missingActor);

  const serviceActor = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.equal(serviceActor.status, 201);
});

test("wrong minecraft uuid cannot issue first session", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);
  await approveJoinRequest(boundary, joinResponse.body.request.id);

  const response = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id,
      minecraftUuid: "uuid-b"
    }
  });

  assert.deepEqual(response, {
    status: 403,
    headers: {
      "content-type": "application/json"
    },
    body: {
      error: {
        reason: ErrorStates.SESSION_UNAVAILABLE
      }
    }
  });
});

test("expired and revoked invites block approved request at session boundary", async () => {
  const clock = createMemoryClock();
  const expiredBoundary = createBoundary({
    simulationOptions: {
      clock,
      inviteTtlMs: 1000
    }
  });
  const expiredRoom = await createRoom(expiredBoundary);
  const expiredInvite = await createInvite(expiredBoundary, expiredRoom.body.room.id);
  const expiredJoin = await createJoinRequest(expiredBoundary, expiredInvite.body.invite.handle);
  await approveJoinRequest(expiredBoundary, expiredJoin.body.request.id);
  clock.advance(1001);

  assert.equal(
    (
      await expiredBoundary.handle({
        method: "POST",
        path: "/service/sessions",
        headers: {
          "x-actor-type": "service"
        },
        body: {
          requestId: expiredJoin.body.request.id,
          minecraftUuid: MINECRAFT_UUID
        }
      })
    ).status,
    403
  );

  const revokedBoundary = createBoundary();
  const revokedRoom = await createRoom(revokedBoundary);
  const revokedInvite = await createInvite(revokedBoundary, revokedRoom.body.room.id);
  const revokedJoin = await createJoinRequest(revokedBoundary, revokedInvite.body.invite.handle);
  await approveJoinRequest(revokedBoundary, revokedJoin.body.request.id);
  await revokedBoundary.handle({
    method: "POST",
    path: `/host/invites/${revokedInvite.body.invite.handle}/revoke`,
    headers: {
      "x-actor-id": HOST_ID
    }
  });

  assert.equal(
    (
      await revokedBoundary.handle({
        method: "POST",
        path: "/service/sessions",
        headers: {
          "x-actor-type": "service"
        },
        body: {
          requestId: revokedJoin.body.request.id,
          minecraftUuid: MINECRAFT_UUID
        }
      })
    ).status,
    403
  );
});

test("invalid decision and malformed join/session requests do not mutate boundary state", async () => {
  const boundary = createBoundary();
  const roomResponse = await createRoom(boundary);
  const inviteResponse = await createInvite(boundary, roomResponse.body.room.id);
  const joinResponse = await createJoinRequest(boundary, inviteResponse.body.invite.handle);
  assert.equal(joinResponse.status, 202);

  const invalidDecision = await boundary.handle({
    method: "POST",
    path: `/host/join-requests/${joinResponse.body.request.id}/decision`,
    headers: {
      "x-actor-id": HOST_ID
    },
    body: {
      decision: "maybe"
    }
  });
  assert.equal(invalidDecision.status, 400);

  const before = boundary.snapshotBoundaryForTest();

  const malformedJoin = await boundary.handle({
    method: "POST",
    path: "/friend/join-requests",
    body: {
      inviteHandle: inviteResponse.body.invite.handle
    }
  });
  assert.equal(malformedJoin.status, 400);

  const malformedSession = await boundary.handle({
    method: "POST",
    path: "/service/sessions",
    headers: {
      "x-actor-type": "service"
    },
    body: {
      requestId: joinResponse.body.request.id
    }
  });
  assert.equal(malformedSession.status, 400);

  assert.deepEqual(boundary.snapshotBoundaryForTest(), before);
});

test("host actor id is taken from headers only", async () => {
  const boundary = createBoundary();
  const roomResponse = await boundary.handle({
    method: "POST",
    path: "/host/rooms",
    headers: {
      "x-actor-id": HOST_ID
    },
    body: {
      actorId: "host-b",
      hostId: "host-b",
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    }
  });
  assert.equal(roomResponse.status, 201);

  const hostBInvite = await createInvite(boundary, roomResponse.body.room.id, "host-b");
  assert.equal(hostBInvite.status, 403);

  const hostAInvite = await createInvite(boundary, roomResponse.body.room.id, HOST_ID);
  assert.equal(hostAInvite.status, 201);
});

test("malformed request does not mutate boundary state", async () => {
  const boundary = createBoundary();
  assert.deepEqual(boundary.snapshotBoundaryForTest(), {
    inviteHandleCount: 0,
    requestBindingCount: 0,
    sessionHandleCount: 0
  });

  const response = await boundary.handle({
    method: "POST",
    path: "/host/rooms",
    body: {
      alias: "Missing Actor"
    }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(boundary.snapshotBoundaryForTest(), {
    inviteHandleCount: 0,
    requestBindingCount: 0,
    sessionHandleCount: 0
  });
});
