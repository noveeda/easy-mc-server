import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Actions,
  Actors,
  ApprovalStates,
  ErrorStates,
  InviteStates,
  RoomStates,
  SessionStates,
  canActorPerform,
  redactInviteStatus
} from "../protocol.mjs";

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRESENCE_TTL_MS = 90 * 1000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;

export function createMemoryClock(initialNow = Date.parse("2026-04-30T00:00:00.000Z")) {
  let current = initialNow;

  return {
    now() {
      return current;
    },
    advance(ms) {
      current += ms;
      return current;
    }
  };
}

export function hashInviteToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createControlPlaneSimulation(options = {}) {
  const clock = options.clock ?? createMemoryClock();
  const inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  const presenceTtlMs = options.presenceTtlMs ?? DEFAULT_PRESENCE_TTL_MS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  const rooms = new Map();
  const invites = new Map();
  const approvals = new Map();
  const sessions = new Map();
  const rawTokens = new Map();

  function createRoom({ hostId, alias, minecraftVersion, packProfileName }) {
    const roomId = `room_${randomUUID()}`;
    const now = clock.now();
    const room = {
      id: roomId,
      hostId,
      alias,
      minecraftVersion,
      packProfileName,
      state: RoomStates.OPEN,
      createdAt: now,
      hostLastSeenAt: now
    };

    rooms.set(roomId, room);
    return { ...room };
  }

  function heartbeatHost({ actorId, roomId }) {
    const room = rooms.get(roomId);
    if (!room || room.hostId !== actorId) {
      return false;
    }

    room.hostLastSeenAt = clock.now();
    room.state = RoomStates.OPEN;
    return true;
  }

  function isHostOnline(room) {
    return room && room.state === RoomStates.OPEN && clock.now() - room.hostLastSeenAt <= presenceTtlMs;
  }

  function createInvite({ actorId, roomId }) {
    return createInviteRecord({ actorId, roomId, token: createInviteToken() });
  }

  function createInviteForTest({ actorId, roomId, token }) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("createInviteForTest is only available with NODE_ENV=test");
    }

    return createInviteRecord({ actorId, roomId, token });
  }

  function createInviteRecord({ actorId, roomId, token }) {
    const room = rooms.get(roomId);
    if (!room || !canActorPerform(Actors.HOST, Actions.CREATE_INVITE, { actorId, roomHostId: room.hostId })) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    const inviteId = `invite_${randomUUID()}`;
    const tokenHash = hashInviteToken(token);
    const invite = {
      id: inviteId,
      roomId,
      tokenHash,
      state: InviteStates.ACTIVE,
      createdAt: clock.now(),
      expiresAt: clock.now() + inviteTtlMs
    };

    invites.set(inviteId, invite);
    rawTokens.set(tokenHash, inviteId);

    return {
      ok: true,
      inviteId,
      token,
      expiresAt: invite.expiresAt
    };
  }

  function revokeInvite({ actorId, inviteId }) {
    const invite = invites.get(inviteId);
    const room = invite ? rooms.get(invite.roomId) : null;

    if (!invite || !room || !canActorPerform(Actors.HOST, Actions.REVOKE_INVITE, { actorId, roomHostId: room.hostId })) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    invite.state = InviteStates.REVOKED;
    return { ok: true };
  }

  function resolveInviteByToken(token) {
    if (!token) {
      return null;
    }

    const inviteId = rawTokens.get(hashInviteToken(token));
    return inviteId ? invites.get(inviteId) : null;
  }

  function isInviteActive(invite) {
    return invite && invite.state === InviteStates.ACTIVE && invite.expiresAt > clock.now();
  }

  function readSafeInviteStatus({ token }) {
    const invite = resolveInviteByToken(token);
    if (!isInviteActive(invite)) {
      return redactInviteStatus(null);
    }

    const room = rooms.get(invite.roomId);
    if (!room) {
      return redactInviteStatus(null);
    }

    return redactInviteStatus({
      state: InviteStates.ACTIVE,
      roomAlias: room.alias,
      minecraftVersion: room.minecraftVersion,
      packProfileName: room.packProfileName,
      trustCopy: "No Microsoft or Minecraft password is required."
    });
  }

  function createJoinRequest({ token, friendId, minecraftUuid, displayName }) {
    const invite = resolveInviteByToken(token);
    if (!isInviteActive(invite)) {
      return fail(ErrorStates.INVITE_UNAVAILABLE);
    }

    const room = rooms.get(invite.roomId);
    if (!room || !isHostOnline(room)) {
      return fail(ErrorStates.ROOM_CLOSED);
    }

    if (!canActorPerform(Actors.FRIEND, Actions.CREATE_JOIN_REQUEST, { validInvite: true })) {
      return fail(ErrorStates.APPROVAL_REQUIRED);
    }

    const requestId = `approval_${randomUUID()}`;
    const request = {
      id: requestId,
      roomId: room.id,
      inviteId: invite.id,
      friendId,
      minecraftUuid,
      displayName,
      state: ApprovalStates.PENDING,
      createdAt: clock.now(),
      sessionIssued: false
    };

    approvals.set(requestId, request);

    return {
      ok: true,
      requestId,
      state: request.state
    };
  }

  function readApprovalQueue({ actorId, roomId }) {
    const room = rooms.get(roomId);
    if (!room || !canActorPerform(Actors.HOST, Actions.READ_APPROVAL_QUEUE, { actorId, roomHostId: room.hostId })) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    return {
      ok: true,
      requests: [...approvals.values()]
        .filter((request) => request.roomId === roomId && request.state === ApprovalStates.PENDING)
        .map((request) => ({
          id: request.id,
          displayName: request.displayName,
          minecraftUuid: request.minecraftUuid,
          state: request.state
        }))
    };
  }

  function decideJoinRequest({ actorId, requestId, decision }) {
    const request = approvals.get(requestId);
    const room = request ? rooms.get(request.roomId) : null;

    if (!request || !room || !canActorPerform(Actors.HOST, actionForDecision(decision), { actorId, roomHostId: room.hostId })) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    if (request.state !== ApprovalStates.PENDING) {
      return fail(ErrorStates.APPROVAL_REQUIRED);
    }

    request.state = decision;
    return {
      ok: true,
      state: request.state
    };
  }

  function issueSession({ requestId, roomId, inviteId, minecraftUuid }) {
    const request = approvals.get(requestId);
    const room = request ? rooms.get(request.roomId) : null;
    const invite = request ? invites.get(request.inviteId) : null;
    const identityBound =
      request &&
      room &&
      invite &&
      request.state === ApprovalStates.APPROVED &&
      request.roomId === roomId &&
      request.inviteId === inviteId &&
      request.minecraftUuid === minecraftUuid &&
      !request.sessionIssued &&
      isInviteActive(invite);

    if (identityBound && !isHostOnline(room)) {
      return fail(ErrorStates.ROOM_CLOSED);
    }

    const authorized =
      identityBound &&
      isHostOnline(room);

    if (!canActorPerform(Actors.SERVICE, Actions.ISSUE_SESSION, { authorizedApproval: authorized })) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    request.sessionIssued = true;
    const sessionId = `session_${randomUUID()}`;
    const session = {
      id: sessionId,
      roomId,
      inviteId,
      requestId,
      minecraftUuid,
      state: SessionStates.ISSUED,
      issuedAt: clock.now(),
      expiresAt: clock.now() + sessionTtlMs
    };

    sessions.set(sessionId, session);

    return {
      ok: true,
      sessionId,
      expiresAt: session.expiresAt
    };
  }

  function readSession({ sessionId }) {
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= clock.now() || session.state !== SessionStates.ISSUED) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    return {
      ok: true,
      roomId: session.roomId,
      minecraftUuid: session.minecraftUuid,
      expiresAt: session.expiresAt
    };
  }

  return {
    clock,
    createRoom,
    heartbeatHost,
    createInvite,
    createInviteForTest,
    revokeInvite,
    readSafeInviteStatus,
    createJoinRequest,
    readApprovalQueue,
    decideJoinRequest,
    issueSession,
    readSession,
    snapshotInviteForTest(inviteId) {
      const invite = invites.get(inviteId);
      if (!invite) {
        return null;
      }

      return {
        id: invite.id,
        roomId: invite.roomId,
        tokenHash: invite.tokenHash,
        state: invite.state,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        hasRawToken: Object.hasOwn(invite, "token")
      };
    }
  };
}

export function createInviteToken() {
  return randomBytes(24).toString("base64url");
}

function actionForDecision(decision) {
  if (decision === ApprovalStates.APPROVED) {
    return Actions.APPROVE_JOIN;
  }

  if (decision === ApprovalStates.DENIED) {
    return Actions.DENY_JOIN;
  }

  if (decision === ApprovalStates.BLOCKED) {
    return Actions.BLOCK_JOIN;
  }

  return "unknown";
}

function fail(reason) {
  return {
    ok: false,
    reason
  };
}
