# Changelog

## 0.8.18

- Give image-only source messages one native timeline position, replacing a delayed
  image fallback in place instead of appending a second photo message.
- Preserve native image content through temporary preview loss and caption changes.
- Update existing messages quietly without marking unseen chat messages as read.

## 0.8.17

- Compress oversized still PNG/JPEG images to bounded WebP previews instead of
  rejecting ordinary generated images above 2 MB. Originals that fit are unchanged;
  oversized animations retain the unavailable-image fallback.
- Fix automatic image verification for native attachments whose description is
  exposed as a filename, including image-only messages omitted by search.
- Add content-free diagnostics for selected-tab visibility and media readiness.

## 0.8.16

- Match animated Muse avatars with a bounded, cached still frame from the named assistant.
- Exclude file-card icons from conversation photos.
- Retry incomplete image preparation with bounded backoff instead of marking it
  synced. After three failed attempts, show an unavailable-image fallback so later
  text can continue. Reply completion leaves unfinished media for background synchronization.
- Preserve generated-image descriptions as alt text. The development image test
  identifies the marked image itself, including when Muse emits a separate caption.

## 0.8.15

- Log image preparation success, download failures, unsupported formats and size
  limits using fixed codes without message content or image URLs.
- Record the passed live photo-followed-by-text checks, including native delivery.

## 0.8.14

- Read all top-level bubbles in each Muse message. Photo and caption surfaces now
  stay together, and nested bubbles are not duplicated.
- Cover the observed image-first, caption-second layout that still failed reply
  matching in 0.8.13.

## 0.8.13

- Include user photo attachments rendered beside their caption bubble, using the
  message's media controls. Preserve the caption and ignore unrelated decoration.
- Wait for a matching caption's image to render before confirming delivery,
  instead of treating missing media as an unrelated message.

## 0.8.12

- Locate the complete Muse composer so attachment previews and Send controls in
  sibling containers can be observed. Preserve draft and transcript guards.
- Live inspection confirmed the previous upload region was too narrow; successful
  photo delivery remains under verification.

## 0.8.11

- Handle cleared or replaced image pickers when a loaded local preview matches
  the requested upload byte for byte. Reject mismatches and recheck the preview,
  composer and caption before Send.
- Record upload-control counts after image failures as well as before attempts.
- Require the updated source adapter when reconnecting Muse. Held uploads remain
  held until reviewed; updating does not retry them.

## 0.8.10

- Include a persisted timestamp and bridge identity in native delivery-status
  events, sent as the Muse bot. Beeper Desktop can omit timestamp-free statuses
  from its API even when a message made the round trip.
- Preserve status timestamps and transaction IDs across retries. Repair saved
  status metadata without resending the underlying prompts.
- Accept Chrome's actual document-token format when restoring the selected Muse
  tab after updates. Previously, valid reconnection records were discarded.
- Check Desktop chat access before development-test uploads or sends.

## 0.8.9

- Recognize composer image pickers that use filename extensions or no accept
  filter, alongside MIME types. Match the actual file type before staging it.
- Reject disabled pickers, incompatible filters and multiple matching inputs.
  Keep composer scoping, draft protection and preview confirmation unchanged.
- Require the updated source script when reconnecting an existing Muse tab.

## 0.8.8

- Keep the chosen diagnostic file updating when runtime health checks stall.
  Record collection freshness separately from connection state and queue counts;
  unavailable health is never reported as an empty, ready queue.
- Record bounded update stages and elapsed time even when a health read is stuck.
  Limit each diagnostic channel to one outstanding read.
- Keep authenticated read-only diagnostics out of the update work guard while
  preserving guards for message handling and source preparation.
- Refuse development sends when collection is inconsistent, stale or reports an
  update in progress. File grants and uncertain-message protections are unchanged.
- Live update recovery and the earlier interrupted photo remain unverified.

## 0.8.7

- Preserve headings, tables, continued ordered lists, code language and other
  supported Matrix formatting using a bounded HTML parser instead of tag regexes.
- Keep table cell separators, list numbers and code indentation in plain text.
- Drop active/foreign markup and unsafe attributes; use the plain message when
  formatting exceeds structural limits. Images remain native attachments.
