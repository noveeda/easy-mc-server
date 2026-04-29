---
title: "M5 Closed Alpha Safety Hardening TODO"
type: todo
status: in_progress
milestone: M5
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M5 Closed Alpha Safety Hardening TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Source units:** U9 Invite Web And Friend Onboarding, U10 MVP Safety Privacy And Policy Gates

## Goal

Make MVP-0 safe enough for closed-alpha use beyond local development while preserving the principle that non-developer users should not need to understand server or network setup.

## Start Conditions

- [ ] M2 control-plane failure states are stable.
- [ ] M3 desktop app can create and run local rooms.
- [ ] M4 relay join flow works end-to-end.

## Executable Contract Progress

- [x] Invite recovery state contract covers valid, expired, revoked, missing, invalid, unsupported device, Modrinth missing, pack download failure, import failure, host offline, and approval timeout states.
- [x] Support bundle redaction contract removes invite URLs, tokens, IPs, session keys, and credential-like strings.
- [x] Mod permission metadata gate requires source, license, redistribution/use permission, original HTTPS URL, and SHA1/SHA512 hashes.
- [x] Audit event contract allows only minimal room, invite, approval, and relay usage facts and rejects sensitive payload fields.
- [x] Privacy data map and mod permission policy documents exist.

## Invite And Friend Onboarding TODO

- [ ] Keep invite pages `noindex,nofollow`.
- [ ] Ensure there is no public room discovery.
- [ ] Show valid invite state with only safe metadata: room alias, Minecraft version, pack profile name, and trust copy.
- [ ] Hide room details for expired, revoked, missing, and invalid invites.
- [ ] Add unsupported device/browser recovery state.
- [ ] Add Modrinth App missing recovery state.
- [ ] Add pack download/import failed recovery state.
- [ ] Add host offline recovery state.
- [ ] Add approval timeout recovery state.
- [ ] Add trust panel copy explaining the generated pack and first-party connection mod.
- [ ] Keep invite actions button-focused and readable for non-developer friends.
- [ ] Verify keyboard and mobile browser accessibility.

## Support Bundle And Redaction TODO

- [ ] Define support bundle contents for desktop app, invite helper, relay, and control plane.
- [ ] Redact invite tokens, raw invite URLs, session keys, IPs, device signals, and credential-bearing logs.
- [ ] Redact Minecraft access/session-related data if it ever appears in logs.
- [ ] Add redaction tests for known sensitive patterns.
- [ ] Make support export explain what is included in user language.

## Privacy And Policy TODO

- [x] Write initial privacy data map for invite token hashes, session credentials, IP/device rate signals, relay metrics, and Minecraft UUIDs.
- [ ] Review privacy data map against real closed-alpha data flows.
- [ ] Define retention defaults for closed alpha data.
- [ ] Add unofficial-product wording to public app surfaces and invite pages.
- [x] Add initial mod permission policy for source, license, redistribution/use conditions, and hash-pinned original URLs.
- [ ] Review mod permission policy against real generated pack flows.
- [ ] Make generated pack creation fail when required mod source/permission metadata is missing.
- [ ] Keep third-party mod rehosting out of MVP-0.

## Abuse And Rate Limit TODO

- [ ] Add repeated join request rate limits.
- [ ] Add invite regeneration and revocation controls.
- [ ] Add block/report-ready metadata for abusive join attempts.
- [ ] Add minimal audit events for room creation, invite creation, approval decision, and relay usage.
- [ ] Ensure abuse controls fail closed without exposing sensitive room metadata.

## Completion Gate

- [ ] Invite tests pass for valid, expired, revoked, unsupported device, import failure, host offline, and approval timeout states.
- [ ] Invite pages are noindex and have no public discovery path.
- [ ] Support bundle redaction tests pass.
- [ ] Privacy data map exists and matches implemented data flows.
- [ ] Generated packs fail when a mod lacks required source/permission metadata.
- [ ] Public app surfaces and invite pages include unofficial-product wording.
- [ ] Closed-alpha release can run without exposing public discovery or unredacted support data.

## Validation

- [ ] Invite page state tests.
- [ ] Support bundle redaction tests.
- [ ] Mod policy gate tests.
- [ ] Control-plane audit and invite-safety tests.
- [ ] Manual invite page accessibility pass.
- [ ] `npm run test`
- [ ] `git diff --check`

## Stop Or Pivot

- Stop if the app cannot explain the generated pack and connection mod in a way users trust.
- Stop if mod permission policy blocks all useful fixed packs.
- Pivot if abuse/rate-limit signals require more personal data than the privacy model allows.
