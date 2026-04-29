---
title: "M1 mrpack templates must wait for first-party artifacts"
date: 2026-04-29
category: docs/solutions/workflow-issues
module: local-minecraft-room
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Building M1 friend-install validation before the client connection mod exists"
  - "Generating private Modrinth packs from templates"
tags: [m1, mrpack, modrinth, artifacts, validation]
---

# M1 mrpack templates must wait for first-party artifacts

## Context

M1 asks for a private `.mrpack` so non-developer friends can validate the invite-to-approval flow. The third-party fixed-pack mods can be referenced by Modrinth URL, hash, and file size, but the first-party client connection mod does not exist yet as a signed immutable release artifact.

## Guidance

Keep the M1 pack as `modrinth.index.template.json` until the first-party client connection mod has:

- Immutable HTTPS artifact URL.
- SHA1 and SHA512 hashes.
- File size in bytes.
- Signed release provenance.
- Rollback and revocation metadata.

The template can include real third-party Modrinth references, but it must use obvious placeholder values for the first-party mod and must not be zipped into an importable `.mrpack`.

## Why This Matters

An importable `.mrpack` with fake or unstable first-party artifact metadata would create false confidence in M1. Testers might validate a pack that cannot represent the actual room connection path, or the app could train future pack-builder code to tolerate missing hashes and placeholder URLs.

## When to Apply

- Before the client connection mod has a release artifact.
- Whenever pack generation depends on private first-party files.
- Whenever milestone completion requires tester validation rather than static document readiness.

## Examples

Use a template path:

```text
packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json
```

Do not emit:

```text
packages/modpack-builder/m1/mvp0-performance-room-1.21.1/mvp0-performance-room-1.21.1.mrpack
```

until placeholders are replaced and the pack imports successfully in Modrinth App.

## Related

- `docs/validation/m1-friend-install-join-validation.md`
- `docs/product/fixed-alpha-packs.md`
- `docs/milestones/2026-04-29-local-minecraft-room-milestones.md`
