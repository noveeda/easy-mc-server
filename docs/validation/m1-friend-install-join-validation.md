---
title: "M1 Desktop Host Invite Flow Validation"
type: validation
status: blocked
created: 2026-04-29
source_milestone: "../milestones/2026-04-29-local-minecraft-room-milestones.md"
---

# M1 Desktop Host Invite Flow Validation

M1 validates the highest-risk user behavior before the full room connection stack exists: a non-developer host prepares a room and creates an invite from the desktop app, then a non-developer friend opens that invite, applies a private Modrinth pack, launches Minecraft Java, and reaches a clear approval waiting state.

## Current Status

M1 is validation-ready only after the first-party client connection mod has a signed HTTPS artifact with URL, SHA1, SHA512, and file size metadata.

Until then, the repo contains:

- Desktop host prototype: `apps/desktop/index.html`
- Static invite-page prototype: `apps/invite-web/index.html`
- Fixed pack metadata: `docs/product/fixed-alpha-packs.md`
- Modrinth index template: `packages/modpack-builder/m1/mvp0-performance-room-1.21.1/modrinth.index.template.json`

## Preflight Gate

Do not run the tester study or mark M1 complete until:

- The `.mrpack` is importable in Modrinth App.
- All placeholder artifact values are removed from the pack template.
- The friend client mod can render an approval waiting state in Minecraft.
- The host approval state can be simulated or handled by a minimal local harness.

## Tester Profile

Use at least three testers who:

- Play Minecraft Java or understand launching Minecraft Java.
- Have not manually hosted a Minecraft server before.
- Are not given port forwarding, firewall, Docker, VPN, or relay explanations.

## Validation Flow

### Host Flow

1. Host opens the desktop app.
2. Host selects the supported Minecraft version.
3. Host selects the recommended fixed pack.
4. Host prepares the room.
5. Host opens the room.
6. Host copies the invite link.
7. Host sees a friend request and approves or denies it.

### Friend Flow

1. Tester opens the invite link.
2. Tester reads the trust panel.
3. Tester installs Modrinth App if missing.
4. Tester downloads the friend modpack.
5. Tester imports the pack in Modrinth App.
6. Tester launches the generated profile.
7. Tester reaches the approval waiting state.
8. Tester reports what they expected to happen next.

## States To Exercise

| State | Expected result |
|---|---|
| Valid invite | Shows safe room metadata, pack download, Modrinth path, and trust copy. |
| Modrinth App missing | Guides to Modrinth App without exposing room connection details. |
| Pack downloaded | Tells the tester to import the pack and shows the exact profile name. |
| Import failed | Offers a fresh download and states the desktop Java requirement. |
| Unsupported device/browser | Explains desktop requirement without exposing sensitive room details. |
| Host offline | Says the room is closed right now. |
| Approval pending | Makes waiting for host approval feel intentional. |
| Approval timeout | Gives a retry path without blaming the tester. |
| Expired/revoked invite | Hides room details and asks for a new invite. |

## Metrics

Record:

- Time from desktop app open to invite creation.
- Time from invite open to Minecraft launch.
- Pack import completion result.
- Whether support intervention was needed.
- Drop-off point and tester wording.
- Whether the trust panel made the install feel acceptable.

## Completion Criteria

M1 is complete only when at least three non-developer hosts can create an invite from the desktop app and at least three non-developer friends can reach approval waiting state without Hamachi, Tailscale, ZeroTier, port forwarding, Docker, firewall instructions, or developer support.
