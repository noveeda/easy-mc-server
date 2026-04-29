# M1 Modpack Builder Fixtures

This directory holds the fixed-pack metadata needed for the M1 friend install validation loop.

`mvp0-performance-room-1.21.1/modrinth.index.template.json` is a template, not an importable `.mrpack`. It contains real Modrinth file URLs, SHA1, SHA512, and file sizes for third-party mods, plus placeholder entries for the first-party room connection mod.

Do not zip the template into `.mrpack` until all placeholders have been replaced with immutable signed artifact metadata.

## Pack Rules

- Minecraft version: `1.21.1`
- Fabric Loader: `0.19.2`
- Java: Java 21-compatible runtime required by the host runtime policy
- Third-party files are referenced from original allowed download URLs
- First-party connection artifacts must be served over HTTPS and pinned by SHA1/SHA512
