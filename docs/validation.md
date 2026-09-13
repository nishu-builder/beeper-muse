# Validation record

## Automated checks

`npm run check` passes locally on macOS with Node.js 24 and Go 1.27.1. This runs
TypeScript checking, the browser/setup tests, Go tests, the native build, and
format checks. `go test -race -tags goolm ./...` also passes. The production npm
dependency audit reports no vulnerabilities at the time of this check.
`govulncheck` v1.8.0 finds no vulnerabilities reachable by this code or its imported
packages; it reports three advisories elsewhere in required modules.

Coverage includes:

- Distinct Muse identity, one-owner authorization, portal restrictions, text-only
  input, additional-recipient rejection, and startup locks.
- Persistent queue serialization, duplicate messages and results, recovery from
  interrupted browser/Matrix sends, expiry, size limits, and content removal.
- Host/origin/token validation, strict JSON requests, and private routing data.
- Setup preserving credentials and crypto keys, refusing owner changes and active
  locks, and never echoing malformed private configuration.
- Browser input events, one Send click, draft preservation, response extraction,
  rejection of interleaved manual messages, and extension tab authorization.

Tests use synthetic DOM fixtures and temporary databases. They do not require
accounts, contact live services, or establish real-world encryption compatibility.
The browser tests run in jsdom, not an installed Chrome extension.

## Live checks — September 13, 2026

- Official bbctl 0.15.0 authenticated using an existing Beeper Desktop login and
  registered a custom `sh-muse` application service.
- The Go bridge connected to Beeper over its application-service websocket and
  created a dedicated encrypted **Muse** DM, with the owner and distinct Muse
  ghost. Beeper Desktop displayed it as a single chat on the `bridgev2` network.
- Browser selectors were checked against the signed-in Muse main chat. The earlier
  0.1 relay had a successful controlled-UI prompt/reply round trip; that result
  does **not** establish success for the new Matrix transport.
- The custom bridge initially hit a server HTTP 500 while signing its master key.
  A later startup succeeded using the saved recovery/crypto state.
- An encrypted diagnostic notice sent by the bridge bot was readable in Beeper.
- A startup handler-registration race in mautrix was reproduced and addressed by
  registering application-service crypto handlers before event dispatch, with
  regression tests.
- The first test room retained an encryption session created before identity
  setup was corrected, producing `m.unauthorised`. A fresh encrypted room using
  the same verified bridge identity received a new session and decrypted its
  first test message successfully. The earlier test chat was retained.
- A **complete custom-bridge round trip passed**: an ordinary message sent through
  Beeper entered the Go queue, Muse returned the requested marker, and the bridge
  delivered it as a reply from the distinct Muse contact (`isSender: false`).
  Beeper displayed the exact text and linked it to the original message. The
  queue finished idle with prompt/result bodies cleared from the completed row.
- That check used controlled browser UI actions and the real queue claim/result
  endpoints. It validates encrypted transport in both directions, Muse response
  capture, sender identity, and reply mapping; it does not validate installation
  or execution of the packaged Chrome extension.

The generated Chrome extension has not been verified running in an installed
browser. The project is experimental and should not be treated as production
ready. See [operations](operations.md) for recovery and encryption troubleshooting.
