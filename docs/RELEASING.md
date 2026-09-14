# Releasing

Current releases ship the Chrome-only extension. The public artifact is built
from `dist/chrome-extension`, not the legacy `extension` source directory or a
private `.local` installation.

## Prepare a release

1. Update the version in `package.json`, the root entries of `package-lock.json`,
   and `browser-runtime/runtime/manifest.json`. The legacy Go/client versions
   remain independent. Update `CHANGELOG.md` and affected documentation.
2. Run `npm ci --ignore-scripts`, `npm run check`,
   `go test -race -tags goolm ./...`, `npm audit --omit=dev --audit-level=high`,
   and `npm run package`. Review [validation](validation.md) honestly.
3. Inspect the archive: it must contain the connection tab, runtime JavaScript,
   `crypto.wasm`, icons and license notices. It must exclude credentials,
   private configuration, development probes and companion code.
4. Merge through a ready-for-review PR with passing CI. Tag the merged main commit
   with the matching version (for example `v0.7.0`) and push that tag.

The tag workflow requires the commit to be an ancestor of main and verifies the
version against the Chrome manifest and package. It runs checks, publishes
`beeper-muse-extension.zip` and `SHA256SUMS`, and optionally submits the same
artifact to Chrome Web Store. ZIP order and timestamps are fixed; toolchain
versions can still affect compressed bytes.

Users can verify the published checksum with `shasum -a 256 -c SHA256SUMS` on
macOS or `sha256sum -c SHA256SUMS` on Linux. Do not replace existing release
assets silently; issue a new version for changed bytes.

## Chrome Web Store

Item: `bchjpmhhlhpcokhlmbpbiibehfjdgnme`. Use [listing notes](store-listing.md)
for the short description, current permissions, privacy disclosures and reviewer
instructions. Keep the privacy/setup links public. Remove stale companion
screenshots or descriptions when uploading the Chrome-only package.

Upload `dist/beeper-muse-extension.zip` through the developer dashboard, complete
listing/disclosure changes, then submit for review. An upload or submission is
not approval. If another release is under review, inspect the dashboard's options
before replacing it. Record the actual version and status after submission.

The repository also supports the [Chrome Web Store V2 API](https://developer.chrome.com/docs/webstore/using-api)
through `scripts/publish-store.mjs`. It uploads, waits for processing and requests
review with warnings treated as errors. It does not edit listing metadata.

Configure the protected `chrome-web-store` GitHub environment:

| Kind     | Name                |
| -------- | ------------------- |
| Variable | `CWS_PUBLISHER_ID`  |
| Variable | `CWS_EXTENSION_ID`  |
| Secret   | `CWS_CLIENT_ID`     |
| Secret   | `CWS_CLIENT_SECRET` |
| Secret   | `CWS_REFRESH_TOKEN` |

Use a required maintainer reviewer and Google's documented OAuth scope. Never
commit these secrets or copy them into issues. Run `npm run store:check` to verify required secret names and publishing IDs,
then `npm run store:check -- --enable` when the credentials and listing are ready; without
it, GitHub releases work and the store job is skipped. Credentials from another
repository are not automatically shared.

As of this release preparation, publishing secrets are not configured and
`CWS_PUBLISH` is false. The store update therefore requires the dashboard. A
previous 0.3.0 submission was recorded, but that historical status does not
establish the current store version or approval state.

## Failure handling

Inspect existing releases/assets before retrying a failed workflow. After an
uncertain store response, inspect the dashboard before repeating publication.
Do not print OAuth response bodies or private registration data. A failed store
job does not invalidate an already published GitHub release; report their states
separately.

## Artwork

The geometric M icon is original artwork. Store illustrations must use synthetic
content and be clearly described as illustrations, not evidence of live delivery.
Never publish screenshots containing account details or personal conversations.

### Configure store credentials once

Create a Google OAuth client and authorize the publisher account following
[Google's API setup](https://developer.chrome.com/docs/webstore/using-api).
Use the `https://www.googleapis.com/auth/chromewebstore` scope and obtain an
offline refresh token. Store the client ID, client secret and refresh token as
`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` in the repository's
**Settings → Environments → chrome-web-store → Environment secrets**. Do not
paste them into chat, commit them, or pass them as command-line arguments.
The configured publisher/item IDs must belong to the account that authorized it.

`npm run store:check -- --enable` checks names, not token validity, before enabling
submission on future release tags. Only Google's authorization/upload responses
can establish validity. It does not submit an existing tag or alter the listing.
Missing secrets leave publishing disabled; GitHub packages can still be released.
