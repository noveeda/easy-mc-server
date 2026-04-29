---
title: "npm workspace protocol unavailable in local environment"
date: 2026-04-30
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: tooling
severity: low
applies_when:
  - "Using npm workspaces in this local Codex environment"
  - "Importing local packages without dependency installation"
tags: [npm, workspace, protocol, m2, tooling]
---

# npm workspace protocol unavailable in local environment

## Context

M2 initially tried to declare `@local-room/protocol` as a `workspace:*` dependency of `@local-room/control-plane`. Running `npm.cmd install` failed with:

```text
Unsupported URL Type "workspace:": workspace:*
```

## Guidance

Until package tooling is normalized, keep no-dependency M2 tests runnable without install by using an internal service adapter:

```text
services/control-plane/src/protocol.mjs
```

That file re-exports the protocol package source from one place. Control-plane domain code imports from the adapter instead of scattering deep source-path imports through the service.

## Why This Matters

The M2 contract suite should run with `npm run test` in a fresh local checkout. Requiring a workspace install that this environment cannot perform would block every later milestone loop.

## When to Apply

- Before adding a package manager lockfile.
- Before choosing pnpm/npm/yarn as the committed workspace runner.
- While keeping M2 contract tests dependency-free.

## Related

- `services/control-plane/src/protocol.mjs`
- `package.json`
- `docs/plans/2026-04-30-001-m2-contract-foundation-plan.md`
