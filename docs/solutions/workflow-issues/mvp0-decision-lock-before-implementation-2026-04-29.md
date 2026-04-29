---
title: "Lock MVP-0 product defaults before implementation"
date: 2026-04-29
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "A milestone contains product, policy, or operating defaults that implementation should not invent"
  - "A plan has open questions under Resolve Before Implementation"
  - "A milestone loop needs a durable completion artifact before moving to the next stage"
tags: [milestones, decision-lock, mvp0, planning, compound]
---

# Lock MVP-0 product defaults before implementation

## Context

The local Minecraft room plan had a milestone gate (`M0. MVP-0 Decision Lock`) whose job was to close product and operating defaults before code work. The implementation plan intentionally left several values open: supported Minecraft versions, fixed packs, relay limits, Java/Fabric policy, and legal/mod-distribution policy. Starting implementation without closing these would force engineers to make product decisions while writing code.

## Guidance

Use a separate decision document for each milestone that closes product, policy, or operating defaults. For M0, the decision document is:

- [docs/decisions/2026-04-29-mvp0-decision-lock.md](../../decisions/2026-04-29-mvp0-decision-lock.md)

The decision document should:

- name the source plan and milestone document;
- lock the initial supported product surface;
- record fixed defaults as tables, not prose-only notes;
- move ambiguous values out of "open questions";
- update the milestone checklist only after a durable decision artifact exists;
- keep implementation details out unless the detail prevents a concrete implementation mistake.

## Why This Matters

Milestone plans are useful only when each gate has a clear done state. For this project, M0 was not a code milestone; it was a decision-quality milestone. Treating it like code work would have skipped the highest-risk question: what exactly MVP-0 is allowed to build.

Locking the decisions first prevented scope drift in later milestones:

- M1 can validate one fixed pack instead of designing a generalized catalog.
- M2/U1-U3 can build protocol/control-plane contracts without choosing product limits.
- M4 can enforce relay quotas from day one instead of opening unlimited relay traffic.
- M6/M7 remain clearly post-MVP-0 work.

## When to Apply

- Before starting any milestone whose completion criteria mention unresolved defaults.
- When a milestone depends on external policy, third-party artifacts, or operating limits.
- When the next engineer should not decide product scope while implementing infrastructure.

## Examples

Good M0 decision shape:

```text
Initial supported version: Minecraft 1.21.1
Fixed pack: mvp0-performance-room-1.21.1
Java policy: Java 21 required; prompt install only when missing
Relay total room size: 10 players including host
Third-party mods: original allowed URL + pinned hash, no rehosting
```

Poor M0 decision shape:

```text
Pick a stable Minecraft version during implementation.
Choose reasonable relay limits later.
Use appropriate mods for alpha.
```

The poor version leaves product scope and operating risk to implementation-time guessing.

## Related

- [docs/plans/2026-04-29-001-feature-local-minecraft-room-plan.md](../../plans/2026-04-29-001-feature-local-minecraft-room-plan.md)
- [docs/milestones/2026-04-29-local-minecraft-room-milestones.md](../../milestones/2026-04-29-local-minecraft-room-milestones.md)
- [docs/decisions/2026-04-29-mvp0-decision-lock.md](../../decisions/2026-04-29-mvp0-decision-lock.md)
