# Contributing

Use Node.js 24 or newer. Run `npm ci --ignore-scripts`, make a focused change, then
run `npm run check`. Add regression tests for changes to chat restrictions, network
errors, queue transitions, browser selectors, or persistence.

Tests must use synthetic fixtures and isolated temporary directories. Do not
include credentials, chat identifiers, real conversations, browser profiles, or
screenshots of personal data in commits or issues. Never commit `.local/` or the
generated extension. Browser selector changes need manual verification in a
consenting test account, with the exact verification limits recorded.

Update documentation when behavior changes. Keep dependencies minimal and commit
the npm lockfile when they change. Prefer the documented Beeper SDK; do not add
Muse cookie extraction, undocumented account endpoints, or automatic clicks on
agent approval controls.

Pull requests should explain the user-visible problem, the change, and how it was
verified. Keep discussions constructive and respectful.
