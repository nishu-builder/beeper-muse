# Website

The public landing page is https://nishu-builder.github.io/beeper-muse/.
Its source is `site/`: static HTML, CSS, the extension icon, and an original SVG sample image. There is no
JavaScript, build step, analytics, external font service, or registration form.
Private registration files are imported in the extension, never on this site.

To preview, run `python3 -m http.server 8080 --directory site` from the repository
root and open `http://localhost:8080`. Check desktop and narrow mobile layouts,
keyboard focus, the disclosure controls, and links after changing the page.
Run `npx prettier --check site docs/website.md .github/workflows/pages.yml`.

GitHub Pages must use **GitHub Actions** as its publishing source. The
`Deploy website` workflow publishes only `site/` after changes to that folder
or its workflow land on `main`. It can also be run manually. The `github-pages`
environment records the deployment and URL. Never change the artifact path to
the repository root: private local files and unrelated project content do not
belong in the website artifact.

Keep setup instructions in `docs/chrome-setup.md`; the site links there instead
of duplicating commands. Keep feature claims aligned with `docs/parity.md` and
distinguish source builds from older public releases. Website changes do not
require an extension version bump or Chrome Web Store submission.
