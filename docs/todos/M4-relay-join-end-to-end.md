---
title: "M4 Relay Join End To End TODO"
type: todo
status: in_progress
milestone: M4
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M4 Relay Join End-To-End TODO

**Milestone source:** [Local Minecraft Mod Room Milestones](../milestones/2026-04-29-local-minecraft-room-milestones.md)

**Source units:** U6 Fabric Client Connection Mod, U7 Relay MVP With Guardrails

## Goal

Prove that a friend client mod can join the host's local room through loopback proxy and relay-only transport, with no Hamachi, port forwarding, VPN, or rented Minecraft server.

## Start Conditions

- [ ] M2 can issue short-lived room sessions from approved join requests.
- [ ] M3 can run a local Fabric room and bridge approval events.
- [ ] The first-party client connection mod can be included in the friend pack.

## Executable Contract Progress

- [x] Relay simulation authorizes approved room sessions.
- [x] Relay simulation pairs friend streams to the host room target.
- [x] Relay simulation rejects unauthenticated, expired, cross-room, wrong-UUID, and arbitrary TCP attempts.
- [x] Relay simulation enforces 9 friend streams for 10 total players including the host.
- [x] Relay simulation enforces duration, idle, room bandwidth, monthly host quota, and room bandwidth warning contracts.
- [x] Client loopback plan opens `127.0.0.1:<ephemeral>` and redacts invite/session/relay tokens from diagnostics.

## Protocol And Session TODO

- [ ] Define relay/tunnel protocol fields for room id, session handle, expiry, client identity, and stream target.
- [ ] Add session validation endpoint or service call for relay authorization.
- [ ] Bind relay sessions to approved room, invite, Minecraft UUID, and expiry.
- [ ] Refuse expired, revoked, cross-room, wrong-UUID, and replayed session attempts.
- [ ] Make arbitrary TCP destination forwarding impossible.
- [ ] Add redaction rules for relay logs and errors.

## Relay Service TODO

- [ ] Scaffold relay service in `services/relay/`.
- [ ] Accept authenticated room stream connections from host app.
- [ ] Accept authenticated room stream connections from client mod.
- [ ] Pair host and friend streams only for valid room/session targets.
- [ ] Forward Minecraft TCP bytes without inspecting game payload.
- [ ] Enforce total room size of 10 players including host.
- [ ] Enforce six-hour room session limit.
- [ ] Enforce 20-minute idle timeout when no approved friends are connected.
- [ ] Emit warning at 25 GB per room session.
- [ ] Enforce 40 GB hard cap per room session.
- [ ] Enforce 150 GB monthly relay cap per host during closed alpha.
- [ ] Enforce invite expiry and approval-request rate-limit guardrails.
- [ ] Emit minimal metrics: active rooms, room-hours, disconnects, bytes, and quota stops.

## Client Mod TODO

- [ ] Add Fabric client connection mod skeleton for the supported Minecraft/Fabric version.
- [ ] Open `127.0.0.1:<ephemeral>` as the friend-facing Minecraft server target.
- [ ] Bind the loopback proxy to a relay session from the invite-linked pack.
- [ ] Show missing, empty, expired, or revoked invite state in Minecraft.
- [ ] Show host approval pending as an intentional wait state.
- [ ] Avoid writing invite/session tokens to logs, crash reports, or visible dumps.
- [ ] Handle relay disconnect with bounded retry and clear room-language failure.

## Host Tunnel TODO

- [ ] Add host app tunnel component that connects the local Fabric server to relay.
- [ ] Bind host tunnel to the active room only.
- [ ] Stop relay stream when the local room stops.
- [ ] Surface relay status in the host UI without exposing network terminology by default.
- [ ] Send disconnect/quota states back to desktop UI.

## End-To-End TODO

- [ ] Add a local TCP echo-style integration test before using Minecraft.
- [ ] Add a simulated room-flow E2E test: approved friend stream reaches host stream.
- [ ] Add an E2E test that unauthenticated and arbitrary TCP proxy attempts fail closed.
- [ ] Add an E2E test for quota stop behavior.
- [ ] Add a manual Minecraft Java E2E script for small multiplayer validation.

## Completion Gate

- [ ] Friend client mod reaches the host room through relay in a small multiplayer session.
- [ ] Relay refuses unauthenticated, expired, cross-room, wrong-UUID, and arbitrary TCP attempts.
- [ ] Total room size, session duration, idle timeout, bandwidth caps, monthly cap, invite expiry, and approval-request rate limits are enforced.
- [ ] Relay disconnects trigger bounded retry and a user-facing room-connection failure state.
- [ ] Minimal relay metrics exist for alpha operations.

## Validation

- [ ] Relay session tests.
- [ ] Open-proxy guard tests.
- [ ] Quota tests.
- [ ] Client mod loopback tests or gametests.
- [ ] Host tunnel integration tests.
- [ ] Manual two-client Minecraft room test.
- [ ] `npm run test`
- [ ] `git diff --check`

## Stop Or Pivot

- Stop if relay latency or disconnect rate prevents acceptable small-room play.
- Stop if relay cannot be prevented from acting like a general TCP proxy.
- Pivot if guardrails cannot fail closed without breaking normal joins.
