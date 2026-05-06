import { randomUUID } from "node:crypto";
import { Actors, ApprovalStates, ErrorStates } from "../protocol.mjs";
import { createControlPlaneSimulation } from "../domain/simulation.mjs";

const HEADER_ACTOR_ID = "x-actor-id";
const HEADER_ACTOR_TYPE = "x-actor-type";
const HOST_DECISIONS = new Set([ApprovalStates.APPROVED, ApprovalStates.DENIED, ApprovalStates.BLOCKED]);

export function createControlPlaneHttpBoundary(options = {}) {
  const simulation = options.simulation ?? createControlPlaneSimulation(options.simulationOptions);
  const inviteHandles = new Map();
  const requestBindings = new Map();
  const sessionHandles = new Map();

  async function handle(request) {
    const method = normalizeMethod(request?.method);
    const path = normalizePath(request?.path);
    const body = request?.body ?? {};
    const headers = normalizeHeaders(request?.headers);

    if (method === "POST" && path === "/host/rooms") {
      return createRoom({
        actorId: actorIdFrom(headers),
        body
      });
    }

    const heartbeatMatch = match(path, /^\/host\/rooms\/([^/]+)\/heartbeat$/);
    if (method === "POST" && heartbeatMatch) {
      return heartbeatHost({
        actorId: actorIdFrom(headers),
        roomId: heartbeatMatch[1]
      });
    }

    const inviteCreateMatch = match(path, /^\/host\/rooms\/([^/]+)\/invites$/);
    if (method === "POST" && inviteCreateMatch) {
      return createInvite({
        actorId: actorIdFrom(headers),
        roomId: inviteCreateMatch[1]
      });
    }

    const inviteRevokeMatch = match(path, /^\/host\/invites\/([^/]+)\/revoke$/);
    if (method === "POST" && inviteRevokeMatch) {
      return revokeInvite({
        actorId: actorIdFrom(headers),
        inviteHandle: inviteRevokeMatch[1]
      });
    }

    const safeInviteMatch = match(path, /^\/friend\/invites\/([^/]+)$/);
    if (method === "GET" && safeInviteMatch) {
      return readSafeInviteStatus(safeInviteMatch[1]);
    }

    if (method === "GET" && path === "/friend/invites") {
      return readSafeInviteStatus(undefined);
    }

    if (method === "POST" && path === "/friend/join-requests") {
      return createJoinRequest(body);
    }

    const queueMatch = match(path, /^\/host\/rooms\/([^/]+)\/approval-queue$/);
    if (method === "GET" && queueMatch) {
      return readApprovalQueue({
        actorId: actorIdFrom(headers),
        roomId: queueMatch[1]
      });
    }

    const decisionMatch = match(path, /^\/host\/join-requests\/([^/]+)\/decision$/);
    if (method === "POST" && decisionMatch) {
      return decideJoinRequest({
        actorId: actorIdFrom(headers),
        requestId: decisionMatch[1],
        decision: body.decision
      });
    }

    if (method === "POST" && path === "/service/sessions") {
      return issueSession({
        actorType: actorTypeFrom(headers),
        body
      });
    }

    return json(404, {
      error: {
        reason: "route_not_found"
      }
    });
  }

  function createRoom({ actorId, body }) {
    if (!actorId) {
      return missingField("actorId");
    }

    const required = requireFields(body, ["alias", "minecraftVersion", "packProfileName"]);
    if (required) {
      return required;
    }

    const room = simulation.createRoom({
      hostId: actorId,
      alias: body.alias,
      minecraftVersion: body.minecraftVersion,
      packProfileName: body.packProfileName
    });

    return json(201, {
      room: publicRoom(room)
    });
  }

  function revokeInvite({ actorId, inviteHandle }) {
    if (!actorId) {
      return missingField("actorId");
    }

    const binding = inviteHandles.get(inviteHandle);
    const result = simulation.revokeInvite({
      actorId,
      inviteId: binding?.inviteId
    });

    if (!result.ok) {
      return domainError(result.reason);
    }

    return json(200, {
      invite: {
        handle: inviteHandle,
        state: "revoked"
      }
    });
  }

  function heartbeatHost({ actorId, roomId }) {
    if (!actorId) {
      return missingField("actorId");
    }

    const ok = simulation.heartbeatHost({
      actorId,
      roomId
    });

    if (!ok) {
      return domainError(ErrorStates.SESSION_UNAVAILABLE);
    }

    return json(200, {
      room: {
        id: roomId,
        state: "open",
        hostOnline: true
      }
    });
  }

  function createInvite({ actorId, roomId }) {
    if (!actorId) {
      return missingField("actorId");
    }

    const result = simulation.createInvite({ actorId, roomId });
    if (!result.ok) {
      return domainError(result.reason);
    }

    const inviteHandle = `invite_handle_${randomUUID()}`;
    inviteHandles.set(inviteHandle, {
      token: result.token,
      inviteId: result.inviteId,
      roomId
    });

    return json(201, {
      invite: {
        handle: inviteHandle,
        expiresAt: result.expiresAt
      }
    });
  }

  function readSafeInviteStatus(inviteHandle) {
    const binding = inviteHandles.get(inviteHandle);
    const status = simulation.readSafeInviteStatus({ token: binding?.token });

    if (status.unavailable) {
      return json(404, {
        unavailable: true,
        reason: status.reason
      });
    }

    return json(200, {
      invite: {
        unavailable: false,
        roomAlias: status.roomAlias,
        minecraftVersion: status.minecraftVersion,
        packProfileName: status.packProfileName,
        trustCopy: status.trustCopy
      }
    });
  }

  function createJoinRequest(body) {
    const required = requireFields(body, ["inviteHandle", "friendId", "minecraftUuid", "displayName"]);
    if (required) {
      return required;
    }

    const binding = inviteHandles.get(body.inviteHandle);
    const result = simulation.createJoinRequest({
      token: binding?.token,
      friendId: body.friendId,
      minecraftUuid: body.minecraftUuid,
      displayName: body.displayName
    });

    if (!result.ok) {
      return domainError(result.reason);
    }

    requestBindings.set(result.requestId, {
      roomId: binding.roomId,
      inviteId: binding.inviteId,
      minecraftUuid: body.minecraftUuid
    });

    return json(202, {
      request: {
        id: result.requestId,
        state: result.state
      }
    });
  }

  function readApprovalQueue({ actorId, roomId }) {
    if (!actorId) {
      return missingField("actorId");
    }

    const result = simulation.readApprovalQueue({ actorId, roomId });
    if (!result.ok) {
      return domainError(result.reason);
    }

    return json(200, {
      requests: result.requests.map((request) => ({
        id: request.id,
        displayName: request.displayName,
        minecraftUuid: request.minecraftUuid,
        state: request.state
      }))
    });
  }

  function decideJoinRequest({ actorId, requestId, decision }) {
    if (!actorId) {
      return missingField("actorId");
    }

    if (!HOST_DECISIONS.has(decision)) {
      return json(400, {
        error: {
          reason: "invalid_decision"
        }
      });
    }

    const result = simulation.decideJoinRequest({ actorId, requestId, decision });
    if (!result.ok) {
      return domainError(result.reason);
    }

    return json(200, {
      request: {
        id: requestId,
        state: result.state
      }
    });
  }

  function issueSession({ actorType, body }) {
    if (actorType !== Actors.SERVICE) {
      return domainError(ErrorStates.SESSION_UNAVAILABLE);
    }

    const required = requireFields(body, ["requestId", "minecraftUuid"]);
    if (required) {
      return required;
    }

    const binding = requestBindings.get(body.requestId);
    const result = simulation.issueSession({
      requestId: body.requestId,
      roomId: binding?.roomId,
      inviteId: binding?.inviteId,
      minecraftUuid: body.minecraftUuid
    });

    if (!result.ok) {
      return domainError(result.reason);
    }

    const sessionHandle = `session_handle_${randomUUID()}`;
    sessionHandles.set(sessionHandle, {
      sessionId: result.sessionId,
      requestId: body.requestId
    });

    return json(201, {
      session: {
        handle: sessionHandle,
        expiresAt: result.expiresAt
      }
    });
  }

  return {
    handle,
    simulation,
    snapshotBoundaryForTest() {
      return {
        inviteHandleCount: inviteHandles.size,
        requestBindingCount: requestBindings.size,
        sessionHandleCount: sessionHandles.size
      };
    }
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    alias: room.alias,
    minecraftVersion: room.minecraftVersion,
    packProfileName: room.packProfileName,
    state: room.state
  };
}

function requireFields(body, fields) {
  const missing = fields.find((field) => body[field] === undefined || body[field] === null || body[field] === "");
  return missing ? missingField(missing) : null;
}

function missingField(field) {
  return json(400, {
    error: {
      reason: "missing_field",
      field
    }
  });
}

function domainError(reason) {
  return json(statusForReason(reason), {
    error: {
      reason
    }
  });
}

function statusForReason(reason) {
  if (reason === ErrorStates.INVITE_UNAVAILABLE || reason === ErrorStates.ROOM_CLOSED) {
    return 404;
  }

  if (reason === ErrorStates.APPROVAL_REQUIRED || reason === ErrorStates.SESSION_UNAVAILABLE) {
    return 403;
  }

  return 400;
}

function json(status, body) {
  return {
    status,
    headers: {
      "content-type": "application/json"
    },
    body
  };
}

function actorIdFrom(headers) {
  return headers[HEADER_ACTOR_ID];
}

function actorTypeFrom(headers) {
  return headers[HEADER_ACTOR_TYPE];
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function normalizeMethod(method) {
  return String(method ?? "GET").toUpperCase();
}

function normalizePath(path) {
  if (!path) {
    return "/";
  }

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

function match(path, pattern) {
  return pattern.exec(path);
}
