# Relay Service

Relay implementation starts in M4. M2 only reserves the ownership boundary so protocol and control-plane contracts can avoid becoming tied to arbitrary TCP forwarding details too early.

## M4 Relay Contract

`src/relay-simulation.mjs` is the executable relay contract for later socket or Rust adapters. It models authenticated Minecraft stream forwarding without opening sockets.

The relay contract requires:

1. A host tunnel registered for the room's local Minecraft target only.
2. An approved session with matching room, friend, session token, and server-observed Minecraft UUID.
3. No caller-selected arbitrary TCP target.
4. Enforced room member, session duration, idle timeout, room bandwidth, and monthly host bandwidth quotas.

Any missing, expired, cross-room, wrong-UUID, arbitrary-target, or quota-exceeded request fails closed.
