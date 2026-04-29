---
title: "M7 Direct P2P Beta TODO"
type: todo
status: in_progress
milestone: M7
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M7 Direct P2P Beta TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Source unit:** U13 Direct P2P Adapter

## Goal

Reduce relay cost and latency by attempting direct connection with automatic relay fallback, without turning direct connection failure into friend join failure.

## Start Conditions

- [ ] M4 relay join is reliable enough to remain the fallback path.
- [ ] Relay metrics show cost or latency pressure worth addressing.
- [ ] Direct-mode privacy copy and default policy are approved.
- [ ] Host app and client mod can accept transport adapter changes without increasing friend install friction.

## Executable Contract Progress

- [x] Transport candidate exchange contract exists.
- [x] Candidate expiry and cross-room rejection are covered.
- [x] Safe home-network direct candidate selects direct path with direct privacy copy.
- [x] Restricted networks fall back to relay within the configured timeout.
- [x] Direct connection failure falls back to relay and does not become a join failure.

## Transport Candidate TODO

- [ ] Define transport candidate schema for relay and direct paths.
- [ ] Add control-plane candidate exchange scoped to a room session.
- [ ] Add candidate expiry.
- [ ] Prevent candidates from being reused across rooms or sessions.
- [ ] Keep direct candidates out of support exports unless redacted.

## Host And Client Adapter TODO

- [ ] Add host direct-path adapter in the desktop app tunnel layer.
- [ ] Add friend direct-path adapter in the client Fabric mod.
- [ ] Keep the existing relay adapter as the reliability fallback.
- [ ] Add direct attempt timeout.
- [ ] Fall back to relay automatically when direct path fails.
- [ ] Avoid requiring friends to install extra networking tools.
- [ ] Avoid exposing advanced network terminology in the default UI.

## Privacy And Product TODO

- [ ] Write user-language IP privacy notice for direct mode.
- [ ] Decide whether direct mode is opt-in, beta flag, or default-on after measurement.
- [ ] Show privacy copy before broad enablement.
- [ ] Add advanced diagnostics for direct path only when needed.
- [ ] Make sure relay remains visible as the reliability fallback, not as a user decision.

## Metrics TODO

- [ ] Measure direct success rate.
- [ ] Measure fallback rate.
- [ ] Measure direct and relay latency.
- [ ] Measure disconnects by transport path.
- [ ] Measure relay bytes saved per room-hour.
- [ ] Track failure reasons without logging sensitive network details.

## Completion Gate

- [ ] Common home-network cases can select a direct path.
- [ ] Restricted networks fall back to relay within the configured timeout.
- [ ] Direct failure does not become join failure when relay is available.
- [ ] Direct-mode privacy copy is visible before broad enablement.
- [ ] Relay remains available as the reliability fallback.
- [ ] Metrics exist for direct success, fallback, latency, disconnects, and relay bytes.

## Validation

- [ ] Candidate exchange tests.
- [ ] Direct path selection tests.
- [ ] Relay fallback E2E tests.
- [ ] Privacy copy review.
- [ ] Metrics tests.
- [ ] Manual tests across at least one friendly network pair and one restricted network pair.
- [ ] `npm run test`
- [ ] `git diff --check`

## Stop Or Pivot

- Stop if direct success rate is not high enough to justify added complexity.
- Stop if IP privacy expectations conflict with default direct mode.
- Pivot if native or Java transport choices increase install friction for friends.
