# Beeper Muse

A custom Beeper bridge that gives your existing Meta Muse conversation its own
**Muse** chat. Send ordinary messages in that chat; replies are delivered by the
Muse contact. No WhatsApp connection, Note to self relay, or Muse password in the
bridge.

[Setup guide](docs/setup.md) · [Extension download](https://github.com/nishu-builder/beeper-muse/releases/latest)
· [Privacy](PRIVACY.md) · [Troubleshooting](docs/operations.md)

**Chrome-only preview:** [setup instructions](docs/chrome-setup.md). Version
0.6.5 bundles encryption and durable storage in Chrome; no companion runs during
use. Live Chrome acceptance testing is still in progress. The instructions below
are for the existing companion release.

The source now includes version 0.5.3 structured message sync. Build
both the local bridge and extension from this source to use them; the existing
0.3.0 release ZIP does not include these changes. See [the component design](docs/architecture.md)
for how a future Muse API can replace the browser adapter.

Version 0.3.0 was submitted to Chrome Web Store on September 13, 2026 and is
**pending review**. Until Google approves it, use the release ZIP or load the
source extension as described below. **The extension
requires the local bridge; installing it alone does not create a Beeper chat.**

**Experimental.** The Beeper side uses the mautrix `bridgev2`
framework. The Muse side operates the signed-in website through a Chrome
extension; it is not an official Muse API. Website changes can interrupt it.

```text
Dedicated Muse chat in Beeper
            ↕ encrypted Matrix messages
Local Go bridge + durable queue
            ↕ authenticated loopback connection
Chrome extension ↔ your signed-in Muse conversation
```

## Requirements

- A Beeper account and [bbctl](https://github.com/beeper/bridge-manager), Beeper's
  official manager for self-hosted bridges.
- Go 1.26 or newer, Node.js 24 or newer, npm, and a C compiler for SQLite.
  On macOS, the Xcode command line tools supply the compiler.
- macOS or Linux. Native Windows is not supported by bbctl; WSL is untested here.
- Chrome 127 or newer, and a signed-in [Muse](https://muse.ai/)
  account. Keep that browser tab and the bridge process running.

The Beeper Desktop local API is **not required** by this bridge. Setup uses
bbctl to register a custom application service and can reuse an existing Beeper
Desktop login. The bridge connects directly to Beeper's server over an outbound
websocket. No public listener or port forwarding is required.

## Install

Install bbctl using its official instructions. On macOS:

```sh
brew install beeper/tap/bbctl
```

Then:

```sh
git clone https://github.com/nishu-builder/beeper-muse.git
cd beeper-muse
npm ci --ignore-scripts
npm run build
npm start -- setup
npm start -- start
```

Setup signs into Beeper with bbctl if needed, registers **sh-muse**, and prepares
private configuration under `.local/`. Run one installation for this registration.
Do not reuse the name if you already have an unrelated bridge called sh-muse.

Leave that terminal running, then:

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's **extension** folder.
   Alternatively, extract `beeper-muse-extension.zip` from a GitHub release and
   load the extracted folder containing `manifest.json`.
3. Open the extension, paste the code from `.local/pairing-code.txt`, and click
   **Pair bridge**. Keep this code private; it stays on this computer.
4. Open Muse's main chat and sign in. Reload the page if it was open before the
   extension was installed.
5. The popup opens automatically if no Muse tab is connected. Choose how much
   loaded history to catch up, then click **Connect this Muse tab**. You can also
   open the popup from the toolbar.
6. Close the popup and send a message in the **Muse** chat in Beeper.

A separate **Muse** conversation appears in Beeper. Send a short message there,
for example `Explain why the sky is blue in two sentences.` No command prefix is
needed. The bridge forwards only messages in this conversation from its owner.
See [validation](docs/validation.md) for the current live verification status and
[operations](docs/operations.md) if encryption or delivery fails.

## Commands

| Command                     | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `npm start -- setup`        | Register the bridge and save a private pairing code. |
| `npm start -- pairing-code` | Save the existing code again, including during use.  |
| `npm start -- start`        | Run the bridge in the foreground.                    |
| `npm start -- status`       | Show queue state without displaying messages.        |
| `npm start -- acknowledge`  | Discard an interrupted job after checking both apps. |

Optional exported environment variables are described in [.env.example](.env.example).
A `.env` file is not loaded automatically. Both loopback ports, `24819` for the
extension and `24820` for the Matrix application service, are fixed.

## Behavior and limits

- One owner, one Muse contact, one existing Muse web conversation. This does not
  create a separate Muse agent or copy its memory into Beeper.
- Connecting imports the most recent 20 loaded messages by default. Choose
  all loaded messages or only new messages in the popup. Messages written in Muse
  appear as you through Beeper's existing double-puppet session; assistant replies
  come from Muse. Catch-up uses silent Matrix batches. Text formatting and
  accessible PNG/JPEG/GIF/WebP images are included; blocked images remain links.
  Interactive cards and approvals stay in Muse. No automatic scrolling, whole-message
  deletion sync, or Beeper-to-Muse attachments are supported.
- One prompt runs at a time, with up to 20 outstanding prompts. Prompts support
  8,000 Unicode characters. Browser replies are capped at 23,000 JavaScript
  characters, with an explicit truncation notice.
- The extension refuses to overwrite a draft or send while Muse is busy. Keep
  the connected tab dedicated to this bridge. Interleaved manual messages stop
  response capture.
- Reply capture checks for the submitted prompt's echo, then waits for four
  seconds without changes after Muse's Stop button disappears. This is a website
  heuristic. A separate observer captures later text messages and revisions after
  the prompt finishes, without requiring another Beeper message. Revisions use native Matrix edits. Original timestamps are used when the DOM
  exposes an absolute timestamp; otherwise the first observation time is used
  and marked as such in event metadata. Verified Muse reaction labels map to native reactions from you or Muse, including
  removals. Read receipts remain unavailable; acknowledgments are not treated as
  read receipts. Virtualized messages provide text-only catch-up until rendered;
  those placeholders never overwrite already imported content.
- The popup opens once per Muse tab when no healthy tab is connected. Closing,
  reloading, or leaving a connected tab requests Chrome's standard confirmation,
  after you have interacted with that webpage. Disconnect first to remove it.
- Jobs interrupted during a send are blocked for inspection. They are not
  automatically replayed. There is no end-to-end exactly-once guarantee.
- This is a custom chat network, but Beeper may label its network as `bridgev2`.
  It is not an officially listed Muse integration in Beeper's network picker.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run package
go test -race -tags goolm ./...
```

Tests use synthetic DOM fixtures and temporary databases, with no accounts or
network access. They cover owner and recipient restrictions, durable queue
transitions, crash recovery, duplicate results, local API authorization, setup,
and browser response attribution. CI checks Linux and macOS.

Release ZIPs contain only the extension's explicitly listed public files and a
SHA-256 checksum is published alongside them. [Releasing](docs/RELEASING.md)
explains store submission and the tag-triggered GitHub workflow.

See [contributing](CONTRIBUTING.md), [security](SECURITY.md),
[architecture](docs/architecture.md), and [dependency notices](NOTICES.md).
Original project code is MIT licensed. Unaffiliated with Beeper or Meta.

## References

- [Beeper third-party bridge setup](https://github.com/beeper/bridge-manager#3rd-party-bridgev2-based-bridges)
- [mautrix bridge framework](https://docs.mau.fi/bridges/)
- [End-to-bridge encryption](https://docs.mau.fi/bridges/general/end-to-bridge-encryption.html)
- [Muse](https://muse.ai/)
