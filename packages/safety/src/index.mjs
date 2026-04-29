import { isIP } from "node:net";

export const InviteRecoveryStates = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  MISSING: "missing",
  INVALID: "invalid",
  UNSUPPORTED_DEVICE: "unsupported_device",
  MODRINTH_MISSING: "modrinth_missing",
  PACK_DOWNLOAD_FAILED: "pack_download_failed",
  IMPORT_FAILED: "import_failed",
  HOST_OFFLINE: "host_offline",
  APPROVAL_TIMEOUT: "approval_timeout"
});

export const AuditEventTypes = Object.freeze({
  ROOM_CREATED: "room_created",
  INVITE_CREATED: "invite_created",
  APPROVAL_DECISION: "approval_decision",
  RELAY_USAGE: "relay_usage"
});

const REDACTED = "[REDACTED]";
const REDACTED_IP = "[REDACTED_IP]";
const REDACTED_INVITE_URL = "[REDACTED_INVITE_URL]";
const REDACTED_CREDENTIAL = "[REDACTED_CREDENTIAL]";

const inviteRecoveryCopy = Object.freeze({
  [InviteRecoveryStates.ACTIVE]: {
    unavailable: false,
    showRoomDetails: true,
    title: "Ready to join",
    body: "Open the pack and wait for the host to approve you.",
    primaryAction: { label: "Open pack", action: "open_pack" },
    secondaryAction: { label: "Copy invite", action: "copy_invite" }
  },
  [InviteRecoveryStates.EXPIRED]: {
    unavailable: true,
    showRoomDetails: false,
    title: "This invite expired",
    body: "Ask the host for a fresh invite.",
    primaryAction: { label: "Ask for new invite", action: "request_new_invite" }
  },
  [InviteRecoveryStates.REVOKED]: {
    unavailable: true,
    showRoomDetails: false,
    title: "This invite no longer works",
    body: "Ask the host to send a new invite when the room is ready.",
    primaryAction: { label: "Ask host", action: "contact_host" }
  },
  [InviteRecoveryStates.MISSING]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Invite not found",
    body: "Check that the whole invite link was copied.",
    primaryAction: { label: "Paste invite again", action: "paste_invite" }
  },
  [InviteRecoveryStates.INVALID]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Invite cannot be opened",
    body: "Use the latest link from the host.",
    primaryAction: { label: "Try another invite", action: "enter_new_invite" }
  },
  [InviteRecoveryStates.UNSUPPORTED_DEVICE]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Open this on a Windows PC",
    body: "The alpha pack is for Minecraft Java on a Windows desktop.",
    primaryAction: { label: "Send to my PC", action: "share_to_pc" }
  },
  [InviteRecoveryStates.MODRINTH_MISSING]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Modrinth App is needed",
    body: "Install Modrinth App, then come back to this invite.",
    primaryAction: { label: "Get Modrinth App", action: "open_modrinth" },
    secondaryAction: { label: "Try again", action: "retry" }
  },
  [InviteRecoveryStates.PACK_DOWNLOAD_FAILED]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Pack download failed",
    body: "Try the download again. If it still fails, ask the host for a new invite.",
    primaryAction: { label: "Retry download", action: "retry_download" },
    secondaryAction: { label: "Ask host", action: "contact_host" }
  },
  [InviteRecoveryStates.IMPORT_FAILED]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Pack import failed",
    body: "Open Modrinth App and try importing the pack again.",
    primaryAction: { label: "Retry import", action: "retry_import" },
    secondaryAction: { label: "Get help", action: "open_help" }
  },
  [InviteRecoveryStates.HOST_OFFLINE]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Host is not ready",
    body: "Ask the host to open the room, then try again.",
    primaryAction: { label: "Try again", action: "retry" },
    secondaryAction: { label: "Ask host", action: "contact_host" }
  },
  [InviteRecoveryStates.APPROVAL_TIMEOUT]: {
    unavailable: true,
    showRoomDetails: false,
    title: "Approval timed out",
    body: "Ask the host to approve you, then try joining again.",
    primaryAction: { label: "Try joining again", action: "retry_join" },
    secondaryAction: { label: "Ask host", action: "contact_host" }
  }
});

