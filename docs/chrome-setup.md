# Set up Beeper Muse

The current extension runs in Chrome. Registration is a one-time terminal step;
there is no companion process to leave running afterward.

## Requirements

- Chrome 127 or newer, a Beeper account, and access to [Muse](https://muse.ai/).
- Node.js 24+, npm, Git, and [bbctl](https://github.com/beeper/bridge-manager)
  for registration on macOS or Linux. Follow bbctl's current installation and
  sign-in instructions. Native Windows registration and WSL are untested here.
- One Chrome profile and one extension installation per registration. Two active
  copies with the same registration conflict.

On macOS, bbctl is available with `brew install beeper/tap/bbctl`.
A Beeper Desktop API token and a Go compiler are not needed for this setup.

## 1. Create a private registration

```sh
git clone https://github.com/nishu-builder/beeper-muse.git
cd beeper-muse
npm ci --ignore-scripts
umask 077
mkdir -p .local
BEEPER_MUSE_REGISTRATION="sh-muse-chrome-$(node -p "require('node:crypto').randomBytes(6).toString('hex')")"
bbctl config --type bridgev2 --output .local/chrome-bridge.yaml "$BEEPER_MUSE_REGISTRATION"
npm run prepare:registration -- .local/chrome-bridge.yaml
```

Follow bbctl's sign-in instructions if required. This creates
`.local/chrome-registration.json`. Import that file in the extension; do not
paste it into a website, issue, or chat. It grants the bridge access to your
Beeper account. The converter refuses to overwrite an existing JSON file.
Reuse your existing registration when updating; do not rerun registration just
to fix a disconnected tab.

## 2. Install the extension

### Public download

Download `beeper-muse-extension.zip` and `SHA256SUMS` from
[GitHub Releases](https://github.com/nishu-builder/beeper-muse/releases/latest).
On macOS, you can verify the download with `shasum -a 256 -c SHA256SUMS`;
on Linux, use `sha256sum -c SHA256SUMS` in the download directory.

Extract the ZIP to a permanent folder. Open `chrome://extensions`, enable
**Developer mode**, choose **Load unpacked**, and select the extracted folder
containing `manifest.json`. Keep that folder in place.

If installing through Chrome Web Store, confirm the version is 0.7.0 or newer.
Older companion releases use a different setup, and store review can delay the
new version. Store installations update through Chrome. For local builds, use
the automatic reload setup below.

### Build from source

From the repository, run `npm run build`, then load `dist/chrome-extension`
using the same **Load unpacked** steps. The source `extension/` directory is
part of the older companion build; do not load it for Chrome-only operation.

## 3. Import and connect

1. Open the **Beeper Muse — Chrome-only** popup and choose the private
   `.local/chrome-registration.json` file under **Beeper registration JSON**.
2. Keep the automatically opened **Beeper Muse connection** tab open. Pinning it
   helps keep it out of the way. Wait for **Beeper: Connected** in the popup.
3. Open and sign in to <https://muse.ai/>. Refresh the webpage if it was open
   before installing the extension.
4. Open the popup on the Muse main chat. Choose the catch-up amount and click
   **Connect this Muse tab**. Check the separate **Muse tab** status.
5. Open **Muse** in Beeper. Check message requests if it is not in your inbox.
   Send a short test prompt and verify its reply appears in Beeper.

The Connect button starts observation and the selected catch-up. It does not
send a test prompt. “Beeper connected” describes the server connection, not a
completed end-to-end sync. See [troubleshooting](operations.md) if either side
stops progressing.

Keep both tabs open and the Muse message box empty during bridge work. Closing
Chrome pauses syncing. After a browser restart, reconnect the Muse tab if needed.
The extension offers its popup once on an active Muse tab when no healthy tab is
connected. Chrome controls whether a leave-page warning appears and its wording;
it normally requires prior interaction with the webpage. Use **Disconnect Muse
tab** before closing to remove the extension's warning.

## Catch-up

Choose **Latest 20 loaded messages**, **All messages loaded in Muse**, or
**Only new messages**. **Catch up now** rescans the selected loaded history.
Scroll in Muse first to load older messages; the extension does not scroll or
fetch hidden account history. Repeated observations are deduplicated.

History uses silent batches and read markers. Source timestamps are used when
available; otherwise timestamps describe when the extension first observed the
message. Older imports are appended, not inserted between existing Beeper events.
Offscreen text placeholders may gain formatting and images when rendered later.

## Update without losing state

Store installations use Chrome's update service. When a downloaded update is
ready, the extension stops claiming new prompts, waits for current activity to
finish, saves its reconnect ticket, then reloads. The same selected Muse tab is
reconnected without a page refresh; drafts, encryption keys and queues are kept.
Google review and Chrome's download schedule still determine availability.

For a source checkout, update the existing `.local/chrome-extension` folder with:

```sh
npm run update:local
```

This builds the current checkout, stages a complete replacement, preserves private
configuration and publishes a completed-build marker. An installed 0.7.2+ local
build checks that marker and reloads when idle. It does not download arbitrary
code from GitHub, run a local server, or require a background terminal. Run the
command after pulling reviewed changes; it exits after installing the files.

**One-time transition:** after installing this update hook for the first time,
reload the extension at `chrome://extensions`, refresh Muse once, and connect it.
Later updates made with this command reconnect automatically. Use the same folder.
A freshly unpacked release ZIP still needs manual file replacement and reload;
the development marker is intentionally excluded from public ZIPs.

For initial private setup, `npm run prepare:browser-runtime --
.local/chrome-bridge.yaml` also seeds the registration. Future `update:local`
runs retain it. Never upload `.local`, staging folders or local configuration.
Do not remove/reinstall the extension to update: removal deletes encryption keys.

Reconnection is limited to the selected main Muse tab and a two-minute update
window. Closed, discarded or signed-out tabs need attention. If the updater cannot
confirm a safe source state, it waits; it never interrupts a prompt to force an
update. Chrome shutdown or a manual reload can still interrupt work.

Switching between an unpacked extension and the Web Store installation changes
the extension identity and storage. There is no crypto-state export/import tool.
Plan a fresh registration/chat for that switch, disable the old copy, and retain
old messages. Do not promise that importing credentials transfers the old keys.

## Moving from the Go companion

Finish or inspect pending jobs, stop the old companion, and disable its extension.
Create a new Chrome registration using this guide. The new runtime does not
import the Go SQLite encryption database, queued work, or old room mappings.
Keep private backups until you have verified the new chat. The old setup is
recorded in [legacy companion](legacy-companion.md).

For pausing, interrupted jobs, removal, and credential revocation, see
[operations](operations.md). Current testing limits are in [validation](validation.md).
