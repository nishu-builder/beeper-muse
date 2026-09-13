import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const extensionID = 'a'.repeat(32),
  token = 'b'.repeat(64);
const extensionURL = (path: string) =>
  `chrome-extension://${extensionID}/${path}`;
interface Sender {
  id: string;
  url: string;
  tab?: { id: number };
}
type Reply = Record<string, unknown>;
function harness(paired = true) {
  const saved: { tabID?: number } = {};
  const local: { bridgeToken?: string } = paired ? { bridgeToken: token } : {};
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  let restricted = false,
    reachable = true,
    receiver = true;
  let health = 'ready';
  let protocol = 1;
  let listener!: (
    message: unknown,
    sender: Sender,
    respond: (reply: Reply) => void,
  ) => boolean;
  let removed!: (id: number) => Promise<void>;
  runInNewContext(source, {
    URL,
    AbortSignal,
    fetch: async (url: string, options?: RequestInit) => {
      requests.push({ url, options });
      return {
        ok: reachable,
        json: async () =>
          url.endsWith('/v1/status')
            ? { phase: 'idle', queued: 0 }
            : { job: { id: 'job', prompt: 'Synthetic prompt' } },
      };
    },
    chrome: {
      runtime: {
        id: extensionID,
        getURL: extensionURL,
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn;
          },
        },
      },
      storage: {
        local: {
          setAccessLevel: async (value: { accessLevel: string }) => {
            assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS');
            restricted = true;
          },
          get: async () => {
            assert.equal(restricted, true);
            return { ...local };
          },
          set: async (value: typeof local) => {
            assert.equal(restricted, true);
            Object.assign(local, value);
          },
          remove: async () => {
            delete local.bridgeToken;
          },
        },
        session: {
          get: async () => ({ ...saved }),
          set: async (value: typeof saved) => Object.assign(saved, value),
          remove: async () => {
            delete saved.tabID;
          },
        },
      },
      tabs: {
        query: async () => [{ id: 7, url: 'https://muse.ai/' }],
        sendMessage: async () => {
          if (!receiver) throw new Error('No content script');
          return { protocol, health };
        },
        onRemoved: {
          addListener: (fn: typeof removed) => {
            removed = fn;
          },
        },
      },
    },
  });
  const send = (message: unknown, sender: Sender) =>
    new Promise<Reply>((resolve) => {
      assert.equal(listener(message, sender, resolve), true);
    });
  return {
    requests,
    local,
    saved,
    send,
    offline: () => {
      reachable = false;
    },
    withoutContentScript: () => {
      receiver = false;
    },
    health: (value: string) => {
      health = value;
    },
    legacyContentScript: () => {
      protocol = 0;
    },
    close: (id: number) => removed(id),
    popup: (type: string, extra = {}) =>
      send(
        { type, ...extra },
        { id: extensionID, url: extensionURL('popup.html') },
      ),
    tab: (type: string) =>
      send(
        { type },
        { id: extensionID, url: 'https://muse.ai/', tab: { id: 7 } },
      ),
  };
}

