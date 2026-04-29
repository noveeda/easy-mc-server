# Invite Web Helper

This is a secondary helper surface for friends who receive an invite link from the desktop host app. It is not the primary product entry point and must not grow public discovery, listing, search, sitemap, or marketing entry paths.

The product starts in `apps/desktop/`. This page only helps a friend apply the generated pack or recover from a small set of invite states.

Supported closed-alpha contract states:

- `valid`
- `expired`
- `revoked`
- `missing`
- `invalid`
- `unsupported`
- `modrinth`
- `download`
- `import`
- `hostOffline`
- `approvalTimeout`

Legacy prototype aliases are still accepted for static checks: `ready`, `modrinthMissing`, `packDownloaded`, `importFailed`, `pending`, and `unavailable`.

Open `index.html?state=approvalTimeout` to review a state directly. Do not add visible state-picker controls to the friend-facing page; QA controls belong in a separate harness.

Safety and accessibility contract:

- `index.html` keeps `robots=noindex,nofollow`; deployment must also send `X-Robots-Tag: noindex, nofollow` before closed-alpha links are shared.
- Unavailable states hide room alias, Minecraft version, and pack profile name.
- Valid state may show only safe metadata: room alias, Minecraft version, pack profile name, and trust copy.
- Actions are keyboard-focusable links with button styling and visible focus.
- Mobile layout keeps actions full-width and avoids text overflow.
- Public copy must include the unofficial-product wording for Minecraft, Mojang, and Microsoft.
- The trust panel states that generated packs preserve original mod download URLs and pinned hashes; third-party mod files are not rehosted by this helper.

Release checks live in [closed-alpha-release-checklist.md](../../docs/operations/closed-alpha-release-checklist.md).
