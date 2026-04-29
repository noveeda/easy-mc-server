import { randomUUID } from "node:crypto";
import {
  Actions,
  Actors,
  ApprovalStates,
  ErrorStates,
  InviteStates,
  RoomStates,
  SessionStates,
  canActorPerform
} from "../protocol.mjs";
import { createInviteToken } from "../domain/simulation.mjs";

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_JOIN_REQUEST_LIMIT = 5;
const DEFAULT_JOIN_REQUEST_WINDOW_MS = 60 * 1000;
const HOST_DECISIONS = new Set([ApprovalStates.APPROVED, ApprovalStates.DENIED, ApprovalStates.BLOCKED]);

export function createRoomService(options = {}) {
  if (!options.repository) {
    throw new TypeError("room service requires a repository");
  }

  const repository = options.repository;
  const clock = options.clock ?? { now: () => Date.now() };
  const inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const joinRequestLimit = options.joinRequestLimit ?? DEFAULT_JOIN_REQUEST_LIMIT;
  const joinRequestWindowMs = options.joinRequestWindowMs ?? DEFAULT_JOIN_REQUEST_WINDOW_MS;
  const hooks = options.hooks ?? {};
  const ids = {
    roomId: () => `room_${randomUUID()}`,
    inviteId: () => `invite_${randomUUID()}`,
    approvalId: () => `approval_${randomUUID()}`,
    sessionId: () => `session_${randomUUID()}`,
    ...options.ids
  };
  const issueInviteToken = options.createInviteToken ?? createInviteToken;

  return {
    createRoom,
    createInvite,
    revokeInvite,
    regenerateInvite,
    createJoinRequest,
    decideJoinRequest
  };

  async function createRoom({ actorId, alias, minecraftVersion, packProfileName }) {
    if (!actorId) {
      throw new TypeError("createRoom requires actorId");
    }

    return serviceTransaction(repository, async (repo) => {
      const quota = await callHook(hooks.checkRoomQuota, {
        actorId,
        now: clock.now()
      });
      if (!quota.ok) {
        return fail(quota.reason);
      }

      const now = clock.now();
      const room = {
        id: ids.roomId(),
        hostId: actorId,
        alias,
        minecraftVersion,
        packProfileName,
        state: RoomStates.OPEN,
        createdAt: now,
        updatedAt: now
      };
      const saved = await repo.saveRoom(room);
      if (!saved.ok) {
        return saved;
      }

      await audit(repo, {
        type: "room_created",
        actorId,
        roomId: room.id,
        metadata: {
          minecraftVersion,
          packProfileName
        }
      });

      return {
        ok: true,
        room: publicRoom(saved.room ?? room)
      };
    });
  }

  async function createInvite({ actorId, roomId }) {
    return serviceTransaction(repository, async (repo) => {
      const roomResult = await repo.readRoom(roomId);
      if (!roomResult.ok) {
        return fail(ErrorStates.SESSION_UNAVAILABLE);
      }

      const room = roomResult.room;
      if (!canActorPerform(Actors.HOST, Actions.CREATE_INVITE, { actorId, roomHostId: room.hostId })) {
        return fail(ErrorStates.SESSION_UNAVAILABLE);
      }

      const now = clock.now();
      const token = issueInviteToken();
      const invite = {
        id: ids.inviteId(),
        roomId,
        token,
        state: InviteStates.ACTIVE,
        createdAt: now,
        expiresAt: now + inviteTtlMs
      };
      const saved = await repo.saveInvite(invite);
      if (!saved.ok) {
        return saved;
      }

      await audit(repo, {
        type: "invite_created",
        actorId,
        roomId,
        inviteId: saved.invite?.id ?? invite.id,
        metadata: {
          expiresAt: invite.expiresAt
        }
      });

      return {
        ok: true,
        invite: {
          id: saved.invite?.id ?? invite.id,
          token,
          expiresAt: invite.expiresAt
        }
      };
    });
  }

  async function revokeInvite({ actorId, inviteId, reason }) {
    return serviceTransaction(repository, async (repo) => {
      const authorized = await readAuthorizedInvite(repo, {
        actorId,
        inviteId,
        action: Actions.REVOKE_INVITE
      });
      if (!authorized.ok) {
        return authorized;
      }

      const now = clock.now();
      const invite = {
        ...authorized.invite,
        state: InviteStates.REVOKED,
        revokedAt: now
      };
      const saved = await repo.saveInvite(invite);
      if (!saved.ok) {
        return saved;
      }

      await audit(repo, {
        type: "invite_revoked",
        actorId,
        roomId: invite.roomId,
        inviteId,
        metadata: {
          reason: reason ?? "host_revoked",
          revokedAt: now
        }
      });

      return {
        ok: true,
        invite: {
          id: inviteId,
          state: InviteStates.REVOKED
        }
      };
    });
  }

  async function regenerateInvite({ actorId, inviteId }) {
    return serviceTransaction(repository, async (repo) => {
      const authorized = await readAuthorizedInvite(repo, {
        actorId,
        inviteId,
        action: Actions.REVOKE_INVITE
      });
      if (!authorized.ok) {
        return authorized;
      }

      const now = clock.now();
      const oldInvite = {
        ...authorized.invite,
        state: InviteStates.REVOKED,
        revokedAt: now
      };
      const revoked = await repo.saveInvite(oldInvite);
      if (!revoked.ok) {
        return revoked;
      }

      const token = issueInviteToken();
      const nextInvite = {
        id: ids.inviteId(),
        roomId: oldInvite.roomId,
        token,
        state: InviteStates.ACTIVE,
        createdAt: now,
        expiresAt: now + inviteTtlMs
      };
      const saved = await repo.saveInvite(nextInvite);
      if (!saved.ok) {
        return saved;
      }

      await audit(repo, {
        type: "invite_regenerated",
        actorId,
        roomId: oldInvite.roomId,
        inviteId: saved.invite?.id ?? nextInvite.id,
        metadata: {
          revokedInviteId: oldInvite.id,
          expiresAt: nextInvite.expiresAt
        }
      });

      return {
        ok: true,
        invite: {
          id: saved.invite?.id ?? nextInvite.id,
          token,
          expiresAt: nextInvite.expiresAt
        },
        revokedInvite: {
          id: oldInvite.id,
          state: InviteStates.REVOKED
        }
      };
    });
  }

  async function createJoinRequest({ inviteToken, friendId, minecraftUuid, displayName, ipAddress, deviceSignal }) {
    return serviceTransaction(repository, async (repo) => {
      const inviteResult = await repo.readInviteByToken(inviteToken);
      if (!inviteResult.ok) {
        return fail(ErrorStates.INVITE_UNAVAILABLE);
      }

      const invite = inviteResult.invite;
      const roomResult = await repo.readRoom(invite.roomId);
      if (!roomResult.ok || !(await isRoomAvailable(repo, roomResult.room))) {
        return fail(ErrorStates.ROOM_CLOSED);
      }

      const rateLimit = await applyJoinRequestRateLimits(repo, {
        inviteId: invite.id,
        ipAddress,
        deviceSignal,
        minecraftUuid
      });
      if (!rateLimit.ok) {
        return rateLimit;
      }

      const approval = {
        id: ids.approvalId(),
        roomId: invite.roomId,
        inviteId: invite.id,
        friendId,
        minecraftUuid,
        displayName,
        state: ApprovalStates.PENDING,
        createdAt: clock.now(),
        decidedAt: null
      };
      const saved = await repo.saveApproval(approval);
      if (!saved.ok) {
        return saved;
      }

      return {
        ok: true,
        request: {
          id: saved.approval?.id ?? approval.id,
          state: ApprovalStates.PENDING
        }
      };
    });
  }

  async function decideJoinRequest({ actorId, requestId, decision, minecraftUuid, sessionCredential }) {
    if (!HOST_DECISIONS.has(decision)) {
      return fail(ErrorStates.APPROVAL_REQUIRED);
    }

    return serviceTransaction(repository, async (repo) => {
      const approvalResult = await repo.readApproval(requestId);
      if (!approvalResult.ok) {
        return fail(ErrorStates.SESSION_UNAVAILABLE);
      }

      const approval = approvalResult.approval;
      const roomResult = await repo.readRoom(approval.roomId);
      if (!roomResult.ok) {
        return fail(ErrorStates.SESSION_UNAVAILABLE);
      }

      const room = roomResult.room;
      if (!canActorPerform(Actors.HOST, actionForDecision(decision), { actorId, roomHostId: room.hostId })) {
        return fail(ErrorStates.SESSION_UNAVAILABLE);
      }

      if (approval.state !== ApprovalStates.PENDING) {
        return fail(ErrorStates.APPROVAL_REQUIRED);
      }

      const decidedAt = clock.now();
      const decidedApproval = {
        ...approval,
        state: decision,
        decidedAt
      };

      const preparedSession =
        decision === ApprovalStates.APPROVED
          ? await prepareSessionForApproval(repo, {
              approval: decidedApproval,
              room,
              minecraftUuid,
              sessionCredential
            })
          : null;
      if (preparedSession && !preparedSession.ok) {
        return preparedSession;
      }

      const savedApproval = await repo.saveApproval(decidedApproval);
      if (!savedApproval.ok) {
        return savedApproval;
      }

      await audit(repo, {
        type: "approval_decided",
        actorId,
        roomId: approval.roomId,
        inviteId: approval.inviteId,
        requestId,
        metadata: {
          decision,
          decidedAt
        }
      });

      if (!preparedSession) {
        return {
          ok: true,
          request: {
            id: requestId,
            state: decision
          }
        };
      }

      const sessionResult = await savePreparedSession(repo, preparedSession.sessionRecord, preparedSession.session);
      if (!sessionResult.ok) {
        return sessionResult;
      }

      return {
        ok: true,
        request: {
          id: requestId,
          state: ApprovalStates.APPROVED
        },
        session: sessionResult.session
      };
    });
  }

  async function prepareSessionForApproval(repo, { approval, room, minecraftUuid, sessionCredential }) {
    if (approval.minecraftUuid !== minecraftUuid) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    const inviteResult = await repo.readInvite(approval.inviteId);
    if (!inviteResult.ok || !isInviteActive(inviteResult.invite, clock.now())) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    if (!(await isRoomAvailable(repo, room))) {
      return fail(ErrorStates.ROOM_CLOSED);
    }

    const authorized = canActorPerform(Actors.SERVICE, Actions.ISSUE_SESSION, {
      authorizedApproval: true
    });
    if (!authorized) {
      return fail(ErrorStates.SESSION_UNAVAILABLE);
    }

    const quota = await callHook(hooks.checkSessionQuota, {
      roomId: approval.roomId,
      requestId: approval.id,
      inviteId: approval.inviteId,
      minecraftUuid,
      now: clock.now()
    });
    if (!quota.ok) {
      return fail(quota.reason);
    }

    const now = clock.now();
    const session = {
      id: ids.sessionId(),
      roomId: approval.roomId,
      inviteId: approval.inviteId,
      requestId: approval.id,
      minecraftUuid,
      sessionCredential,
      state: SessionStates.ISSUED,
      issuedAt: now,
      expiresAt: now + sessionTtlMs
    };

    return {
      ok: true,
      sessionRecord: session,
      session: {
        id: session.id,
        expiresAt: session.expiresAt
      }
    };
  }

  async function savePreparedSession(repo, sessionRecord, sessionDto) {
    const saved = await repo.saveSession(sessionRecord);
    if (!saved.ok) {
      return saved;
    }

    return {
      ok: true,
      session: {
        id: saved.session?.id ?? sessionDto.id,
        expiresAt: sessionDto.expiresAt
      }
    };
  }

  async function applyJoinRequestRateLimits(repo, { inviteId, ipAddress, deviceSignal, minecraftUuid }) {
    const signals = [
      ["join_request.invite", inviteId],
      ["join_request.ip_device", [ipAddress, deviceSignal].filter(Boolean).join("|")],
      ["join_request.minecraft_identity", minecraftUuid]
    ].filter(([, signal]) => signal);

    for (const [scope, signal] of signals) {
      const result = await repo.incrementRateLimitCounter({
        scope,
        signal,
        limit: joinRequestLimit,
        windowMs: joinRequestWindowMs
      });
      if (!result.ok) {
        return fail(result.reason);
      }
    }

    return { ok: true };
  }
}

