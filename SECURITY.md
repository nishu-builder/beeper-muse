# Security

This is an experimental personal connector. Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/nishu-builder/beeper-muse/security/advisories/new).
Do not put credentials, private messages, or pairing codes in public issues.
Version 0.1.x is the currently maintained series; there is no guaranteed support SLA.

## Data and permissions

The Beeper access token stays in the local Node process and private configuration.
Beeper grants read/write access broadly; the self-chat restriction is enforced by
this application, not a chat-scoped token. The relay validates that the configured
chat contains exactly one participant marked as yourself before processing work.

The Chrome extension has a content script on `https://muse.ai/*`, storage access,
active-tab access for explicit attachment, and a host permission only for
`http://127.0.0.1:24819/*`. It does not request cookies, browsing history, debugger
access, or access to other websites. Its background worker holds the relay token;
that token is not passed into the Muse page or content script. Extension messages
are accepted only from the connected Muse tab or the extension's own popup.

Only your explicit queued prompts and newly captured reply text cross the local
relay. The extension reads the visible message list to identify the submitted
prompt and response, but does not upload prior chat history to the relay. It never
extracts Muse cookies or calls undocumented Muse endpoints.

The relay binds to loopback, checks the Host header and bearer token, rejects
website origins, caps request size, and refuses redirects. Its endpoints can
claim already-queued prompts and return a reply; they cannot search your Beeper
history or send arbitrary messages to other chats.

## Local storage

`.local/connection.json` stores the Beeper and relay tokens. The generated
`.local/extension/local-config.json` contains only the relay token. Pending jobs
in `.local/relay.json` contain their prompt and, briefly, response text so recovery
can avoid duplicate sends. Completed prompt and response bodies are removed from
relay state; message identifiers and cursors are retained. Files use owner-only
permissions on Unix. Use appropriate user-account protection on Windows.

Never share the generated extension directory. It is private configuration, not a
redistributable release. The source `extension/` directory has no credentials.

## Limits

A compromised local account or malicious extension with equivalent access is
outside this connector's isolation boundary. There is no exactly-once delivery
guarantee across crashes, network failures, or manual state changes. The web
adapter cannot formally prove which asynchronous agent output belongs to a prompt;
use a dedicated tab and inspect unexpected results in Muse.

To revoke access, disconnect/remove the Chrome extension and revoke Beeper Muse
under Beeper Settings → Integrations. Stop the local relay as well.
