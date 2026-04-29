---
title: "Node test runner process isolation can fail in sandbox"
date: 2026-04-30
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: testing_framework
severity: low
applies_when:
  - "Running node:test in Codex workspace sandbox"
  - "Adding multi-file Node test suites without external dependencies"
tags: [node-test, sandbox, workflow, m2, testing]
---

# Node test runner process isolation can fail in sandbox

## Context

M2 introduced `node:test` files for protocol and control-plane contracts. Running `node --test tests/smoke/*.test.mjs packages/protocol/tests/*.test.mjs services/control-plane/tests/*.test.mjs` failed with `Error: spawn EPERM` even though the test code itself was valid.

## Guidance

Use `--test-isolation=none` for this repository's no-dependency contract test script:

```json
{
  "scripts": {
    "test": "node scripts/verify-static-prototypes.mjs && node --test --test-isolation=none tests/smoke/*.test.mjs packages/protocol/tests/*.test.mjs services/control-plane/tests/*.test.mjs"
  }
}
```

This keeps the tests in one process and avoids sandbox child-process restrictions.

## Why This Matters

Without this flag, normal `npm run test` can fail before executing any contract assertions. That makes the suite look broken and can hide real implementation failures behind environment noise.

## When to Apply

- The test suite uses built-in `node:test`.
- The suite has multiple test files.
- The environment blocks child process spawning or reports `spawn EPERM`.

## Examples

Before:

```text
node --test tests/smoke/*.test.mjs packages/protocol/tests/*.test.mjs services/control-plane/tests/*.test.mjs
```

After:

```text
node --test --test-isolation=none tests/smoke/*.test.mjs packages/protocol/tests/*.test.mjs services/control-plane/tests/*.test.mjs
```

## Related

- `package.json`
- `scripts/verify-static-prototypes.mjs`
