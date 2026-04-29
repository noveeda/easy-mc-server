# Invite Web Helper

This is a secondary helper surface for friends who receive an invite link from the desktop host app. It is not the primary product entry point.

The product starts in `apps/desktop/`. This page only helps a friend apply the generated pack or recover from a small set of invite states.

Supported development states:

- `ready`
- `modrinthMissing`
- `packDownloaded`
- `importFailed`
- `unsupported`
- `hostOffline`
- `pending`
- `approvalTimeout`
- `unavailable`

Open `index.html?state=pending` to review a state directly. Do not add visible state-picker controls to the friend-facing page; QA controls belong in a separate harness.
