export const Actors = Object.freeze({
  HOST: "host",
  FRIEND: "friend",
  SERVICE: "service",
  SERVICE_ADMIN: "service_admin"
});

export const Actions = Object.freeze({
  CREATE_ROOM: "create_room",
  CREATE_INVITE: "create_invite",
  REVOKE_INVITE: "revoke_invite",
  READ_SAFE_INVITE: "read_safe_invite",
  READ_APPROVAL_QUEUE: "read_approval_queue",
  CREATE_JOIN_REQUEST: "create_join_request",
  APPROVE_JOIN: "approve_join",
  DENY_JOIN: "deny_join",
  BLOCK_JOIN: "block_join",
  ISSUE_SESSION: "issue_session",
  READ_RELAY_METRICS: "read_relay_metrics",
  BREAK_GLASS_READ: "break_glass_read"
});

export const RoomStates = Object.freeze({
  CREATED: "created",
  OPEN: "open",
  CLOSED: "closed",
  HOST_OFFLINE: "host_offline"
});

export const InviteStates = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  UNAVAILABLE: "unavailable"
});

export const ApprovalStates = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  DENIED: "denied",
  BLOCKED: "blocked",
  EXPIRED: "expired",
  HOST_UNAVAILABLE: "host_unavailable",
  ALREADY_ALLOWED: "already_allowed",
  IDENTITY_CHANGED: "identity_changed"
});

export const SessionStates = Object.freeze({
  ISSUED: "issued",
  EXPIRED: "expired",
  REVOKED: "revoked"
});

export const TransportStates = Object.freeze({
  RELAY_ONLY: "relay_only",
  RELAY_AUTHORIZED: "relay_authorized",
  RELAY_DENIED: "relay_denied"
});

export const InstallStates = Object.freeze({
  INVITE_OPENED: "invite_opened",
  MODRINTH_MISSING: "modrinth_missing",
  PACK_DOWNLOADED: "pack_downloaded",
  IMPORT_FAILED: "import_failed",
  UNSUPPORTED_DEVICE: "unsupported_device",
  APPROVAL_PENDING: "approval_pending",
  APPROVED: "approved"
});

export const ErrorStates = Object.freeze({
  INVITE_UNAVAILABLE: "invite_unavailable",
  ROOM_CLOSED: "room_closed",
  APPROVAL_REQUIRED: "approval_required",
  SESSION_UNAVAILABLE: "session_unavailable",
  RATE_LIMITED: "rate_limited"
});

export const RiskLabels = Object.freeze({
  HIGH_CONFIDENCE: "high_confidence",
  CAUTION: "caution",
  LIKELY_FAIL: "likely_fail"
});

export const SAFE_INVITE_STATUS = Object.freeze({
  unavailable: true,
  reason: ErrorStates.INVITE_UNAVAILABLE
});

const ownRoomHostActions = new Set([
  Actions.CREATE_ROOM,
  Actions.CREATE_INVITE,
  Actions.REVOKE_INVITE,
  Actions.READ_SAFE_INVITE,
  Actions.READ_APPROVAL_QUEUE,
  Actions.APPROVE_JOIN,
  Actions.DENY_JOIN,
  Actions.BLOCK_JOIN,
  Actions.READ_RELAY_METRICS
]);

const friendActions = new Set([
  Actions.READ_SAFE_INVITE,
  Actions.CREATE_JOIN_REQUEST
]);

const serviceActions = new Set([
  Actions.ISSUE_SESSION
]);

const serviceAdminActions = new Set([
  Actions.BREAK_GLASS_READ
]);

export function isKnownRiskLabel(label) {
  return Object.values(RiskLabels).includes(label);
}

export function canActorPerform(actor, action, context = {}) {
  if (!Object.values(Actors).includes(actor)) {
    return false;
  }

  if (!Object.values(Actions).includes(action)) {
    return false;
  }

  if (actor === Actors.HOST) {
    if (!ownRoomHostActions.has(action)) {
      return false;
    }

    return Boolean(context.roomHostId && context.actorId && context.roomHostId === context.actorId);
  }

  if (actor === Actors.FRIEND) {
    return friendActions.has(action) && Boolean(context.validInvite);
  }

  if (actor === Actors.SERVICE) {
    return serviceActions.has(action) && Boolean(context.authorizedApproval);
  }

  if (actor === Actors.SERVICE_ADMIN) {
    return serviceAdminActions.has(action) && Boolean(context.breakGlass);
  }

  return false;
}

export function redactInviteStatus(status) {
  if (!status || status.state !== InviteStates.ACTIVE) {
    return { ...SAFE_INVITE_STATUS };
  }

  return {
    unavailable: false,
    roomAlias: status.roomAlias,
    minecraftVersion: status.minecraftVersion,
    packProfileName: status.packProfileName,
    trustCopy: status.trustCopy
  };
}