const auditRequirements = Object.freeze({
  [AuditEventTypes.ROOM_CREATED]: ["roomId", "actorId"],
  [AuditEventTypes.INVITE_CREATED]: ["roomId", "actorId", "inviteId"],
  [AuditEventTypes.APPROVAL_DECISION]: ["roomId", "actorId", "requestId", "decision"],
  [AuditEventTypes.RELAY_USAGE]: ["roomId", "sessionId", "byteCount"]
});

const sensitiveKeyPattern = /(^|_)(accessToken|authorization|cookie|credential|deviceSignal|ip|ipAddress|inviteToken|minecraftAccessToken|password|refreshToken|secret|sessionCredential|sessionKey|sessionToken|token)(_|$)/i;

export function buildInviteRecoveryState(state, details = {}) {
  const normalizedState = state === "valid" ? InviteRecoveryStates.ACTIVE : state;
  const effectiveState = inviteRecoveryCopy[normalizedState] ? normalizedState : InviteRecoveryStates.INVALID;
  const copy = inviteRecoveryCopy[effectiveState];
  const result = copySafeInviteCopy(copy, effectiveState);

  if (!result.unavailable) {
    return {
      ...result,
      roomAlias: details.roomAlias,
      minecraftVersion: details.minecraftVersion,
      packProfileName: details.packProfileName,
      trustCopy: details.trustCopy
    };
  }

  return result;
}

export function redactSupportBundle(bundle) {
  return redactValue(bundle);
}

export function validateModPermissionMetadata(entry) {
  const missing = [];
  const reasons = [];
  const files = Array.isArray(entry?.files) && entry.files.length > 0 ? entry.files : [entry];
  const sourceUrl = entry?.sourceUrl ?? entry?.source?.url ?? entry?.projectUrl;
  const license = normalizeLicense(entry?.license);
  const permission = entry?.permission ?? entry?.permissions;

  if (!sourceUrl) {
    missing.push("source");
    reasons.push("source metadata is required");
  } else if (!isHttpsUrl(sourceUrl)) {
    reasons.push("source URL must use HTTPS");
  }

  if (!license) {
    missing.push("license");
    reasons.push("license metadata is required");
  }

  if (!hasPermissionRecord(permission)) {
    missing.push("permission");
    reasons.push("redistribution and use permission metadata is required");
  }

  files.forEach((file, index) => {
    const fileLabel = file?.filename ?? file?.path ?? `file ${index + 1}`;
    const downloads = file?.downloads ?? (file?.downloadUrl || file?.url ? [file.downloadUrl ?? file.url] : []);
    const hashes = file?.hashes ?? {};

    if (downloads.length === 0 || !downloads.every(isHttpsUrl)) {
      missing.push(`files[${index}].downloads`);
      reasons.push(`${fileLabel} must keep an original HTTPS download URL`);
    }

    if (!hashes.sha1 || !hashes.sha512) {
      missing.push(`files[${index}].hashes`);
      reasons.push(`${fileLabel} must include pinned SHA1 and SHA512 hashes`);
    }
  });

  return {
    ok: reasons.length === 0,
    entryId: entry?.id ?? entry?.projectId ?? entry?.slug ?? null,
    missing: [...new Set(missing)],
    reasons
  };
}

export function validatePackPolicy(pack) {
  const entries = packEntries(pack);
  const failures = entries
    .map((entry) => validateModPermissionMetadata(entry))
    .filter((result) => !result.ok);

  return {
    ok: failures.length === 0,
    checkedCount: entries.length,
    failures
  };
}

export function createAuditEvent(type, payload, options = {}) {
  if (!Object.values(AuditEventTypes).includes(type)) {
    throw new TypeError(`Unknown audit event type: ${type}`);
  }

  const requiredFields = auditRequirements[type];
  const missing = requiredFields.filter((field) => payload?.[field] === undefined || payload?.[field] === null);
  if (missing.length > 0) {
    throw new TypeError(`Audit event ${type} is missing required fields: ${missing.join(", ")}`);
  }

  const sensitivePaths = findSensitivePaths(payload);
  if (sensitivePaths.length > 0) {
    throw new TypeError(`Audit event ${type} cannot include sensitive fields: ${sensitivePaths.join(", ")}`);
  }

  return {
    type,
    occurredAt: options.occurredAt ?? new Date(0).toISOString(),
    payload: structuredCloneFallback(payload)
  };
}

