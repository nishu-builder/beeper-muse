# Browser runtime

Decision: move toward an extension-only bridge. Status: typed source boundaries
and an isolated Chrome authentication probe are implemented. The probe has
synthetic protocol tests but still needs a successful live Chrome run. Encrypted
message transport, durable browser state, and migration are not implemented.
The released runtime still needs the companion.

## Components

```mermaid
flowchart LR
    Muse[Signed-in Muse tab] <--> Adapter[Muse adapter]
    Adapter <--> Sync[Typed source sync]
    Sync <--> Worker[Extension service worker]
    Worker <--> Beeper[Beeper appservice connection]
    Worker --- DB[IndexedDB queue and crypto state]
```

The popup manages connection and diagnostics. The service worker owns Beeper
credentials, encrypted transport, and recovery. The content script only sees the
source contract and commands for the selected Muse tab. Neither the popup nor a
content script creates its own Matrix crypto client. Closing Chrome stops the
bridge; opening Chrome must resume from persisted state.

The current bridge communicates over HTTP and WebSocket, not filesystem IPC.
IndexedDB can replace the SQLite queue. Browser encryption is available through
the [Matrix JavaScript SDK's Rust/WASM crypto](https://matrix-org.github.io/matrix-js-sdk/index.html#end-to-end-encryption-support),
which supports persistent IndexedDB storage. That establishes a plausible route,
not compatibility with Beeper's application-service extensions or the existing
Go crypto database.

## Work needed before switching

1. **Registration and transport.** Implement Beeper registration in extension UI,
   then connect directly to its application-service WebSocket. Preserve the Muse
   participant, owner identity, room membership checks, and account isolation.
   Beeper's pinned [WebSocket implementation](https://github.com/mautrix/go/blob/v0.30.0/appservice/websocket.go)
   sends Authorization, process ID, and protocol-version headers. Browser
   WebSocket constructors cannot set those headers. Verify an authenticated
   Chrome handshake before committing to this path. A narrowly scoped extension
   request-header rule is a candidate; never put credentials in a URL or broadly
   attach them to requests. Do not introduce a proxy daemon to solve this step.
2. **Crypto and native events.** Verify appservice transactions, to-device key
   events, double-puppet encryption, encrypted attachments, edits, reactions, and
   Beeper batch send using bundled SDK/WASM code. A normal Matrix chat client is
   not a drop-in replacement for the current appservice bridge. Retain explicit
   timestamp provenance and notification suppression.
3. **Durability.** Persist an incoming transaction before acknowledging it. Store
   message IDs, revision receipts, outgoing work, and crypto state in IndexedDB.
   Keep one crypto owner, including during worker restart. A connection conflict
   must stop, not repeatedly replace the existing bridge. Reuse deterministic
   event IDs and never resend an uncertain Muse prompt automatically.
4. **Lifecycle.** Support reconnect with bounded backoff and alarms. Chrome can
   terminate a worker and users can close the browser. Active WebSocket traffic
   resets the idle timer in supported Chrome versions, but cannot replace crash
   recovery. See [Chrome's lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
5. **Migration.** Test with an isolated registration first. Export or replace the
   crypto device through supported APIs; copying the Go SQLite database into
   IndexedDB is not a migration. Preserve the existing Muse room, source mappings,
   and queued results. Switch ownership once, keep a private rollback backup, and
   verify both directions with the companion stopped before calling it daemon-free.

## Validation required

A real Chrome session must demonstrate encrypted messages in both directions,
correct owner/assistant identities, silent repeated history sync, image delivery,
and recovery after worker termination and browser restart. Removing the extension
must stop its connection; no native host or background process may be necessary.
The final public ZIP must contain its runtime code and WASM, exclude private
credentials, and request only the permissions the implemented transport needs.

Chronological history repair is a separate problem: the existing forward import
appends missing history. It cannot reposition older messages between existing
Matrix events. A browser rewrite must not claim that IndexedDB or WebSockets fix
that behavior automatically. Confirm Beeper's backfill semantics with an isolated
room before changing the live chat's history strategy.

## Running the isolated Chrome connection test

This development extension tests only the authenticated appservice handshake.
It does not capture Muse, send chat messages, acknowledge transactions, or reconnect.
It sends one protocol ping to verify an otherwise idle authenticated connection.
It closes after confirmation, failure, cancellation, or a 15-second timeout.
A successful test is one prerequisite for the browser runtime, not a working
Chrome-only bridge.

With the existing setup signed in and `bbctl` on your PATH:

```sh
npm run setup:browser-probe
```

The setup creates a new `sh-muse-probe-…` registration and prepares
`.local/chrome-probe`. It does not copy the live bridge's registration, encryption
keys, or chat history. Load that directory using **Load unpacked** at
`chrome://extensions`. On first installation, the test opens in a tab and runs
automatically. To retry, open **Beeper Muse Chrome connection test** and click
**Test connection**. The target result is **Authenticated Beeper connection
confirmed.** A WebSocket upgrade alone does not count: the probe waits for a
Beeper protocol message or a correlated ping response. Report only the displayed status, not registration files.

The extension has no content scripts or localhost permission. A temporary
[Chrome request-header rule](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
sets the three appservice headers only on the exact WebSocket URL initiated by
this extension ID and diagnostic tab. It also removes the Origin header on
that socket to match the native appservice handshake. Credentials never appear
in URLs. The rule is removed when
the test ends, the diagnostic tab closes, or Chrome starts. Cleanup uses the
same ownership lock as the page, so a worker wakeup cannot clear a live test. Raw server responses and credentials
are not shown in the popup.

`npm run build:browser-probe` produces public code in `dist/browser-probe` without
credentials. Setup copies allowlisted files into the private directory and adds
its isolated registration. Never upload `.local/chrome-probe` as a public ZIP.
The ordinary extension and its store package are unchanged by this experiment.
The registration is retained for further development; removing the unpacked test
stops browser access but does not delete the remote registration.

Probe 0.1.1 adds explicit `wss://matrix.beeper.com/*` host access; HTTPS host
access alone does not cover header modification on the WebSocket handshake.
The popup checks that permission and reports bounded diagnostic stages without
printing tokens, source URLs, or raw server frames. An independent native API
control confirmed HTTP 101 and a correlated Beeper ping response for the isolated
registration. That does not yet establish that the Chrome handshake works.

Explicit WebSocket host permissions have historically had different Chrome Web
Store validation behavior; see the [Chromium report](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/P1PbbBGvydo).
This remains an unpacked experiment. The production runtime must validate its
permission flow and store packaging before release.

Probe 0.1.2 runs the WebSocket from a dedicated extension document. The 0.1.1
worker test accepted its permission and rule setup but failed the handshake in
Chrome. The document test also failed, despite observing all three required
authentication headers on the outgoing request; worker interception was not
established as the cause. The document test also checks Chrome's hypothetical rule match and observes
handshake metadata via [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest).
Only verification flags, numeric status codes, and bounded network error codes
reach the UI. Headers, credentials, URLs, and message bodies are never displayed.
Observers and authentication rules are scoped to the exact endpoint, extension
origin, and diagnostic tab. A Web Lock permits only one connection test at a time.

This experiment requires keeping its diagnostic tab open for at most 15 seconds.
It does not establish a production background runtime; encryption, durability,
and a supported document lifecycle still need implementation and verification.

Probe 0.1.3 removes `Origin` from this narrowly scoped appservice handshake.
A native API control using the same isolated registration returned HTTP 101 and
a protocol ping response without Origin, but HTTP 403 with a Chrome extension
Origin. The diagnostic now reports whether the outgoing Origin header is absent.
This identifies a server rejection independently of Chrome; a successful live
Chrome run is still required to confirm the complete fix.
