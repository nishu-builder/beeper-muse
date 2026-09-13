# Contributing

Use Go 1.26+, a C compiler, and Node.js 24+. Install dependencies with
`npm ci --ignore-scripts`, then run `npm run check` and
`go test -race -tags goolm ./...`. Format with `npm run format`.

Keep changes focused. Add regression coverage for recipient checks, queue state
transitions, recovery, browser attribution, and authentication. Tests must use
synthetic fixtures and isolated temporary directories, without real accounts or
network services. Do not commit credentials, room identifiers, conversations,
browser profiles, or screenshots of personal data. Never commit `.local/` or
the generated extension.

Use the mautrix framework for Matrix transport and encryption. Keep browser
permissions narrow. Do not add Muse cookie extraction, undocumented Muse account
endpoints, or automatic clicks on agent approval controls. Website selector
changes need a consenting test account and an honest validation record.

Update documentation for behavior changes. Commit `go.mod`, `go.sum`, and the npm
lockfile when dependencies change. Check dependency licenses before adding them.
Pull requests should explain the concrete problem, resulting behavior, and
validation. Keep discussions constructive and respectful.