- Bundle the parser and dependency licenses with the public extension package.
- Live source inventory and Desktop/mobile rendering verification remain open.

## 0.8.6

- Report native Beeper connection status from fresh checks of the selected Muse
  tab, including disconnected/stopped, discarded and unavailable source states.
- Use the same source state for account discovery. Stop renewing stale Connected
  status from socket heartbeats; use a 90-second expiry and bounded source probes.
- Ignore delayed probes after disconnect or tab navigation. Record sanitized
  source connection transitions for diagnostics.
- Native client banners and offline expiry still need installed-app verification.

## 0.8.5

- Preserve source order when an earlier first delivery is still settling.
- Preserve known reactions when source observation is unknown; reject malformed
  observations without treating them as removals.
- Give re-added reactions and reverted text/images fresh event IDs. Keep original
  message timestamps while ordering revisions by increasing observation times.
- Journal reaction removals before sending and recover pending mutations before
  comparing newer source content, including reversions after a lost response.
- Detect busy state on the current assistant message renderer, based on previously
  captured Muse markup. Exclude avatar loading and older/nested activity.
- Live browser access and fresh diagnostics remain prerequisites for verifying
  the interrupted upload, queued text, avatar and visible typing.

## 0.8.4

- Add a persistent parity ledger covering reported reliability issues, native
  state, identity and Muse message/rendering types. Keep live verification open
  separately from implementation and synthetic regression coverage.
- Add typed assistant-avatar synchronization to native profile, room and bridge
  metadata, with bounded retrieval, ambiguity checks and resumable updates.
- Recognize additional explicit Muse activity signals and log source readiness
  separately from accepted or failed Matrix typing requests. Unknown source
  failures let the typing lease expire instead of claiming Muse became idle.
- Refresh older content scripts when reconnecting. Avatar and typing display
  remain unverified in the installed apps; the earlier interrupted photo is not
  retried or dismissed by this update.

## 0.8.3

- Support a bounded message composer container without requiring a native HTML
  form. Diagnostic evidence showed the live Muse composer has no enclosing form.
- Keep upload discovery out of the transcript and page root; unrelated file
  pickers must remain untouched. Add regression coverage for form-free uploads.
- Include bounded page/file-input counts and recognized-container presence in
  the optional diagnostic log. These counts contain no page content.
- Preserve existing interrupted jobs for inspection. This update does not retry
  the previous photo or establish that the live photo round trip now succeeds.

## 0.8.2

- Add a typed development driver with pinned-chat checks, synthetic text/photo
  tests, persisted send records, read-only resume and sanitized result reports.
- Add `dev:cycle` to run checks, stage the extension, wait for the exact running
  build and test text, a photo and subsequent text. Unverified work stops the
  cycle; it never automatically resends an uncertain prompt.
- Include a content-free diagnostic heartbeat with the build fingerprint,
  connection readiness and queue counts. File selection remains a one-time
  Chrome grant; the product still needs no companion process.
- Keep known pre-upload failures visible without holding subsequent messages.
  Interrupted uploads still hold the queue until inspected and dismissed.
- Incoming photo compatibility and client status rendering remain unverified.

## 0.8.1

- Add a bounded, content-free diagnostic log with specific upload failure codes
  and read-only upload-control counts. Choose one file from the connection tab
  to keep a readable copy updated without a daemon or copying popup errors.
- Show “Sending to Muse paused” when an interrupted message holds later sends;
  dismissing the interrupted job skips it and releases the queue.
- Publish native Beeper pending, failed and confirmed delivery statuses. The
  bridge waits for a matching Muse echo and new reply before success, and retries
  status updates independently without resending prompts. Client rendering still
  needs live confirmation.
- Keep typed upload diagnostics separate from message contents. The underlying
  Muse image-upload compatibility issue is still under investigation.

## 0.8.0

- Add preview Beeper-to-Muse photo jobs with captions, authenticated media
  downloads, Matrix attachment decryption, bounded image validation and a typed
  upload adapter. The current Muse upload controls still need live verification.
- Require an unambiguous composer and loaded preview before Send; blocked photos
  are visible and never automatically submitted again after an uncertain result.
- Preserve original Beeper image events during catch-up instead of replacing
  them with text or importing a duplicate. Reactions target the original photo.
