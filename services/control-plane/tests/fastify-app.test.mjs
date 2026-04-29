import { test } from "node:test";
import assert from "node:assert/strict";
import { Actors, ApprovalStates, ErrorStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { createControlPlaneFastifyApp } from "../src/http/fastify-app.mjs";

const HOST_ID = "host-a";
const FRIEND_ID = "friend-a";
const MINECRAFT_UUID = "uuid-a";

function createApp() {
  return createControlPlaneFastifyApp({
    boundaryOptions: {
      simulationOptions: {
        clock: createMemoryClock()
      }
    },
    deriveActor(request) {
      return {
        actorId: request.headers["x-trusted-actor-id"],
        actorType: request.headers["x-trusted-actor-type"]
      };
    }
  });
}

async function injectJson(app, request) {
  const response = await app.inject({
    method: request.method,
    url: request.url,
    headers: {
      ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      ...(request.headers ?? {})
    },
    payload: request.body === undefined ? undefined : JSON.stringify(request.body)
  });

  return {
    status: response.statusCode,
    body: response.json()
  };
}

async function createRoom(app, headers = trustedHostHeaders()) {
  return injectJson(app, {
    method: "POST",
    url: "/host/rooms",
    headers,
    body: {
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    }
  });
}

async function createInvite(app, roomId, headers = trustedHostHeaders()) {
  return injectJson(app, {
    method: "POST",
    url: `/host/rooms/${roomId}/invites`,
    headers
  });
}

async function createJoinRequest(app, inviteHandle) {
  return injectJson(app, {
    method: "POST",
    url: "/friend/join-requests",
    body: {
      inviteHandle,
      friendId: FRIEND_ID,
      minecraftUuid: MINECRAFT_UUID,
      displayName: "MineFriend_27"
    }
  });
}

async function approveJoinRequest(app, requestId, headers = trustedHostHeaders()) {
  return injectJson(app, {
    method: "POST",
    url: `/host/join-requests/${requestId}/decision`,
    headers,
    body: {
      decision: ApprovalStates.APPROVED
    }
  });
}

function trustedHostHeaders(hostId = HOST_ID) {
  return {
    "x-trusted-actor-id": hostId,
    "x-trusted-actor-type": Actors.HOST
  };
}

function trustedServiceHeaders() {
  return {
    "x-trusted-actor-type": Actors.SERVICE
  };
}

test("Fastify app exposes the host invite approval and service session flow", async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const room = await createRoom(app);
  assert.equal(room.status, 201);
  assert.match(room.body.room.id, /^room_/);
  assert.deepEqual(room.body.room, {
    id: room.body.room.id,
    alias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    state: "open"
  });

  const invite = await createInvite(app, room.body.room.id);
  assert.equal(invite.status, 201);
  assert.match(invite.body.invite.handle, /^invite_handle_/);
  assert.equal(typeof invite.body.invite.expiresAt, "number");

  const safeInvite = await injectJson(app, {
    method: "GET",
    url: `/friend/invites/${invite.body.invite.handle}?utm_source=ignored`
  });
  assert.deepEqual(safeInvite, {
    status: 200,
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

  const join = await createJoinRequest(app, invite.body.invite.handle);
  assert.equal(join.status, 202);
  assert.deepEqual(join.body.request, {
    id: join.body.request.id,
    state: ApprovalStates.PENDING
  });
  assert.match(join.body.request.id, /^approval_/);

  const queue = await injectJson(app, {
    method: "GET",
    url: `/host/rooms/${room.body.room.id}/approval-queue`,
    headers: trustedHostHeaders()
  });
  assert.deepEqual(queue, {
    status: 200,
    body: {
      requests: [
        {
          id: join.body.request.id,
          displayName: "MineFriend_27",
          minecraftUuid: MINECRAFT_UUID,
          state: ApprovalStates.PENDING
        }
      ]
    }
  });

  const approval = await approveJoinRequest(app, join.body.request.id);
  assert.deepEqual(approval, {
    status: 200,
    body: {
      request: {
        id: join.body.request.id,
        state: ApprovalStates.APPROVED
      }
    }
  });

  const session = await injectJson(app, {
    method: "POST",
    url: "/service/sessions",
    headers: trustedServiceHeaders(),
    body: {
      requestId: join.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.equal(session.status, 201);
  assert.match(session.body.session.handle, /^session_handle_/);
  assert.equal(typeof session.body.session.expiresAt, "number");

  const secondInvite = await createInvite(app, room.body.room.id);
  assert.equal(secondInvite.status, 201);

  const revoke = await injectJson(app, {
    method: "POST",
    url: `/host/invites/${secondInvite.body.invite.handle}/revoke`,
    headers: trustedHostHeaders()
  });
  assert.deepEqual(revoke, {
    status: 200,
    body: {
      invite: {
        handle: secondInvite.body.invite.handle,
        state: "revoked"
      }
    }
  });

  const revokedLookup = await injectJson(app, {
    method: "GET",
    url: `/friend/invites/${secondInvite.body.invite.handle}`
  });
  assert.deepEqual(revokedLookup, {
    status: 404,
    body: {
      unavailable: true,
      reason: ErrorStates.INVITE_UNAVAILABLE
    }
  });
});

test("Fastify app ignores client-supplied actor headers", async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const forgedHostOnly = await createRoom(app, {
    "x-actor-id": HOST_ID,
    "x-actor-type": Actors.HOST
  });
  assert.deepEqual(forgedHostOnly, {
    status: 400,
    body: {
      error: {
        reason: "missing_field",
        field: "actorId"
      }
    }
  });

  const room = await createRoom(app);
  const invite = await createInvite(app, room.body.room.id);
  const join = await createJoinRequest(app, invite.body.invite.handle);
  await approveJoinRequest(app, join.body.request.id);

  const forgedServiceOnly = await injectJson(app, {
    method: "POST",
    url: "/service/sessions",
    headers: {
      "x-actor-type": Actors.SERVICE
    },
    body: {
      requestId: join.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.deepEqual(forgedServiceOnly, {
    status: 403,
    body: {
      error: {
        reason: ErrorStates.SESSION_UNAVAILABLE
      }
    }
  });

  const trustedService = await injectJson(app, {
    method: "POST",
    url: "/service/sessions",
    headers: trustedServiceHeaders(),
    body: {
      requestId: join.body.request.id,
      minecraftUuid: MINECRAFT_UUID
    }
  });
  assert.equal(trustedService.status, 201);
});
