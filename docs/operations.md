# Troubleshooting and recovery

Use the popup's separate **Beeper** and **Muse tab** statuses. A successful socket
connection does not mean the tab is connected, history has finished, or a reply
has reached Beeper. Queue counts describe saved work; capture counts describe
what the Muse adapter has observed.

## Common problems

| Symptom                                           | Action                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Start the local bridge” or a pairing-code field  | You loaded the legacy extension. Follow [Chrome setup](chrome-setup.md); disable the old copy.                                                       |
| Beeper connecting or needs attention              | Open **Connection settings** and inspect the startup stage/error. Keep the connection tab open. Use **Reconnect Beeper** after addressing the error. |
| Another instance is connected                     | Pause/disable the other extension or development probe using this registration, then reconnect deliberately.                                         |
| Beeper connected, Muse tab not connected          | Open the signed-in Muse main chat, and click **Connect this Muse tab**.                                                                              |
| Pending prompt does not appear in Muse            | Keep the selected main chat open, clear any draft, and wait for existing Muse work to finish.                                                        |
| Muse answered but Beeper did not                  | Inspect the queue and interrupted-job controls. Do not resend blindly; the prompt may already have reached Muse.                                     |
| Catch-up misses messages                          | Scroll them into view in Muse, then use **Catch up now** with the appropriate history mode. The bridge cannot fetch hidden history.                  |
| Images or reactions are missing                   | Render the message in Muse and rescan. Unknown/virtualized markup and CORS restrictions can limit extraction.                                        |
| Times look recent or history appears out of order | Muse may not expose original timestamps. Fallback times describe first observation; forward imports do not reorder existing events.                  |

Local 0.7.2+ development builds use `npm run update:local` for automatic reload
and reconnection. An update waits for active work and a responsive source tab.
If it remains waiting, inspect pending prompts and Muse activity; reconnect a
missing or discarded tab. See [update setup](chrome-setup.md#update-without-losing-state)
for the one-time transition and manually unpacked ZIPs. Keep the same installed
extension and folder; clearing data or reinstalling is not a normal fix.

Muse's product-query or monitoring errors do not by themselves diagnose a bridge
failure. Use the extension's status rather than assuming every Muse console error
comes from the extension.

## Phone has the room, Desktop does not

Check Beeper's message requests and search for Muse. Version 0.6.6 fixed a concrete
Desktop loading failure: the bridge ignored the capabilities request, leaving
Desktop queuing events for an unloaded account. The 0.7 release includes this
handler, the account announcement, and matching direct-chat metadata.

Confirm the installed version, reload the existing extension, and allow Desktop
to retry. The current room has appeared in Desktop’s account list after this fix, but its
room-detail API still returned HTTP 500 during testing. If it does not open,
capture the version and non-sensitive status
for a bug report. Do not create successive registrations or rooms as a retry
strategy. A mobile room and an authenticated socket are useful evidence, but do
not establish Desktop success; see [validation](validation.md).

## Interrupted jobs

If Chrome stops after claiming a prompt, Muse may already have accepted it.
The extension blocks that job rather than submitting it again. Check Muse and
Beeper, then use **I handled this in Muse** to clear the interrupted job when
appropriate. That control clears the saved prompt; it does not roll back Muse
or reconstruct a missing response.

Saved Matrix deliveries retry with their original encrypted payload and event
IDs. This is distinct from retrying a prompt in Muse. Avoid submitting the same
prompt manually while its delivery status is uncertain.

## Encryption and storage

If startup reports a device/key mismatch, keep the extension and its data intact.
Do not reset the device or delete IndexedDB. A private registration file is not
a backup of browser encryption keys. There is currently no supported crypto
export/import or cross-profile migration tool.

The crypto database, pending messages, and deduplication receipts live in the
Chrome profile. Browser/OS backups may retain them. An encrypted store whose
passphrase is also on that profile is not protected from a compromised profile.

## Pause and removal

**Disconnect Muse tab** stops source observation. **Pause Beeper connection**
stops the server connection. Closing Chrome also pauses syncing. Pending work
is retained locally; these actions do not delete remote messages.

Before removing the extension, inspect/finish pending jobs. Uninstalling removes
its local credentials, encryption keys and queues. It does not revoke the remote
registration or erase Beeper/Muse conversations. Use Beeper's supported bridge
management tools to revoke the registration separately, checking their deletion
behavior before proceeding. Delete private setup files/backups only when no
longer needed; filesystem deletion does not guarantee secure erasure.

Legacy companion files/processes have separate removal needs; see
[legacy companion](legacy-companion.md).

## Report a problem

Include the extension version, Chrome/OS/Beeper versions, whether Desktop and
mobile differ, the popup's startup step/error, and reproducible steps with a
synthetic prompt. Redact messages, room/user IDs, registration JSON, tokens,
private files and browser profiles. Do not attach raw diagnostic logs publicly.
Use [private vulnerability reporting](../SECURITY.md) for security issues.
