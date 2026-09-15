# Chrome runtime and protocol

This document describes the current Chrome implementation.
For the component overview, see [architecture](architecture.md). For installation,
see [setup](chrome-setup.md).

## Registration and room identity

One-time setup uses Beeper's official `bbctl` to obtain an application-service
registration. The converter accepts a Beeper hungryserv HTTPS endpoint, the
matching owner, and an isolated `sh-muse-chrome-…` registration (development
`sh-muse-probe-…` registrations are also accepted). The public package contains
no registration. The user imports it into trusted local extension storage.

Startup registers the bot, initializes a persistent crypto device, opens or
creates the encrypted Muse room, joins the owner, checks encryption/membership,
and restores pending work. Room identity is saved in IndexedDB. `m.bridge` and
`uk.half-shot.bridge` metadata identify the Muse network, the `browser` login,
and a direct chat. A `bridge_status` message announces the account after the
socket connects and is refreshed while connected.

Do not clear storage to retry startup. Room-alias recovery is not reliable on
all Beeper server paths; losing local state can create another room. There is
no supported migration of encryption state between extension IDs.

## Why the socket has its own tab

Browser WebSocket constructors cannot set Beeper's authentication headers.
A scoped `declarativeNetRequest` session rule sets Authorization,
`X-Mautrix-Process-ID`, and `X-Mautrix-Websocket-Version`, and removes Origin on
the exact appservice socket URL for this extension and connection tab.
Credentials are never placed in the URL. This follows the
[mautrix WebSocket protocol](https://github.com/mautrix/go/blob/v0.30.0/appservice/websocket.go).

The extension-document handshake was verified in Chrome. The worker socket path
failed despite the successful document probe, so the document holds only the
socket. A Web Lock prevents duplicate socket documents. The worker reloads its
own existing connection tab during startup to avoid stale code after an update.

A worker heartbeat drives a protocol ping every 20 seconds; the document replies
through its port. A 15-second handshake deadline and a 50-second reply timeout
turn stalled sockets into recoverable errors. Alarms and bounded backoff restart
failed connections. A registration conflict stops the runtime until explicit
reconnection instead of repeatedly displacing another copy.

Closing Chrome stops the bridge. Sleep, browser suspension, and terminated
workers still require durable recovery; heartbeat traffic is not a durability
guarantee. See [Chrome's worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Desktop discovery

Desktop requests bridge capabilities before loading an account. These requests
arrive as `http_proxy` frames on the existing authenticated socket. Ignoring them
can leave Desktop queuing room events for an unloaded account even when mobile
shows the room.

The runtime implements a read-only subset of the
[mautrix provisioning protocol](https://github.com/mautrix/go/blob/v0.30.0/bridgev2/matrix/provisioning.go):

| GET endpoint                         | Response                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `/_matrix/provision/v3/capabilities` | Supported provisioning features; no speculative contact or group support |
| `/_matrix/provision/v3/login/flows`  | Empty list; registration happens through setup                           |
| `/_matrix/provision/v3/whoami`       | Network and current login after owner/token validation                   |
| `/_matrix/provision/v3/logins`       | Current login ID after owner/token validation                            |

Responses use the native request ID and HTTP response envelope. Public capability
responses contain no account or message data. Account discovery checks the exact
owner and validates the supplied bearer token against the configured homeserver.
Other paths and writes return explicit errors. There is no general URL proxy,
local HTTP listener, login wizard, or remote management endpoint.

## Storage and retries

- `browser-runtime/inbox.ts` saves complete transactions with strict IndexedDB
  durability before acknowledgment. It preserves unknown fields and key events.
- Intake is bounded to 128 pending transactions, each at most 1 MiB. A full queue,
  failed write, or reused transaction ID with changed content produces no ACK.
- Crypto updates are processed before waiting room events so later keys can
  unblock earlier messages. Device identity and Rust/WASM crypto state persist.
- Outbound batches are persisted before send. Retries reuse ciphertext and event
  IDs. Completed payloads are cleared; deduplication receipts remain.
- One serialized worker owns crypto/delivery. Prompt claims are saved before
  browser submission. Interrupted claims are blocked, never automatically resent.
- Typing is transient, expires after 12 seconds, and is not replayed from storage.

Storage is scoped to the homeserver and registration. The browser keeps the
crypto-store passphrase alongside local state; encryption at rest is not a defense
against someone controlling the Chrome profile. `unlimitedStorage` avoids ordinary
quota eviction but does not protect against disk failure or uninstalling.

## Diagnostics

The popup shows separate Beeper/Muse states, startup stages, queue counts,
connection errors and interrupted jobs. Diagnostics exclude credentials, raw
frames and conversations. Handshake observations are restricted to the exact
socket/tab and report only verification flags, HTTP status and bounded errors.
A startup stage taking over 60 seconds is reported; the watchdog does not create
a second crypto writer while an operation is still pending.

See [validation](validation.md) for acceptance coverage and [releasing](RELEASING.md)
for public artifacts.

## Image messages

`m.image` jobs use the same owner, room, membership, claim and duplicate checks
as text prompts. Only Matrix media addresses are accepted. Captions are preserved
when the event includes a distinct `filename`; the filename alone is not sent as
a prompt. Unsupported formats, failed downloads/decryption and uncertain uploads
are blocked visibly. The source adapter's optional typed `submitImage` operation
keeps future Muse API uploads separate from Matrix media handling.

See [architecture](architecture.md#images-in-both-directions), [limits](../README.md#photos)
and [acceptance status](validation.md#image-support-acceptance).
