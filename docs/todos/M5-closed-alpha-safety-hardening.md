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

- [x] M2 control-plane failure states are stable.
- [ ] M3 desktop app can create and run local rooms.
- [ ] M4 relay join flow works end-to-end.

## Executable Contract Progress

- [x] Invite recovery state contract covers valid, expired, revoked, missing, invalid, unsupported device, Modrinth missing, pack download failure, import failure, host offline, and approval timeout states.
- [x] Support bundle redaction contract removes invite URLs, tokens, IPs, session keys, and credential-like strings.
- [x] Mod permission metadata gate requires source, license, redistribution/use permission, original HTTPS URL, and SHA1/SHA512 hashes.
- [x] Audit event contract allows only minimal room, invite, approval, and relay usage facts and rejects sensitive payload fields.
- [x] Privacy data map and mod permission policy documents exist.
- [x] Invite helper applies `noindex,nofollow`, referrer protection, no public discovery copy, trust copy, and safe metadata hiding.
- [x] Closed-alpha defaults define retention, unofficial-product wording, and abuse-control guardrails.
- [x] Generated pack permission gate blocks missing source/permission metadata and app-side rehosting.
- [x] Closed-alpha release gate contract blocks public discovery, missing `X-Robots-Tag`, missing unofficial-product wording, failed invite accessibility, and unredacted support probes.
- [x] Trusted actor derivation is required before mounting the dependency-free router adapter.
- [x] Audit metadata redacts sensitive free-text values before persistence.
- [x] Local runtime and materialization plans reject unsafe room ids, artifact names, traversal paths, and app-data boundary escapes.

## Invite And Friend Onboarding TODO

- [x] Keep invite pages `noindex,nofollow`.
- [x] Ensure there is no public room discovery.
- [x] Show valid invite state with only safe metadata: room alias, Minecraft version, pack profile name, and trust copy.
- [x] Hide room details for expired, revoked, missing, and invalid invites.
- [x] Add unsupported device/browser recovery state.
- [x] Add Modrinth App missing recovery state.
- [x] Add pack download/import failed recovery state.
- [x] Add host offline recovery state.
- [x] Add approval timeout recovery state.
- [x] Add trust panel copy explaining the generated pack and first-party connection mod.
- [x] Keep invite actions button-focused and readable for non-developer friends.
- [x] Verify keyboard and mobile browser accessibility with an executable static contract.

## Support Bundle And Redaction TODO

- [x] Define support bundle contents for desktop app, invite helper, relay, and control plane.
- [x] Redact invite tokens, raw invite URLs, session keys, IPs, device signals, and credential-bearing logs.
- [x] Redact Minecraft access/session-related data if it ever appears in logs.
- [x] Add redaction tests for known sensitive patterns.
- [x] Make the support export contract and closed-alpha runbook explain what is included in user language.

## Privacy And Policy TODO

- [x] Write initial privacy data map for invite token hashes, session credentials, IP/device rate signals, relay metrics, and Minecraft UUIDs.
- [x] Review privacy data map against executable closed-alpha data flows.
- [x] Define retention defaults for closed alpha data.
- [x] Add unofficial-product wording to public app surfaces and invite pages.
- [x] Add initial mod permission policy for source, license, redistribution/use conditions, and hash-pinned original URLs.
- [x] Review mod permission policy against generated pack contract flows.
- [x] Make generated pack creation fail when required mod source/permission metadata is missing.
- [x] Keep third-party mod rehosting out of MVP-0.

## Abuse And Rate Limit TODO

- [x] Add repeated join request rate limits.
- [x] Add invite regeneration and revocation controls.
- [x] Add block/report-ready metadata for abusive join attempts.
- [x] Add minimal audit events for room creation, invite creation, approval decision, and relay usage.
- [x] Ensure abuse controls fail closed without exposing sensitive room metadata.

## Completion Gate

- [x] Invite tests pass for valid, expired, revoked, unsupported device, import failure, host offline, and approval timeout states.
- [x] Invite pages are noindex and have no public discovery path.
- [x] Support bundle redaction tests pass.
- [x] Privacy data map exists for implemented data flows.
- [x] Generated packs fail when a mod lacks required source/permission metadata.
- [x] Public app surfaces and invite pages include unofficial-product wording.
- [x] Closed-alpha release gate contract blocks public discovery and unredacted support data.
- [ ] Closed-alpha release can run without exposing public discovery or unredacted support data.

## Validation

- [x] Invite page state tests.
- [x] Support bundle redaction tests.
- [x] Mod policy gate tests.
- [x] Control-plane audit and invite-safety tests.
- [x] Static invite accessibility contract.
- [x] Closed-alpha release gate contract.
- [x] Router trusted-actor, audit redaction, and local path boundary regression tests.
- [ ] Manual invite page accessibility pass.
- [x] `npm run test`
- [x] `git diff --check`

## Stop Or Pivot

- Stop if the app cannot explain the generated pack and connection mod in a way users trust.
- Stop if mod permission policy blocks all useful fixed packs.
- Pivot if abuse/rate-limit signals require more personal data than the privacy model allows.
