# Validation record

## Automated checks

`npm run check` passes locally on macOS with Node.js 24 and Go 1.27.1. This runs
TypeScript checking, the browser/setup tests, Go tests, the native build, and
format checks. `go test -race -tags goolm ./...` also passes. The production npm
dependency audit reports no vulnerabilities at the time of this check.
`govulncheck` v1.8.0 finds no vulnerabilities reachable by this code or its imported
packages; it reports three advisories elsewhere in required modules.

Coverage includes:

- Distinct Muse identity, one-owner authorization, portal restrictions, text-only
  input, additional-recipient rejection, and startup locks.
- Persistent queue serialization, duplicate messages and results, recovery from
  interrupted browser/Matrix sends, expiry, size limits, and content removal.
- Host/origin/token validation, strict JSON requests, and private routing data.
- Setup preserving credentials and crypto keys, refusing owner changes and active
  locks, and never echoing malformed private configuration.
- Browser input events, one Send click, draft preservation, reaction-independent
  prompt/reply extraction, rejection of interleaved manual messages, and extension
  tab authorization.
- Private popup pairing, rejection of page-origin pairing requests, failed pairing
  preserving the existing token, storage isolation, and a public ZIP allowlist.
- Connection probes detect missing or old content scripts, an unavailable chat,
  active Muse work, and existing drafts without returning conversation text.
- Content-script cancellation during a pending claim or reply wait, including
  rapid reconnects, and cancellation before clicking Send without erasing a
  manually edited draft.

Tests use synthetic DOM fixtures and temporary databases. They do not require
accounts, contact live services, or establish real-world encryption compatibility.
The browser tests run in jsdom, not an installed Chrome extension.

## Live checks — September 13, 2026

- Official bbctl 0.15.0 authenticated using an existing Beeper Desktop login and
  registered a custom `sh-muse` application service.
- The Go bridge connected to Beeper over its application-service websocket and
  created a dedicated encrypted **Muse** DM, with the owner and distinct Muse
  ghost. Beeper Desktop displayed it as a single chat on the `bridgev2` network.
- Browser selectors were checked against the signed-in Muse main chat. The earlier
  0.1 relay had a successful controlled-UI prompt/reply round trip; that result
  does **not** establish success for the new Matrix transport.
- The custom bridge initially hit a server HTTP 500 while signing its master key.
  A later startup succeeded using the saved recovery/crypto state.
- An encrypted diagnostic notice sent by the bridge bot was readable in Beeper.
- A startup handler-registration race in mautrix was reproduced and addressed by
  registering application-service crypto handlers before event dispatch, with
  regression tests.
- The first test room retained an encryption session created before identity
  setup was corrected, producing `m.unauthorised`. A fresh encrypted room using
  the same verified bridge identity received a new session and decrypted its
  first test message successfully. The earlier test chat was retained.
- A **complete custom-bridge round trip passed**: an ordinary message sent through
  Beeper entered the Go queue, Muse returned the requested marker, and the bridge
  delivered it as a reply from the distinct Muse contact (`isSender: false`).
  Beeper displayed the exact text and linked it to the original message. The
  queue finished idle with prompt/result bodies cleared from the completed row.
- That check used controlled browser UI actions and the real queue claim/result
  endpoints. It validates encrypted transport in both directions, Muse response
  capture, sender identity, and reply mapping; it does not validate installation
  or execution of the packaged Chrome extension.

## Installed extension and version 0.3

The installed 0.2 extension forwarded a real prompt but blocked its reply when
Muse added a reaction beside the user's message bubble. The adapter was reading
the whole message item and mistook the reaction for a different prompt. Version
0.3 reads the message bubble, excluding sibling reactions and toolbars. Synthetic
fixtures cover reactions on both the prompt and reply. The affected reply was
recovered from Muse without replaying the prompt.

After reloading the installed extension with the corrected adapter, an automatic
round trip passed. A diagnostic text sent through Beeper was claimed by the
extension, submitted to Muse, captured, and returned by the distinct Muse contact
with exact marker text and `isSender: false`. No controlled browser send or manual
claim/result call was used for this test. The queue returned to idle and cleared
completed message bodies.

This establishes the corrected installed adapter's automatic path. The new
version 0.3 public pairing flow is separately covered by automated service-worker
tests and popup UI checks; it has not yet been verified as a Chrome Web Store
installation. Store artwork uses synthetic popup state and is not live-test
evidence. Longer background tasks, proactive replies, sleep/resume, and long-term
reliability remain unverified. The project is experimental. See
[operations](operations.md) for recovery and encryption troubleshooting.

## Version 0.4 development checks

Synthetic tests cover automatic popup deduplication and active-tab checks,
close-guard removal on disconnect, recent/all/new-only catch-up, delayed replies,
message revisions, source-receipt deduplication across database restarts, safe
retry after an import failure, and rejection of unauthorized imports or browser-
selected Matrix destinations. Version 0.4 is installed locally for user
verification. The actual Chrome popup, native confirmation dialog, and a live
catch-up remain unverified until the updated extension is reloaded and connected.

A labeled synthetic diagnostic posted to the new authenticated import endpoint
was delivered to the configured Beeper Muse chat by the Muse contact
(`isSender: false`). The imported job finished `done`. This verifies the new
import queue and encrypted delivery path; it does not verify Chrome's catch-up
reader, automatic popup, or native leave-page dialog.

## Version 0.5 native mapping checks

The local development build was checked with 44 JavaScript/TypeScript tests, Go
tests, and the Go race detector. New coverage includes typed snapshots, absolute
timestamps, status text exclusion, source revision reversions, structured prompt
echo binding, HTML sanitization, image bounds, encrypted upload results, native
self identity, and silent-batch policy.

A clearly labeled synthetic batch in the configured private Beeper chat verified:

- An imported user message appeared with `isSender=true`.
- Original supplied millisecond timestamps matched the Desktop API exactly.
- A formatted assistant response retained its HTML and had a native PNG attachment.
- Both assistant parts reported `isUnread=false`; the chat unread count was zero.
- Reimporting the same batch queued zero messages.
- A source revision edited the existing message and preserved its original timestamp.
- A native reaction was saved in the Matrix mapping database and its removal
  removed that mapping. An explicit source read update completed through the
  native read-marker path.

These checks used the authenticated local source endpoint and read-only Beeper
inspection. They did not send a prompt to Muse or establish that every current
Muse DOM selector works. Chrome automation was unavailable in the session.
Actual reaction actors and authoritative read state are not exposed by the DOM
adapter; those capabilities remain disabled pending verified source evidence.
Notification suppression was verified through batch flags and read/unread state,
not through observation of operating-system notification banners.
