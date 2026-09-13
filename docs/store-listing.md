# Chrome Web Store listing notes

Item: **Beeper Muse** (`bchjpmhhlhpcokhlmbpbiibehfjdgnme`).
Category: Productivity / Communication. Language: English. Free, public.

Version 0.3.0 was submitted on September 13, 2026. The dashboard confirms
**Pending review**, with automatic publication after approval enabled.
This is not yet an available Chrome Web Store installation.

## Description

Use Muse from a dedicated chat in Beeper.

Setup instructions: https://github.com/nishu-builder/beeper-muse

## URLs and artwork

- Homepage: <https://github.com/nishu-builder/beeper-muse>
- Setup: <https://github.com/nishu-builder/beeper-muse/blob/main/docs/setup.md>
- Support: <https://github.com/nishu-builder/beeper-muse/issues>
- Privacy: <https://github.com/nishu-builder/beeper-muse/blob/main/PRIVACY.md>
- Icon: `extension/icons/icon128.png`.
- Screenshot: `docs/store/setup-preview.jpg`, 1280 × 800, JPEG.

The screenshot shows the actual popup markup with synthetic connection state
and a visible setup-preview caption. It contains no private conversation or
credential. Use original assets and keep screenshots aligned with the package.

## Privacy disclosures

Single purpose: connect one dedicated Muse chat in Beeper to the user's existing
signed-in Muse browser conversation through a local companion bridge, forwarding
new text prompts and their replies.

| Permission                         | Justification                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `storage`                          | Save a private bridge token in trusted-context-only local storage and the selected tab ID in session storage. No Chrome Sync. |
| `activeTab`                        | Identify and validate the active Muse tab when the user clicks Connect.                                                       |
| `http://127.0.0.1:24819/*`         | Exchange queued prompts and captured replies with the authenticated local companion.                                          |
| `https://muse.ai/*` content script | Use visible controls and chat bubbles in the explicitly connected main Muse chat.                                             |

No remotely hosted executable code. Data disclosures identify authentication
information (the local pairing token), personal communications (prompts/replies),
and website content (visible chat text/links). They do not claim that the
maintainer receives this information: its path and local storage are explained
in the privacy policy. No sale, advertising, unrelated use, or credit scoring.

## Reviewer instructions

Reviewers need their own Beeper and Muse accounts and a macOS/Linux computer with
the setup prerequisites. There is no shared developer account. The extension
does not need account passwords entered into its popup.

Follow the public setup guide, start the bridge, pair using its generated code,
sign in to Muse, refresh its main chat, and connect that tab. Send
`Reply with exactly: MUSE_CONNECTED` in Beeper's dedicated Muse chat and verify
the reply appears from Muse. Inspect Disconnect and Forget this bridge as well.
Keep the terminal and browser running. Do not provide a maintainer's personal
credentials to reviewers; respond to requests for further access with a suitable
dedicated test arrangement.
