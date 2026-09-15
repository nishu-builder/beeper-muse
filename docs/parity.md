# Muse / Beeper parity ledger

This is the persistent work list for the integration. New requests add to this
list; they do not replace unfinished work. Last updated: September 15, 2026.

**Target:** preserve Muse's conversation content, identity and state in its Beeper
chat as faithfully as the supported protocol allows. Keep source parsing behind
the typed Muse adapter so an official Muse API can replace DOM access later.
The product remains Chrome-only. Maintainer test tools are optional.

## Current priorities

1. Visible-source generated-image delivery without rescan passed in 0.8.17 and
   0.8.18. Encrypted delayed fallback replacement is now verified in Desktop. Continue
   background-tab media discovery; source-hidden images remain a known limitation.
2. Quiet catch-up and reconnect deduplication passed in installed Desktop (see
   acceptance below). Older-history placement remains open. Muse's inspected
   source exposes no original timestamps, so observed-time fallback stays explicit.
3. Babar's animated-avatar frame is visible in Desktop. Real Muse-driven typing
   appeared and cleared; native owner reaction addition/removal also passed.
   Retain broader mobile, reaction replacement and acknowledgement checks.
4. Broaden incoming photo coverage beyond the passed PNG → text sequence, and
   continue the rendering/type inventory below. These remain separate acceptance
   cases rather than reopening already verified individual tests.

## September 14 additional reports

- **REL-06 — Disconnection visible in Beeper:** show when Chrome or the selected
  Muse tab is offline inside Beeper, not only in the extension. Open: investigate
  native bridge status and expiry; a disconnected browser cannot send a final
  notice reliably. Verify loss of tab, browser exit and recovery in both clients.
  **Implemented, not live verified (0.8.6):** native bridge status and provisioning
  now use fresh selected-tab health, with a 90-second TTL instead of six hours.
  Closed/stopped/discarded/unavailable sources report TRANSIENT_DISCONNECT.
  Socket heartbeats cannot refresh stale source status. Tests cover expiry,
  timeouts, selection changes and delayed responses after detach. Visible banners,
  server expiry and browser-exit behavior remain open in both clients.
- **HIS-04 — Messages arrive out of order:** user screenshot shows older content
  appearing after newer replies. Open: trace source order, settling, catch-up and
  native timeline insertion separately from timestamps. Do not invent source times.
  0.8.5 now prevents later messages from overtaking an earlier first import while
  it settles; regressions cover that case and nonblocking edits. Late-loaded
  history and installed-client ordering remain open.
- **RENDER-01 — Connector icon treated as a photograph:** the same screenshot
  shows the Messenger connector logo enlarged into a standalone image. Open:
  distinguish action-card decoration from conversation attachments and retain
  useful card text/context without making inactive controls appear actionable.

Earlier browser inspection returned `Debugger unattached` after reconnect.
A newly opened Muse tab now supports live DOM inspection; see the latest entry.

## User-reported issues

| ID      | Report / desired behavior                                         | Implementation and evidence                                                                                                                                                                                | Status / next acceptance                                                                                                                                |
| ------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01  | Incoming Beeper photo never reached Muse                          | **Live verified in 0.8.14:** synthetic PNG received and interpreted correctly by Muse; exact reply returned to Beeper with native SUCCESS.                                                                 | Broaden formats, sizes and multiple-image coverage; do not claim all attachments are verified.                                                          |
| REL-02  | Interrupted photo blocks later text                               | User dismissed the earlier held attempts. A fresh 0.8.14 photo and subsequent text both passed with native SUCCESS; the completed photo released its queue claim.                                          | Successful photo → text verified. Ambiguous interrupted sends remain held for inspection, without replay.                                               |
| REL-03  | Beeper says Sent without confirmed delivery                       | Live photo and text tests in 0.8.14 each returned exact replies and native SUCCESS naming Muse as the delivered recipient. Earlier failed attempts exposed native failure.                                 | Native API status verified for these cases; visible Desktop/mobile pending and delivery labels still require observation.                               |
| REL-04  | Too much manual testing and relaying errors                       | Typed Desktop API driver, send journal, sanitized reports, local updater and chosen log file implemented. File grant and fresh 0.8.2 heartbeat observed. Logging later became stale during update attempt. | **Partial.** Complete unattended build → reload → heartbeat → text/photo/text cycle; verify file grant survives updates.                                |
| REL-05  | Connect button appears to do nothing / misleading Connected state | Separate Beeper/Muse states, queue information and error descriptions implemented.                                                                                                                         | **Partial.** Exercise stale scripts, disconnected source, held queue and reconnect UI. Connected transport must not imply successful delivery.          |
| ID-01   | Chat avatar should match Muse                                     | Babar's animated avatar is captured as a still frame. Native room/profile state and Desktop list/header show the elephant.                                                                                 | Desktop verified. Mobile and restart persistence remain separate checks.                                                                                |
| ID-02   | User messages show “You in Muse:” instead of native identity      | Native owner identity implemented; user confirmed You/Them alignment improved. Surrogate transcript prefixes removed.                                                                                      | **Partially verified.** Recheck live photo captions and catch-up without added author prefixes.                                                         |
| ID-03   | Muse (Chrome) absent as another Account                           | Desktop API lists the chat's account as connected, provider self-hosted, type bridgev2, with a login but no friendly network name.                                                                         | **Open.** Determine supported naming/discovery metadata and confirm the Account UI. Do not claim the account is absent from the backend.                |
| ACT-01  | Typing indicators do not show                                     | Real Muse generation emitted typing and cleared it about 12 seconds later. Native Desktop captures show appearance and clearing.                                                                           | Desktop verified. Mobile display remains unverified.                                                                                                    |
| ACT-02  | Reactions / acknowledgments rendered as message text or omitted   | A reaction added on the selected Muse source created a native owner m.reaction on the exact message; removal redacted it. Temporary test reactions were removed.                                           | Add/remove protocol verified. Bubble appearance, replacement and assistant acknowledgements remain open.                                                |
| HIS-01  | Catch-up misses recent/older messages                             | Source-ID deduplication and loaded-message catch-up implemented, with partial observations protected.                                                                                                      | **Open.** Compare a bounded known transcript, repeated catch-up, virtualized items and reload recovery. Full account history is not currently imported. |
| HIS-02  | Notifications for already-read catch-up                           | A bounded missed exchange arrived already read with Desktop unread count zero while Beeper was backgrounded; reconnect retained that state.                                                                | Native read/unread behavior verified. OS banners and mobile notifications were not directly observed.                                                   |
| HIS-03  | Timestamps may be wrong                                           | Native catch-up timestamps and sort keys stayed unchanged across reconnect. The inspected Muse DOM exposes no original timestamp for these messages.                                                       | Observed-time stability verified. Original history times remain unavailable; do not fabricate them.                                                     |
| UI-01   | Local extension needs icon, auto popup, close warning             | Extension icons, popup offer and Chrome before-unload guard implemented.                                                                                                                                   | **Partial.** Retest update/reconnect and close behavior. Browser controls the warning wording and may require page interaction.                         |
| ARCH-01 | Chrome-only product and clean future API swap                     | Chrome runtime and source-neutral TypeScript contracts implemented.                                                                                                                                        | **Maintain.** No companion daemon or disk IPC in the product; new source features stay behind the adapter.                                              |

