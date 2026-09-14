# Validation

This record distinguishes automated checks, live observations and remaining
acceptance work. “Connected” is not an end-to-end success criterion. The project
remains experimental; the public package is not a claim of production reliability.

## Automated coverage

For 0.7.2, local checks passed: 130 JavaScript/TypeScript tests, TypeScript
checks, Go tests and race tests, both builds, formatting, the public ZIP tests,
and the production npm audit (zero reported vulnerabilities). The release gate
is `npm run check`, Go race tests, `npm run package`, and the production npm audit. CI runs on Linux and macOS. Tests use synthetic DOM,
mocked Chrome APIs, Rust/WASM crypto tests and isolated temporary databases.
They do not log into accounts or establish Web Store installation behavior.

Coverage includes:

- Owner, room, membership and selected-tab restrictions; trusted document ports.
- Draft preservation, prompt echo attribution, reaction-independent message text,
  source timestamps, partial observations and rich-content upgrades.
- Durable transaction acknowledgment, restarts, changed duplicate payloads,
  queue limits, exact encrypted retry batches and interrupted prompts.
- Formatting validation, encrypted image delivery, sender identity, edits,
  reaction add/remove, activity expiry and notification-suppression flags.
- Native browser fetch binding, handshake errors, document reload/reconnect,
  bridge announcements and read-only provisioning response envelopes.
- Credential-free packaging, deterministic ZIP construction, required WASM and
  notices, and store publishing control flow using synthetic credentials.

Package integrity tests inspect the ZIP itself. They cannot guarantee acceptance
by Chrome Web Store or establish that every current Muse selector still works.

## Live observations before the 0.7 release

| Area                  | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy companion      | An installed extension completed an automatic encrypted Beeper-to-Muse-to-Beeper text round trip. This verifies that older architecture, not the Chrome-only release.                                                                                                                                                                                                                             |
| Source extraction     | Muse reaction actor labels and virtualized text were inspected; fixtures cover those observed structures. Website behavior can change.                                                                                                                                                                                                                                                            |
| Matrix protocol       | Independent live API checks exercised owner identity, formatted text, encrypted images, edits, reactions and typing. These do not substitute for an installed-extension round trip.                                                                                                                                                                                                               |
| Chrome handshake      | The extension-document probe confirmed required headers, absent Origin, HTTP 101 and a Beeper protocol reply.                                                                                                                                                                                                                                                                                     |
| Chrome runtime        | The user confirmed Beeper connected and the Muse room was visible on mobile. Desktop received room events but queued them for an unloaded account.                                                                                                                                                                                                                                                |
| Desktop discovery fix | Desktop logs showed repeated capabilities-request timeouts. Version 0.6.6 added the missing `http_proxy` handler; regression tests verify dispatch and response framing. After the fix, Desktop’s account chat list includes the current Muse room. Its detail endpoint still returned HTTP 500 for that room, while older test rooms returned 200; complete Desktop behavior remains unverified. |

History suppression has been checked through request flags and read/unread state.
Operating-system notification banners across clients have not been comprehensively
observed. Original timestamps can only be verified when the source supplies them.

## Update automation acceptance

Automated tests cover busy-source deferral, pending claims, overlapping checks,
source recovery after failure, durable delivery checkpoints, draft preservation,
old-script disposal, tab/expiry validation and staged-file installation. Package
tests confirm that local build markers and private configuration are excluded.
These are synthetic Chrome API tests, not an observed installed-extension reload.

After the one-time manual transition, make a new local build with `update:local`.
Verify that the popup version changes without a Chrome extensions-page reload,
that the same Muse page remains open with any draft intact, and that a fresh
Beeper prompt completes. Repeat with a prompt in progress: the update must wait.
Also test a downloaded store update after Google authorization and review. Store
publishing is not enabled until its required secrets are configured.

## Release acceptance checklist

