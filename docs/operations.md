# Operations

The bridge runs in the foreground. No background service, login item, or browser
extension is installed automatically. Keep the bridge and the connected Muse tab
open. Beeper Desktop can be closed after setup; Beeper clients communicate through
the server. Chrome throttling and computer sleep can interrupt browser work.

## Normal use

Send an ordinary text message in the **Muse** chat. Messages from other rooms or
users are rejected. The connector checks room membership before accepting a prompt
and delivering a reply; additional invited or joined recipients block processing.

Leave the Muse composer empty and connect one extension instance. The browser
adapter clicks only the main message Send button. Purchases, permissions, and other
agent approvals must be handled in Muse. A stable initial answer may precede a
longer task's eventual result; later unsolicited updates are not mirrored.

## Interrupted jobs

`npm start -- status` reports `idle`, `queued`, `claimed`, `ready`, `delivering`,
or `blocked`. Unclaimed prompts and completed browser results survive restarts.
Claims are persisted before sending to Muse. A claimed or delivering job becomes
blocked after a restart. An unanswered browser claim blocks after 30 minutes.

1. Disconnect the extension and stop the bridge with Ctrl+C.
2. Check both Muse and Beeper to see whether the prompt and reply arrived.
3. Run `npm start -- acknowledge` and type `checked`.
4. Restart the bridge, reconnect the extension, and enter a new prompt if needed.

Acknowledgment discards the interrupted job without replaying it. Never delete a
database to force a retry. A crash can happen between a successful remote send and
its local receipt being saved.

## Encryption troubleshooting

Keep `encryption.allow`, `default`, and `require` enabled. Setup also enables
`self_sign`; Beeper's generated application-service and verification settings are
preserved. Do not lower verification requirements to work around a failure.

If logs show `m.unauthorised` while requesting a room key, the bridge did not
receive the encryption session for that message. Quit and reopen the sending
Beeper client to refresh its device information, then send a new test message.
An old session may remain inaccessible even after identity setup is corrected.
During development, a fresh room created after the corrected crypto startup
received a new session and passed the complete round trip. Do not erase crypto
keys to repair an old room. Preserve its history and investigate room migration
with the bridge maintainer if refreshing the client is insufficient.

During local testing, the server initially returned HTTP 500 with `unknown
signature` while the bridge signed its master key. The device and recovery keys
had already been saved, and a subsequent start succeeded. Preserve both
`bridge.yaml` and `bridge.db`; inspect any process lock as described below before
restarting. Do not enable `msc4190` on a server that does not support it, erase
crypto state, or repeatedly generate replacement identities.

See the current [validation record](validation.md) and the maintainer's
[encryption troubleshooting](https://docs.mau.fi/bridges/general/troubleshooting.html).
If a fresh message still cannot be decrypted, stop the bridge and investigate
Beeper compatibility before depending on it.

## Locks and configuration

The connector reserves `.local/connector.lock` before opening the Matrix crypto
database. Its PID identifies the process holding the state. A crash or fatal
framework startup error can leave this file behind. Verify that the recorded PID
has stopped before removing that one lock file. Never remove a running process's
lock or delete database files to clear it.

Use one process and one private data directory per registration. If either port
24819 or 24820 is occupied, identify the listener and stop only an old connector
that you own. Do not stop an unrelated service.

To update: stop the bridge, update the source, run `npm ci --ignore-scripts`,
`npm run build`, and `npm start -- setup`. Reload the unpacked extension at
`chrome://extensions`, reload Muse, reconnect, and restart the bridge. Back up the
entire private directory while stopped. The configuration and crypto database
must be restored together. Logs can include Matrix identifiers and errors; redact
them before sharing.

Version 0.3 uses a public extension paired through its popup instead of a private
generated copy. Follow the [0.2 upgrade instructions](setup.md#upgrade-from-version-02)
when migrating. Store extension updates do not update the local bridge.

## Upgrading from 0.1

Stop the old Note to self relay while its queue is idle. Version 0.2 creates a new
Muse chat and does not import the old queue or history. Setup preserves a valid
local extension token, but you must reload the generated extension. Review any
unfinished 0.1 jobs in both apps before proceeding. Keep old private state until
recovery is complete; do not run both versions on port 24819.

## Removal

Disconnect/remove the extension and stop the process. Remove the custom sh-muse
network through Beeper's settings when you no longer want it. The official
`bbctl delete sh-muse` operation permanently erases its server rooms and ghosts;
use that only if you intend to delete those chats. Local configuration and
backups must be removed separately. Removing this bridge does not delete your
Muse conversation.