async function readAuthorizedInvite(repo, { actorId, inviteId, action }) {
  const inviteResult = await repo.readInvite(inviteId);
  if (!inviteResult.ok) {
    return fail(ErrorStates.INVITE_UNAVAILABLE);
  }

  const invite = inviteResult.invite;
  const roomResult = await repo.readRoom(invite.roomId);
  if (!roomResult.ok) {
    return fail(ErrorStates.INVITE_UNAVAILABLE);
  }

  if (!canActorPerform(Actors.HOST, action, { actorId, roomHostId: roomResult.room.hostId })) {
    return fail(ErrorStates.INVITE_UNAVAILABLE);
  }

  return {
    ok: true,
    invite,
    room: roomResult.room
  };
}

async function serviceTransaction(repository, operation) {
  if (typeof repository.withTransaction === "function") {
    return repository.withTransaction((transactionRepository) => operation(transactionRepository ?? repository));
  }

  return operation(repository);
}

async function audit(repo, event) {
  if (typeof repo.recordAuditEvent !== "function") {
    return { ok: true };
  }

  return repo.recordAuditEvent(event);
}

async function callHook(hook, context) {
  if (typeof hook !== "function") {
    return { ok: true };
  }

  const result = await hook(context);
  if (result === false) {
    return fail(ErrorStates.SESSION_UNAVAILABLE);
  }

  return result?.ok === false ? result : { ok: true };
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

function isRoomOpen(room) {
  return room?.state === RoomStates.OPEN;
}

async function isRoomAvailable(repo, room) {
  if (!isRoomOpen(room)) {
    return false;
  }

  if (typeof repo.readPresence !== "function") {
    return true;
  }

  const presence = await repo.readPresence(room.id);
  return Boolean(presence.ok);
}

function isInviteActive(invite, now) {
  return Boolean(invite && invite.state === InviteStates.ACTIVE && (!invite.expiresAt || invite.expiresAt > now));
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
