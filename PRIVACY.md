# Privacy policy

Effective September 14, 2026. Applies to the Chrome-only 0.8 release series.

Beeper Muse connects one dedicated Beeper chat to your selected signed-in Muse
conversation. It is maintained in the [public repository](https://github.com/nishu-builder/beeper-muse).
The maintainer operates no relay, analytics, advertising, or data-collection service.

## Data used and where it goes

The extension receives text prompts and supported photos from your Beeper chat, decrypts them locally,
and enters them in the Muse tab you connect. It reads loaded conversation text,
links, formatting, accessible images, explicit reactions and visible activity
so it can send the corresponding Matrix events to Beeper. Selected catch-up
can include earlier messages already loaded in that conversation.

When recognizable, the selected assistant's avatar is copied to the Muse bot's
Matrix profile, room avatar and bridge metadata. Unlike encrypted message
attachments, these are ordinary, unencrypted Matrix profile/state media. Avatar
retrieval follows the same browser access rules, with a 512 KiB limit. The saved
avatar record contains a content hash, Matrix media address and completion flag;
the diagnostic file contains neither the image nor its address.

The Muse website uses your existing signed-in session to communicate with Muse.
The extension connects directly to `matrix.beeper.com` over HTTPS and WebSocket.
Beeper photo downloads can redirect to its Cloudflare R2 storage service. The
worker follows that redirect without forwarding Authorization across origins
and without cookies or referrers. Photo bytes are passed to the selected Muse
composer for upload using your existing Muse session.
These providers process data under their own policies. There is no companion
server or localhost connection in the current package. No messages or credentials
are sent to the maintainer, sold, used for advertising, or used for credit scoring.

The extension does not read Muse passwords, cookies, authentication tokens,
browsing history, or unrelated tabs' content. It does not automatically scroll
through your whole history or switch conversations. Muse image retrieval uses ordinary
browser fetches subject to CORS and size/time limits; inaccessible images remain
links. No remotely hosted executable code is loaded.

## Local storage

The imported application-service credential stays in trusted Chrome extension
storage, not Chrome Sync or the Muse content script. A private extension port
passes it in memory to the connection tab for the WebSocket handshake. Treat the
registration JSON as a powerful account credential and keep setup files private.

IndexedDB holds the crypto device token, encrypted crypto database, its local
passphrase, room/source identifiers, hashes, pending incoming transactions,
outgoing encrypted batches, pending Muse prompt text and incoming photo references
(including attachment decryption metadata). Downloaded plaintext photo bytes are
held in memory while submitting, not added to the durable job queue. Completed payloads are
cleared while compact deduplication records remain. The selected Muse tab and
popup state are stored for the session. Profile backups can retain deleted data.

The crypto-store passphrase lives on the same Chrome profile. This protects the
protocol state format, not against someone controlling that profile. Beeper-to-
bridge encryption does not hide messages from this extension, the local browser,
or Muse: the bridge must read plaintext to perform the integration.

## Permissions

| Permission or host                     | Use                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `storage`                              | Save registration and session selection in local/session extension storage                                     |
| `scripting`                            | Reinstall bundled content scripts in the selected Muse main frame after an update, without refreshing the page |
| `unlimitedStorage`                     | Persist IndexedDB queues and crypto state without ordinary quota eviction                                      |
| `alarms`                               | Schedule reconnect/recovery checks                                                                             |
| `activeTab`                            | Identify the active tab when connecting Muse                                                                   |
| `declarativeNetRequestWithHostAccess`  | Set authentication headers for the exact Beeper socket and connection tab                                      |
| `webRequest`                           | Observe that socket's handshake for bounded diagnostics                                                        |
| `https://muse.ai/*`                    | Run the adapter on the explicitly connected Muse conversation                                                  |
| `https://matrix.beeper.com/*`          | Matrix requests, encryption key exchange and encrypted media upload                                            |
| `https://*.r2.cloudflarestorage.com/*` | Retrieve photos from the storage URLs supplied by Beeper                                                       |
| `wss://matrix.beeper.com/*`            | Beeper application-service WebSocket                                                                           |

Handshake diagnostics show verification flags, status codes and bounded errors;
they do not display or transmit credentials or raw frames. Read-only bridge
capability requests contain no conversation data. Account discovery validates the
owner and supplied client token against the configured Beeper homeserver.

## Your controls

Disconnect the Muse tab to stop observation; pause the Beeper connection to stop
server connectivity. Closing Chrome pauses the bridge. Uninstalling deletes its
local storage and pending work but does not revoke the remote Beeper registration
or remove messages already held by Beeper or Muse. Private setup files and
backups must be removed separately. See [removal and recovery](docs/operations.md).

Earlier companion versions stored credentials/messages in local files and SQLite
and communicated over loopback. Those components are not in the current public
ZIP; consult [legacy companion](docs/legacy-companion.md) if still using them.

Policy changes are committed here. Ask privacy questions in a
[GitHub issue](https://github.com/nishu-builder/beeper-muse/issues) without private
data; use [private vulnerability reporting](https://github.com/nishu-builder/beeper-muse/security/advisories/new)
for sensitive security reports.

During a planned update, a reconnect ticket containing the selected tab ID, Chrome document ID and
a two-minute expiry is saved locally and removed on restoration or expiry.
Unpacked development builds read a local build marker; they do not contact an
update server or download executable code. Store updates are delivered by Chrome.

## Optional diagnostic file

The extension keeps a bounded local ring of 200 diagnostic entries using a closed
schema: timestamps, versions, fixed event codes and bounded upload-control counts.
It does not record message text, image bytes, filenames, credentials, account or
message identifiers, raw exceptions, or page URLs. A read-only upload readiness
check counts controls without submitting anything.

You can choose one normal file in Chrome's save dialog for an automatically
updated copy of that ring, plus a heartbeat containing the extension version,
source build fingerprint, connection/ready flags and queue counts. This heartbeat
updates about every five seconds while the connection tab is running; it contains
no account identifiers or message contents. The file handle and write grant stay in this Chrome
profile; no new host permission, relay or companion is involved. The connection
tab writes only while permission is granted. You may need to renew permission
after a restart. Stopping file logging forgets the handle and stops updates,
but does not delete the exported file or the internal diagnostic ring. File
backups can retain copies. Share the file only with people you want to inspect it.

The optional development driver runs separately when a maintainer invokes it.
It uses a separately supplied Beeper Desktop API token on localhost, verifies
one pinned chat and reads that chat's recent messages in memory. It can send
synthetic test prompts and generated test images. Its private run journal stores
that target's identifiers and synthetic prompts under `.local/`; sanitized
reports exclude conversation contents. This tooling is not included in extension
packages and does not run for ordinary users.
