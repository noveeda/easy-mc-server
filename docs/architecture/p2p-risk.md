---
title: "Direct P2P Risk Contract"
type: architecture
status: draft
created: 2026-04-30
---

# Direct P2P Risk Contract

M7 direct P2P is a beta optimization over the relay path. The relay remains the required reliability path for MVP-0 and closed alpha. A direct attempt must never turn a valid friend join into a failed join while relay is available.

## Executable Contract

`services/control-plane/src/transport/candidates.mjs` defines the dependency-free control-plane contract for transport candidates:

- Candidates are room-bound and cross-room submissions are rejected.
- Candidates expire before selection and expired submissions are rejected.
- Direct selection is allowed only for safe home-network candidates that explicitly allow direct use.
- Restricted, unknown, expired, or otherwise unsafe direct candidates fall back to relay.
- Direct attempt failure falls back to relay and returns `joinFailure: false`.

These contracts are simulations. They do not perform NAT traversal, open sockets, or validate real Minecraft connectivity.

## Direct Privacy Copy

User-facing direct mode copy:

> A direct room connection can show your internet address to the approved friend. If it does not connect quickly, the room keeps using the reliable room path.

The copy must be visible before broad direct-mode enablement. The implementation may document relay behavior in architecture and diagnostics, but normal join failure states should stay in room language.

## Risk Controls

- Default to relay when candidate safety is unknown.
- Keep direct attempt timeout bounded and controlled by the transport contract.
- Keep direct candidate data out of support exports unless redacted.
- Record direct success, fallback, latency, disconnect, and relay byte savings before considering default-on behavior.
- Treat direct mode policy as unresolved until product and privacy review approves the default.

## Production Gates

Before M7 can be marked production-complete, real adapters still need separate validation:

- Host desktop direct-path adapter.
- Friend Fabric client direct-path adapter.
- Relay fallback under real connection failure.
- Manual privacy-copy review.
- End-to-end Minecraft play validation across common and restricted home networks.
