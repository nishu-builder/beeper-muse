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

## Development loop (0.8.2)

On September 14, 2026, the local repository checks passed with 165 JS/TS tests,
all TypeScript checks, Go tests, both builds and formatting. Go race tests passed.
New regressions cover target pinning, response validation, redirect refusal,
failed send journals, uncertain-send replay prevention, stale build/log rejection,
image-content verification, delivery versus reply evidence and queue continuation
only after known pre-upload failures.

Live Beeper Desktop observations:

- The pinned Muse chat and its expected owner/bot participants were found.
- Chat-detail and ordinary message-list routes still returned HTTP 500.
- Chat-scoped message search succeeded. A live validation error established its
  20-result limit; the driver was corrected to respect that limit and to reject
  incomplete results.
- The Desktop image-upload API accepted a synthetic 168-byte PNG and returned an
  upload ID. This uploaded a test asset; it sent no conversation message.
- `dev:doctor` verified the target and search, then correctly stopped because the
  diagnostic file had not been selected. No text/photo round trip was initiated.
- Supported browser inspection still returned `Debugger unattached`. Actual Muse
  file-input compatibility remains unresolved.

The cycle, automatic-reload heartbeat, live send path, native status rendering
and both-direction image round trip are **not yet live-verified**. The next
prerequisite is the one-time diagnostic file grant. Existing uncertain uploads
must still be inspected before dismissing them; this version does not silently
release or resend the user's previously interrupted photo.

## First diagnostic-file observation (0.8.3 work)

The selected diagnostic file updated successfully and reported the exact 0.8.2
build, both connections ready, one interrupted image and one queued text message.
The upload-readiness event showed one composer and `hasForm: false`. Previous
file/preview counts were scoped to that absent form; zero counts therefore did
not establish that the page had no upload input or staged image.

The adapter now considers the smallest composer ancestor with upload controls,
rejecting page roots and regions containing transcript messages or multiple
textareas. Synthetic tests cover both native forms and form-free containers,
while preserving existing drafts and requiring a loaded preview. Additional
content-free counts distinguish a missing region from a missing page file input.
The older interrupted attempt remains held because current readiness cannot
prove whether that historical attempt reached Muse.

## Avatar, activity and persistent parity tracking (0.8.4)

All 175 JavaScript/TypeScript tests pass, together with the TypeScript checks,
Go tests, builds and formatting checks. New synthetic cases cover avatar
selection outside history/navigation, ambiguous names, byte limits, concurrent
refreshes, native state preservation, retry after partial failure and nonblocking
source reads. Activity cases distinguish current controls from historical
widgets and leave unknown source activity to expire instead of inventing idle.

Live read-only Matrix checks found no avatar on either the selected room or the
Muse bot. A short typing request and its explicit clearing request were accepted;
no conversation message was sent, and this does not verify visible client typing.
The corresponding Desktop account exists, connected, under self-hosted `bridgev2`
without a friendly network name. Its Account-screen rendering remains unverified.

Supported browser inspection still returns `Debugger unattached`. The selected
diagnostic file is stale; its last runtime is 0.8.2 with one held photo and one
queued text. The development driver correctly refuses to send a test in this
state. The new source selectors are synthetic hypotheses until inspected against
the live header and upload controls. Track all remaining work in the
[parity ledger](parity.md); neither avatar display nor full message parity is
claimed from passing tests.

## Reaction/revision recovery and current-turn activity (0.8.5)

All 181 JS/TS tests, TypeScript checks, Go tests, builds and formatting pass.
New regressions verify unknown versus explicitly empty reaction observations;
re-added reactions with fresh IDs; text/image cycles with fresh revision IDs and
ordered update times; exact retry payloads; and recovery when newer source state
reverts after an uncertain edit or reaction-removal response. Original message
times remain unchanged. These are protocol tests against a recording transport,
not proof of Desktop/mobile rendering.

