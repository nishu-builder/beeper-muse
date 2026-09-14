# Chrome Web Store listing

Item: **Beeper Muse** (`bchjpmhhlhpcokhlmbpbiibehfjdgnme`).
Category: Productivity / Communication. Language: English. Free, public.
Target package: **0.8.0**, Chrome-only. Verify the actual dashboard status before
claiming the update is submitted or published.

## Description

Use Muse from a dedicated chat in Beeper.

Setup instructions: https://github.com/nishu-builder/beeper-muse

## URLs and artwork

- Homepage/setup: <https://github.com/nishu-builder/beeper-muse>
- Detailed setup: <https://github.com/nishu-builder/beeper-muse/blob/main/docs/chrome-setup.md>
- Support: <https://github.com/nishu-builder/beeper-muse/issues>
- Privacy: <https://github.com/nishu-builder/beeper-muse/blob/main/PRIVACY.md>
- Icon: `extension/icons/icon128.png`
- Architecture illustration: `docs/store/chrome-only.png` (1280 × 800)

Remove the old companion pairing screenshot. The new illustration describes the
Chrome-only architecture with synthetic text; it is not a screenshot or live
verification record. Use the supplied icon, with no private account images.

## Single purpose

Connect one dedicated Muse chat in Beeper to the user's selected signed-in Muse
conversation, directly from Chrome. Forward text prompts and preview photo uploads, and sync observable
conversation content through an encrypted Beeper application-service connection.

## Permission justifications

| Permission                             | Justification                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `storage`                              | Store imported registration in trusted local extension storage and selected-tab state in session storage; no Chrome Sync |
| `scripting`                            | Reinstall bundled content scripts in the selected Muse main frame after an update, without refreshing the page           |
| `unlimitedStorage`                     | Retain IndexedDB encryption keys, durable message queues and deduplication receipts                                      |
| `alarms`                               | Schedule reconnection/recovery checks when the worker restarts                                                           |
| `activeTab`                            | Identify the active Muse tab when the user chooses Connect                                                               |
| `declarativeNetRequestWithHostAccess`  | Set required authentication headers and remove Origin only for the exact Beeper appservice WebSocket and connection tab  |
| `webRequest`                           | Observe that scoped WebSocket handshake for header verification, HTTP status and bounded error diagnostics               |
| `https://muse.ai/*`                    | Read the connected conversation and submit text/photos through its visible composer                                      |
| `https://matrix.beeper.com/*`          | Exchange Matrix events, device keys and encrypted media directly with Beeper                                             |
| `https://*.r2.cloudflarestorage.com/*` | Download Beeper photos from its signed storage redirects; no cookies or cross-origin Authorization forwarding            |
| `wss://matrix.beeper.com/*`            | Maintain the authenticated application-service WebSocket                                                                 |

No localhost host permission or companion process is required. All executable
JavaScript and WebAssembly are bundled; no remotely hosted executable code.

## Data disclosures

Disclose authentication information (Beeper registration/device credentials),
personal communications (prompts, replies, images, reactions), and website content
(the selected Muse conversation). Data is stored locally as needed and sent to
Beeper/Muse to provide the stated function, not to the maintainer. No sale,
advertising, unrelated use, or credit scoring. The [privacy policy](../PRIVACY.md)
explains local storage, provider processing, permissions and removal.

Do not claim that messages are never read or transmitted: the extension handles
plaintext to bridge them and transmits encrypted Matrix events to Beeper.

## Reviewer instructions

Reviewers need their own Beeper and Muse accounts, Chrome 127+, and a macOS/Linux
machine for the one-time bbctl/Node registration step. There is no shared personal
account or password to enter into the extension.

Follow the public setup guide to create and import the private registration JSON.
No companion app or terminal remains running afterward. Keep the connection tab
open, sign into Muse, refresh its main chat, and choose **Connect this Muse tab**.
Send `Reply with exactly: MUSE_CONNECTED` in Beeper's Muse chat and check the reply.
Test disconnect, pause/reconnect and a repeated catch-up. Interactive approvals
stay in Muse. The release remains experimental; the public validation document
states live-test limits. Never supply a maintainer's personal credentials.
