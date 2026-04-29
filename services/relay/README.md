# Relay Service

Relay implementation starts in M4. M2 only reserves the ownership boundary so protocol and control-plane contracts can avoid becoming tied to arbitrary TCP forwarding details too early.

## M4 Relay Contract

`src/relay-simulation.mjs` is the executable relay contract for later socket or Rust adapters. It models authenticated Minecraft stream forwarding without opening sockets.

The relay contract requires:

1. A `relay.m4` host tunnel registered for the room's local Minecraft target only.
2. A session validation service result, or local test fixture, with matching room, invite, friend, session token, server-observed Minecraft UUID, and expiry.
3. No caller-selected arbitrary TCP target.
4. One-time session consumption so replayed stream opens fail closed.
5. Enforced room member, session duration, idle timeout, room bandwidth, and monthly host bandwidth quotas.
6. Host tunnel lifecycle, bounded disconnect retry/failure state, metrics, and redacted relay diagnostics.

Any missing, expired, replayed, cross-room, wrong-invite, wrong-UUID, arbitrary-target, closed-tunnel, or quota-exceeded request fails closed.

`relayEcho()` provides a local echo-style contract proving that an approved friend stream reaches the host stream without opening a real socket or starting Minecraft.
