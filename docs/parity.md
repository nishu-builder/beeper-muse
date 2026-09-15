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

## Additional open reports

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
A newly opened Muse tab now supports live DOM inspection; see the [investigation log](history/parity-2026-09.md).

## User-reported issues

| ID      | Report / desired behavior                                         | Implementation and evidence                                                                                                                                                | Status / next acceptance                                                                                                                                |
| ------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01  | Incoming Beeper photo never reached Muse                          | **Live verified in 0.8.14:** synthetic PNG received and interpreted correctly by Muse; exact reply returned to Beeper with native SUCCESS.                                 | Broaden formats, sizes and multiple-image coverage; do not claim all attachments are verified.                                                          |
| REL-02  | Interrupted photo blocks later text                               | User dismissed the earlier held attempts. A fresh 0.8.14 photo and subsequent text both passed with native SUCCESS; the completed photo released its queue claim.          | Successful photo → text verified. Ambiguous interrupted sends remain held for inspection, without replay.                                               |
| REL-03  | Beeper says Sent without confirmed delivery                       | Live photo and text tests in 0.8.14 each returned exact replies and native SUCCESS naming Muse as the delivered recipient. Earlier failed attempts exposed native failure. | Native API status verified for these cases; visible Desktop/mobile pending and delivery labels still require observation.                               |
| REL-04  | Too much manual testing and relaying errors                       | Typed Desktop API driver, send journal, sanitized reports and local updater implemented. Automatic updates and continued logging observed through 0.8.21.                  | **Partial.** Complete unattended build → reload → heartbeat → text/photo/text cycle; verify file grant survives updates.                                |
| REL-05  | Connect button appears to do nothing / misleading Connected state | Separate Beeper/Muse states, queue information and error descriptions implemented.                                                                                         | **Partial.** Exercise stale scripts, disconnected source, held queue and reconnect UI. Connected transport must not imply successful delivery.          |
| ID-01   | Chat avatar should match Muse                                     | Babar's animated avatar is captured as a still frame. Native room/profile state and Desktop list/header show the elephant.                                                 | Desktop verified. Mobile and restart persistence remain separate checks.                                                                                |
| ID-02   | User messages show “You in Muse:” instead of native identity      | Native owner identity implemented; user confirmed You/Them alignment improved. Surrogate transcript prefixes removed.                                                      | **Partially verified.** Recheck live photo captions and catch-up without added author prefixes.                                                         |
| ID-03   | Muse (Chrome) absent as another Account                           | Desktop API lists the chat's account as connected, provider self-hosted, type bridgev2, with a login but no friendly network name.                                         | **Open.** Determine supported naming/discovery metadata and confirm the Account UI. Do not claim the account is absent from the backend.                |
| ACT-01  | Typing indicators do not show                                     | Real Muse generation emitted typing and cleared it about 12 seconds later. Native Desktop captures show appearance and clearing.                                           | Desktop verified. Mobile display remains unverified.                                                                                                    |
| ACT-02  | Reactions / acknowledgments rendered as message text or omitted   | A reaction added on the selected Muse source created a native owner m.reaction on the exact message; removal redacted it. Temporary test reactions were removed.           | Add/remove protocol verified. Bubble appearance, replacement and assistant acknowledgements remain open.                                                |
| HIS-01  | Catch-up misses recent/older messages                             | Source-ID deduplication and loaded-message catch-up implemented, with partial observations protected.                                                                      | **Open.** Compare a bounded known transcript, repeated catch-up, virtualized items and reload recovery. Full account history is not currently imported. |
| HIS-02  | Notifications for already-read catch-up                           | A bounded missed exchange arrived already read with Desktop unread count zero while Beeper was backgrounded; reconnect retained that state.                                | Native read/unread behavior verified. OS banners and mobile notifications were not directly observed.                                                   |
| HIS-03  | Timestamps may be wrong                                           | Native catch-up timestamps and sort keys stayed unchanged across reconnect. The inspected Muse DOM exposes no original timestamp for these messages.                       | Observed-time stability verified. Original history times remain unavailable; do not fabricate them.                                                     |
| UI-01   | Local extension needs icon, auto popup, close warning             | Extension icons, popup offer and Chrome before-unload guard implemented.                                                                                                   | **Partial.** Retest update/reconnect and close behavior. Browser controls the warning wording and may require page interaction.                         |
| ARCH-01 | Chrome-only product and clean future API swap                     | Chrome runtime and source-neutral TypeScript contracts implemented.                                                                                                        | **Maintain.** No companion daemon or disk IPC in the product; new source features stay behind the adapter.                                              |

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

## Repository maintenance — September 15

The retired Go companion, its extension UI, setup wrapper and handshake-only
probe have been removed. Active content scripts/icons now live with the Chrome
runtime; all generated files go under dist. Builds and CI require Node 24 and
unzip, with no Go toolchain. Registration validation continues to accept existing
Chrome and earlier test registrations; stored state and live jobs are unchanged.

Current setup, support claims and validation now reflect recorded live evidence.
The detailed [investigation log](history/parity-2026-09.md) and
[earlier validation record](history/validation-through-0.8.16.md) retain the full
chronology. This cleanup does not close any integration acceptance item.

Local validation: all 220 remaining tests, type checks, build, formatting and
release packaging passed on Node 24. The 21 removed tests belonged to the retired
companion. ZIP checks cover manifest and HTML asset references and private-file
exclusion. The production dependency audit reported no vulnerabilities.
Documentation file targets were checked; installed message behavior was not
retested because this cleanup changes no runtime logic. GitHub runs the same
checks on Linux and macOS before merge.

## Protocol wording — September 15

README and website now identify Beeper's existing Matrix-based bridge protocol.
The runtime guide separates standard Matrix messages/application services from
Beeper/mautrix WebSocket and provisioning extensions, and identifies bbctl as
the one-time registration tool. Muse still uses the DOM adapter; this wording
does not assert official API access, complete bridgev2 support or new parity.

Website copy: removed the redundant “No server to run.” sentence; retained
“The bridge is fully local.” Integration acceptance is unchanged.