function copySafeInviteCopy(copy, state) {
  const result = {
    state,
    unavailable: copy.unavailable,
    showRoomDetails: copy.showRoomDetails,
    title: copy.title,
    body: copy.body,
    primaryAction: { ...copy.primaryAction }
  };

  if (copy.secondaryAction) {
    result.secondaryAction = { ...copy.secondaryAction };
  }

  return result;
}

function redactValue(value, key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSensitiveKey(key)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }

  return value;
}

function redactString(value) {
  return redactIpLiterals(value
    .replace(/https?:\/\/[^\s"'<>]*(?:\/invite\/|\/invites\/|\/friend\/invites\/)[^\s"'<>]*/gi, REDACTED_INVITE_URL)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED_CREDENTIAL}`)
    .replace(/\b(inviteToken|token|sessionKey|session|access_token|refresh_token|password|credential|secret)=([^&\s"'<>]+)/gi, `$1=${REDACTED_CREDENTIAL}`)
    .replace(/\b(invite token|session key|session credential|access token|password|credential|secret)\s*[:=]\s*["']?[^"',}\s]+/gi, `$1: ${REDACTED_CREDENTIAL}`)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, REDACTED_IP));
}

function redactIpLiterals(value) {
  return value
    .replace(/\[([A-Fa-f0-9:.]+)\](?::\d+)?/g, (match, candidate) => (isIP(candidate) ? REDACTED_IP : match))
    .replace(/(?<![A-Za-z0-9])::ffff:(?:\d{1,3}\.){3}\d{1,3}(?![A-Za-z0-9])/gi, redactIpCandidate)
    .replace(/(?<![A-Za-z0-9])::(?:[A-Fa-f0-9]{1,4}:){0,6}[A-Fa-f0-9]{0,4}(?![A-Za-z0-9])/g, redactIpCandidate)
    .replace(/(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{1,4}:){1,7}:[A-Fa-f0-9]{0,4}(?![A-Za-z0-9])/g, redactIpCandidate)
    .replace(/\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g, redactIpCandidate);
}

function redactIpCandidate(candidate) {
  return isIP(candidate) ? REDACTED_IP : candidate;
}

function normalizeLicense(license) {
  if (!license) {
    return null;
  }

  if (typeof license === "string") {
    return license.trim() || null;
  }

  return license.id ?? license.name ?? null;
}

function hasPermissionRecord(permission) {
  if (!permission) {
    return false;
  }

  if (typeof permission === "string") {
    return permission.trim().length > 0;
  }

  return Boolean(permission.redistribution && permission.use);
}

function packEntries(pack) {
  if (!pack) {
    return [];
  }

  if (Array.isArray(pack)) {
    return pack;
  }

  if (Array.isArray(pack.mods)) {
    return pack.mods;
  }

  if (Array.isArray(pack.files)) {
    return pack.files.map((file) => ({
      ...file,
      sourceUrl: file.sourceUrl ?? file.metadata?.sourceUrl,
      license: file.license ?? file.metadata?.license,
      permission: file.permission ?? file.metadata?.permission
    }));
  }

  return [pack];
}

function findSensitivePaths(value, basePath = "") {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    return redactString(value) === value ? [] : [basePath || "<value>"];
  }

  if (typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, entryValue]) => {
    const path = basePath ? `${basePath}.${key}` : key;
    if (isSensitiveKey(key)) {
      return [path];
    }
    return findSensitivePaths(entryValue, path);
  });
}

function isSensitiveKey(key) {
  return sensitiveKeyPattern.test(key);
}

function isHttpsUrl(value) {
  return typeof value === "string" && value.startsWith("https://");
}

function structuredCloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}
