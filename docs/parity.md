# Muse / Beeper parity ledger

This is the persistent work list for the integration. New requests add to this
list; they do not replace unfinished work. Last updated: September 14, 2026.

**Target:** preserve Muse's conversation content, identity and state in its Beeper
chat as faithfully as the supported protocol allows. Keep source parsing behind
the typed Muse adapter so an official Muse API can replace DOM access later.
The product remains Chrome-only. Maintainer test tools are optional.

## Current priorities

1. Restore a reliable local iteration loop: fresh diagnostics, the correct running
   build, and an idle selected Muse tab. The diagnostic file stopped updating
   after the 0.8.3 update attempt; last observed runtime was 0.8.2.
2. Resolve the earlier interrupted incoming photo without resending it or attaching
   it to the queued text. The last live heartbeat had one held photo and one queued
   text. The user has not confirmed that the held job was dismissed.
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

Browser inspection still returned `Debugger unattached` after the user reconnected
Computer use. No live UI verification was obtained from that reconnect.

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
**not yet an exhaustive inspection of the current Muse UI**: supported browser
inspection repeatedly returns `Debugger unattached`. Unknown rows must be checked
in the source before implementation is presented as parity.

| Type / rendering                                   | Evidence that Muse supports it                                                 | Beeper target / current gap                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain text, paragraphs, Unicode                    | Observed                                                                       | Native text in both directions; verify consecutive sends and identity.                                                                                                                       |
| Bold, italics, links, lists                        | Observed                                                                       | Sanitized Matrix formatted text; compare content and links.                                                                                                                                  |
| Headings, quotes, code, tables                     | Not comprehensively inventoried                                                | Code audit found heading/table tags are stripped and plain text can concatenate their content. Add structured safe formatting and readable fallback; live source inventory still incomplete. |
| User images and captions                           | Observed; failed incoming attempt                                              | Native encrypted attachments ↔ Muse upload; REL-01/03.                                                                                                                                       |
| Assistant/generated images, galleries              | Observed; user saw Muse images in Beeper                                       | Preserve multiple images, ordering, captions and full-resolution choices within documented size bounds. More live cases needed.                                                              |
| Responsive/local/blob image previews               | Observed                                                                       | Capture selected image; native upload when accessible; never ship unusable blob links.                                                                                                       |
| Image-only messages and alt text                   | Code support; live cases incomplete                                            | Preserve as images without fabricated body/duplicate text.                                                                                                                                   |
| Video, animation/GIF, audio/voice                  | Composer microphone visible; exact supported message types not yet inventoried | Verify source capabilities first. No claim of general video/audio/voice-message parity.                                                                                                      |
| Files/documents and downloads                      | Not yet inventoried                                                            | Determine source upload types and Matrix file mapping, names, MIME and size bounds.                                                                                                          |
| Replies/quotes/thread relations                    | Reply controls visible; behavior not fully inventoried                         | Map to native reply relations where source IDs are known; no guessed associations.                                                                                                           |
| Edits / streaming updates                          | Observed                                                                       | 0.8.5 adds durable revision IDs and recovery for reversions after uncertain responses. Verify final completeness, notifications and image retention.                                         |
| Delete/redaction                                   | Not yet inventoried                                                            | Determine source semantics and supported direction; do not delete messages on temporary DOM disappearance.                                                                                   |
| Reactions, acknowledgment icons                    | Observed                                                                       | Native actor-aware reactions and removals; ACT-02.                                                                                                                                           |
| Read/delivery receipts                             | User request; authoritative Muse read signal unverified                        | Native delivery from confirmed submission; preserve unknown read state.                                                                                                                      |
| Typing / agent working state                       | Observed assistant progress; user reports missing Beeper typing                | ACT-01; ephemeral, renewed and cleared with expiry.                                                                                                                                          |
| Product/search cards with images, prices and links | Observed                                                                       | Preserve accessible content and links without copying inactive controls as though actionable. Audit current flattening.                                                                      |
| Browser/tool activity cards and previews           | Observed                                                                       | Represent current status and useful preview/link when available; embedded remote controls are not standard Matrix chat controls.                                                             |
| Suggested responses / choice buttons               | Observed                                                                       | Preserve labels/context. Investigate safe supported interaction; do not silently execute arbitrary action text.                                                                              |
| Approval/confirmation prompts                      | Observed                                                                       | Keep approvals explicit in Muse unless a supported authenticated action API is available; never auto-approve.                                                                                |
| Assistant avatar/name                              | Observed Babar                                                                 | ID-01. Avatar should follow Babar, not the integration logo. Do not rename the user's account.                                                                                               |
| Main chat and side chats                           | Side-chat UI observed                                                          | Current adapter selects main chat only. Define per-conversation routing before extending; never mix their histories.                                                                         |
| History, time separators, unread state             | Observed / reported                                                            | HIS-01/02/03 with native timestamps and states where authoritative.                                                                                                                          |
| Links/previews and interactive embedded content    | Observed                                                                       | Use native supported formats plus an honest “Open in Muse” path for controls that Beeper cannot render.                                                                                      |

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

Next independently actionable rendering gap: headings/table structure and readable
plain-text fallbacks. The current formatter strips those tags. Corrected the
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
