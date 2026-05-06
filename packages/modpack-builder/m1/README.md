# M1 Modpack Builder Fixtures

This directory holds the fixed-pack metadata needed for the M1 friend install validation loop.

For the current Korean runnable developer preview guide and `.mrpack` blocker explanation, see `../../../docs/usage/mvp0-local-preview.md`.

`mvp0-performance-room-1.21.1/modrinth.index.template.json` is a template, not an importable `.mrpack`. It contains real Modrinth file URLs, SHA1, SHA512, and file sizes for third-party mods, plus placeholder entries for the first-party room connection mod.

Do not zip the template into `.mrpack` until all placeholders have been replaced with immutable signed artifact metadata.

For local development only, run:

```powershell
npm.cmd run m1:artifacts
```

This creates skeleton client/server jar files under `.omc/artifacts/fabric-mods`. These files are local verification artifacts, not signed public release artifacts. The build script verifies each jar contains `fabric.mod.json` and the expected compiled first-party class before writing the local manifest.

## M1 Status Model

- `local_artifacts_built`: local `.omc` jars and manifest exist for development verification.
- `pending_signed_https_release`: the first-party client jar is not yet available at a public HTTPS URL.
- `ready_to_package`: readiness passes with a real HTTPS URL and immutable local jar metadata.
- `mrpack_written`: private `.mrpack` has been generated with pinned hashes and file sizes.
- `modrinth_import_verified`: Modrinth App import and Minecraft approval-waiting flow were manually checked.

M1 is complete only after `modrinth_import_verified`. Earlier states are useful gates, not product completion.

Check whether the pack is actually ready to become an importable private `.mrpack`:

```powershell
npm.cmd run m1:readiness
```

This command is read-only. It reports the current blockers and must stay blocked until the first-party client artifact has a signed public HTTPS URL. The readiness check rejects stale local files that are not readable jars with the expected Fabric metadata and class entries.

After publishing the first-party client artifact, re-run readiness with the public URL:

```powershell
npm.cmd run m1:readiness -- --publish-url mods/local-room-client-connection-0.1.0-alpha.jar=<signed-https-artifact-url>
```

To prepare the exact release files before upload, run:

```powershell
npm.cmd run m1:release-assets -- --tag m1-first-party-0.1.0-alpha
```

This writes the client jar and `m1-release-manifest.json` under `dist/m1-release`. The command does not publish anything and does not make M1 ready by itself. The repository workflow `.github/workflows/m1-first-party-artifacts.yml` can publish those files to a GitHub Release, producing a public HTTPS URL in this shape:

```text
https://github.com/noveeda/easy-mc-server/releases/download/<tag>/local-room-client-connection-0.1.0-alpha.jar
```

After a signed HTTPS first-party client artifact exists, run:

```powershell
npm.cmd run m1:mrpack -- --output dist/private-room.mrpack --artifact mods/local-room-client-connection-0.1.0-alpha.jar=<signed-client-jar-path>,<signed-https-artifact-url>
```

The `.mrpack` command refuses local, private-network, reserved test, or placeholder artifact URLs. It must not be used to show a successful friend install path until the URL points to the actual published artifact bytes. The local jar path is used only to compute pinned hashes and file size.

`applyFirstPartyArtifactLocks()` can inject the first-party artifact metadata after a signed HTTPS release exists. The fixed template must remain blocked until the caller supplies an explicit lock for:

- download URL
- SHA1
- SHA512
- file size

The lock is intentionally not stored as a fake URL in the template. This keeps MVP-0 from showing an importable pack before the first-party client/server artifact is actually published.

## Pack Rules

- Minecraft version: `1.21.1`
- Fabric Loader: `0.19.2`
- Java: Java 21-compatible runtime required by the host runtime policy
- Third-party files must match the fixed-pack lock for original allowed download URLs, SHA1/SHA512, and file size
- First-party connection artifacts must be served over HTTPS and pinned by SHA1/SHA512

## Manual Modrinth App Check

M1 is not complete until a real user-flow check passes with the generated `.mrpack`.

Use this checklist after `m1:readiness` reports ready and `m1:mrpack` writes the pack:

- Import `dist/private-room.mrpack` into Modrinth App.
- Confirm Minecraft `1.21.1` and Fabric Loader `0.19.2`.
- Confirm Fabric API, Lithium, FerriteCore, and the first-party client connection mod are downloaded without hash or file-size errors.
- Launch the imported instance.
- Open the invite flow and reach the host approval waiting state.
- Confirm no placeholder URL, raw invite token, session secret, UUID, IP address, or local path is shown in the UI or logs.

Do not mark M1 complete from CLI output alone. Modrinth App import and Minecraft approval-waiting behavior require manual validation.