- Capture responsive, local blob and embedded raster images from Muse. Show
  fallback links or explanations when image bytes cannot be retrieved.
- Add HTTPS Cloudflare R2 storage permission for Beeper's media redirects and
  constrain extension network destinations. Chrome may require permission approval.

## 0.7.2

- Add `update:local`: stage complete builds, preserve private configuration and
  let the installed extension detect a completed build and reload when idle.
- Apply downloaded store updates at the same safe boundary. Stop new claims,
  wait for current prompts/delivery and keep encryption keys and durable queues.
- Reconnect the previously selected Muse tab using packaged content scripts,
  without refreshing the page or clearing drafts. Add the `scripting` permission.
- Add store-publishing configuration checks and one-time credential instructions.
  Google authorization is still required before automated store submissions.
- Cover update deferral, interrupted preparation, installation failure and tab
  validation with automated tests. Installed Chrome reload behavior still needs
  live verification after the one-time transition.

## 0.7.1

- Request fresh Muse activity from the worker so background-tab timer throttling
  does not prevent typing renewals. Disconnects stop renewal; typing expires if
  the source becomes unavailable.
- Observe activity independently of message capture, including when Muse disables
  its composer or temporarily removes the transcript. Sending still requires a
  usable, empty composer.
- Add regression coverage for renewal, clearing, disconnected/discarded tabs and
  failed transcript reads. Live Desktop and mobile rendering remains to be checked.

## 0.7.0

First public package of the Chrome-only runtime. One-time bbctl registration is
still required; there is no companion process during use.

- Bundle the service worker, dedicated socket tab, persistent Rust/WASM encryption,
  durable inbox/outbox, icons and license notices in the public release ZIP.
- Forward text prompts and translate observable Muse content to native sender
  identities, formatting, encrypted images, edits, reactions and typing.
- Retain source timestamps when available, deduplicate catch-up, suppress history
  notifications and block interrupted prompts rather than automatically resending.
- Include the 0.6.6 Desktop capabilities handler, account announcements and DM
  metadata. Desktop now lists the room; a room-detail API error and full live
  acceptance remain under investigation.
- Add a private registration converter for public/store installations. Make the
  default build/package commands target Chrome-only; retain `build:legacy`.
- Rewrite setup, architecture, operations, privacy, security, contribution and
  release documentation around the current runtime and its limits.

Unpacked and Web Store installations have separate encryption storage. Updating
in place preserves state; switching installation identities has no automatic
crypto migration. See [setup](docs/chrome-setup.md) and [validation](docs/validation.md).

## 0.6.0–0.6.6 — Chrome development previews

- Move Matrix encryption, durable transactions and delivery into Chrome.
- Correct native fetch binding and expose bounded startup diagnostics.
- Host the authenticated WebSocket in a dedicated extension tab; use worker-driven
  heartbeats, document ownership checks and recovery after disconnection.
- Announce the bridge account and add matching direct-chat receiver metadata.
- Answer Desktop's read-only `http_proxy` provisioning requests instead of silently
  dropping them and leaving Desktop waiting for account capabilities.

## 0.5.0–0.5.3 — companion development

- Introduce a typed source adapter contract and native Matrix translation.
- Add owner identity, formatting, encrypted images, edits and silent catch-up.
- Preserve source times with explicit first-observed fallback provenance.
- Capture verified reaction actor labels and visible Muse activity.
- Keep partial virtualized text from overwriting known rich messages.

## 0.4.0 — companion development

- Add selected loaded-history catch-up, later messages and revisions.
- Offer the popup on Muse tabs and request Chrome's standard leave-page warning.
- Persist source receipts to avoid duplicate imports after reconnecting.

## 0.3.0

- Exclude sibling reactions/toolbars from prompt and reply matching.
- Add public extension pairing, connection feedback and a forget control.
- Add allowlisted ZIP packaging, checksums, tagged releases and optional store API
  submission. Verify an installed-companion automatic text round trip.

## 0.2.0

- Replace the Note to self relay with a custom mautrix bridgev2 network and
  dedicated encrypted Muse chat.
- Add durable SQLite queues, sender checks, recovery and native crypto handling.
- Remove the Desktop local API as a runtime dependency.

## 0.1.0

Initial text-only Note to self prototype, superseded by the custom bridge.
