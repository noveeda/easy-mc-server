# Relay Service

Relay implementation starts in M4. M2 only reserves the ownership boundary so protocol and control-plane contracts can avoid becoming tied to arbitrary TCP forwarding details too early.

For the current Korean runnable developer preview guide, see `../../docs/usage/mvp0-local-preview.md`.

## M4 Relay Contract

`src/relay-simulation.mjs` is the executable relay contract for later socket or Rust adapters. It models authenticated Minecraft stream forwarding without opening sockets.

The relay contract requires:

1. A `relay.m4` host tunnel registered for the room's local Minecraft target only.
2. A room-bound host tunnel credential before a host tunnel can be opened or closed.
3. A session validation service result, or local test fixture, with matching room, invite, host, friend, session token, server-observed Minecraft UUID, and expiry.
4. Authoritative first-use consumption through the session validation boundary; relay-local replay checks are defense in depth only.
5. No caller-selected arbitrary TCP target.
6. Enforced room member, session duration, idle timeout, room bandwidth, and monthly host bandwidth quotas.
7. Host tunnel lifecycle, bounded disconnect retry/failure state, room-hour/quota-stop metrics, and redacted relay diagnostics.

Any missing, expired, replayed, cross-room, wrong-invite, wrong-host, wrong-UUID, arbitrary-target, closed-tunnel, or quota-exceeded request fails closed. Failed-open logs use an allowlisted diagnostic shape instead of recording raw request metadata.

`relayEcho()` provides a local echo-style contract proving that an approved friend stream reaches the host stream without opening a real socket or starting Minecraft.
