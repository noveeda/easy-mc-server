---
title: "Fixed Alpha Packs"
type: product
status: draft
created: 2026-04-29
---

# Fixed Alpha Packs

This document records the fixed pack inputs for MVP-0 and M1 validation. It is intentionally narrower than the later curated catalog.

## mvp0-performance-room-1.21.1

| Field | Value |
|---|---|
| Minecraft version | `1.21.1` |
| Loader | Fabric |
| Fabric Loader | `0.19.2` |
| Java policy | Java 21-compatible runtime required; prompt only when no compatible runtime is detected |
| Pack artifact | `packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json` |
| Importable now | No, pending first-party connection mod signed artifact metadata |

## Third-Party Mod References

These entries were fetched from Modrinth project version metadata for Fabric and Minecraft `1.21.1`.

| Mod | Version | File | Size | SHA1 |
|---|---:|---|---:|---|
| Fabric API | `0.116.11+1.21.1` | `fabric-api-0.116.11+1.21.1.jar` | `2426356` | `65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84` |
| Lithium | `mc1.21.1-0.15.3-fabric` | `lithium-fabric-0.15.3+mc1.21.1.jar` | `797398` | `c4a1c2b6de9915ac77ae46a005509d4acf09535d` |
| FerriteCore | `7.0.3-fabric` | `ferritecore-7.0.3-fabric.jar` | `123450` | `a8a6a34fcda177da2828cedef44e0e538cf78aad` |

## First-Party Artifact Requirements

The private `.mrpack` must not be generated until the client connection mod has all of the following:

- Immutable HTTPS artifact URL.
- SHA1 and SHA512 hashes.
- File size in bytes.
- Signed release provenance.
- Rollback and revocation metadata.

The server bridge mod is not part of the friend pack. It belongs to the host room runtime.

## Generation Rule

A pack builder must fail closed when any template placeholder remains, any download URL is not HTTPS, any file hash is missing, or a referenced third-party file cannot be tied back to an allowed original source.
