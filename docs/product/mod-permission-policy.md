---
title: "Mod Permission Policy"
type: product
status: draft
created: 2026-04-30
---

# Mod Permission Policy

MVP-0 and closed-alpha packs may reference third-party mods only when source, license, permission, original URL, and hash metadata are recorded. Generated pack creation must fail closed when any required field is missing.

## Required Metadata

Each mod entry must include:

- Stable source page URL, preferably the original Modrinth project URL.
- License id or license name.
- Permission record for redistribution and use conditions.
- Original HTTPS download URL for every referenced file.
- SHA1 and SHA512 hashes for every referenced file.
- File size, Minecraft version, loader, client/server side support, and dependency metadata when available.

## Distribution Rules

- Do not rehost third-party mod files through the app service in MVP-0 or closed alpha.
- Generated packs must preserve original allowed download URLs and pinned hashes.
- Generated packs must not replace original mod download URLs with app-hosted mirrors, proxy URLs, or opaque bundle URLs.
- First-party connection and bridge mods require signed HTTPS release artifacts, immutable versions, rollback metadata, and revocation metadata before they can be included in importable packs.
- Mods with missing source, license, permission, URL, or hash metadata are blocked from pack generation.
- Mods with unclear permissions require operator review before recommendation and cannot be auto-included in generated packs.
- A permission value that requires or implies app rehosting is treated as blocked for closed alpha.

## User-Facing Wording

Public app surfaces, invite pages, and release notes must state that this is not an official Minecraft, Mojang, or Microsoft product and is not endorsed by them.

Invite-page trust copy should explain that generated packs use original mod download URLs plus pinned hashes and that the helper does not publish a searchable pack catalog.

## Abuse and Audit Hooks

Pack generation and invite recovery flows should emit minimal audit facts for:

- Room creation.
- Invite creation and revocation.
- Approval decisions.
- Join request rate limits.
- Host block decisions.
- Relay usage.

Audit payloads must use ids, counts, reasons, and coarse state only. They must reject raw invite tokens, raw invite URLs, session credentials, IP addresses, device signals, cookies, passwords, bearer credentials, and secret-bearing log fragments.

## Catalog Follow-Up

Curated catalog entries must keep the same metadata gate. Compatibility labels can explain technical risk, but they do not override missing permission metadata.