A partial Muse transcript saved during earlier authorized browser inspection
contains assistant renderer `aria-busy` attributes and turn identifiers. The
adapter now reads busy state from the current assistant turn, excluding older
turns, nested loading widgets and avatar loading. The captured values were idle;
the synthetic busy transition still requires live confirmation.

The browser tool continues to list the Muse tab but rejects page inspection with
`Debugger unattached`. The selected diagnostic file remains stale at 0.8.2. No
additional conversation test, held-job dismissal or photo retry was performed.
The live-check goal remains open; the parity ledger records the remaining work.

### Source-order regression follow-up

The sync tracker could import a settled later message before an earlier first
import that was still changing. A source-order barrier now holds later items
until that earlier item settles. Edits to already imported messages retain their
existing position and do not block later first deliveries. Both cases pass
synthetic regressions. This does not establish native client ordering for older
history first observed after newer messages were already imported.

Full check after the source-order fix passed: 183 JS/TS tests, TypeScript,
Go tests/build and formatting. Live diagnostics remain stale at version 0.8.2.

### Native source connection status (0.8.6)

Synthetic tests cover selected-tab/protocol/active-source checks, disconnected,
draft and busy states, stale evidence, backward clock movement, hung probes,
late responses after detach, nonoverlapping probes, current provisioning state
and transport heartbeats not renewing stale source status. Content-script probes
expose only fixed health and active state, not drafts or conversation content.
The native payload matches the installed mautrix bridgev2 status schema.

No live offline banner, server-side TTL expiration or mobile/desktop recovery has
been verified. Browser inspection still fails with `Debugger unattached`; the
chosen diagnostic export remains stale. No existing user job was dismissed or
resent and no new conversation test was sent.

Full validation passed with 190 JS/TS tests, TypeScript checks, Go tests/build
and formatting. The extension package remains free of private registration data.

### Structured formatting (0.8.7)

Synthetic adapter-to-runtime tests preserve continued list numbering, heading/table
structure, cell boundaries, code language and indentation. Parser regressions
cover malformed HTML, encoded unsafe URLs, embedded credentials, foreign markup,
active controls, output reparsing and structural/size limits. Excess formatting
retains a visible plain message rather than emitting an empty formatted body.
Parser and entity dependency licenses are included in the public archive.

Live browser inspection still returns `Debugger unattached`, and the chosen log
has no fresh heartbeat. These tests do not establish an exhaustive current Muse
inventory or prove the installed Beeper clients render all allowed tags.

Full checks passed with 196 JS/TS tests, TypeScript, Go tests/build and formatting.

## Diagnostic collection and account warning (0.8.8)

The user supplied a Desktop disconnected banner. A read-only Desktop account query
confirmed that the named account is the extension's current registration and
returned the source-disconnected status text. This establishes a visible native
warning; it does not establish why source health was lost or verify recovery,
mobile rendering or server-side expiry.

Synthetic regression tests cover a never-resolving health request with continued
file heartbeat, one outstanding read per channel, late completion, retained
sanitized events after storage failure, independent update progress and strict
preflight refusal for missing health or pending updates. Authenticated diagnostic
observations do not hold the update guard; actual message operations still do.
Source preparation and reload operations are never retried because of an
observation timeout. Live update recovery remains unverified: the selected export
is still stale at 0.8.2 and no held user work was modified.

## Fresh runtime and first automated send (0.8.9 work)

The user renewed file updates. The chosen export now reports the exact staged
0.8.8 fingerprint, both connections ready, and zero queued/claimed/blocked/pending
jobs. Desktop's current account status is connected. Browser DOM inspection still
fails with Debugger unattached.

A journaled text test through Desktop's send API returned HTTP 500. Logs identify
a sendMessage tool execution failure; the read-only getChat endpoint independently
returns TOOL_EXECUTION_ERROR. Message search and listing work. The same run was
observed for 45 seconds without a matching message/reply or native delivery result.
Its send outcome remains unverified and its journal was retained without replay.
The photo and subsequent text scenarios have not been sent.

