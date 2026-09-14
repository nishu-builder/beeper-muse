# Repeatable local development

The development driver checks, updates and tests the installed Chrome extension.
It is optional tooling for maintainers. It exits after each run; ordinary users
still need only Chrome. The driver talks to Beeper Desktop's documented local
API, not a second bridge, browser profile, or extension control server.

## One-time setup

1. Install the local extension from `.local/chrome-extension`, sign in to Muse,
   and connect the dedicated Muse chat. Keep the Muse and connection tabs open.
2. Enable Beeper Desktop's API and save its token in a private JSON file such as
   `.local/desktop-token.json` containing `{"token":"YOUR_TOKEN"}`. Do not put the
   token in a shell argument, source file or public issue.
3. In the extension popup choose **Diagnostic log**, then **Choose diagnostic log
   file** in the connection tab. Save `beeper-muse-diagnostics.json` in Downloads.
   Chrome requires this file grant from you. Later iterations read the file;
   they do not require copied popup text or screenshots. Chrome can require
   **Allow file updates** again after a permission reset.
4. Create `.local/dev-loop.json` with your exact test chat and participants:

```json
{
  "chatID": "YOUR_MUSE_ROOM_ID",
  "ownerID": "YOUR_BEEPER_USER_ID",
  "botID": "YOUR_MUSE_BOT_ID",
  "tokenFile": ".local/desktop-token.json",
  "diagnosticFile": "/absolute/path/to/beeper-muse-diagnostics.json"
}
```

Paths are relative to the repository unless absolute. An existing private
connection file with a `beeperToken` field also works. The token must be for
Beeper Desktop, not the bridge's application-service token. The driver pins the
room and verifies both participants, including the owner's `isSelf` flag. It
never chooses a conversation by title or sends to another contact.

Use the existing Muse chat for debugging only with its owner's consent. For
regular development, use a dedicated test account and matching Muse session:
these tests place visible synthetic messages into the configured conversation.
Do not point the driver at another room while leaving the extension on the old
one. This tooling does not create accounts or replace a registration.

## Daily loop

```sh
npm run dev:doctor
npm run dev:cycle
```

`dev:doctor` sends nothing. It checks target identity, chat-scoped message search,
log freshness, exact running build fingerprint, connection state, empty composer
and outstanding work. It saves a sanitized report in `.local/dev-doctor.json`.
Missing logging, a stale build, a draft or an interrupted job stops a test before
anything is added to the queue.

From 0.8.8, the file also records a separate `collection` heartbeat: whether event
storage and runtime health answered, the connection page's version/build, and a
bounded update stage with elapsed time. Each read is observed for three seconds;
a pending read is not restarted on every collection. A fresh collection with
unavailable health means the file writer is alive, not that syncing is healthy.
Previous known events remain available when event storage fails, with collection
marked incomplete. `dev:doctor` shows both freshness checks and refuses test sends
while runtime health is unavailable or an update is pending. This does not bypass
Chrome's file permission or prove that a build reload completed.

`dev:cycle` requires the full build prerequisites described in
[Contributing](../CONTRIBUTING.md). It runs repository checks, installs the local
build, waits up to 90 seconds for its exact fingerprint in the diagnostic file,
then runs a text test, a photo test and a subsequent text test. That last test
checks that a successful photo leaves the queue usable. A failure stops the
cycle. It does not dismiss or resend uncertain work. Do not run concurrent builds
against this checkout. A cycle lock prevents two cycle commands from building
at once; each test also takes a separate sender lock.

```sh
npm run dev:test -- text
npm run dev:test -- image
npm run dev:observe
```

Each send has a unique marker and a durable record written **before** any
mutation. Losing a response or restarting the driver never triggers an automatic
resend. `dev:observe` resumes reading the same run; it sends nothing. An individual
observation lasts up to 45 seconds and exits with status 2 if failed or still
unverified. Exit 0 means the scenario's required API evidence passed.

The photo test uploads a synthetic 64-by-64 PNG through Beeper Desktop. Its
randomly chosen red or blue color is not disclosed in the caption. A passing
reply must contain the test marker and the correct observed color. Text without
its attachment therefore cannot satisfy the test. The driver also requires a
native `SUCCESS` status naming the Muse bot as delivered recipient. Merely
accepting the HTTP send request is not delivery confirmation.

For an additional Muse-to-Beeper generation test:

```sh
npm run dev:test -- receive-image
# Or include it at the end of a complete cycle:
npm run dev:cycle -- --receive-image
```

This asks Muse to generate an image and may use its generation allowance. The
current verifier conservatively requires an image attachment on the marked
reply. An image emitted as a separate message remains unverified; an unrelated
image cannot pass the test. All scenarios still require a native delivery status.

## Reading failures and resuming

Private run records live in `.local/dev-loop-active.json`; completed records and
sanitized evidence reports live in `.local/dev-runs/`. Reports contain booleans,
fixed failure codes, version/build fingerprints and queue counts, not chat
contents. Private records include target identifiers, synthetic prompts and
pending message IDs; never attach them to public issues.

If an observation times out, run `dev:observe`, not `dev:test` again. After a failed
run is understood and the Muse composer/bridge queue have been inspected, use
`dev:close` to archive that test record. This command **only** closes the driver's
record. It does not dismiss a bridge job, clear a draft or retry a photo.
An uncertain upload still needs inspection before the extension can continue.
Failures known to occur before an upload starts remain visible but no longer
hold later ordinary messages.

Locks include an owner PID. After a crash, verify the recorded process and its
children have stopped before removing that specific stale lock. Never remove
another running test's lock to make progress.

## Evidence boundaries

The driver uses `/v1/chats`, `/v1/messages/search`, `/v1/assets/upload/base64` and
`/v1/chats/{chatID}/messages`, following the
[Beeper Desktop SDK](https://github.com/beeper/desktop-api-js). On the development
installation, the ordinary chat-detail/message-list endpoints return HTTP 500;
chat-scoped search works and is limited to 20 results per page. The driver rejects
truncated search results instead of declaring success from incomplete evidence.

A live report distinguishes the Muse reply from native delivery confirmation.
Typing animation, reactions rendered in a client, operating-system notification
banners and original Muse timestamps remain **unverified** unless separately
observed. A successful API response does not prove those UI behaviors.

Browser inspection uses the supported browser tooling when it is available.
The present `Debugger unattached` failure still prevents inspecting Muse's actual
upload controls. Neither the driver nor the diagnostic file bypasses browser
access restrictions. Log counts can identify a missing form/input, but they do
not establish the correct selectors by themselves.

See [validation](validation.md) for actual observations rather than treating the
existence of this harness as a passed live integration test.
