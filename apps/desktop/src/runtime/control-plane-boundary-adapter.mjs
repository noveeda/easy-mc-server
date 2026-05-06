import { Actors } from "../../../../services/control-plane/src/protocol.mjs";
import { createControlPlaneHttpBoundary } from "../../../../services/control-plane/src/http/handlers.mjs";

export function createControlPlaneBoundaryAdapter(options = {}) {
  const boundary = options.boundary ?? createControlPlaneHttpBoundary(options.boundaryOptions ?? {});

  async function createRoom({ hostId, alias, minecraftVersion, packProfileName }) {
    const result = await send({
      method: "POST",
      path: "/host/rooms",
      actorId: hostId,
      body: {
        alias,
        minecraftVersion,
        packProfileName
      }
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      room: result.body.room
    };
  }

  async function heartbeatHost({ actorId, roomId }) {
    const result = await send({
      method: "POST",
      path: `/host/rooms/${encodeURIComponent(roomId)}/heartbeat`,
      actorId
    });

    return result.ok;
  }

  async function createInvite({ actorId, roomId }) {
    const result = await send({
      method: "POST",
      path: `/host/rooms/${encodeURIComponent(roomId)}/invites`,
      actorId
    });

    if (!result.ok) {
      return result;
    }

    const handle = result.body.invite?.handle;
    return {
      ok: Boolean(handle),
      invite: {
        id: handle,
        publicHandle: handle,
        expiresAt: result.body.invite?.expiresAt
      }
    };
  }

  async function revokeInvite({ actorId, inviteId }) {
    const result = await send({
      method: "POST",
      path: `/host/invites/${encodeURIComponent(inviteId)}/revoke`,
      actorId
    });

    return result.ok ? { ok: true } : result;
  }

  async function readSafeInviteStatus({ inviteHandle }) {
    const result = await send({
      method: "GET",
      path: inviteHandle ? `/friend/invites/${encodeURIComponent(inviteHandle)}` : "/friend/invites"
    });

    if (!result.ok) {
      return {
        ok: false,
        unavailable: true,
        reason: result.reason
      };
    }

    return {
      ok: true,
      invite: result.body.invite
    };
  }

  async function createJoinRequest({ inviteHandle, friendId, minecraftUuid, displayName }) {
    const result = await send({
      method: "POST",
      path: "/friend/join-requests",
      body: {
        inviteHandle,
        friendId,
        minecraftUuid,
        displayName
      }
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      request: result.body.request
    };
  }

  async function readApprovalQueue({ actorId, roomId }) {
    const result = await send({
      method: "GET",
      path: `/host/rooms/${encodeURIComponent(roomId)}/approval-queue`,
      actorId
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      requests: result.body.requests ?? []
    };
  }

  async function decideJoinRequest({ actorId, requestId, decision }) {
    const result = await send({
      method: "POST",
      path: `/host/join-requests/${encodeURIComponent(requestId)}/decision`,
      actorId,
      body: {
        decision
      }
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      request: result.body.request
    };
  }

  async function issueSession({ requestId, minecraftUuid }) {
    const result = await send({
      method: "POST",
      path: "/service/sessions",
      actorType: Actors.SERVICE,
      body: {
        requestId,
        minecraftUuid
      }
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      session: result.body.session
    };
  }

  async function send({ method, path, actorId, actorType, body }) {
    const response = await Promise.resolve(boundary.handle({
      method,
      path,
      headers: trustedActorHeaders({ actorId, actorType }),
      body
    }));

    if (response.status >= 400) {
      return {
        ok: false,
        status: response.status,
        reason: response.body?.error?.reason ?? response.body?.reason ?? "control_plane_unavailable"
      };
    }

    return {
      ok: true,
      status: response.status,
      body: response.body ?? {}
    };
  }

  return {
    kind: "control_plane_http_boundary",
    boundary,
    createRoom,
    heartbeatHost,
    createInvite,
    revokeInvite,
    readSafeInviteStatus,
    createJoinRequest,
    readApprovalQueue,
    decideJoinRequest,
    issueSession,
    snapshotBoundaryForTest: boundary.snapshotBoundaryForTest
      ? () => boundary.snapshotBoundaryForTest()
      : undefined
  };
}

function trustedActorHeaders({ actorId, actorType } = {}) {
  const headers = {};

  if (actorId) {
    headers["x-actor-id"] = actorId;
  }

  if (actorType) {
    headers["x-actor-type"] = actorType;
  }

  return headers;
}
