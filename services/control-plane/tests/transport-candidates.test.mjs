import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryClock } from "../src/domain/simulation.mjs";
import {
  CandidateRejectReasons,
  DIRECT_NO_FALLBACK_PRIVACY_COPY,
  DIRECT_PRIVACY_COPY,
  NetworkTypes,
  RELAY_FALLBACK_COPY,
  SelectionReasons,
  TransportPaths,
  createTransportCandidateExchange
} from "../src/transport/candidates.mjs";

function createDirectCandidate(overrides = {}) {
  return {
    roomId: "room-a",
    participantId: "host-a",
    path: TransportPaths.DIRECT,
    networkType: NetworkTypes.HOME,
    directAllowed: true,
    restricted: false,
    ...overrides
  };
}

test("expired candidates are rejected and stored candidates expire before selection", () => {
  const clock = createMemoryClock();
  const exchange = createTransportCandidateExchange({ clock, candidateTtlMs: 1000 });

  assert.deepEqual(
    exchange.submitCandidate({
      roomId: "room-a",
      candidate: createDirectCandidate({ expiresAt: clock.now() })
    }),
    {
      ok: false,
      reason: CandidateRejectReasons.CANDIDATE_EXPIRED
    }
  );

  const accepted = exchange.submitCandidate({
    roomId: "room-a",
    candidate: createDirectCandidate()
  });

  assert.equal(accepted.ok, true);
  assert.equal(exchange.listCandidatesForTest({ roomId: "room-a" }).length, 1);

  clock.advance(1001);

  assert.deepEqual(exchange.listCandidatesForTest({ roomId: "room-a" }), []);
  assert.deepEqual(exchange.selectTransport({ roomId: "room-a" }), {
    ok: true,
    path: TransportPaths.RELAY,
    reason: SelectionReasons.NO_SAFE_DIRECT_CANDIDATE,
    directAttemptTimeoutMs: 2000,
    failedCandidateId: undefined,
    joinFailure: false,
    privacyCopy: RELAY_FALLBACK_COPY
  });
});

test("cross-room candidates are rejected and not stored in the target room", () => {
  const exchange = createTransportCandidateExchange();

  assert.deepEqual(
    exchange.submitCandidate({
      roomId: "room-a",
      candidate: createDirectCandidate({ roomId: "room-b" })
    }),
    {
      ok: false,
      reason: CandidateRejectReasons.CROSS_ROOM
    }
  );

  assert.deepEqual(exchange.listCandidatesForTest({ roomId: "room-a" }), []);
});

test("common home-network candidate selects direct path with privacy copy", () => {
  const exchange = createTransportCandidateExchange({ directAttemptTimeoutMs: 750 });
  const accepted = exchange.submitCandidate({
    roomId: "room-a",
    candidate: createDirectCandidate({ id: "direct-home-a" })
  });

  assert.equal(accepted.ok, true);

  assert.deepEqual(exchange.selectTransport({ roomId: "room-a" }), {
    ok: true,
    path: TransportPaths.DIRECT,
    reason: SelectionReasons.SAFE_DIRECT_CANDIDATE,
    candidateId: "direct-home-a",
    participantId: "host-a",
    directAttemptTimeoutMs: 750,
    fallbackPath: TransportPaths.RELAY,
    joinFailure: false,
    privacyCopy: DIRECT_PRIVACY_COPY
  });

  assert.match(DIRECT_PRIVACY_COPY, /internet address/);
  assert.match(DIRECT_PRIVACY_COPY, /approved friend/);
});

test("direct selection does not advertise relay fallback when relay is unavailable", () => {
  const exchange = createTransportCandidateExchange({ directAttemptTimeoutMs: 750 });
  exchange.submitCandidate({
    roomId: "room-a",
    candidate: createDirectCandidate({ id: "direct-home-a" })
  });

  assert.deepEqual(exchange.selectTransport({ roomId: "room-a", relayAvailable: false }), {
    ok: true,
    path: TransportPaths.DIRECT,
    reason: SelectionReasons.SAFE_DIRECT_CANDIDATE,
    candidateId: "direct-home-a",
    participantId: "host-a",
    directAttemptTimeoutMs: 750,
    fallbackPath: undefined,
    joinFailure: false,
    privacyCopy: DIRECT_NO_FALLBACK_PRIVACY_COPY
  });
});

test("restricted networks fall back to relay within the direct attempt timeout", () => {
  const exchange = createTransportCandidateExchange({ directAttemptTimeoutMs: 500 });

  const accepted = exchange.submitCandidate({
    roomId: "room-a",
    candidate: createDirectCandidate({
      id: "direct-restricted-a",
      networkType: NetworkTypes.RESTRICTED,
      directAllowed: false,
      restricted: true
    })
  });

  assert.equal(accepted.ok, true);

  const selection = exchange.selectTransport({ roomId: "room-a" });

  assert.equal(selection.ok, true);
  assert.equal(selection.path, TransportPaths.RELAY);
  assert.equal(selection.reason, SelectionReasons.RESTRICTED_NETWORK_FALLBACK);
  assert.equal(selection.directAttemptTimeoutMs, 500);
  assert.equal(selection.joinFailure, false);
});

test("direct failure falls back to relay and never becomes a join failure", () => {
  const exchange = createTransportCandidateExchange();
  exchange.submitCandidate({
    roomId: "room-a",
    candidate: createDirectCandidate({ id: "direct-home-a" })
  });
  const selection = exchange.selectTransport({ roomId: "room-a" });

  assert.equal(selection.path, TransportPaths.DIRECT);

  assert.deepEqual(exchange.resolveDirectAttempt({ selection, outcome: "failed" }), {
    ok: true,
    path: TransportPaths.RELAY,
    reason: SelectionReasons.DIRECT_FAILED_RELAY_FALLBACK,
    directAttemptTimeoutMs: 2000,
    failedCandidateId: "direct-home-a",
    joinFailure: false,
    privacyCopy: RELAY_FALLBACK_COPY
  });
});
