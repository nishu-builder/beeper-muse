# Validation record

## Automated

The local suite covers OAuth with PKCE, loopback restrictions,
Host/origin/token validation, exclusive file locks, queue claims, duplicate
results, pagination, rich-text commands, restart recovery, blocked sends,
extension sender/tab authorization, and browser DOM behavior.
Fixtures are synthetic and contain no real account data.

The browser tests run in jsdom. They verify DOM selection, input events, one Send
click, preservation of existing drafts, response extraction, and refusal when
manual messages interleave. They do not prove that a Chrome extension is installed
or that future Muse UI versions remain compatible.

## Manual checks — September 13, 2026

- Beeper Desktop 4.3.73 on macOS: OAuth login and authenticated self-chat access.
- Muse main chat: visible textarea and Send/Stop controls, user-message echo,
  assistant-message identifiers, and a harmless direct prompt/reply.
- A live Beeper/relay/Muse round trip: a synthetic `!muse` prompt entered the
  relay from Beeper; Muse returned the requested marker; the relay posted that
  marker back into Beeper as a reply to the original command. Browser actions
  for this check were performed using controlled UI automation, with the actual
  local relay claim/result endpoints. This did not test extension installation.

Packaged Chrome extension execution has not yet been verified in an installed
browser. No claim of production readiness is made.
