# Contributing

Start with [architecture](docs/architecture.md) and [runtime protocol](docs/browser-runtime.md).
Read the [parity ledger](docs/parity.md) before choosing work. Keep reported bugs,
implemented changes and live verification separate, and update it when findings
or priorities change. An interrupted investigation stays open across handoffs.

## Development

Use Node.js 24+, npm, and the standard unzip utility for package tests.
The same toolchain builds and checks the entire project on Linux and macOS.

```sh
npm ci --ignore-scripts
npm run build
npm run check
npm run package
```

`npm run build` writes the public extension to `dist/chrome-extension`.
`npm run format` formats TypeScript, JavaScript, CSS, HTML and documentation. Tests use synthetic DOM,
mocked Chrome APIs and isolated temporary databases; they do not require accounts.
See [validation](docs/validation.md) for live checks still needed.

## Source layout

- `src/`: typed Muse contract, DOM adapter and sync/activity tracking.
- `browser-runtime/runtime/`: service worker, popup, connection tab, content
  script and icons; shared transport/storage modules are one directory above.
- `scripts/`: builds, registration, updates, releases and optional live test tools.
- `test/`: synthetic behavior and packaging regressions.
- `site/`: GitHub Pages source; `docs/`: guides, active issues and dated history.

Generated content scripts live in `dist/content/`; the complete extension is
`dist/chrome-extension/`. Source directories are not loadable extensions.

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

Use `npm run update:local` to build and install into `.local/chrome-extension`.
After the one-time manual installation of 0.7.2+, local builds reload when idle
and reconnect the selected Muse tab. The command exits; no watcher or companion
is needed. Do not run concurrent builds against the same `dist` directory.

## Live development loop

Use [the development loop](docs/development-loop.md) to configure a pinned test
chat and diagnostic file once. `npm run dev:doctor` checks readiness without
sending; `npm run dev:cycle` checks, updates and tests the installed extension.
The typed driver uses Beeper Desktop's API and records each send before making
it. `dev:observe` resumes an unfinished observation without resending. This is
optional maintainer tooling, not part of the shipped extension.

## Website

For landing-page edits and GitHub Pages deployment, see [website maintenance](docs/website.md).
