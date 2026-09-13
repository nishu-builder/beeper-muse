# Architecture

`cmd/beeper-muse` runs the mautrix bridgev2 Matrix connector and the Muse network
connector in `internal/connector`. The framework owns registration, websocket
transport, encryption, portal creation, ghosts, and message mappings. Network
login `browser` and portal `muse` map to one dedicated DM. The Muse ghost is a
separate sender; responses never impersonate the owner.

The configured owner's text messages pass sender, portal, message-type, and
membership checks before entering `internal/queue`. The Matrix event ID produces
a stable job ID. Duplicate Matrix delivery returns the existing mapping.

```text
queued → claimed → ready → delivering → done
            │                  │
            └──── blocked ─────┘
                     │
              manual acknowledgment → done
```

SQLite commits a claim before a browser can submit a prompt and commits
`delivering` before a reply is handed to Matrix. A post-processing callback
requires a persisted Matrix event mapping before completing a job. Restarted
claims and interrupted delivery are blocked. The completed identifier remains
to suppress duplicates. This protects against blind replay, not all possible
partial failures across independent systems.

The Chrome service worker handles pairing and local authorization. A content
script drives only the explicitly attached Muse tab. Its adapter uses DOM
controls and message identifiers, waits for the prompt echo and a stable reply,
and returns text through the service worker. A job carries its ID and prompt;
room IDs and Matrix credentials are never sent to the content script.

`scripts/manage.mjs` runs official bbctl registration, prepares private config,
copies the extension, and provides start/status/recovery commands. It is a setup
wrapper; the running Matrix bridge is Go and does not use the Desktop API.

`internal/matrixfix` registers application-service crypto listeners before event
processing starts. This compensates for the startup ordering in pinned mautrix
v0.30.0, which can dispatch queued keys while the handler map is still changing.
The wrapper preserves the original crypto implementation, trust checks, and
errors. Long-polling mode is unchanged. Reassess this wrapper when upgrading the
framework; do not register listeners twice.
