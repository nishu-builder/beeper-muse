# Security

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/nishu-builder/beeper-muse/security/advisories/new).
Do not publish tokens, private messages, logs, or pairing codes. Version 0.3.x is
the maintained experimental series; there is no guaranteed support SLA.

## Trust and permissions

Beeper registration gives this bridge a Matrix application-service identity and
its own ghost namespace. The configuration also supports owner double puppeting.
Treat registration credentials as powerful account credentials, not a narrow
permission to one message. The bridge enforces one owner and one dedicated room,
disables relay mode, and checks recipients before accepting or delivering work.

The Matrix leg requires encryption. The local process necessarily decrypts
prompts and encrypts replies; encryption does not hide content from this process,
Muse, or the connected browser. The browser leg uses authenticated HTTP on
loopback. A malicious local account is outside the isolation boundary.

The Chrome extension has a content script on `https://muse.ai/*`, storage and
active-tab access, and a host permission for `http://127.0.0.1:24819/*`. It does
not request cookies, browsing history, debugger access, or other website access.
The background worker holds the local token and does not expose it to the page
or content script. Only the selected main Muse tab and the extension popup may
issue extension commands.

Only queued prompts and newly captured reply text cross the browser API. The
adapter reads visible messages to attribute a response, but does not upload old
history to the bridge. It does not extract Muse session credentials or call
undocumented Muse endpoints. Agent approval controls are never clicked.

Both HTTP listeners bind to loopback. The browser API validates Host, Origin,
bearer authorization, JSON shape, and body size. It exposes queue operations,
not arbitrary Matrix sends or Beeper history search. The Matrix framework
validates its separate application-service authorization.

## Private storage

`.local/bridge.yaml` holds registration credentials, a crypto pickle key, owner
identity, and browser token. `bridge.db` holds Matrix sessions, recovery material,
room/member metadata, and message mappings. `queue.db` holds pending prompt and
reply text. After delivery or acknowledgment, the queue removes message bodies
from active rows but retains identifiers for deduplication. SQLite pages, WAL
files, backups, and filesystem snapshots may retain previous content; this is
not secure erasure.

`.local/bbctl.json` contains bbctl authentication configuration.
`.local/pairing-code.txt` contains the browser token. Setup creates owner-only
configuration files and a private directory on Unix. The popup verifies the code
against the running bridge before saving it to trusted-context-only Chrome local
storage. Protect backups and the local account. Public extension files contain
no credentials; the release packager uses an explicit file allowlist. Old 0.2
installations may still have a private `.local/extension/local-config.json`;
never distribute that generated copy. See [privacy](PRIVACY.md).

## Failure boundaries

Queued work is durable. Interrupted sends block for inspection rather than
replay automatically, but no exactly-once guarantee spans Matrix, the browser,
and Muse. Response attribution uses visible DOM structure and a quiet-period
heuristic. A changed page, concurrent manual activity, or delayed agent response
can prevent capture or make attribution uncertain. Use a dedicated tab and
inspect unexpected results in Muse.

To revoke access, disconnect/remove the extension, stop the bridge, and remove
its custom network in Beeper. See [operations](docs/operations.md) before deleting
server rooms, local state, or backups.