The 0.7.1 typing fix covers activity checks while the composer is disabled,
transcript reads fail, and the page's interval timers do not fire. Before the fix,
Desktop SDK logs showed incoming `m.typing` events for the current room, so missing
visible indicators cannot be attributed solely to transport. Rendering and
clearing in both Desktop and mobile still need a live check after updating.

Use a consenting test account and synthetic content. Record exact versions and
outcomes without committing credentials, identifiers or private screenshots.

- Install the actual release ZIP, import a fresh registration, and connect Muse.
- Verify the room is discoverable in both Desktop and mobile, including requests.
- Send a new text prompt from Beeper and receive its Muse reply automatically.
- Check native user/assistant identities, formatting, accessible images and edits.
- Observe reaction addition/removal and typing expiry in the installed extension.
- Run catch-up twice; verify deduplication, timestamps, unread state and banners.
- Terminate/restart the worker and restart Chrome; verify saved work and keys.
- Interrupt a claimed prompt; confirm it is blocked rather than submitted twice.
- Confirm there is no running companion and no localhost traffic dependency.
- Test an update in place and separately document a Web Store installation.

Do not mark an item passed based only on synthetic tests or a successful socket.
Store upload, review submission and publication are separate states. See
[release process](RELEASING.md) and [troubleshooting](operations.md).

## Image support acceptance

For 0.8.0, 145 JavaScript/TypeScript tests, all type checks, Go tests and race
tests, both builds, formatting, public packaging and the production dependency
audit passed locally (zero reported vulnerabilities).

The 0.8 image work adds synthetic coverage for encrypted/plain image descriptors,
stream limits, MIME signatures, caption handling, single claims, failed-job
recovery, prompt attribution, existing-draft preservation, loaded previews,
local image extraction and native-photo deduplication during catch-up. A local
HTTP redirect test verifies that native fetch removes Authorization before
requesting a different origin. These are not Chrome permission or live DOM tests.

On September 14, 2026, a synthetic 68-byte PNG was encrypted, uploaded to the
configured Beeper media API, downloaded through its storage redirect, decrypted
and byte-compared successfully. No conversation messages were sent by that probe.
The authenticated download returned a 307 redirect even with `allow_redirect=false`;
rejecting redirects prevented media downloads.

Browser inspection of the signed-in Muse page repeatedly returned “Debugger
unattached,” including after the user confirmed DevTools was closed. The current
upload adapter therefore has only synthetic form/input/preview coverage. Its
compatibility with Muse's current upload controls is **not verified**. Do not
claim complete image support from the media API test alone.

Remaining installed-extension checks:

- Accept the new storage permission and download/decrypt a Beeper photo in Chrome.
- Upload a real photo, with and without a caption, into the selected Muse chat.
- Verify Muse's reply and image echo without duplicate imports or text replacement.
- Check a native Muse image and a local preview reach Beeper as actual images.
- Interrupt an upload, inspect the staged attachment and recover without resending it.

## Follow-up diagnostics and native status

The user confirmed that Muse images appeared in Beeper, while an incoming photo
produced an interrupted job and held a later text message in the outgoing queue.
The 0.8.0 popup indicated that photo download/decryption had completed but did not
identify the failing adapter step. This is evidence of a failed live incoming
photo attempt, not a passed image round trip.

Version 0.8.1 passed 155 JS/TS tests, type checks, Go tests, both builds and
formatting locally. It records bounded readiness facts and specific failure codes. Synthetic
checks cover filtering private/unknown fields, ring limits, serial file writes,
revoked permissions, failed writes, file selection/stop controls, prompt echo
validation, pending/failed/success status payloads and status retry without a
second send. The native status schema follows mautrix v0.30.0's `event/beeper.go`
and `bridgev2/messagestatus.go`.

Remaining live checks: choose the actual diagnostic file in Chrome, confirm it
updates and survives reload, inspect readiness without another photo send, fix
and test the identified upload control behavior, and confirm message-status
rendering in Beeper Desktop and mobile. A pending/failure protocol payload alone
does not prove the client changed its “Sent” label.
