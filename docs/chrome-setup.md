# Chrome-only setup

Beeper Muse 0.6.3 is a preview that runs in Chrome. A service worker connects
to Beeper; the selected Muse tab supplies the conversation. No companion,
localhost server, native messaging host, or background terminal is needed while
it runs. Registration is a one-time setup using Beeper's `bbctl` tool.

The transport handshake and encrypted API delivery have passed live tests.
The complete Chrome worker, encryption storage, and both-direction conversation
flow still need a live Chrome acceptance run. Use the preview for testing.

## Prepare the extension

Use Node.js 24 or newer and Chrome 127 or newer. Install and sign in to
[bbctl](https://github.com/beeper/bridge-manager) using its instructions.
Clone this repository, then run:

```sh
npm ci --ignore-scripts
mkdir -p .local
BEEPER_MUSE_REGISTRATION="sh-muse-chrome-$(node -p "require('node:crypto').randomBytes(6).toString('hex')")"
bbctl config --type bridgev2 --output .local/chrome-bridge.yaml "$BEEPER_MUSE_REGISTRATION"
npm run prepare:browser-runtime -- .local/chrome-bridge.yaml
```

This creates `.local/chrome-extension`, with its private registration included
for local setup. Never publish that directory. `dist/chrome-extension` is the
public build and contains no credentials. A public build asks you to import
`.local/chrome-extension/local-config.json` through its popup.

Disable earlier Beeper Muse extensions and stop the old companion before switching.
Do not load a second copy using the same registration: a connection conflict
stops this runtime until you explicitly reconnect.

1. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
2. Select the complete `.local/chrome-extension` directory.
3. Open and sign in to `https://muse.ai/`. Refresh the webpage after loading or
   reloading the extension; reloading the extension does not replace an existing
   page's content script.
4. Open **Beeper Muse — Chrome-only** from the toolbar. Wait for **Beeper connected**, then choose
   **Connect this Muse tab**. A new **Muse** chat appears in Beeper.
5. Send a short message in that Beeper chat and verify the reply returns.

The build includes a toolbar icon. On an active Muse page, the extension offers
its popup once if no tab is connected. Keep the connected tab open with its
composer empty. Chrome can show its standard leave-page confirmation after
interaction with the Muse page; the extension cannot choose that dialog's text.
Use **Disconnect tab** before closing if you do not want that confirmation.

## Seeing “Start the local bridge”?

That message belongs to the older companion-based extension. The Chrome-only
build never asks you to start a local bridge.

In `chrome://extensions`, disable the older **Beeper Muse** extension and any
**Chrome connection test** copy. Keep **Beeper Muse — Chrome-only** enabled.
If it is missing, use **Load unpacked** and select `.local/chrome-extension`,
not `.local/extension` or `.local/chrome-probe`.

Refresh the Muse webpage, then open **Beeper Muse — Chrome-only** from Chrome's
extensions menu. The new panel says **Chrome-only v0.6.3** under its title and
shows separate **Beeper** and **Muse tab** connection states. Reloading the old
extension does not switch it to the new folder. You do not need to restart the
retired companion.

## What syncs

- New Beeper text messages are entered in Muse. Unsupported incoming message
  types and edits are not submitted as new prompts.
- Muse text, allowed formatting, accessible images, and subsequent revisions
  are sent using Matrix events. Images are encrypted before upload.
- Messages written in Muse appear as the owner, with assistant replies as Muse.
- Observed reactions use Matrix annotations and redactions. Muse activity uses
  a typing indicator that expires unless refreshed.
- Catch-up suppresses notifications and marks the imported batch read. Source
  timestamps are preserved when available; otherwise the first observation time
  is used and identified as a fallback in event metadata.

Catch-up covers only what Muse has loaded: latest 20, all loaded, or only new
messages. It does not scroll or retrieve an account's full history. It does not
reposition older imports between events already in Beeper. Approvals, shopping
widgets, and other interactive controls remain in Muse. CORS-inaccessible images
cannot be uploaded by the page adapter. Beeper-to-Muse attachments, reactions,
and typing are not implemented; source read status is only propagated when the
adapter actually provides it.

## Recovery

The popup shows the current startup step and time spent there. A step that takes
more than 60 seconds is reported as stalled. It does not start a second encryption
writer while the first operation is pending; reload the same extension to retry.
Connection settings lists the recent startup steps without credentials or message
contents. Socket failures remain visible during the automatic retry delay.

Incoming transactions and outgoing encrypted batches are saved in IndexedDB.
A lost send response retries the same ciphertext and event IDs. Crypto keys and
the device identity persist across worker restarts. If the saved keys do not match
the registered device, startup stops rather than replacing that device's keys.

The worker sends a protocol ping every 20 seconds. A Chrome alarm can restart a
failed connection with bounded backoff. Closing Chrome pauses delivery. Reopening
Chrome reconnects Beeper; connect a Muse tab again if the previous browser session
ended. The popup distinguishes Beeper connectivity from Muse-tab connectivity.

A prompt claimed before a worker interruption is marked **interrupted**, because
Muse may already have accepted it. Check Muse, then use **I handled this in Muse**
to clear it. The extension never automatically resubmits an uncertain prompt.

Use **Pause Beeper connection** to stop locally. Removing the extension also
removes its encryption storage and pending work. Keep the extension installed
when updating: reload the same directory instead of removing and reinstalling.
Remote registration deletion is separate and can be done with Beeper's bridge
management tools. Deletion may also affect associated rooms; check that tool's
instructions first.

## Building a public package

```sh
npm run build:browser-runtime
```

Package the contents of `dist/chrome-extension` only. Keep `crypto.wasm` and
`MATRIX-CRYPTO-LICENSE` alongside the JavaScript. Do not package `.local` or a
registration JSON file. The preview is not the extension currently under Chrome
Web Store review.
