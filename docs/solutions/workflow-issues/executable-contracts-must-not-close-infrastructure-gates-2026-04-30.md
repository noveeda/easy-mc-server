---
title: "Executable contracts must not close infrastructure gates"
date: 2026-04-30
last_updated: 2026-04-30
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: milestone_execution
applies_when:
  - "A milestone slice adds dependency-free simulations for later infrastructure work"
  - "Tests pass before real adapters, sockets, packaged apps, or manual E2E validation exist"
  - "A review finds TODO checkboxes claim behavior that the executable contract does not actually implement"
tags: [milestones, testing, relay, contracts, m2-m7, review]
---

# Executable contracts must not close infrastructure gates

## Context

M2-M7 spans real infrastructure: Fastify/PostgreSQL, Windows host runtime, Fabric mods, relay transport, alpha safety, catalog ingestion, and direct P2P. During the executable-contract slice, tests passed after adding dependency-free simulations, but that green run could be misread as full milestone completion.

The same risk appeared in relay defaults: if simulated guardrails do not match the alpha policy, tests can lock in the wrong product limit.

## Guidance

When a milestone requires real adapters or manual validation, keep three states separate:

- Contract implemented: dependency-free code proves behavior and DTOs.
- Adapter implemented: real Fastify, PostgreSQL, Tauri, relay socket, or Fabric integration exists.
- Gate complete: completion criteria and manual/E2E validation are satisfied.

For this project, executable contracts should update TODO and milestone status to `in_progress`, not `completed`, until the real adapters and validation exist.

Guardrail defaults in simulations must match product policy. Closed alpha currently means 10 total room members including the host, six-hour room sessions, 20-minute idle timeout, 25 GB room warning, 40 GB room hard cap, and 150 GB monthly host cap.

Contract tests must also exercise the production-shaped boundary, not only synchronous or happy-path fakes. A relay contract that validates sessions through a service boundary should include an async validator test. A persistence contract that claims atomic approval/session issuance should expose and test a repository-level transaction wrapper. A friend-facing invite contract should prove unknown or malformed states fail closed instead of falling back to a valid room view.

## Why This Matters

Green tests are only useful if they prove the right thing. A dependency-free simulation can be valuable because it freezes product behavior before infrastructure work, but it is not a substitute for real transport, process control, persistence, packaged app behavior, or Minecraft validation.

If the docs do not distinguish these states, future agents may skip necessary production work or report a milestone as complete too early.

If tests use simplified fakes that do not match production call semantics, green tests can hide the exact adapter bug the milestone is supposed to prevent.

## When to Apply

Use this rule whenever a plan turns a large milestone into testable simulations before the real runtime exists.

## Examples

- M2 persistence/router contracts can pass while real Fastify and PostgreSQL remain pending.
- M3 host runtime contracts can pass while no Tauri shell or Fabric server process exists.
- M4 relay guardrail contracts can pass while no relay socket or real Fabric client mod exists.
- M7 direct P2P selection contracts can pass while no host/client P2P adapter exists.
- M2 approval/session contracts should test both fake repositories and the PostgreSQL repository `withTransaction` path.
- M4 relay session validation should test async service validation, because a real control-plane call will not behave like a synchronous in-memory object.
- Invite helper states should default unknown query states to the invalid/unavailable view so malformed links never expose room metadata.
