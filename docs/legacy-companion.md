# Legacy Go companion

This guide is for the older companion architecture, retained in source for
existing installations and protocol reference. New installations should use
[Chrome-only setup](chrome-setup.md). Current public extension downloads do not
contain the companion client.

## Components

The signed-in Muse tab communicates with the legacy Chrome extension. That
extension exchanges work with an authenticated loopback queue on port 24819.
The Go bridge owns a dedicated encrypted Beeper room and SQLite state. The
application-service listener uses port 24820. No port forwarding is required.

The Node wrapper starts the Go executable; it is not a relay or installed daemon.
The terminal must stay open while this version runs. The Beeper Desktop API is
not a runtime dependency.

## Build and operate

Requirements: macOS or Linux, bbctl, Node.js 24+, Go 1.26+, and a C compiler.
For an existing checkout and registration:

```sh
npm ci --ignore-scripts
npm run build:legacy
npm start -- start
```

For a deliberately new legacy installation, `npm start -- setup` registers
`sh-muse` and prepares `.local/`. Do not reuse that name for an unrelated bridge.
Load the `extension/` folder unpacked, open the popup, and pair with the code in
`.local/pairing-code.txt`. Refresh Muse and connect its main chat.

| Command                     | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `npm start -- setup`        | Prepare the legacy registration and private configuration |
| `npm start -- pairing-code` | Save the existing pairing code again                      |
| `npm start -- start`        | Run the companion in the foreground                       |
| `npm start -- status`       | Inspect queue state without displaying message bodies     |
| `npm start -- acknowledge`  | Clear an interrupted job after checking both apps         |

The wrapper supports `MUSE_DATA_DIR` and `BBCTL_BIN`; it does not automatically
load `.env`. Protect `.local/`, including registration files, pairing codes,
SQLite databases, WAL files, and backups. They can contain messages and credentials.

## Updates and migration

Stop the companion before rebuilding. Keep the registration, crypto database,
and queue together. Reload the legacy extension and refresh Muse after updates.
Do not delete databases to fix encryption errors or blindly replay uncertain
prompts. Completed queue bodies are cleared, but SQLite pages and backups can
retain previous content.

The Chrome runtime replaces this process with extension storage and bundled
Rust/WASM encryption. It cannot read the Go crypto database. Use a fresh Chrome
registration, stop this companion, and disable its extension before switching.
Keep the old chat/history until the new connection is verified. See
[Chrome migration instructions](chrome-setup.md#moving-from-the-go-companion).
