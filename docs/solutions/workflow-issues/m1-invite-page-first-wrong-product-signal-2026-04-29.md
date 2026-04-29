---
title: "M1 invite page first created the wrong product signal"
date: 2026-04-29
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Building milestone prototypes for a desktop-first product"
  - "Adding invite or onboarding web surfaces before the host app exists"
tags: [m1, desktop-first, invite-web, product-signal, prototype]
---

# M1 invite page first created the wrong product signal

## Context

The original product direction was a Windows desktop GUI app for non-developer Minecraft hosts. The first M1 artifact put `apps/invite-web/index.html` in front, which made the product feel like a confusing web page instead of a desktop app.

## Guidance

For desktop-first products, the first clickable prototype should start at the desktop app's primary user flow. In this project, that means:

- Host opens desktop app.
- Host prepares a room.
- Host creates an invite.
- Host approves or denies a friend request.

The invite web page should stay secondary. It only helps a friend who already received a link apply the generated pack or recover from an unavailable invite state.

## Why This Matters

Prototype order teaches everyone what the product is. If the first visible artifact is a web invite page, reviewers will judge the product as a website and expect instructions. That conflicts with the core principle that non-developer users should not need to understand setup details.

## When to Apply

- A milestone includes both primary app UI and secondary helper surfaces.
- A validation artifact is likely to be opened directly by the product owner.
- The product is intended to hide technical setup behind a GUI.

## Examples

Primary artifact:

```text
apps/desktop/index.html
```

Secondary helper:

```text
apps/invite-web/index.html
```

The secondary helper should not include visible QA state pickers or developer controls. Use URL state parameters or a separate QA harness instead.

## Related

- `docs/milestones/2026-04-29-local-minecraft-room-milestones.md`
- `apps/desktop/README.md`
- `apps/invite-web/README.md`