test('a public extension pairs only through its popup after validating the private code', async () => {
  const h = harness(false);
  assert.equal((await h.popup('status')).paired, false);
  assert.equal(h.requests.length, 0);
  assert.equal((await h.popup('pair', { token: 'short' })).ok, false);
  assert.equal(
    (
      await h.send(
        { type: 'pair', token },
        { id: extensionID, url: 'https://muse.ai/', tab: { id: 7 } },
      )
    ).ok,
    false,
  );
  assert.equal(h.local.bridgeToken, undefined);
  const paired = await h.popup('pair', { token: token.toUpperCase() });
  assert.equal(paired.ok, true);
  assert.equal(h.local.bridgeToken, token);
  assert.ok(!JSON.stringify(paired).includes(token));
  assert.equal(h.requests[0]?.url, 'http://127.0.0.1:24819/v1/status');
});
test('a failed pairing does not replace existing credentials and never echoes a token', async () => {
  const h = harness();
  h.offline();
  const result = await h.popup('pair', { token: 'c'.repeat(64) });
  assert.equal(result.ok, false);
  assert.equal(h.local.bridgeToken, token);
  assert.ok(!JSON.stringify(result).includes('c'.repeat(64)));
  assert.equal((await h.popup('status')).reachable, false);
});
test('only the popup can attach a Muse tab; pairing is required', async () => {
  const h = harness();
  assert.equal((await h.tab('claim')).ok, false);
  assert.equal((await h.tab('attach')).ok, false);
  assert.equal((await h.tab('connected')).connected, false);
  assert.equal((await h.popup('attach')).ok, true);
  assert.equal((await h.tab('connected')).connected, true);
  const unpaired = harness(false);
  assert.equal((await unpaired.popup('attach')).ok, false);
  assert.equal(unpaired.saved.tabID, undefined);
});
test('claims require the selected tab, main Muse URL, and extension sender identity', async () => {
  const h = harness();
  await h.popup('attach');
  for (const sender of [
    { id: extensionID, url: 'https://muse.ai/', tab: { id: 8 } },
    { id: extensionID, url: 'https://muse.ai/settings', tab: { id: 7 } },
    { id: extensionID, url: 'https://example.com/', tab: { id: 7 } },
    { id: 'foreign', url: 'https://muse.ai/', tab: { id: 7 } },
  ])
    assert.equal((await h.send({ type: 'claim' }, sender)).ok, false);
  assert.equal(h.requests.length, 1);
  const result = await h.tab('claim');
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result).includes(token));
  const request = h.requests.at(-1)!;
  assert.equal(request.url, 'http://127.0.0.1:24819/v1/claim');
  assert.equal(
    (request.options?.headers as Record<string, string>).Authorization,
    `Bearer ${token}`,
  );
  assert.equal(request.options?.redirect, 'error');
});
test('missing content scripts do not leave a tab falsely connected', async () => {
  const h = harness();
  h.withoutContentScript();
  assert.equal((await h.popup('attach')).ok, false);
  assert.equal(h.saved.tabID, undefined);
});
test('status checks the content script after attachment instead of trusting a saved tab', async () => {
  const h = harness();
  await h.popup('attach');
  assert.equal((await h.popup('status')).connected, true);
  h.withoutContentScript();
  const status = await h.popup('status');
  assert.equal(status.attached, true);
  assert.equal(status.connected, false);
  assert.equal(status.health, 'reload');
});
test('readiness distinguishes a busy chat, a draft, a missing chat, and an old content script', async () => {
  const h = harness();
  for (const health of ['busy', 'draft']) {
    h.health(health);
    assert.equal((await h.popup('attach')).ok, true);
    const status = await h.popup('status');
    assert.equal(status.connected, true);
    assert.equal(status.health, health);
  }
  h.health('unavailable');
  assert.equal((await h.popup('status')).connected, false);
  assert.match(String((await h.popup('attach')).error), /Sign in/);
  h.legacyContentScript();
  assert.match(
    String((await h.popup('attach')).error),
    /Refresh the Muse webpage/,
  );
});
test('disconnect, tab close, and forgetting revoke access; forgetting removes the saved code', async () => {
  const h = harness();
  await h.popup('attach');
  await h.popup('detach');
  assert.equal((await h.tab('claim')).ok, false);
  await h.popup('attach');
  await h.close(8);
  assert.equal((await h.tab('connected')).connected, true);
  await h.close(7);
  assert.equal((await h.tab('connected')).connected, false);
  await h.popup('attach');
  await h.popup('forget');
  assert.equal(h.local.bridgeToken, undefined);
  assert.equal((await h.tab('claim')).ok, false);
  assert.equal((await h.popup('status')).paired, false);
});
