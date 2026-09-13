# Beeper Muse privacy policy

Effective September 13, 2026.

Beeper Muse is an open-source Chrome extension and local bridge maintained in
the [Beeper Muse repository](https://github.com/nishu-builder/beeper-muse). It
connects your dedicated Muse chat in Beeper to your signed-in Muse browser tab.
The maintainer does not operate a message relay, analytics service, or advertising
service for this extension.

## Information used

- **Prompts and replies:** the local bridge receives new text messages from your
  dedicated Beeper chat. The extension enters each prompt in the Muse tab you
  explicitly connect, reads the visible conversation to identify the corresponding
  new reply, and returns that reply to the local bridge for delivery to Beeper.
  On connection, the selected catch-up sends the most recent 20 loaded messages
  by default, all loaded messages, or only new messages to the local bridge and
  Beeper. It also reads later messages, formatting, accessible images, and revisions while connected. No
  automatic scrolling or account-wide history retrieval is performed.
- **Pairing code:** the extension stores your bridge's private pairing token in
  Chrome's local extension storage, not Chrome Sync. Access is restricted to
  trusted extension contexts; the page and content script do not receive it.
- **Tab selection:** the selected Muse tab identifier is stored for the browser
  session. The extension uses it to restrict which tab can claim bridge work or
  import messages. It also remembers which tabs have already shown an automatic
  popup, so dismissing it does not repeatedly reopen it.
- **Private bridge state:** the local companion stores Beeper registration and
  encryption credentials, room/message identifiers, and queued structured messages and image bytes on
  your computer. Completed message bodies and image bytes are cleared from active queue rows.
  Source message identifiers and content hashes are retained to prevent duplicate
  imports after restarts. SQLite files, backups, and filesystem snapshots may
  retain previous content.

The extension does not read your Muse password, cookies, or authentication
tokens. It uses the website through your existing signed-in browser session.
For images already displayed in the connected chat, the extension may make an
ordinary browser fetch to that image URL, subject to the page's CORS rules. It
does not add host permissions or bypass browser restrictions. Accessible images
are uploaded through the bridge's encrypted Matrix media path; inaccessible
images are represented by links. Messages can contain whatever personal
information you choose to send.

## Where information goes

The extension communicates with the bridge at `http://127.0.0.1:24819`, on your
own computer. The bridge exchanges messages with Beeper, and the Muse website
sends prompts to its own service using your existing account. These providers
process messages under their respective policies. Beeper Muse does not sell
data, use it for advertising, or send it to the maintainer. No analytics or
remote executable code is included.

The bridge must decrypt messages to send them to Muse. Encryption between
Beeper and the bridge does not hide content from your local process, browser,
or Muse.

## Permissions

`storage` saves the private pairing and session tab selection. `activeTab` lets
the popup identify the tab you choose to connect. Access to `https://muse.ai/*`
lets the content script read and operate the main Muse chat after you connect it.
Access to `http://127.0.0.1:24819/*` lets the extension exchange queued prompts
and replies with the authenticated local bridge. The extension does not request
browsing history, cookie access, or permission to operate unrelated websites.

## Your controls

Use **Disconnect tab** to stop using the selected tab. In **Change bridge**, use
**Forget this bridge** to remove the stored pairing code. Removing the extension
removes its local extension storage. Stop the bridge to stop its connection to
Beeper; its private local files and backups must be removed separately. None of
these actions deletes conversations already saved by Beeper or Muse. See
[removal instructions](docs/operations.md#removal) before deleting bridge state.

Policy changes will be committed in this repository. For privacy questions,
open a [GitHub issue](https://github.com/nishu-builder/beeper-muse/issues) without
including private data. For sensitive security reports, use
[private vulnerability reporting](https://github.com/nishu-builder/beeper-muse/security/advisories/new).
