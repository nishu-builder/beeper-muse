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
