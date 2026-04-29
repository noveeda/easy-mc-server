---
title: "Closed Alpha Release Checklist"
type: runbook
status: draft
milestone: M5
---

# Closed Alpha Release Checklist

This checklist is a release gate for M5 safety hardening. It does not close M3 local runtime, M4 relay join, or first-party friend-pack artifact blockers.

## Required Evidence

- `npm run test` passes, including the static invite helper checks and `packages/safety` closed-alpha release gate tests.
- `git diff --check` passes.
- The invite helper HTML includes `robots=noindex,nofollow`, `googlebot=noindex,nofollow,noarchive,nosnippet`, and `referrer=no-referrer`.
- The deployed invite helper sends `X-Robots-Tag: noindex, nofollow`.
- The deployed site has no public room listing, search route, sitemap entry, canonical public room URL, or marketing entry path for invites.
- Unavailable invite states hide room alias, Minecraft version, pack profile name, invite token, room id, host id, and raw failure internals.
- Desktop and invite surfaces include unofficial-product wording and never request Microsoft or Minecraft passwords.
- Support bundle export is generated only through the redaction contract before it is shared.

## Support Bundle Handling

- Generate the bundle from the app-controlled support export path only.
- Before sharing, run the export through `redactSupportBundle`.
- Confirm the exported JSON/text does not contain raw invite URLs, invite tokens, session ids, session keys, credentials, cookies, IP addresses, device signals, or bearer/basic auth values.
- Store alpha support bundles only in the issue or support location chosen for the alpha test.
- Delete raw support bundles according to `RetentionDefaults` in `packages/safety`.

## Deployment Header Check

Use the deployed invite URL, not a local file URL:

```bash
curl -I https://example.invalid/invite/example
```

The response must include:

```text
X-Robots-Tag: noindex, nofollow
```

If static hosting cannot set this header, do not share alpha invite links from that host.

## Current Blockers

- M3 desktop app runtime completion is still required before a real closed-alpha run.
- M4 relay join end-to-end completion is still required before a real closed-alpha run.
- The first-party friend pack must become an importable signed artifact before friend onboarding can be validated.
- A manual keyboard and mobile browser pass is still required for the invite page.
