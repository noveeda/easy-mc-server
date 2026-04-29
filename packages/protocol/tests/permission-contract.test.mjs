import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Actions,
  Actors,
  ApprovalStates,
  ErrorStates,
  InviteStates,
  RiskLabels,
  canActorPerform,
  isKnownRiskLabel,
  redactInviteStatus
} from "../src/index.mjs";

test("host permissions are scoped to own room", () => {
  assert.equal(canActorPerform(Actors.HOST, Actions.CREATE_INVITE, { actorId: "host-a", roomHostId: "host-a" }), true);
  assert.equal(canActorPerform(Actors.HOST, Actions.CREATE_INVITE, { actorId: "host-a", roomHostId: "host-b" }), false);
  assert.equal(canActorPerform(Actors.HOST, Actions.APPROVE_JOIN, { ownRoom: true }), false);
  assert.equal(canActorPerform(Actors.HOST, Actions.APPROVE_JOIN, { actorId: "host-a" }), false);
  assert.equal(canActorPerform(Actors.HOST, Actions.APPROVE_JOIN, { roomHostId: "host-a" }), false);
  assert.equal(canActorPerform(Actors.HOST, Actions.APPROVE_JOIN, { actorId: "host-a", roomHostId: "host-a" }), true);
});

test("friend cannot manage invites or approvals", () => {
  assert.equal(canActorPerform(Actors.FRIEND, Actions.READ_SAFE_INVITE, { validInvite: true }), true);
  assert.equal(canActorPerform(Actors.FRIEND, Actions.CREATE_JOIN_REQUEST, { validInvite: true }), true);
  assert.equal(canActorPerform(Actors.FRIEND, Actions.CREATE_INVITE, { validInvite: true }), false);
  assert.equal(canActorPerform(Actors.FRIEND, Actions.APPROVE_JOIN, { validInvite: true }), false);
  assert.equal(canActorPerform(Actors.FRIEND, Actions.DENY_JOIN, { validInvite: true }), false);
});

test("service and admin permissions are narrow", () => {
  assert.equal(canActorPerform(Actors.SERVICE, Actions.ISSUE_SESSION, { authorizedApproval: true }), true);
  assert.equal(canActorPerform(Actors.SERVICE, Actions.ISSUE_SESSION, { authorizedApproval: false }), false);
  assert.equal(canActorPerform(Actors.SERVICE_ADMIN, Actions.APPROVE_JOIN, { breakGlass: true }), false);
  assert.equal(canActorPerform(Actors.SERVICE_ADMIN, Actions.BREAK_GLASS_READ, { breakGlass: true }), true);
});

test("risk labels are closed enum values", () => {
  assert.equal(isKnownRiskLabel(RiskLabels.HIGH_CONFIDENCE), true);
  assert.equal(isKnownRiskLabel(RiskLabels.CAUTION), true);
  assert.equal(isKnownRiskLabel(RiskLabels.LIKELY_FAIL), true);
  assert.equal(isKnownRiskLabel("maybe"), false);
});

test("safe invite status redacts inactive invite details", () => {
  const inactiveStates = [InviteStates.EXPIRED, InviteStates.REVOKED, InviteStates.UNAVAILABLE, undefined];

  for (const state of inactiveStates) {
    const result = redactInviteStatus({
      state,
      roomAlias: "Secret Room",
      minecraftVersion: "1.21.1",
      packProfileName: "Hidden",
      hostOnline: true,
      sessionCredential: "secret"
    });

    assert.deepEqual(result, {
      unavailable: true,
      reason: ErrorStates.INVITE_UNAVAILABLE
    });
  }
});

test("active invite exposes only safe metadata", () => {
  const result = redactInviteStatus({
    state: InviteStates.ACTIVE,
    roomAlias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    trustCopy: "No passwords",
    hostEmail: "host@example.com",
    sessionCredential: "secret"
  });

  assert.deepEqual(result, {
    unavailable: false,
    roomAlias: "Cozy Room",
    minecraftVersion: "1.21.1",
    packProfileName: "MVP-0 Performance Room",
    trustCopy: "No passwords"
  });
});

test("approval state enum stays stable for older clients", () => {
  assert.equal(ApprovalStates.PENDING, "pending");
  assert.equal(ApprovalStates.APPROVED, "approved");
  assert.equal(ApprovalStates.DENIED, "denied");
});
