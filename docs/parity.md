# Muse / Beeper parity ledger

This is the persistent work list for the integration. New requests add to this
list; they do not replace unfinished work. Last updated: September 14, 2026.

**Target:** preserve Muse's conversation content, identity and state in its Beeper
chat as faithfully as the supported protocol allows. Keep source parsing behind
the typed Muse adapter so an official Muse API can replace DOM access later.
The product remains Chrome-only. Maintainer test tools are optional.

## Current priorities

1. Complete the live iteration loop. Beeper Desktop's API recovered after restart.
   Fresh 0.8.9 diagnostics allowed a new text test; its round trip passed. After
   the 0.8.10 status fix, that same test also reports native delivery. Automatic
   reload, diagnostic-file retention and selected-tab recovery were verified
   during the 0.8.10 → 0.8.11 update; the held photo job stayed held.
2. Finish photo confirmation. A fresh 0.8.12 image was submitted and Muse returned
   the correct undisclosed test color, verified through live browser inspection.
   The bridge incorrectly rejected its caption because the image was a sibling
   outside that text bubble. Version 0.8.13 parses that media control and waits
   for delayed image evidence. The correct reply returned to Beeper through sync.
   Native success and post-photo text remain open;
   the already submitted test is held and must not be replayed.
3. Verify the new Babar avatar synchronization and diagnose missing typing indicators.
4. Verify both-direction photos and native delivery status end to end.
5. Work through the rendering/type inventory below; inspect actual source support
   before claiming the inventory is exhaustive.

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

| ID      | Report / desired behavior                                         | Implementation and evidence                                                                                                                                                                                                    | Status / next acceptance                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01  | Incoming Beeper photo never reached Muse                          | Media download/decryption works; live attempt interrupted. Readiness shows composer has no native form. 0.8.3 removes that assumption with bounded container discovery.                                                        | **Open.** Confirm actual input, preview, submission and correct image-aware response.                                                                                                                |
| REL-02  | Interrupted photo blocks later text                               | 0.8.2 lets known pre-upload failures release later work. Unknown old attempts remain held and visible.                                                                                                                         | **Partial.** Verify recovery of the existing held job and subsequent text. Never auto-retry it.                                                                                                      |
| REL-03  | Beeper says Sent without confirmed delivery                       | Native PENDING/FAIL_PERMANENT/SUCCESS events implemented; success waits for a matched source echo and reply.                                                                                                                   | **Open live verification.** Confirm pending/failure/delivered states in Desktop and mobile, not just HTTP acceptance.                                                                                |
| REL-04  | Too much manual testing and relaying errors                       | Typed Desktop API driver, send journal, sanitized reports, local updater and chosen log file implemented. File grant and fresh 0.8.2 heartbeat observed. Logging later became stale during update attempt.                     | **Partial.** Complete unattended build → reload → heartbeat → text/photo/text cycle; verify file grant survives updates.                                                                             |
| REL-05  | Connect button appears to do nothing / misleading Connected state | Separate Beeper/Muse states, queue information and error descriptions implemented.                                                                                                                                             | **Partial.** Exercise stale scripts, disconnected source, held queue and reconnect UI. Connected transport must not imply successful delivery.                                                       |
| ID-01   | Chat avatar should match Muse                                     | User explicitly chose **Babar's Muse assistant picture**, not the extension icon. Live Matrix reads show neither room nor bot avatar set.                                                                                      | **Implemented, not live verified (0.8.4).** Typed profile sync, native metadata, deduplication and partial retry tests added. Verify actual Babar selection, client display and restart persistence. |
| ID-02   | User messages show “You in Muse:” instead of native identity      | Native owner identity implemented; user confirmed You/Them alignment improved. Surrogate transcript prefixes removed.                                                                                                          | **Partially verified.** Recheck live photo captions and catch-up without added author prefixes.                                                                                                      |
| ID-03   | Muse (Chrome) absent as another Account                           | Desktop API lists the chat's account as connected, provider self-hosted, type bridgev2, with a login but no friendly network name.                                                                                             | **Open.** Determine supported naming/discovery metadata and confirm the Account UI. Do not claim the account is absent from the backend.                                                             |
| ACT-01  | Typing indicators do not show                                     | Live Matrix typing=true and false requests accepted. 0.8.5 reads the current assistant message renderer’s busy flag found in a saved Muse page. Source/transport logs and expiry remain in place; client rendering unverified. | **Open live verification.** Check the new source/transport logs and visible typing/clearing in both clients. Investigate room-feature advertisement without claiming unsupported outbound actions.   |
| ACT-02  | Reactions / acknowledgments rendered as message text or omitted   | 0.8.5 preserves unknown reaction state, validates complete observations and journals removals. Re-additions use fresh event IDs. Live cases remain unverified.                                                                 | **Open live verification.** Add/change/remove own and assistant reactions without text pollution; never convert reaction acknowledgments into read receipts.                                         |
| HIS-01  | Catch-up misses recent/older messages                             | Source-ID deduplication and loaded-message catch-up implemented, with partial observations protected.                                                                                                                          | **Open.** Compare a bounded known transcript, repeated catch-up, virtualized items and reload recovery. Full account history is not currently imported.                                              |
| HIS-02  | Notifications for already-read catch-up                           | Historical notification-suppression flags and read state implemented.                                                                                                                                                          | **Open live verification.** Observe OS/client notifications; do not infer banner suppression from request flags.                                                                                     |
| HIS-03  | Timestamps may be wrong                                           | Original events preserve machine-readable source times or first observation time. 0.8.5 gives revisions increasing observation timestamps instead of reusing the original time.                                                | **Open.** Compare known source times/timezones and chronological ordering; never invent an original time.                                                                                            |
| UI-01   | Local extension needs icon, auto popup, close warning             | Extension icons, popup offer and Chrome before-unload guard implemented.                                                                                                                                                       | **Partial.** Retest update/reconnect and close behavior. Browser controls the warning wording and may require page interaction.                                                                      |
| ARCH-01 | Chrome-only product and clean future API swap                     | Chrome runtime and source-neutral TypeScript contracts implemented.                                                                                                                                                            | **Maintain.** No companion daemon or disk IPC in the product; new source features stay behind the adapter.                                                                                           |

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