## Message and rendering inventory

This inventory combines the user's screenshots, reports and current code. It is
**not yet an exhaustive inspection of the current Muse UI**. Browser inspection
now works in a newly opened Muse tab. Unknown rows must be checked
in the source before implementation is presented as parity.

| Type / rendering                                   | Evidence that Muse supports it                                                 | Beeper target / current gap                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain text, paragraphs, Unicode                    | Observed                                                                       | Native text in both directions; verify consecutive sends and identity.                                                                                                                                                  |
| Bold, italics, links, lists                        | Observed                                                                       | Sanitized Matrix formatted text; compare content and links.                                                                                                                                                             |
| Headings, quotes, code, tables                     | Not comprehensively inventoried                                                | 0.8.7 preserves bounded Matrix HTML structure, list starts and code language; plain text keeps table cells/list numbers/code indentation. Synthetic tests pass; live source inventory and client rendering remain open. |
| User images and captions                           | Observed; failed incoming attempt                                              | Native encrypted attachments ↔ Muse upload; REL-01/03.                                                                                                                                                                  |
| Assistant/generated images, galleries              | Observed; user saw Muse images in Beeper                                       | Preserve multiple images, ordering, captions and full-resolution choices within documented size bounds. More live cases needed.                                                                                         |
| Responsive/local/blob image previews               | Observed                                                                       | Capture selected image; native upload when accessible; never ship unusable blob links.                                                                                                                                  |
| Image-only messages and alt text                   | Code support; live cases incomplete                                            | Preserve as images without fabricated body/duplicate text.                                                                                                                                                              |
| Video, animation/GIF, audio/voice                  | Composer microphone visible; exact supported message types not yet inventoried | Verify source capabilities first. No claim of general video/audio/voice-message parity.                                                                                                                                 |
| Files/documents and downloads                      | Not yet inventoried                                                            | Determine source upload types and Matrix file mapping, names, MIME and size bounds.                                                                                                                                     |
| Replies/quotes/thread relations                    | Reply controls visible; behavior not fully inventoried                         | Map to native reply relations where source IDs are known; no guessed associations.                                                                                                                                      |
| Edits / streaming updates                          | Observed                                                                       | 0.8.5 adds durable revision IDs and recovery for reversions after uncertain responses. Verify final completeness, notifications and image retention.                                                                    |
| Delete/redaction                                   | Not yet inventoried                                                            | Determine source semantics and supported direction; do not delete messages on temporary DOM disappearance.                                                                                                              |
| Reactions, acknowledgment icons                    | Observed                                                                       | Native actor-aware reactions and removals; ACT-02.                                                                                                                                                                      |
| Read/delivery receipts                             | User request; authoritative Muse read signal unverified                        | Native delivery from confirmed submission; preserve unknown read state.                                                                                                                                                 |
| Typing / agent working state                       | Observed assistant progress; user reports missing Beeper typing                | ACT-01; ephemeral, renewed and cleared with expiry.                                                                                                                                                                     |
| Product/search cards with images, prices and links | Observed                                                                       | Preserve accessible content and links without copying inactive controls as though actionable. Audit current flattening.                                                                                                 |
| Browser/tool activity cards and previews           | Observed                                                                       | Represent current status and useful preview/link when available; embedded remote controls are not standard Matrix chat controls.                                                                                        |
| Suggested responses / choice buttons               | Observed                                                                       | Preserve labels/context. Investigate safe supported interaction; do not silently execute arbitrary action text.                                                                                                         |
| Approval/confirmation prompts                      | Observed                                                                       | Keep approvals explicit in Muse unless a supported authenticated action API is available; never auto-approve.                                                                                                           |
| Assistant avatar/name                              | Observed Babar                                                                 | ID-01. Avatar should follow Babar, not the integration logo. Do not rename the user's account.                                                                                                                          |
| Main chat and side chats                           | Side-chat UI observed                                                          | Current adapter selects main chat only. Define per-conversation routing before extending; never mix their histories.                                                                                                    |
| History, time separators, unread state             | Observed / reported                                                            | HIS-01/02/03 with native timestamps and states where authoritative.                                                                                                                                                     |
| Links/previews and interactive embedded content    | Observed                                                                       | Use native supported formats plus an honest “Open in Muse” path for controls that Beeper cannot render.                                                                                                                 |

