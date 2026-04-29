const DEFAULT_CANDIDATE_TTL_MS = 30 * 1000;
const DEFAULT_DIRECT_ATTEMPT_TIMEOUT_MS = 2 * 1000;

const systemClock = Object.freeze({
  now() {
    return Date.now();
  }
});

export const TransportPaths = Object.freeze({
  DIRECT: "direct",
  RELAY: "relay"
});

export const NetworkTypes = Object.freeze({
  HOME: "home_network",
  RESTRICTED: "restricted_network",
  UNKNOWN: "unknown"
});

export const CandidateRejectReasons = Object.freeze({
  INVALID_CANDIDATE: "invalid_candidate",
  CANDIDATE_EXPIRED: "candidate_expired",
  CROSS_ROOM: "cross_room_candidate"
});

export const SelectionReasons = Object.freeze({
  SAFE_DIRECT_CANDIDATE: "safe_direct_candidate",
  RESTRICTED_NETWORK_FALLBACK: "restricted_network_fallback",
  NO_SAFE_DIRECT_CANDIDATE: "no_safe_direct_candidate",
  DIRECT_FAILED_RELAY_FALLBACK: "direct_failed_relay_fallback",
  RELAY_UNAVAILABLE: "relay_unavailable"
});

export const DIRECT_PRIVACY_COPY =
  "A direct room connection can show your internet address to the approved friend. If it does not connect quickly, the room keeps using the reliable room path.";

export const DIRECT_NO_FALLBACK_PRIVACY_COPY =
  "A direct room connection can show your internet address to the approved friend. If it does not connect, joining may fail until the reliable room path is available.";

export const RELAY_FALLBACK_COPY =
  "The room is using the reliable room path. Direct connection problems do not block joining while that path is available.";

export function createTransportCandidateExchange(options = {}) {
  const clock = options.clock ?? systemClock;
  const candidateTtlMs = options.candidateTtlMs ?? DEFAULT_CANDIDATE_TTL_MS;
  const directAttemptTimeoutMs = options.directAttemptTimeoutMs ?? DEFAULT_DIRECT_ATTEMPT_TIMEOUT_MS;
  const candidatesByRoom = new Map();
  let nextCandidateId = 1;

  function submitCandidate({ roomId, candidate } = {}) {
    if (!isObject(candidate) || !roomId || !candidate.roomId || !candidate.participantId || !candidate.path) {
      return fail(CandidateRejectReasons.INVALID_CANDIDATE);
    }

    if (candidate.roomId !== roomId) {
      return fail(CandidateRejectReasons.CROSS_ROOM);
    }

    const now = clock.now();
    const createdAt = candidate.createdAt ?? now;
    const expiresAt = candidate.expiresAt ?? createdAt + candidateTtlMs;

    if (expiresAt <= now) {
      return fail(CandidateRejectReasons.CANDIDATE_EXPIRED);
    }

    const normalized = Object.freeze({
      id: candidate.id ?? `candidate_${nextCandidateId++}`,
      roomId,
      participantId: candidate.participantId,
      path: candidate.path,
      networkType: candidate.networkType ?? NetworkTypes.UNKNOWN,
      directAllowed: candidate.directAllowed === true,
      restricted: candidate.restricted === true,
      createdAt,
      expiresAt,
      diagnostics: Array.isArray(candidate.diagnostics) ? [...candidate.diagnostics] : []
    });

    const candidates = candidatesByRoom.get(roomId) ?? [];
    candidates.push(normalized);
    candidatesByRoom.set(roomId, candidates);

    return {
      ok: true,
      candidate: publicCandidate(normalized)
    };
  }

  function selectTransport({ roomId, relayAvailable = true } = {}) {
    const candidates = activeCandidatesForRoom(roomId);
    const directCandidates = candidates.filter((candidate) => candidate.path === TransportPaths.DIRECT);
    const directCandidate = directCandidates.find(isSafeDirectCandidate);

    if (directCandidate) {
      return {
        ok: true,
        path: TransportPaths.DIRECT,
        reason: SelectionReasons.SAFE_DIRECT_CANDIDATE,
        candidateId: directCandidate.id,
        participantId: directCandidate.participantId,
        directAttemptTimeoutMs,
        fallbackPath: relayAvailable ? TransportPaths.RELAY : undefined,
        joinFailure: false,
        privacyCopy: relayAvailable ? DIRECT_PRIVACY_COPY : DIRECT_NO_FALLBACK_PRIVACY_COPY
      };
    }

    if (!relayAvailable) {
      return fail(SelectionReasons.RELAY_UNAVAILABLE);
    }

    const reason = directCandidates.some(isRestrictedDirectCandidate)
      ? SelectionReasons.RESTRICTED_NETWORK_FALLBACK
      : SelectionReasons.NO_SAFE_DIRECT_CANDIDATE;

    return relaySelection({ reason, directAttemptTimeoutMs });
  }

  function resolveDirectAttempt({ selection, outcome, relayAvailable = true } = {}) {
    if (!selection || selection.path !== TransportPaths.DIRECT) {
      return selection ?? relaySelection({ reason: SelectionReasons.NO_SAFE_DIRECT_CANDIDATE, directAttemptTimeoutMs });
    }

    if (outcome === "connected") {
      return {
        ...selection,
        directAttempt: "connected",
        joinFailure: false
      };
    }

    if (!relayAvailable) {
      return fail(SelectionReasons.RELAY_UNAVAILABLE);
    }

    return relaySelection({
      reason: SelectionReasons.DIRECT_FAILED_RELAY_FALLBACK,
      directAttemptTimeoutMs,
      failedCandidateId: selection.candidateId
    });
  }

  function activeCandidatesForRoom(roomId) {
    const now = clock.now();
    const candidates = candidatesByRoom.get(roomId) ?? [];
    const active = candidates.filter((candidate) => candidate.expiresAt > now);

    if (active.length !== candidates.length) {
      candidatesByRoom.set(roomId, active);
    }

    return active;
  }

  return {
    submitCandidate,
    selectTransport,
    resolveDirectAttempt,
    listCandidatesForTest({ roomId } = {}) {
      return activeCandidatesForRoom(roomId).map(publicCandidate);
    }
  };
}

function relaySelection({ reason, directAttemptTimeoutMs, failedCandidateId } = {}) {
  return {
    ok: true,
    path: TransportPaths.RELAY,
    reason,
    directAttemptTimeoutMs,
    failedCandidateId,
    joinFailure: false,
    privacyCopy: RELAY_FALLBACK_COPY
  };
}

function isSafeDirectCandidate(candidate) {
  return (
    candidate.path === TransportPaths.DIRECT &&
    candidate.networkType === NetworkTypes.HOME &&
    candidate.directAllowed &&
    !candidate.restricted
  );
}

function isRestrictedDirectCandidate(candidate) {
  return (
    candidate.path === TransportPaths.DIRECT &&
    (candidate.networkType === NetworkTypes.RESTRICTED || candidate.restricted || !candidate.directAllowed)
  );
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    roomId: candidate.roomId,
    participantId: candidate.participantId,
    path: candidate.path,
    networkType: candidate.networkType,
    directAllowed: candidate.directAllowed,
    restricted: candidate.restricted,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    diagnostics: [...candidate.diagnostics]
  };
}

function fail(reason) {
  return {
    ok: false,
    reason
  };
}

function isObject(value) {
  return value !== null && typeof value === "object";
}
