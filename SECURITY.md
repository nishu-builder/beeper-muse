# Security

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/nishu-builder/beeper-muse/security/advisories/new).
Do not post credentials, private messages, raw logs, profiles or registration files
in public issues. The current Chrome-only 0.8 series is experimental; there is
no guaranteed support SLA or claim of an independent security audit.

## Trust boundaries

A Beeper application-service registration is a powerful account credential, not
a narrow permission for one message. The runtime checks the configured owner,
dedicated room and membership before accepting or delivering work. Public builds
contain no registration. Imported credentials are restricted to trusted extension
contexts; the Muse page and content script do not receive them.

The worker owns crypto and storage. Its connection document is authenticated by
extension ID, exact URL, tab, top-level frame and port name. Request-header rules
apply only to the exact Beeper WebSocket URL and document. Credentials never
appear in URL parameters. Matrix requests use a fixed validated HTTPS endpoint,
omit browser cookies and reject redirects, except authenticated media downloads.
Those follow signed storage redirects using native fetch, which removes
Authorization on cross-origin redirects. The extension CSP limits network
connections to itself, Beeper and HTTPS Cloudflare R2 storage. Downloads reject
non-Matrix source URLs, cap streamed bytes at 5 MB, authenticate encrypted files
and check raster image signatures before handing bytes to Muse. No arbitrary
media proxy or general file upload is exposed.

The read-only provisioning handler answers public capability metadata and
owner-authenticated account discovery. It does not expose a general URL proxy,
local HTTP server, account mutation, contact search or group creation API.
Unsupported paths and methods fail explicitly.

The content script can read the selected Muse conversation and operate its
composer. Treat its messages as untrusted input: validate identities, content,
size bounds and allowed operations in the worker. Do not add cookie extraction,
undocumented account endpoints, broad host access, or automatic approval clicks.

## Encryption and persistence

Messages and media use Matrix encryption with bundled Rust/WASM crypto. The
extension necessarily handles plaintext prompts/replies. Encryption does not
hide them from Muse, the extension, or a compromised local browser profile.

IndexedDB stores device credentials, crypto state and its local passphrase,
pending work and compact deduplication receipts. One worker serializes crypto
and delivery. Incoming transactions are durably saved before acknowledgment;
outbound batches are saved before sending. Uncertain prompts are blocked instead
of automatically replayed. This does not provide end-to-end exactly-once delivery.

Uninstalling or clearing extension data can lose keys and pending messages.
The registration JSON alone cannot recover them. Browser/OS backups can retain
old data; deleting files or rows is not secure erasure. A local attacker with
profile access is outside the extension's isolation boundary.

## Distribution and dependencies

The public packager uses an explicit file allowlist, rejects symlinked release
files, and includes the WASM module and license notices. `.local/`, setup
credentials and development tooling are excluded. Never
upload a private development extension directory.

Dependencies are pinned in lockfiles. CI checks formatting, types, tests,
packaging and the production npm dependency audit. See [notices](NOTICES.md)
and [release process](docs/RELEASING.md). Tests and audits are not a substitute
for live compatibility testing or a security review.

To revoke access, pause/remove the extension and use Beeper's supported bridge
management tools. Review their room-deletion behavior first. See
[operations](docs/operations.md) and [privacy](PRIVACY.md).
