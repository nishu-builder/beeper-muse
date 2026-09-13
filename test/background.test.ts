import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('../extension/background.js', import.meta.url),
  'utf8',
);
const extensionID = 'a'.repeat(32);
const token = 'b'.repeat(64);
const extensionURL = (path: string) =>
  `chrome-extension://${extensionID}/${path}`;
interface Sender {
  id: string;
  url: string;
  tab?: { id: number };
}
type Reply = Record<string, unknown>;
function harness() {
  const saved: { tabID?: number } = {};
  const requests: Array<{ url: string; options?: RequestInit }> = [];
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
      if (url === extensionURL('local-config.json'))
        return {
          json: async () => ({ baseURL: 'http://127.0.0.1:24819', token }),
        };
      return {
        ok: true,
        json: async () => ({ job: { id: 'job', prompt: 'Synthetic prompt' } }),
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
        sendMessage: async () => {},
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
    send,
    close: (id: number) => removed(id),
    popup: (type: string) =>
      send({ type }, { id: extensionID, url: extensionURL('popup.html') }),
    tab: (type: string, id = 7, url = 'https://muse.ai/') =>
      send({ type }, { id: extensionID, url, tab: { id } }),
  };
}

test('only the extension popup can attach a Muse tab; unconnected pages cannot claim work', async () => {
  const h = harness();
  assert.equal((await h.tab('claim')).ok, false);
  assert.equal((await h.tab('attach')).ok, false);
  assert.equal((await h.tab('connected')).connected, false);
  assert.equal(h.requests.length, 0);
  assert.equal((await h.popup('attach')).ok, true);
  assert.equal((await h.tab('connected')).connected, true);
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
  assert.equal(h.requests.length, 0);
  const result = await h.tab('claim');
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(h.requests[1]?.url, 'http://127.0.0.1:24819/v1/claim');
  assert.equal(
    (h.requests[1]?.options?.headers as Record<string, string>).Authorization,
    `Bearer ${token}`,
  );
  assert.equal(h.requests[1]?.options?.redirect, 'error');
});

test('disconnecting or closing the selected tab revokes access to queued prompts', async () => {
  const h = harness();
  await h.popup('attach');
  await h.popup('detach');
  assert.equal((await h.tab('claim')).ok, false);
  await h.popup('attach');
  await h.close(8);
  assert.equal((await h.tab('connected')).connected, true);
  await h.close(7);
  assert.equal((await h.tab('connected')).connected, false);
  assert.equal(h.requests.length, 0);
});
