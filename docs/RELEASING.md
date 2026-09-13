# Releasing Beeper Muse

Releases provide a public extension ZIP and checksum, with an optional Chrome
Web Store submission job. The local bridge remains a separate source install.
Store approval is Google's decision; a successful upload or submission does not
mean that the extension is available to users.

## First store submission

1. Run `npm ci --ignore-scripts`, `npm run check`, and `npm run package`.
2. In the Chrome Web Store Developer Dashboard, create an item using
   `dist/beeper-muse-extension.zip`. Never upload `.local/` or an old generated
   extension copy. The package script includes only its explicit public file list.
3. Complete the store listing, privacy disclosures, distribution, and reviewer
   instructions from [the store notes](store-listing.md). Upload the icon and
   screenshots under `docs/store/`. Confirm the privacy and setup links are public.
4. Test pairing, connect/disconnect, and an installed-extension prompt/reply round
   trip. Record limitations in [validation](validation.md). Submit for review.
5. Update the README's availability statement when the store actually publishes
   the item. Keep the GitHub download available as a manual installation option.

## Tagged releases

Update `package.json`, `package-lock.json`, `extension/manifest.json`, and the
version in `cmd/beeper-muse/main.go` together. Include meaningful release notes,
any required local-bridge upgrade, and relevant validation. Merge the change to
`main` through a reviewed PR with passing CI, then tag the merged commit:

```sh
git switch main
git pull --ff-only
git tag v0.3.0
git push origin v0.3.0
```

Use the new version for subsequent releases. The release workflow requires the
tagged commit to be an ancestor of `main` and the tag to match the manifest. It
runs checks, builds the ZIP with fixed file order and timestamps, and publishes
the ZIP and SHA-256 checksum in a GitHub release. Dependency/runtime versions can
affect compression bytes; use the released checksum to verify a download.

For a manual integrity check on macOS, from the download folder:

```sh
shasum -a 256 -c SHA256SUMS
```

If a release job is interrupted after publication, inspect its existing release
and assets before retrying. Published releases are not automatically overwritten.

## Optional store automation

The repository's protected `chrome-web-store` environment and item identifiers
are configured. Google OAuth secrets have not been configured, and `CWS_PUBLISH`
is currently `false`. The first submission was completed through the dashboard.
Add the credentials described below before enabling automated submissions.

The first submission uses the dashboard. Later tags can submit the same release
artifact through the [Chrome Web Store V2 API](https://developer.chrome.com/docs/webstore/using-api).
This follows the distribution pattern used by
[Smooth Surfer](https://github.com/nishu-builder/smooth-surfer): tagged release
downloads plus a protected publishing environment.

Create a GitHub environment called `chrome-web-store` with a required maintainer
reviewer. Configure these environment values:

| Kind     | Name                | Value                                         |
| -------- | ------------------- | --------------------------------------------- |
| Variable | `CWS_PUBLISHER_ID`  | The publisher ID from the store dashboard     |
| Variable | `CWS_EXTENSION_ID`  | The 32-character extension ID                 |
| Secret   | `CWS_CLIENT_ID`     | Authorized Google OAuth client ID             |
| Secret   | `CWS_CLIENT_SECRET` | That client's secret                          |
| Secret   | `CWS_REFRESH_TOKEN` | Refresh token with the Chrome Web Store scope |

Follow Google's OAuth setup instructions; do not commit these credentials or
copy them into issue comments. Enable the repository variable `CWS_PUBLISH=true`
only after the listing, environment, and credentials are ready. Without that
variable, GitHub releases still work and the store job is skipped. Existing
secrets in another repository are not automatically shared with this one.

The store job uploads the release artifact, waits for upload processing, and
submits for review with warnings treated as errors. It does not skip review or
change listing metadata. Approved submissions use automatic publication. Inspect
the dashboard after uncertain network failures before retrying a submission.

## Asset provenance

The M icon is original geometric artwork. The listing screenshots show the actual
popup HTML/CSS in a local preview using synthetic connection state, labeled as a
setup preview. They contain no private accounts, conversations, or pairing code.
They demonstrate the interface, not evidence of a live end-to-end test.
