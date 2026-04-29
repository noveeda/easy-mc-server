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

**Current preview guide:** [MVP-0 local runnable preview](../usage/mvp0-local-preview.md)

## Goal

Prove that a friend client mod can join the host's local room through loopback proxy and relay-only transport, with no Hamachi, port forwarding, VPN, or rented Minecraft server.

## Start Conditions

- [x] M2 can issue short-lived room sessions from approved join requests.
- [ ] M3 can run a local Fabric room and bridge approval events.
- [ ] The first-party client connection mod can be included in the friend pack.

## Executable Contract Progress

- [x] Relay simulation authorizes approved room sessions.
- [x] Relay simulation pairs friend streams to the host room target.
- [x] Relay simulation rejects unauthenticated, expired, cross-room, wrong-UUID, and arbitrary TCP attempts.
- [x] Relay simulation enforces 9 friend streams for 10 total players including the host.
- [x] Relay simulation enforces duration, idle, room bandwidth, monthly host quota, and room bandwidth warning contracts.
- [x] Client loopback plan opens `127.0.0.1:<ephemeral>` and redacts invite/session/relay tokens from diagnostics.
- [x] Relay protocol fields are fixed to `relay.m4` for host tunnels, friend streams, and open frames.
- [x] Relay simulation calls a session validation boundary and refuses replay or invite rebinding.
- [x] Relay and client loopback echo simulations prove approved friend payloads reach the host stream without opening real sockets.
- [x] Relay metrics and bounded disconnect retry states are covered by executable tests.
- [x] Host tunnel intent binds the desktop room to `127.0.0.1:25565` and redacts tunnel credentials from diagnostics.
- [x] Relay host tunnels require a room-bound host credential and cannot be overwritten by another host.
- [x] Relay friend streams require the approved session host to match the active host tunnel.
- [x] Client join state model covers missing, expired, revoked invite, approval pending, host unavailable, and connection failure states.
- [x] Local TCP relay preview can forward bytes from a friend socket to a fixed host target for runnable developer preview smoke coverage.

## Protocol And Session TODO

- [x] Define relay/tunnel protocol fields for room id, session handle, expiry, client identity, and stream target.
- [x] Add session validation endpoint or service call for relay authorization.
- [x] Bind relay sessions to approved room, invite, Minecraft UUID, and expiry.
- [x] Refuse expired, revoked, cross-room, wrong-UUID, and replayed session attempts.
- [x] Require authoritative session validation to consume first-use sessions.
- [x] Make arbitrary TCP destination forwarding impossible.
- [x] Add redaction rules for relay logs and errors.

## Relay Service TODO

- [x] Scaffold relay service in `services/relay/`.
- [ ] Accept authenticated room stream connections from host app.
- [ ] Accept authenticated room stream connections from client mod.
- [x] Define authenticated host tunnel and friend stream open contracts.
- [x] Pair host and friend streams only for valid room/session targets.
- [x] Prove local TCP byte forwarding in the runnable developer preview harness.
- [ ] Forward Minecraft TCP bytes without inspecting game payload.
- [x] Enforce total room size of 10 players including host.
- [x] Enforce six-hour room session limit.
- [x] Enforce 20-minute idle timeout when no approved friends are connected.
- [x] Emit warning at 25 GB per room session.
- [x] Enforce 40 GB hard cap per room session.
- [x] Enforce 150 GB monthly relay cap per host during closed alpha.
- [x] Refuse expired/revoked/unapproved session results from the control-plane boundary.
- [ ] Verify approval-request rate-limit guardrails through real relay/control-plane integration.
- [x] Emit minimal metrics: active rooms, room-hours, disconnects, bytes, and quota stops.

## Client Mod TODO

- [x] Add Fabric client connection mod skeleton for the supported Minecraft/Fabric version.
- [x] Open `127.0.0.1:<ephemeral>` as the friend-facing Minecraft server target.
- [x] Bind the loopback proxy to a relay session from the invite-linked pack.
- [x] Show missing, empty, expired, or revoked invite state in Minecraft.
- [x] Show host approval pending as an intentional wait state.
- [x] Avoid writing invite/session tokens to logs, crash reports, or visible dumps.
- [x] Handle relay disconnect with bounded retry and clear room-language failure.

## Host Tunnel TODO

- [x] Add host app tunnel intent component that connects the local Fabric server to relay.
- [x] Bind host tunnel to the active room only.
- [x] Stop relay stream when the local room stops.
- [x] Surface relay status in the host UI without exposing network terminology by default.
- [x] Send disconnect/quota states back to desktop UI.

## End-To-End TODO

- [x] Add a local echo-style relay simulation before using Minecraft.
- [x] Add a local TCP relay preview smoke path before using Minecraft.
- [x] Add a simulated room-flow E2E test: approved friend stream reaches host stream.
- [x] Add an E2E test that unauthenticated and arbitrary TCP proxy attempts fail closed.
- [x] Add an E2E test for quota stop behavior.
- [ ] Add a manual Minecraft Java E2E script for small multiplayer validation.

## Completion Gate

- [ ] Friend client mod reaches the host room through relay in a small multiplayer session.
- [x] Relay refuses unauthenticated, expired, cross-room, wrong-UUID, and arbitrary TCP attempts.
- [x] Total room size, session duration, idle timeout, bandwidth caps, monthly cap, invite expiry, and relay-denied sessions are enforced.
- [ ] Approval-request rate limits are verified through real relay/control-plane integration.
- [x] Relay disconnects trigger bounded retry and a user-facing room-connection failure state.
- [x] Minimal relay metrics exist for alpha operations.

## Validation

- [x] Relay session tests.
- [x] Open-proxy guard tests.
- [x] Quota tests.
- [x] Client mod loopback tests or gametests.
- [x] Host tunnel integration tests.
- [ ] Manual two-client Minecraft room test.
- [x] `npm run test`
- [x] `git diff --check`

## Stop Or Pivot

- Stop if relay latency or disconnect rate prevents acceptable small-room play.
- Stop if relay cannot be prevented from acting like a general TCP proxy.
- Pivot if guardrails cannot fail closed without breaking normal joins.
