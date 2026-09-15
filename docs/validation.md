# Validation

Tests, protocol responses and visible client behavior are separate evidence.
A connected socket alone does not confirm message delivery. The
[parity ledger](parity.md) tracks every reported issue and remaining acceptance case.

## Automated coverage

Run:

```sh
npm run check
npm run package
npm audit --omit=dev --audit-level=high
```

CI runs on Linux and macOS with Node.js 24. Tests use synthetic DOM, mocked
Chrome APIs, Rust/WASM crypto and isolated temporary storage; accounts are not
required. Coverage includes:

- Sender, room, membership and selected-tab restrictions; trusted document ports.
- Draft preservation, prompt attribution, partial observations and rich content.
- Durable intake, queue limits, restarts, encrypted retries and interrupted jobs.
- Formatting, images, identities, edits, reactions, typing expiry and quiet history.
- WebSocket headers, handshake errors, reconnection and account discovery.
- Local updates, diagnostic privacy and exact installed-build verification.
- Reproducible ZIPs, referenced assets, licenses and exclusion of private files.

These checks cannot prove that Muse's current DOM, Chrome Web Store installs or
every client rendering option works.

## Installed observations

| Behavior                    | Evidence                                                                                      | Remaining limits                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Text and native delivery    | Exact replies and native SUCCESS identifying Muse (0.8.10 onward)                             | Pending/delivery labels need broader Desktop/mobile checks               |
| Beeper photo → Muse → reply | A synthetic PNG's undisclosed color was identified; reply and native SUCCESS arrived (0.8.14) | Other formats, sizes and multiple photos need coverage                   |
| Text after a photo          | Subsequent text passed without dismissal or replay (0.8.14)                                   | Ambiguous interrupted uploads remain held for inspection                 |
| Generated image → Beeper    | Visible-source image arrived without rescan in 0.8.17 and 0.8.18                              | Fully hidden Muse tabs can defer image loading                           |
| Delayed image recovery      | Encrypted image replaced its placeholder with the same message ID, time and sort key (0.8.20) | Test required opening the Muse tab; hidden-only acceptance failed        |
| Assistant avatar            | Babar still frame visible in Desktop list/header (0.8.16)                                     | Mobile and restart persistence need separate checks                      |
| Typing                      | Real Muse-driven typing appeared and cleared in Desktop (0.8.17)                              | Mobile remains unverified                                                |
| Reactions                   | Owner reaction addition/removal mapped to native events (0.8.17)                              | Bubble rendering, replacement and assistant acknowledgments remain open  |
| Catch-up                    | Missed exchange arrived read; reconnect did not duplicate it (0.8.18)                         | OS banners, mobile notifications and older-history placement remain open |
| Local updates               | Automatic reload, restored source and continuing diagnostics observed through 0.8.21          | Store update flow and every interruption case remain separate            |

These are specific observed cases, not blanket compatibility guarantees.
Details are preserved in the [September investigation log](history/parity-2026-09.md)
and [earlier validation record](history/validation-through-0.8.16.md).

## Image support acceptance

Incoming PNG and subsequent text passed through the installed extension with
native delivery confirmation. Generated images passed while Muse was visible.
A hidden Muse tab can leave an image skeleton without exposing image bytes;
the extension cannot copy an image the source has not loaded. Version 0.8.20
delivers a loading placeholder and replaces it when that same image becomes
available. The installed encrypted replacement path passed after opening Muse.

Still needed: additional formats/sizes, captions, galleries, interrupted uploads,
client rendering comparisons, and automatic image loading while Muse stays hidden.
Do not replay an uncertain upload or generation request to complete a test.

## Update automation acceptance

Automated tests cover busy-source deferral, claims, source failure, durable
checkpoints, draft preservation, expired tickets and staged-file installation.
Installed updates have restored the selected source and continued diagnostic
logging. Version 0.8.21 reported both connections ready with no queued, claimed,
blocked or pending jobs after updating.

Busy-update behavior and Chrome restart recovery need broader live coverage.
A downloaded Web Store update is a separate acceptance case; local update success
does not prove store publication or installation.

## Release acceptance checklist

Use a consenting test account and synthetic content. Record versions and outcomes
without credentials, account identifiers or private screenshots.

- Check the actual release ZIP and connect using a private registration.
- Verify the room appears in Desktop and mobile, including message requests.
- Send text, a photo and follow-up text; verify replies and native delivery status.
- Compare sender identity, rich text, image ordering, avatar, reactions and typing.
- Run catch-up twice; inspect deduplication, times, unread state and notifications.
- Restart the worker and Chrome; inspect saved keys and uncertain work without replay.
- Update in place; separately record Web Store upload, review and publication.

Use the [development loop](development-loop.md) for journaled tests and resuming
observations without resending. See [releasing](RELEASING.md) and
[troubleshooting](operations.md).
