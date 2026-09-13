# Changelog

## 0.3.0

- Fix dropped replies when Muse adds a reaction beside a message bubble; prompt
  matching and reply capture now exclude sibling reactions and toolbars.
- Ship a public Chrome extension with a popup pairing flow, local private token
  storage, explicit connection feedback, and a Forget this bridge control.
- Replace generated private extension copies with `.local/pairing-code.txt`.
- Add a reproducible public ZIP allowlist, release checksums, tag-triggered
  GitHub releases, and optional protected Chrome Web Store V2 submissions.
- Add installation, upgrade, privacy, store, and maintainer release instructions.
- Verify the corrected installed adapter with an automatic encrypted Beeper to
  Muse to Beeper round trip. Store installation remains separately unverified.

## 0.2.0

- Replace the Note to self relay with a custom mautrix bridgev2 network.
- Create a dedicated Muse DM with a distinct Muse sender and ordinary text input.
- Connect directly to Beeper with official bbctl registration and encrypted Matrix
  transport; remove the Desktop API OAuth runtime dependency.
- Add a durable SQLite queue, persisted delivery mappings, owner/recipient checks,
  startup locking, and recovery for interrupted jobs.
- Register application-service crypto handlers before event dispatch to avoid a
  startup race in the pinned framework.
- Retain the Muse browser adapter and narrow extension permissions.
- Add Go tests, race checks, setup tests, dependency notices, and migration docs.

This is an experimental release. See `docs/validation.md` for live verification
limits and current Beeper compatibility findings.

## 0.1.0

Initial text-only prototype using explicit commands in Beeper Note to self and a
local Chrome extension. Superseded by the custom bridge in 0.2.
