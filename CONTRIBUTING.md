# Contributing

Start with [architecture](docs/architecture.md) and [runtime protocol](docs/browser-runtime.md).
The current product is the Chrome-only extension. Legacy Go code is retained
for existing installations and protocol reference, not bundled into releases.

## Development

Use Node.js 24+, Go 1.26+, and a C compiler for the full repository checks.
Only Node/npm are needed to build the Chrome extension.

```sh
npm ci --ignore-scripts
npm run build
npm run check
go test -race -tags goolm ./...
npm run package
```

`npm run build` writes the public extension to `dist/chrome-extension`.
`npm run build:legacy` builds the older companion and client. `npm run format`
formats TypeScript, JavaScript, documentation and Go. Tests use synthetic DOM,
mocked Chrome APIs and isolated temporary databases; they do not require accounts.
See [validation](docs/validation.md) for live checks still needed.

## Boundaries to preserve

- Keep selectors in `src/adapter.ts`; source-neutral data belongs in
  `src/muse.d.ts`. A future API adapter should not depend on Matrix or storage.
- Keep protocol translation and durable recovery in the Chrome worker runtime.
  Never acknowledge transactions before persistence or replay uncertain prompts.
- Validate runtime data at every trust boundary. TypeScript interfaces are not
  sufficient validation. Keep one owner, one room and one crypto writer.
- Preserve unknown reaction/read state instead of inventing observations. Do not
  replace rich messages with partial offscreen text.
- Keep permissions narrow. Do not extract cookies or auto-approve Muse actions.
- Use maintained crypto libraries; do not implement cryptographic primitives.

Regression coverage should exercise failures and user-visible behavior: sender
checks, draft preservation, transport dispatch, crash recovery, deduplication,
image bounds, credential isolation and package contents. Do not embed personal
DOM, messages, tokens, room IDs, browser profiles or private screenshots in tests.
Generated extension bundles and `.local/` must not be committed.

Update docs and the changelog for behavior changes. Pin dependency changes with
lockfiles and review their licenses. A normal ready-for-review PR should explain
the problem, resulting behavior, validation and material limitations. Keep
community discussions constructive. Report security issues privately through
[the security policy](SECURITY.md).
