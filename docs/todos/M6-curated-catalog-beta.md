---
title: "M6 Curated Catalog Beta TODO"
type: todo
status: in_progress
milestone: M6
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M6 Curated Catalog Beta TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Source units:** U11 Curated Catalog And Compatibility Engine, U12 Post-Alpha Operations Hardening follow-up

## Goal

Expand beyond fixed packs into curated recommended and popular mods after the MVP-0 room loop is validated.

## Start Conditions

- [ ] MVP-0 local room loop is validated with relay-only transport.
- [ ] Fixed pack usage shows enough demand to justify curated mod selection.
- [ ] Mod permission and source metadata policy from M5 is enforced.
- [ ] Service operators can review and approve catalog entries.

## Executable Contract Progress

- [x] Modrinth-style metadata normalization contract exists.
- [x] Catalog metadata completeness check exists.
- [x] Curated pack output preserves original download URLs, hashes, source URL, license, and permission metadata.
- [x] Compatibility engine labels compatible Fabric mods as `high_confidence`.
- [x] Missing or unavailable required dependencies produce `likely_fail` and automatic add guidance when possible.
- [x] Known conflict pairs produce `caution` with plain-language advice.

## Catalog Policy TODO

- [ ] Define catalog inclusion rules for recommended and popular mods.
- [ ] Define reviewer and approver roles.
- [ ] Define removal policy for unsafe, broken, or license-problem mods.
- [ ] Define how compatibility confidence is explained to non-developer users.
- [ ] Keep `high_confidence`, `caution`, and `likely_fail` as the only user-facing compatibility labels.

## Modrinth Metadata TODO

- [ ] Ingest Modrinth project metadata.
- [ ] Ingest version metadata for Minecraft version and Fabric Loader compatibility.
- [ ] Store original download URLs, hashes, file sizes, side support, dependencies, and license/source metadata.
- [ ] Detect metadata that is missing or too incomplete for recommendation.
- [ ] Add fixture-based tests for representative Modrinth responses.

## Compatibility Engine TODO

- [ ] Validate Minecraft version compatibility.
- [ ] Validate Fabric Loader compatibility.
- [ ] Resolve required dependencies.
- [ ] Suggest automatic dependency additions.
- [ ] Classify mods as client-only, server-only, or both-side.
- [ ] Detect known conflict pairs.
- [ ] Show conflict pairs as `caution` with plain-language advice.
- [ ] Mark missing required dependencies as `likely_fail`.
- [ ] Avoid presenting uncertain combinations as guaranteed safe.

## Pack Generation Integration TODO

- [ ] Generate curated packs from selected recommended/popular mods.
- [ ] Preserve M1/M4 invite and room connection model when fixed packs become curated packs.
- [ ] Reuse M5 mod permission policy gates.
- [ ] Show compatibility result before pack generation.
- [ ] Block pack generation for `likely_fail` combinations unless an explicit beta override policy exists.

## Operations Follow-Up TODO

- [ ] Add catalog review audit trail.
- [ ] Add relay and room usage dashboards needed for beta catalog rollout.
- [ ] Add retention policy checks for post-alpha operational data.
- [ ] Add support playbook for catalog-related failures.
- [ ] Track compatibility false positives and false negatives.

## Completion Gate

- [ ] A supported Minecraft/Fabric version returns curated mods marked with stable compatibility labels.
- [ ] Missing required dependencies are detected and produce an automatic add suggestion.
- [ ] Known conflict pairs are shown as caution with plain-language advice.
- [ ] Fixed pack generation can be replaced by curated pack generation without changing the invite or room connection model.
- [ ] Catalog entries have source/license metadata that satisfies the M5 policy gate.

## Validation

- [ ] Risk-rating tests.
- [ ] Modrinth fixture ingestion tests.
- [ ] Dependency resolution tests.
- [ ] Known conflict tests.
- [ ] Pack generation tests for curated selections.
- [ ] Support/operations documentation review.
- [ ] `npm run test`
- [ ] `git diff --check`

## Stop Or Pivot

- Stop if compatibility guidance creates false confidence for common mod combinations.
- Stop if catalog curation cost is too high relative to MVP-0 usage.
- Pivot if mod source/license metadata is too incomplete for safe recommendations.
