import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovalStates } from "../src/protocol.mjs";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import { createControlPlaneHttpBoundary } from "../src/http/handlers.mjs";
import { createControlPlaneRouterAdapter } from "../src/http/router-adapter.mjs";

const HOST_ID = "host-a";
const FRIEND_ID = "friend-a";
const MINECRAFT_UUID = "uuid-a";

function createBoundary() {
  return createControlPlaneHttpBoundary({
    simulationOptions: {
      clock: createMemoryClock()
    }
  });
}

async function exerciseJoinFlow(send) {
  const responses = [];

  const room = await send({
    method: "POST",
    path: "/host/rooms",
    headers: {
      "x-actor-id": HOST_ID
    },
    body: {
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    }
  });
  responses.push(room);

  const invite = await send({
    method: "POST",
    path: `/host/rooms/${room.body.room.id}/invites`,
    headers: {
      "x-actor-id": HOST_ID
    }
  });
  responses.push(invite);

  responses.push(
    await send({
      method: "GET",
      path: `/friend/invites/${invite.body.invite.handle}`
    })
  );

  const join = await send({
    method: "POST",
    path: "/friend/join-requests",
    body: {
      inviteHandle: invite.body.invite.handle,
      friendId: FRIEND_ID,
      minecraftUuid: MINECRAFT_UUID,
      displayName: "MineFriend_27"
    }
  });
  responses.push(join);

  responses.push(
    await send({
      method: "GET",
      path: `/host/rooms/${room.body.room.id}/approval-queue`,
      headers: {
        "x-actor-id": HOST_ID
      }
    })
  );

  responses.push(
    await send({
      method: "POST",
      path: `/host/join-requests/${join.body.request.id}/decision`,
      headers: {
        "x-actor-id": HOST_ID
      },
      body: {
        decision: ApprovalStates.APPROVED
      }
    })
  );

  responses.push(
    await send({
      method: "POST",
      path: "/service/sessions",
      headers: {
        "x-actor-type": "service"
      },
      body: {
        requestId: join.body.request.id,
        minecraftUuid: MINECRAFT_UUID
      }
    })
  );

  return responses;
}

test("router adapter exposes the current control-plane route table", () => {
  const adapter = createControlPlaneRouterAdapter({ boundary: createBoundary() });

  assert.deepEqual(adapter.routes(), [
    { method: "POST", url: "/host/rooms" },
    { method: "POST", url: "/host/rooms/:roomId/invites" },
    { method: "POST", url: "/host/invites/:inviteHandle/revoke" },
    { method: "GET", url: "/friend/invites/:inviteHandle" },
    { method: "GET", url: "/friend/invites" },
    { method: "POST", url: "/friend/join-requests" },
    { method: "GET", url: "/host/rooms/:roomId/approval-queue" },
    { method: "POST", url: "/host/join-requests/:requestId/decision" },
    { method: "POST", url: "/service/sessions" }
  ]);
});

test("router adapter preserves existing HTTP boundary DTOs", async () => {
  const directBoundary = createBoundary();
  const adapter = createControlPlaneRouterAdapter({ boundary: createBoundary() });

  const directResponses = await exerciseJoinFlow((request) => directBoundary.handle(request));
  const adapterResponses = await exerciseJoinFlow((request) => adapter.inject({ ...request, url: request.path }));

  assert.deepEqual(normalizeDtos(adapterResponses), normalizeDtos(directResponses));
  for (const response of adapterResponses) {
    assertNoSensitiveFields(response.body);
  }
});

test("router adapter accepts Fastify-like payloads without changing DTO shape", async () => {
  const adapter = createControlPlaneRouterAdapter({ boundary: createBoundary() });
  const response = await adapter.inject({
    method: "POST",
    url: "/host/rooms?ignored=true",
    headers: {
      "x-actor-id": HOST_ID
    },
    payload: JSON.stringify({
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(normalizeDtos(response.body), {
    room: {
      id: "<room-id>",
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room",
      state: "open"
    }
  });
  assertNoSensitiveFields(response.body);
});

test("router adapter can register routes on a minimal Fastify-like app", async () => {
  const registered = [];
  const adapter = createControlPlaneRouterAdapter({
    boundary: createBoundary(),
    deriveActor(request) {
      return request.url === "/service/sessions"
        ? { actorType: "service" }
        : { actorId: HOST_ID };
    }
  });
  const app = {
    route(route) {
      registered.push(route);
    }
  };

  assert.equal(adapter.register(app), app);
  assert.equal(registered.length, adapter.routes().length);

  const firstRouteResponse = await registered[0].handler({
    method: "POST",
    url: "/host/rooms",
    headers: {
      "x-actor-id": "spoofed-host"
    },
    body: {
      alias: "Cozy Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room"
    }
  });

  assert.equal(firstRouteResponse.status, 201);
  assertNoSensitiveFields(firstRouteResponse.body);

  const inviteRouteResponse = await registered[1].handler({
    method: "POST",
    url: `/host/rooms/${firstRouteResponse.body.room.id}/invites`,
    headers: {
      "x-actor-id": "spoofed-host"
    }
  });

  assert.equal(inviteRouteResponse.status, 201);
  assertNoSensitiveFields(inviteRouteResponse.body);
});

test("router adapter register requires trusted actor derivation before mounting", () => {
  const adapter = createControlPlaneRouterAdapter({ boundary: createBoundary() });
  const app = {
    route() {}
  };

  assert.throws(() => adapter.register(app), /requires deriveActor/);
});

function normalizeDtos(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDtos(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (key === "id" && typeof nested === "string" && nested.startsWith("room_")) {
        return [key, "<room-id>"];
      }

      if (key === "id" && typeof nested === "string" && nested.startsWith("approval_")) {
        return [key, "<approval-id>"];
      }

      if (key === "handle" && typeof nested === "string" && nested.startsWith("invite_handle_")) {
        return [key, "<invite-handle>"];
      }

      if (key === "handle" && typeof nested === "string" && nested.startsWith("session_handle_")) {
        return [key, "<session-handle>"];
      }

      if (key === "expiresAt" && typeof nested === "number") {
        return [key, "<timestamp>"];
      }

      return [key, normalizeDtos(nested)];
    })
  );
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
