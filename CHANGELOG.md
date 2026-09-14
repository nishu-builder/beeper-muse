# Changelog

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
