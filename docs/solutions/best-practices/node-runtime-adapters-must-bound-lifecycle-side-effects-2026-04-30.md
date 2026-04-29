---
title: "Node runtime adapters must bound lifecycle side effects"
date: 2026-04-30
category: docs/solutions/best-practices
module: local-minecraft-room-runtime
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "A Node adapter turns a pure runtime contract into filesystem, process, or network side effects"
  - "Tests use fake processes or injectable fetch implementations before the real desktop shell exists"
  - "A preview command reports blocked states for missing Java, missing artifacts, or external downloads"
tags: [runtime, node, fabric, java, lifecycle, m3, testing]
---

# Node runtime adapters must bound lifecycle side effects

## Context

M3 added Node adapters for Java detection, Fabric server bootstrap, local room file materialization, and Java/Fabric process lifecycle management. The pure contracts were already useful, but real side effects introduce failure modes that contract tests alone do not cover.

The review pass found concrete risks around unbounded fetches, redirects, partial file writes, child process errors, duplicate starts, stop hangs, and log chunk boundaries.

## Guidance

When a Node adapter crosses from a pure room contract into filesystem, process, or network behavior, bound every side effect and make it injectable in tests.

For downloads:

- Require a pinned checksum before network access.
- Reject unapproved sources and redirects.
- Add an AbortController-backed timeout.
- Enforce a maximum byte size.
- Write downloaded artifacts atomically through a temporary file and rename.
- Do not install or launch from bytes that failed checksum verification.

For Java detection:

- Treat automatic PATH discovery as lower trust than configured or known install roots.
- In real launch flows, exclude PATH and network path candidates unless there is an explicit trust decision.
- Preserve machine-readable failure reasons for missing and incompatible Java.

For process lifecycle:

- Block duplicate starts while a process is active.
- Track process exit with an explicit flag, not only `exitCode`.
- Listen for both `exit` and `error`.
- Send graceful stop, then kill after a timeout, then fail after a hard timeout if the process still does not exit.
- Buffer stdout/stderr by stream and only parse complete log lines, because Node chunk boundaries are arbitrary.
- Redact logs before emitting UI or diagnostic events.

## Why This Matters

This product hides server setup from non-developer hosts. That only works if runtime failures are bounded and recoverable: missing Java must become a clear blocked state, a stalled download must not hang forever, and a stuck Java process must not leave the app believing a room is still safely managed.

Unchecked side effects can also break safety assumptions. A redirect can contact an unapproved host, a partial jar can remain on disk, a malicious PATH entry can be promoted to the launch command, and chunk-split logs can keep the UI stuck in starting state.

## When to Apply

Apply this pattern before wiring the runtime adapters into Tauri commands or any packaged desktop shell. The fake-process and injectable-fetch tests should exist before the first manual Windows host-only run.

## Examples

- `node-fabric-bootstrap.mjs` requires a 64-character SHA256 lock, uses the approved Fabric Meta source, blocks redirects, adds timeout and byte-cap handling, and atomically writes verified files.
- `node-java-detection.mjs` can probe common candidates for tests, while `mvp0-local-preview` real launch excludes PATH and network candidates.
- `node-local-runtime.mjs` now handles duplicate starts, split log chunks, child `error` events, graceful stop, kill fallback, hard timeout failure, and redacted log events.
