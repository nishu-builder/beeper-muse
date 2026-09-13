# Operations

The connector runs in the foreground. It does not install a login item, service,
cron job, or browser extension automatically. Keep Beeper Desktop, the Node
process, and one connected Muse tab open. Chrome may throttle background tabs,
especially when the computer sleeps.

## Normal use

In Beeper Note to self, send `!muse` followed by your prompt. Only new messages
are accepted; editing an old command is not supported. The first run skips
existing messages. Later runs resume saved cursors and unclaimed queued jobs.

Prompts are limited to 8000 characters. Replies are text-only and capped at 23000
characters in the browser adapter. Inline links are preserved as text. Images,
widgets, and approval interfaces remain in Muse. The first stable text response
may be an acknowledgment of longer-running work, rather than its final result.

Leave the connected Muse tab's composer empty. The extension does not overwrite
user drafts or submit while the Stop button is present. Connect only one browser
extension instance to a relay; the queue itself serializes claims even if more
than one client reaches it.

## Recovery

`npm start -- status` reports `idle`, `queued`, `claimed`, `ready`, `sending`, or
`blocked`. A claimed job is never automatically handed to another browser. A job
interrupted during a browser send or Beeper send becomes blocked on restart. An
unresponsive browser job also blocks after 30 minutes.

For a blocked or abandoned job:

1. Disconnect the extension and stop the relay with Ctrl+C.
2. Inspect both Muse and Beeper to see whether the prompt or reply arrived.
3. Run `npm start -- acknowledge` and type `checked`.
4. Restart the relay, reconnect the extension, and enter a new prompt if needed.

Acknowledgment discards that interrupted job without resending it. Do not delete
state to force retries. Neither Muse's UI nor Beeper's send API gives this
connector an end-to-end idempotency guarantee.

## Locks and configuration

A crash may leave `.local/connector.lock`. Inspect the PID recorded in that file
and verify that its process has stopped before removing the lock. Never remove a
lock for a running process. Each installation needs its own private data directory;
do not run multiple independent installations against the same self-chat.

The relay always listens on `127.0.0.1:24819`. If that port is occupied, identify
the listener and stop only your own old connector. Do not kill another service.

After changing extension source, stop the relay, run `npm run build` and
`npm start -- setup`, reload the extension at `chrome://extensions`, reload Muse,
and reconnect the tab. The generated directory must remain private.

## Removing the connector

Disconnect and remove the Chrome extension, stop the relay, and revoke its
approved Beeper connection. You may then remove your local checkout and private
configuration. The connector never deletes messages from Beeper or Muse.
