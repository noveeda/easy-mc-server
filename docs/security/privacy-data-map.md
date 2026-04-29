---
title: "Closed Alpha Privacy Data Map"
type: security
status: draft
created: 2026-04-30
---

# Closed Alpha Privacy Data Map

This map covers the executable M5 safety contracts for the local Minecraft room closed alpha. It documents data classes that may appear in logs, support exports, control-plane records, relay metrics, or invite helper state.

| Data class | Purpose | Stored form | Support export | Default retention |
|---|---|---|---|---|
| Invite token hash | Find an invite from a received link without storing the raw token | One-way hash plus invite id, room id, state, created time, expiry time | Hash may appear; raw token and raw invite URL must be redacted | Delete 7 days after invite expiry or revocation |
| Session credential | Authorize a short-lived friend connection after host approval | Short-lived session handle or credential bound to room, invite, and Minecraft UUID | Redacted as credential material | Delete at expiry; maximum 6 hours for alpha sessions |
| IP and device rate signal | Rate-limit repeated join attempts and abuse patterns | Coarse signal or keyed hash, not a stable profile | Redacted before export | Delete after 7 days unless tied to an active abuse investigation |
| Relay metrics | Enforce room, idle, bandwidth, and monthly host caps | Room id, session id, byte counts, timestamps, close reason | Allowed only after token, IP, and credential redaction | Aggregate after 30 days; delete raw event detail after 30 days |
| Minecraft UUID | Bind approval to the account observed by the room bridge | UUID, display name snapshot, approval request id, decision state | May appear when needed for support; no access/session token may appear | Delete with room history after 30 days |
| Audit event | Prove room creation, invite creation, approval decision, and relay usage operations occurred | Event type, time, actor id, room id, minimal non-secret payload | Allowed when payload contains no raw tokens, credentials, IPs, or device signals | Keep 90 days for closed alpha operator review |

## Redaction Contract

Support bundles must redact:

- Raw invite URLs and invite tokens.
- Session keys, session credentials, access tokens, refresh tokens, passwords, bearer credentials, cookies, and secret-like fields.
- IPv4 and IPv6 addresses.
- Device signals and credential-bearing log fragments.
- Minecraft access or session data if it ever appears in logs.

Support bundles may include safe room metadata, package version, operating system family, invite state, approval state, redacted relay metrics, and audit event ids.

## Closed Alpha Defaults

- There is no public room discovery.
- Invite pages stay `noindex,nofollow`.
- Unavailable invite states hide room details.
- The product must state that it is not an official Minecraft, Mojang, or Microsoft product and is not endorsed by them.
- Raw third-party mod files are not rehosted by the app service.