## Acceptance and handoff rules

For each row, record: source evidence, typed adapter representation, native Matrix
mapping or explicit limitation, synthetic regression, installed-extension test,
and Desktop/mobile observations. “Implemented” is not “verified.” Keep unsupported
interactive features visibly distinct from working controls; do not simulate
approvals by sending text. Add newly discovered Muse types to the inventory.

A steering message can change priorities without erasing this ledger. Before
ending a work session, update relevant statuses and concrete blockers here.
Detailed historical evidence lives in [validation](validation.md); reproducible
commands and report locations live in [development loop](development-loop.md).

## Latest implementation and blockers

The 0.8.4 work adds typed avatar capture and native avatar state updates, plus
explicit activity signals and bounded typing diagnostics. Focused regressions
cover avatar ambiguity, byte limits, metadata preservation, partial retry,
nonblocking capture and current versus historical activity. These are synthetic
fixtures, not a recorded DOM sample of the current Muse header.

The supported browser tool still lists the Muse tab but DOM inspection returns
`Debugger unattached`. The user-selected diagnostic file still reports an old
0.8.2 heartbeat with one held photo and one queued text. Do not infer current
queue state from that stale file or send another test until the dev driver passes.

Account investigation: the matching Desktop API account exists and is connected,
with provider `self-hosted`, type `bridgev2`, a login and no friendly network name.
The bridge already returns a Muse display name in authenticated provisioning
`whoami`; no registration or account was replaced during this investigation.
The [official account schema](https://developers.beeper.com/desktop-api-reference/typescript/resources/bridges/)
says the friendly network field may be omitted for unknown networks. This supports
a client discovery/display limitation, but does not prove how the Account screen
filters it. Naming and actual Desktop/mobile UI behavior remain open.

## September 14 follow-up: protocol recovery and saved source evidence

The saved Muse transcript from earlier authorized browser inspection contains
`aria-busy` on assistant message renderers and stable turn identifiers. 0.8.5
uses that scoped signal for the current assistant turn and excludes avatar
loading. The snapshot is partial and old; it does not include the composer/header
and does not prove present-day upload or avatar selectors. Live browser repair
was requested; the same `Debugger unattached` failure and stale log remain.

Regression tests exposed and now cover: unknown reactions erasing known ones;
re-additions/reverted edits reusing already-consumed event IDs; revisions reusing
original timestamps; and a lost removal/edit response being ignored when newer
source content matched the older saved state. Redactions and events now share a
durable delivery journal. Native client rendering remains a separate acceptance
step. No held user job was dismissed and no conversation test was sent.

The next rendering gap was headings/table structure and readable plain-text
fallbacks (addressed synthetically in 0.8.7 below). Corrected the
architecture table’s earlier claim about removed-image redaction: source deletion
semantics have not been established, and that behavior is not implemented.

## September 14 follow-up: source connection status

0.8.6 checks only the selected Muse tab every 20 seconds, with a five-second probe
limit and immediate invalidation on detach/navigation/transport loss. A ready
composer alone is insufficient: the source script must also be active and use the
current protocol. Busy or draft state remains connected, without implying delivery.
Fresh evidence lasts 30 seconds in provisioning; native status has a 90-second TTL.
The connection transport no longer renews an old status on its own. No message is
added to the conversation for a status transition. The user-selected log is still
stale and Muse browser inspection still returns `Debugger unattached`; actual
client rendering, the held photo and remaining parity items are not closed.

## September 14 follow-up: structured formatting

0.8.7 replaces worker regex stripping with a pinned HTML5 parser and a Matrix tag
allowlist. Headings, tables, continued list numbering and code language survive.
Plain text retains cell boundaries, numbering, nested list indentation and fenced
code. Active controls/scripts/foreign namespaces are dropped; links are restricted
to absolute HTTP(S) without embedded credentials. Unsupported styling is omitted.
Overly deep, numerous or expanded nodes fall back to the original plain body.
Regression tests use synthetic HTML, not private transcript copies.

Browser inspection again returned `Debugger unattached`; the selected diagnostic
export is still stale. The actual Muse type inventory is not exhaustive. Image
upload, avatar, typing, native offline banners, historical ordering, connector-card
decoration and installed-client formatting remain open. No user job was touched.

## September 14 follow-up: disconnected account and diagnostics

The user's Desktop screenshot shows a disconnected account with a legacy probe
name. A read-only check confirmed that it is the current extension registration,
not an obsolete test account. The Desktop API currently reports `disconnected`
with the source-specific message "Muse is disconnected. Open Chrome and connect
your Muse tab." This verifies a native Desktop warning, but not its precise cause,
server expiry, mobile behavior or recovery. Do not remove the active registration
to clean up its name. ID-03 also tracks replacing technical account naming with
supported friendly metadata.

0.8.8 bounds diagnostic observation without restarting pending reads. The selected
file has a separate collection heartbeat and update stage; unavailable health is
not replaced with empty queue counts. Only authenticated top-level connection-page
diagnostic requests bypass the update work guard. Real message operations and
source preparation remain guarded. Tests cover stalled reads, late completion,
privacy, update progress and refusal to send from incomplete/inconsistent state.
These paths could explain stale diagnostics or deferred updates; they have not
been established as the cause of this installation's failure.

The selected live log still ends at 0.8.2. Newer files on disk do not establish the
running build. No uncertain image was retried, no held job dismissed and no live
conversation test sent. Fresh runtime evidence, source inspection and the rest of
the parity inventory remain required.

## September 14 follow-up: live diagnostics restored and upload filters

After the user enabled file updates, the chosen export refreshed to the exact
0.8.8 build. Both connections are ready; queued, claimed, blocked and pending counts
are zero. Native Desktop account status also changed from disconnected to connected.
The earlier held photo is no longer present in queue counts; that does not establish
whether it was delivered or dismissed. No existing user job was modified here.

The first live driver text send returned HTTP 500 / TOOL_EXECUTION_ERROR. Desktop
logs show the sendMessage tool failed, and getChat independently returns the same
error class. Chat listing and message search still work. A 45-second read-only
observation found no matching round trip or delivery confirmation. The test's
private send record remains open; no resend or photo test was attempted.

Fresh source-readiness evidence reports one file input in the isolated composer
region, zero MIME-recognized image inputs and no existing preview. The old adapter
required the substring image/ and did not support standard extension-only or empty
accept filters. 0.8.9 matches MIME, image/* and filename-extension filters against
the actual image, accepts unrestricted composer pickers, and rejects incompatible
or disabled inputs. Tests cover these filters, ambiguity and unchanged draft and
preview protections. Actual photo submission still needs live verification.

Avatar-source-missing is now visible in current logs. Browser DOM inspection still
returns Debugger unattached, so the avatar selector and full rendering inventory
remain open. Fresh diagnostics are restored; the broader development loop is not
yet a passed end-to-end test.

During the automatic update attempt, the chosen log stopped advancing again after
21:50:15 UTC (last runtime 0.8.8). The update's completion and file-grant retention
are unverified. A fresh connection-page status is needed to distinguish lost file
permission from a stopped or duplicate connection document. Do not treat the last
healthy snapshot as current readiness.

## September 14 follow-up: Desktop send preflight

The selected export confirmed the exact 0.8.9 build after file permission was
renewed, then stopped at 22:04:35 UTC. The user's subsequent Muse connection is
not yet visible in that export. Current Desktop account status is connected.
Do not interpret old source-disconnected state or queue counts as current.

Both the canonical chat ID and the local ID returned by chat listing produce
HTTP 500 from get-chat. Read-only inspection of the installed Desktop code shows
that get-chat and send use per-chat platform calls, whereas listing/search have
other retrieval paths. This narrows the failure but does not establish its root
cause. No installed app code was changed.

The development driver now checks per-chat retrieval and pinned identity before
any test upload/send. Its doctor reports this prerequisite separately; read-only
observation remains available when that prerequisite fails. Synthetic regression
tests cover working listing with failing retrieval, changed participants, wrong
chat, malformed responses and read-only rooms. The live doctor detects this
installation's failure without sending. Photo delivery, avatar and typing remain
open; the earlier uncertain test journal is retained.

After the user quit and reopened Beeper Desktop, the same driver's identity,
message-search and per-chat retrieval checks all passed. Restarting cleared this
API failure; the underlying cause is still unknown. The diagnostic file remains
stale, so current Muse readiness and queue state are not yet established.

## September 14 follow-up: live text delivery and update recovery

With fresh 0.8.9 diagnostics, idle source and empty queue, a new uniquely marked
text test reached Muse and returned the expected reply in Beeper. The previous
HTTP-500 test journal was archived as unverified after read-only observation; its
prompt was not replayed. The new test initially lacked native delivery evidence.

Installed Desktop source shows its status mapper requires a timestamp from
`content.ts`; our status events omitted it. Version 0.8.10 persists a timestamp
per status transition, sends the event as the Muse bot with its bridge identity,
and keeps transaction IDs/timestamps stable across retries. Saved confirmed jobs
receive corrected status metadata without another prompt submission. After the
automatic local update, the **same text test passed both round trip and native
delivery** through the Desktop API. Visible Desktop/mobile status rendering is
still unverified.

The automatic update kept the diagnostic file updating but lost the selected Muse
connection. The reconnect validator expected a 36-character hyphenated UUID;
[Chromium's document-token parser](https://github.com/chromium/chromium/blob/main/extensions/browser/extension_api_frame_id_map.cc)
accepts 32 hex characters. The corrected validator preserves the exact token and
still rejects malformed, zero and expired tickets. Live selected-tab recovery
and the photo cycle remain to be verified.

The live text attempt emitted typing-accepted and typing-cleared diagnostics.
Those establish source/transport activity, not a visible typing animation.
Avatar-source-missing remains in fresh logs; Babar's avatar is still open.

## September 14 follow-up: photo handoff

A live 0.8.10 photo test started from fresh connected/ready diagnostics with no
outstanding work. Beeper accepted the encrypted image and the source adapter
reached image-upload-start, then image-input-changed roughly 260 ms later. The
Desktop API reported native FAIL_PERMANENT; there is no verified photo submission
or image-aware response. The guard covers a cleared/replaced file input or changed
composer/draft, so the log alone does not identify which condition occurred.
The synthetic photo job remains held and its test journal open. No user job or
staged photo was dismissed; no new text was sent behind the held attachment.

Version 0.8.11 handles a cleared/replaced picker only when the sole loaded local
preview matches the original upload bytes. Fetches are bounded by the original
size, use only allowed local blob/data URLs, and time out. After any asynchronous
work the same composer, preview URL/node, caption, file selection and Send state
are rechecked. Tests reject wrong/truncated/oversized bytes, foreign remote
previews, new files, user drafts and preview changes while entering a caption.
This is synthetic coverage; successful live photo delivery remains open.

The 0.8.10 → 0.8.11 local update completed automatically. Fresh export fingerprint
38783b35a3a456931d82ed2498e18357e18a15cb6ca23eeeb16aeab63eefbe18
shows Beeper and Muse connected, ready composer, zero queued/claimed/pending jobs
and one held job. The new source reports zero existing files and previews. This
verifies selected-document recovery and continuing file logging for this update;
it does not establish why the first upload changed its picker or prove a photo
was submitted. The user has been asked to dismiss only the synthetic test job
before another test; no dismissal or resend was automated.

## September 14 follow-up: actual composer boundary (0.8.12)

The user's dismissal was confirmed in fresh diagnostics. A new journaled 0.8.11
photo attempt reached upload-start, then timed out after 60 seconds. Readiness
found one picker, no selected file, no preview and no Send button in the monitored
region. Native failure was confirmed; no successful submission or response was
observed. This new synthetic job is held, and no subsequent text was sent.

A newly opened Muse tab restored supported browser DOM inspection. The live
composer has an explicit data-hatch-composer-chrome wrapper. Its inner container
holds the picker and textarea, while action controls are siblings outside that
inner container. The old discovery stopped at the inner container. Version 0.8.12
uses the explicit wrapper, rejects transcript/shared-composer boundaries, and
retains the older bounded fallback. Synthetic tests cover sibling previews/actions
and rejection of a marked transcript ancestor. This fixes an observed boundary
error; it does not prove why Muse cleared the upload or establish live delivery.
Avatar and typing verification, the full rendering inventory and both-direction
photo acceptance remain open. No held job was dismissed automatically.

The automatic local update is live: fresh 0.8.12 diagnostics confirm the exact
packaged build, both connections, continued file logging and the held job. The
corrected region now reports two image elements and one Send control where the
old region reported zero of each. These counts do not identify the images, but
they confirm the boundary changed actual observation. Inspect and remove only
leftover synthetic test attachments before dismissing that test and trying again.

## September 14 follow-up: photo reached Muse; echo parsing (0.8.13)

Fresh diagnostics confirmed dismissal and an empty queue. One new 0.8.12 photo
was sent: upload-start, image-submitted and typing-accepted were observed, then
reply-attribution and native failure. Live read-only browser inspection found the
exact uniquely marked prompt with its image and Muse's correct RED answer. The
caption did not disclose that color. This verifies Beeper-to-Muse image delivery
and interpretation for that attempt. Subsequent read-only dev:observe confirmed
the correct reply in Beeper (roundTrip=true) but nativeFailure=true and
nativeDelivery=false. No resend or subsequent text was attempted.

The source message owns a chat_media_click media button beside its caption
bubble. The parser only read images within the bubble. Version 0.8.13 includes
these owned user-media siblings, keeps captions unchanged and excludes unrelated
sibling decoration or assistant cards. A matching caption without image evidence
now waits rather than throwing an unrelated-message error. Different or multiple
new user messages still fail attribution. Regression coverage uses a synthetic
version of this observed layout. The submitted test remains held and its journal
is retained; parser changes must not resubmit it.

The 0.8.13 local update automatically reconnected and retained fresh diagnostic
logging and the held submitted job. No replay occurred. The fix's new-attempt
native SUCCESS and post-photo text checks await dismissal of that test.

Read-only inspection also explained ID-01: the named Babar avatar is an autoplaying
video, not an img element. Its aria-labelled data-hatch-avatar-interaction wrapper
owns a video marked data-hatch-media-owner=avatar-layer and slot=current. The
image-only avatar selector therefore cannot find it. Next: support a bounded,
cached still frame from the uniquely identified current avatar, preserve original
image support, and verify the resulting native chat avatar. Do not infer typing
from avatar animation. No avatar implementation is claimed by this entry.

## September 14 follow-up: image-first message surfaces (0.8.14)

After confirmed dismissal and a clear queue, one new 0.8.13 photo reached Send
but failed reply-attribution. Live browser inspection again showed the exact
marked photo caption and correct undisclosed RED answer. The 0.8.13 fix was
incomplete: the media button itself has the same bubble class as the caption,
so selecting the first bubble found the image but omitted the prompt text.
No resend or following text was attempted; the submitted test is held.

Version 0.8.14 collects all owned top-level bubble surfaces in DOM order. Nested
surfaces are not counted twice. The regression reproduces the observed media
button first and caption div second, plus nested and multiple assistant bubbles.
The prior sibling-media regression remains in place. Actual native SUCCESS and
post-photo text acceptance still require a fresh live test after safe dismissal;
passing synthetic coverage alone does not close REL-01/REL-03.

Read-only Desktop observation confirmed that this test's correct reply also
returned to Beeper (roundTrip=true). Native failure remains; it was not resent.

## September 14 acceptance: photo followed by text (0.8.14)

After the user dismissed the already submitted failed test, fresh diagnostics
confirmed the exact 0.8.14 build, both connections, ready source and zero queued,
claimed, blocked and pending work. A new synthetic image test passed:
roundTrip=true, nativeDelivery=true, nativeFailure=false and duplicate=false.
Its undisclosed color was correctly identified. The driver archived that success.

The next text test waited for the photo job to finish its source capture and
release its claim. It then passed both exact reply and native delivery without
another user action. Preflight refusals while a claim was still present did not
send messages. No uncertain prior photo was replayed. These are live Desktop API
and source observations; client animation, notification suppression and original
timestamps are not established by them. A separate generated-image test is underway.

## Reverse-image investigation and diagnostics (0.8.15)

The generated-image test's marked text reply reached Beeper with native SUCCESS.
Browser inspection found a separate image message in that same Muse turn, but
Desktop's recent message list did not show that image. The strict automatic
checker also requires media on the marked reply itself; its unverified result
must not be treated as either a passed image test or definitive transport failure.
The active test journal remains open and no generation prompt was resent.

Image preparation previously swallowed fetch, format and size failures while
retaining only the source URL. Version 0.8.15 reports fixed diagnostic codes for
those cases and successful preparation, without identifiers, URLs or contents.
Synthetic tests cover the error distinctions and successful data preparation.

After the automatic 0.8.15 update, fresh logs showed image-prepared and Desktop's
message list gained an assistant image after the marked reply. No generation
prompt was replayed. This is partial recovery evidence, not a passed autonomous
reverse-image test: the delay/reload dependency is unexplained, and Desktop's
numeric message IDs do not expose the deterministic Matrix/source IDs used by
the attempted correlation check. Retain the active generation journal and
investigate automatic image retry/association before claiming full parity.

## Reliable image delivery work (0.8.16)

Code inspection established two loss paths: the tracker remembered a source hash
following an import even when image preparation retained only a URL, and reply
completion likewise remembered incomplete media. Because source hashes exclude
prepared bytes, those sources could remain skipped until a rescan.

The tracker now retries unchanged incomplete images with 2–30 second backoff.
After three failed attempts it publishes the existing unavailable-image fallback
before later text, while continuing media retries. This bounds the wait so a
permanently inaccessible attachment cannot freeze the transcript. Reply completion acknowledges only prepared
assistant media; pending images remain for background sync without repeating the
prompt. Regressions cover unchanged-source recovery, backoff, exactly one import,
subsequent order and reply completion excluding unfinished images. This addresses
proven code paths, without claiming they explain every prior live omission.

The observed generated-image control's own title now supplies missing alt text.
The receive-image test requests its unique marker in that description and still
requires an actual image attachment on the marked message; unrelated adjacent
images cannot pass. Live no-rescan verification is the next acceptance gate.

### Live test and avatar follow-up (0.8.16)

The no-rescan request completed with native SUCCESS and no held work, but Muse
returned a JSON artifact card instead of a generated picture. The strict checker
did not pass. This is not evidence of successful image transport. The original
connected source was not reloaded or rescanned during observation. Its code-file
icon was incorrectly eligible as photo media; that observed decoration is now
excluded, with a regression fixture. The rendering inventory remains open for
other card types.

Animated-avatar support now selects the unique current, ready video in the named
assistant's avatar wrapper. It copies a decoded frame at at most 256 pixels,
without seeking or changing playback, and caches it for that source URL. Missing
frames and canvas security errors retry later; ambiguous identities are refused.
Tests cover size bounds, readiness, failure recovery, caching and ambiguity.
Installed avatar display still needs verification after the next local update.

The installed avatar update emitted avatar-updated. Read-only Matrix requests
confirmed both room and bot avatar state, and a native Beeper Desktop window
capture visibly showed Babar's elephant in the chat list and the Muse chat header.
The current video frame therefore reaches the client; cross-restart persistence
and mobile display remain broader acceptance cases.

A second, uniquely marked generation request produced a real inline image in
Muse. Its marked caption and native SUCCESS reached Desktop, but the exact image
Matrix event returned M_NOT_FOUND before any source refresh. The retry fix alone
does not resolve this source-discovery gap. No generation request was replayed.
Added bounded source-message/image/partial counts, tracker progress and import
failure events to the chosen diagnostic file; message data remains excluded.
The source update retained the completed test journal for observation. Initial
counts show the source tracker finishes its 20 eligible entries, so investigate
which current media observations are omitted rather than assuming transport loss.

## Post-merge evidence (0.8.16 / PR 30)

PR 30 merged after all six Linux/macOS CI checks passed (225 TypeScript tests,
Go tests/build, type checks and formatting). The installed build remains connected
with no held work. A new text round trip passed both exact reply and native SUCCESS.

The source-driven text request emitted typing-accepted followed by typing-cleared
about one second later. The diagnostic-file-triggered captures occurred after the
reply was already visible; they do not establish visible source-driven typing.
A separate controlled native typing request to the same room/bot visibly showed
both the typing label and dots in Desktop; the subsequent clear removed them.
Thus native client rendering is verified. Capture a longer actual Muse task before
closing source-to-client timing and mobile acceptance.

Source-readiness before a later text request reported 43 entries, four extracted
images, 22 partial observations, and zero images/zero partials/one widget among
the last three entries. The tracker completed all 20 eligible entries. This
narrows the missing generated-image issue to discovery in the selected source;
its inspection tab shows a real generated-image button for that same turn.

A temporary reaction was added and removed on the synthetic reply through the
controlled inspection tab. That source UI change was confirmed. It did not become
visible in Desktop during observation, and the homeserver's relation-list route
returned M_UNRECOGNIZED, so the add/change/remove native acceptance is not passed.
The controlled tab is not the extension's selected source; distinguish cross-tab
Muse update propagation from reaction parsing before changing the mapping. The
temporary reaction was removed in the inspection tab; no user message was edited.

## Source visibility and oversized generated images (0.8.17)

Supported browser control can claim the existing selected Muse tab; earlier
reports that only a separate inspection tab was accessible were incomplete.
Claiming that tab made it visible. The previously empty generated-image widget
then mounted a 1600-by-1600 image. Without resending the prompt, diagnostics
subsequently reported image-too-large: the 2 MB preparation limit is a second,
concrete obstruction after source rendering. Foregrounding alone did not prove
delivery. Background rendering remains an acceptance case, not a completed fix.

The new preparation path preserves small originals and compresses oversized
still PNG/JPEG sources to WebP within the existing per-image/message limits.
Downloads remain bounded at 20 MB; conversion caps output dimensions and attempts,
closes decoded bitmaps, and avoids flattening animations. Fixture tests cover
bounded compression, remaining message budget, cleanup and oversized animations.
Live delivery on the installed update is pending.

A temporary reaction added on the actual selected source changed the native
Desktop chat preview to "You loved" the exact synthetic reply. It was removed
through that same Muse source. This is stronger add evidence than the earlier
inspection-tab experiment; visible bubble and removal acceptance remain open.

### Live no-rescan image acceptance (0.8.17)

After the automatic update, the previously missing generated image's exact
Matrix event exists and is encrypted from the Muse bot. A fresh uniquely marked
image-generation request then passed without a refresh, rescan or resend:
roundTrip=true, nativeDelivery=true, duplicate=false, nativeFailure=false. The
source exposed an actual 1920-by-1280 image, image-compressed/image-prepared were
logged, and Desktop's native image attachment retained the marker in fileName.
The development checker now reads the pinned timeline for image-only messages
omitted by search and matches the attachment's own description. Separate nearby
text cannot satisfy the image test. Regression coverage rejects unrelated files,
images and foreign-chat responses. The completed test was archived with no held work.

The same actual Muse request emitted typing-accepted and typing-cleared about
12 seconds apart. A native Desktop capture during that interval visibly shows
"typing" beneath Muse's header (behind an open image viewer); the later capture,
after closing the viewer, shows the label cleared. This establishes source-driven
Desktop appearance/clear, beyond the earlier controlled protocol test. Mobile
visual behavior remains unverified. The connected Muse tab stayed visible for
this image acceptance; rendering deferred in background tabs remains a limitation.

### Native reaction add/remove and merge confirmation

On the actual selected Muse source, a temporary heart on the latest synthetic
caption produced a verified m.reaction event: the sender was the owner, its
annotation targeted the exact caption event, and it was initially unredacted.
After removing the reaction in Muse, that same native event had redacted_because
and no remaining relation content. No test reaction remains. This establishes
native add/remove mapping; client bubble appearance, replacement and assistant
acknowledgements remain separate checks.

The caption's rendered source contains no time element or timestamp/date
attribute. Continue using the explicit observed-time fallback; never infer the
original time from unrelated interface state. History order and quiet catch-up
remain open for installed-client acceptance.

PR 31 merged as 58265ee after all six Linux/macOS CI checks passed. Local
validation passed 229 TypeScript tests, type checks, Go tests/build, formatting,
and the public extension package. The installed 0.8.17 build passed the fresh
no-rescan generated-image check; the driver automatically archived that result.

## Image timeline identity (0.8.18, implementation pending live acceptance)

The previous runtime created an extra "Image" text event for image-only sources,
then appended a separate native photo event. A delayed preparation could therefore
put the photo after later conversation messages. New image-only imports now use
one source event; unavailable-image fallback recovery edits that same event into
a native image. Reactions continue to target the same event. Existing legacy
image event IDs remain unchanged. Caption changes preserve native image content.
Message updates request no new notification and do not assert that the user read
the chat. New messages retain their existing live/history notification policy.
Regression tests cover delayed recovery, later text, original timestamp retention,
reaction targeting, preview loss and caption edits. Installed-client acceptance
is still required; unrelated late-loaded history insertion remains open.

### Single-image native acceptance (0.8.18)

A fresh generated-image request passed automatic native attachment and delivery
checks without refresh, rescan or resend. The image-only source has exactly its
primary encrypted Matrix event; the old separate image-event ID returns
M_NOT_FOUND. Desktop reports one matching image attachment. Native sort keys
place the prompt, caption and image in source order; the caption and image share
the source-observation time, and the owner's original send time is retained.
This verifies new-message identity and order, not delayed fallback replacement
rendering or old-history insertion. All 232 TypeScript tests, type checks, Go
checks, formatting and packaging passed.

### Quiet catch-up and reconnect acceptance (0.8.18)

With the selected Muse source disconnected, one synthetic exchange was created
in another Muse tab. Neither message reached Beeper until the selected source
returned. Both then arrived in source order; the assistant reply was already read
and Desktop unread count remained zero while Beeper was in the background.
A subsequent source reload retained exactly the same two native message IDs,
timestamps, sort keys and read state. No duplicate exchange appeared. This
verifies bounded missed-message catch-up and reconnect stability, not arbitrary
older-history insertion or operating-system notification banners.

The [Matrix replacement specification](https://spec.matrix.org/latest/client-server-api/#validity-of-replacement-events)
explicitly allows changing a message's msgtype through an edit. The image fallback
recovery therefore fits the protocol; delayed text-to-image rendering in the
installed client still needs verification. Fresh image delivery already passed.

### Delayed replacement compatibility and repeat delivery (0.8.18)

A controlled native protocol test sent a synthetic text placeholder, then edited
that exact event into a blue PNG. Desktop returned one image attachment under
the same native message ID, timestamp and sort key. This proves Desktop accepts
the cross-msgtype replacement used by delayed image recovery. The fixture was
unencrypted and did not exercise the installed runtime's encrypted recovery
path; no source message was replayed and no device or room was created.

A further installed-runtime generated-image test passed automatically without
rescan, duplicate or native delivery failure. Although the other Muse tab was
being used, diagnostic observations still reported the selected source visible.
This is another visible-source pass, not background-tab acceptance.

A subsequent native Desktop screenshot visibly confirms the new generated cat
image and the blue replacement image in the conversation, with Babar's elephant
avatar in the header. The replacement is marked Edited and remains after the
generated-image exchange. This adds actual client rendering evidence to the
attachment API checks above; it does not change the background-tab limitation.

### Background acceptance guard

The development runner now accepts `receive-image --background`. It refuses a
send without a fresh hidden-source sample and persists visibility observations
with the existing send journal. Native image delivery cannot pass this scenario
until a subsequent hidden sample arrives. Visible/unknown samples or diagnostic
gaps invalidate background acceptance permanently for that run. Repeated
observations do not count as new evidence, and `dev:observe` never resends.

Seventeen focused development tests passed, including stale/future/unknown
samples, delivery timing, coverage gaps and journal recovery. The installed
0.8.18 diagnostic reported visible and the live preflight correctly refused to
send. A real hidden-tab run is pending the requested manual tab switch; this
guard improves verification and does not itself fix source rendering.

### Independent Chrome tab diagnostics (0.8.19)

After the requested tab switch, fresh page observations still reported visible
and focused. The runtime now adds `sourceTabActive` from Chrome's authenticated
message sender, separately from the DOM signals. Page-provided values cannot
override it; missing Chrome state remains unknown. This distinguishes actual
tab selection from a possible debugger visibility override without changing
source visibility, focusing tabs or reading browser profiles.

All 237 tests and full local checks passed. Actual background acceptance still
requires consistent live evidence; this diagnostic change does not assert that
the source's background rendering has been fixed.

The installed 0.8.19 update reconnected automatically. Fresh diagnostics then
showed `sourceTabActive=false` together with `sourceVisible=true` and
`sourceFocused=true`: the user's tab switch had worked, but page visibility
remained overridden. The background runner now requires both inactive Chrome
tab state and hidden page state. Temporarily disabling computer use was requested
to release inspection; no additional image prompt was sent during diagnosis.

### September 15: real hidden-tab reproduction (0.8.19)

After Chrome restarted with computer use disabled, fresh diagnostics agreed:
page hidden, Chrome tab inactive, page unfocused. One journaled generated-image
request was submitted under the background guard. Native delivery was confirmed
and the text reply completed, but repeated hidden samples over several minutes
showed an image presentation with two child elements and no image element. No
image attachment had arrived in Beeper. Queue, claimed, blocked and pending-key
counts returned to zero. The same test remains available for observation without
resending its prompt. This reproduces the source-rendering gap without browser
inspection's visibility override; it does not establish a permanent media error.
Computer use was requested again to inspect the same source card and diagnose
its deferred rendering.

### Deferred image diagnosis and mitigation (0.8.20)

Reattaching browser inspection made the same image presentation expose its image.
The existing journal then confirmed native attachment delivery without refresh,
catch-up or resend. The background verdict correctly remained failed. The live
DOM had a source-owned image presentation containing a loading skeleton, with no
image URL to capture while hidden. Public frontend script inspection showed its
media resolution depends on Muse's file/connection layer; we did not call private
application APIs, read app state, or extract credentials.

The adapter now carries that observed loading state through the typed contract.
After bounded settling/retry, the bridge emits an explicit loading placeholder
before later messages. The first available image replaces that same primary
event quietly, preserving the first observation time. A subsequent skeleton
cannot downgrade an already delivered photo. This is a mitigation for missing
content and ordering, not a fix for Muse's hidden-page loading itself. No tab
focus override, new permission, or companion process is added to the product.

Focused tests passed for skeleton detection, unrelated-widget exclusion, delayed
recovery, subsequent text, stable timestamps and quiet native replacement.
Installed acceptance of the new pending-image path remains to be checked.

The first installed pending-image check also exposed delayed content polling in
hidden Chrome tabs. The worker's existing four-second activity pulse now invokes
the same guarded sync poll as the page timer. Tests cover progress without page
intervals, no overlapping claim, and no send after stopping the source. The
product still leaves Muse's own visibility and media loading policy unchanged.
All 241 tests and the full Go/type/format checks pass.

### Installed deferred-image recovery acceptance (0.8.20)

One fresh test reproduced the hidden, inactive, unfocused source with an image
skeleton and no image element. Beeper received the explicit loading placeholder.
After opening that same Muse tab, the image replaced the placeholder under the
same Desktop message ID, timestamp and sort key. A native Desktop screenshot
shows the recovered picture marked Edited after its prompt and caption. No
rescan or repeated prompt was used. Queue, claimed, blocked and pending-key
counts are zero. This exercises the installed encrypted recovery path, beyond
the earlier controlled unencrypted replacement test.

The receive-image background verdict remains failed: an observation gap exceeded
the conservative coverage limit, and the image ultimately required a visible
source. We did not relax that guard or claim uninterrupted background delivery.
The final installed build includes worker-driven polling; the fully hidden image
loading limitation remains open. Restoring natural focus via the supported CDP
capability was independently confirmed by fresh hidden/inactive diagnostics, and
read-only CDP DOM inspection preserved that hidden state. Future investigations
can use this without repeated user restarts.
