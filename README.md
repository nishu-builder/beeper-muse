# Beeper Muse

Chat with your Meta Muse agent from Beeper through a local relay and a small
Chrome extension. **No WhatsApp connection and no Muse credential extraction.**

**Experimental, text-only, personal-use integration.** This operates the Muse
website through its visible controls; it is not an official Muse API or a native
Beeper network bridge. Website changes can break it.

```text
Beeper Note to self → local relay → Chrome extension → Muse web app
                   ← text reply  ←                  ←
```

In Beeper's **Note to self**, send:

```text
!muse Explain why the sky is blue in two sentences.
```

The extension enters that prompt in your selected, signed-in Muse tab. The first
stable text reply returns to the self-chat with a **Muse** prefix. Beeper shows
the returned message as sent by your own account.

## Requirements

- Node.js 24 or newer and npm.
- Beeper Desktop with its local API enabled under Settings → Integrations.
- A working Beeper **Note to self** chat.
- Chrome, a signed-in Muse account, and permission to load an unpacked extension.

Both Beeper and the connected Muse tab must remain open while the relay runs.
The default relay address is `127.0.0.1:24819`; it is never exposed publicly.

## Install

```sh
git clone https://github.com/nishu-builder/beeper-muse.git
cd beeper-muse
npm ci --ignore-scripts
npm run build
npm start -- login
npm start -- setup
```

Approve the Beeper login in your browser. `setup` selects the unambiguous Beeper
Note to self chat and prints the absolute path to `.local/extension`. No message
is sent during setup.

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select the generated `.local/extension` directory.
3. Open the main chat at [muse.ai](https://muse.ai/) and sign in. Reload it if it was
   already open before the extension was installed.
4. Click the extension's toolbar button, then **Connect this Muse tab**.
5. Run the relay:

```sh
npm start -- start
```

Open your self-chat with `npm start -- open`, then send a new `!muse` prompt.
Existing chat history is skipped on first launch.

**Keep `.local/` private.** The generated extension contains a local relay token.
Share this repository's `extension/` source, never your generated extension.
No extension or background service is installed automatically.

## Commands

| Command                    | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `npm start -- login`       | Connect to Beeper with OAuth and PKCE.                         |
| `npm start -- setup`       | Choose the self-chat and generate the private extension.       |
| `npm start -- doctor`      | Check local configuration and self-chat access; sends nothing. |
| `npm start -- start`       | Run the local relay in the foreground.                         |
| `npm start -- status`      | Show queue state without printing prompts.                     |
| `npm start -- open`        | Open the configured self-chat in Beeper.                       |
| `npm start -- acknowledge` | Resolve an interrupted job after inspecting both apps.         |

Optional environment settings are documented in [.env.example](.env.example).
They may be placed in a private `.env` file. The extension's local port is fixed
to keep its host permission narrow.

## Boundaries

- Only explicit `!muse` prompts authored by you in the configured self-chat are
  forwarded. Group chats and chats with anyone else are rejected.
- One prompt is handled at a time. The queue holds up to 20 prompts.
- The extension refuses to overwrite an existing draft or send while Muse is busy.
  Keep the connected tab dedicated to the connector; interleaved manual messages
  stop response capture.
- The extension clicks only the main message **Send** button. It never approves
  purchases, permissions, or other agent actions. Review those inside Muse.
- Responses use an observed user-message echo and a four-second quiet period
  after Muse's Stop button disappears. This is a UI heuristic, not an official
  completion signal. Background work, proactive updates, widgets, and attachments
  are not fully mirrored. Open Muse for them.
- This is not a separate Muse contact or network in Beeper. Replies use your own
  Beeper account in Note to self. There is no standalone AI model or copied agent
  memory: prompts go to your existing Muse web conversation.
- Browser reloads, sleep, network failures, and site changes can interrupt a job.
  Uncertain delivery is blocked for manual inspection rather than retried.

## Development and verification

```sh
npm ci --ignore-scripts
npm run check
```

The test suite covers chat restrictions, cursor pagination, queue serialization,
restart recovery, duplicate results, uncertain sends, OAuth/PKCE, token and origin
checks, and the browser adapter against synthetic DOM fixtures. Tests never
require real accounts or access the internet.

The browser selectors were checked against the live Muse interface on September
13, 2026. See [validation](docs/validation.md) for the exact live checks and their
limits. CI runs on Linux, macOS, and Windows with Node.js 24.

See [operations](docs/operations.md), [contributing](CONTRIBUTING.md), and
[security](SECURITY.md). MIT licensed. Unaffiliated with Beeper or Meta.

## References

- [Beeper Desktop API](https://developers.beeper.com/desktop-api/)
- [Beeper OAuth](https://developers.beeper.com/desktop-api/auth/)
- [Meta Muse](https://ai.meta.com/muse/)