Current source diagnostics locate one composer file input that the image/*-only
filter fails to recognize. Version 0.8.9 handles standard MIME, filename-extension
and unrestricted filters, with synthetic rejection tests for incompatible MIME,
PDF/SVG-only inputs, disabled fieldsets and ambiguous multiple pickers. These tests
are not evidence of a successful live image submission.

Staging the new local package was followed by the diagnostic file ceasing to
advance after 21:50:15 UTC. Automatic reload and file-grant retention therefore
remain unverified; disk package contents do not establish the running version.

## Desktop preflight and subsequent connection report

The selected log later confirmed the exact 0.8.9 fingerprint, then stopped
advancing at 22:04:35 UTC. The user reports Muse connected; Desktop's account
API independently reports connected. Current source health, queue state and
image-input recognition remain unverified because that log is stale.

Read-only get-chat calls using both documented identifier forms return HTTP 500.
Listing and message search succeed. The updated development doctor detects the
failed per-chat prerequisite separately and exits with status 2. No test was sent.
Synthetic driver regressions verify that working listing cannot authorize a send
when retrieval fails, and reject incorrect identity, malformed and read-only
chat details. A successful preflight is not delivery confirmation.

The prior text-send journal remains open. No photo or subsequent text test was
sent, no user job was dismissed and no installed Beeper app code was changed.

After a user-performed Beeper Desktop restart, the same read-only doctor passes
identity, search and per-chat retrieval. The restart cleared the observed API
failure. It still refuses a test because the diagnostic file is stale.

## Live text and native status confirmation (0.8.10)

After Desktop restart and renewed diagnostic-file permission, fresh 0.8.9 health
showed both connections, idle composer and empty queue. A newly journaled text
test returned its unique expected reply. Search and message-list API responses
initially omitted sendStatus despite the successful round trip.

The installed Desktop mapper drops status values lacking a timestamp; the
bridge's status content had no ts. Version 0.8.10 supplies a persisted timestamp,
bridge identity and bot sender. The extension updated automatically, and the
same test then passed native SUCCESS with the Muse bot in deliveredToUsers. No
resend was needed. See the documented
[Beeper sendStatus fields](https://developers.beeper.com/desktop-api-reference/resources/messages/methods/list/).

The chosen diagnostic file continued advancing across that update. The selected
Muse tab did not resume: reconnect validation used the wrong Chrome document-ID
format. The validator now accepts nonzero 32-character hex tokens and preserves
exact document targeting. Synthetic tests cover valid upper/lowercase tokens,
invalid lengths/characters and expired tickets. Live reconnect remains pending.
Typing source/transport events were observed; client animations, avatar display
and incoming photo submission are not yet verified.

## Live incoming-photo failure and preview handoff tests (0.8.11)

The journaled 0.8.10 photo scenario reached the Muse upload adapter, then stopped
at image-input-changed before Send. Desktop's API exposed native FAIL_PERMANENT.
The guard does not distinguish a cleared picker, a replaced picker and changed
composer/draft. The queued test is held; its image was not resubmitted or removed.

Synthetic adapter coverage now allows a cleared/replaced picker only with an
exact byte match against the sole loaded local preview. Regressions cover changed
bytes, truncated/oversized streams, remote URLs, newly selected files, user drafts
and preview changes during caption entry. Full photo delivery and post-photo text
remain unverified until the staged test is inspected and a new test can run.

The automatic 0.8.10 → 0.8.11 update successfully restored the same selected Muse
source and continued writing fresh diagnostics. Both connections report ready;
the held photo job remains held. New upload readiness finds no existing files or
previews. No manual reconnect was required for this update, and no held job was
replayed. Another photo test awaits dismissal of the synthetic failed job.

## Live composer inspection and boundary regression (0.8.12)

After confirmed user dismissal, a new 0.8.11 photo attempt failed with
image-preview-timeout and native failure. No photo delivery was verified.
Supported browser inspection worked in a newly opened Muse tab: the picker and
textarea share an inner container, while action controls sit elsewhere in the
explicit composer wrapper. The adapter previously watched only the inner region.
The wrapper fix has synthetic sibling-preview/Send and shared-transcript rejection
coverage. The new failed test remains held; successful live upload and post-photo
text remain pending.

The automatic local update is live: fresh 0.8.12 diagnostics confirm the exact
packaged build, both connections, continued file logging and the held job. The
corrected region now reports two image elements and one Send control where the
old region reported zero of each. These counts do not identify the images, but
they confirm the boundary changed actual observation. Inspect and remove only
leftover synthetic test attachments before dismissing that test and trying again.

## Live photo interpretation and echo parsing (0.8.13)

With fresh connected diagnostics and zero queue counts after user cleanup, the
0.8.12 image test reached Send. Browser inspection verified the exact marked
caption, its image, and Muse's correct RED response without revealing the color
in the prompt. This establishes delivery to Muse and successful interpretation.
The bridge instead emitted native failure at reply-attribution because user media
sits beside the caption bubble. Subsequent read-only observation confirmed the
correct reply in Beeper: roundTrip=true, nativeFailure=true and nativeDelivery=false.
Native success remains unverified; no resend or post-photo text was sent.

Synthetic regression tests for 0.8.13 cover owned sibling media, renamed image
labels, unchanged captions, excluded decoration, delayed media evidence and
rejection of unrelated prompts. The original submitted job remains held.

## Image-first multi-bubble regression (0.8.14)

The next 0.8.13 test submitted its image, and browser inspection verified the
correct uniquely marked photo and color response. Native failure occurred at
reply-attribution again. The media button and caption each carry the bubble class;
the parser selected only the first, dropping the caption. Version 0.8.14 reads
all top-level surfaces once. Its regression uses that observed structure and
checks nested deduplication and ordered assistant text. No failed prompt was
replayed or following text sent; native SUCCESS remains pending live verification.

Read-only Desktop observation confirmed that this test's correct reply also
returned to Beeper (roundTrip=true). Native failure remains; it was not resent.

## Passed live incoming photo and follow-up text (0.8.14)

A fresh small PNG test returned the correct undisclosed color and exact marker in
Beeper, with native SUCCESS/deliveredToUsers identifying Muse. A subsequent plain
text test returned its exact marker and native SUCCESS too. Both reports record
roundTrip=true, nativeDelivery=true, nativeFailure=false and duplicate=false.
The queue claim released between attempts; no user dismissal was required for
either successful job. Tests refused to enqueue while a prior claim was still
present. The earlier failed test journals were retained without replay.

This verifies the incoming photo → text path for the synthetic image, not every
image format/size, visible client indicators or OS notification behavior. The
Muse-to-Beeper generated-image scenario is a separate check.

## Reverse-image diagnostic boundary (0.8.15)

The marked generation reply returned with native SUCCESS. Muse rendered a
separate image in the same source turn; the recent Desktop message list did not
show it. The automatic checker requires an attachment on the marked reply, so
that scenario remains unverified. No generation was replayed. Fixed preparation
codes now distinguish fetching, unsupported formats and exceeded size budgets;
regression tests check these without logging image URLs or response contents.

After the automatic 0.8.15 update, fresh logs showed image-prepared and Desktop's
message list gained an assistant image after the marked reply. No generation
prompt was replayed. This is partial recovery evidence, not a passed autonomous
reverse-image test: the delay/reload dependency is unexplained, and Desktop's
numeric message IDs do not expose the deterministic Matrix/source IDs used by
the attempted correlation check. Retain the active generation journal and
investigate automatic image retry/association before claiming full parity.
