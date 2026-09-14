import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(
  new URL('../extension/bridge.js', import.meta.url),
  'utf8',
);
function harness() {
  let reply: unknown = { phase: 'idle', queued: 0, sourceProtocol: 2 };
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const context = {
    AbortSignal,
    fetch: async (url: string, options: RequestInit) => {
      requests.push({ url, options });
      return { ok: true, json: async () => reply };
    },
    BeeperMuseBridge: undefined as unknown as {
      LocalBridge: new (token: () => Promise<string | null>) => {
        status(): Promise<unknown>;
        claim(): Promise<unknown>;
      };
    },
  };
  runInNewContext(source, context);
  return {
    bridge: new context.BeeperMuseBridge.LocalBridge(async () =>
      'a'.repeat(64),
    ),
    requests,
    reply(value: unknown) {
      reply = value;
    },
  };
}
test('local delivery transport validates status instead of reporting malformed state as connected', async () => {
  const h = harness();
  for (const value of [
    null,
    [],
    { phase: 'idle', queued: -1 },
    { phase: 'success', queued: 0 },
  ]) {
    h.reply(value);
    await assert.rejects(h.bridge.status(), /Invalid bridge/);
  }
  h.reply({ phase: 'idle', queued: 0, sourceProtocol: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.bridge.status())), {
    phase: 'idle',
    queued: 0,
    museSync: false,
    activitySync: false,
    sourceProtocol: 2,
  });
  for (const { url, options } of h.requests) {
    assert.equal(url, 'http://127.0.0.1:24819/v1/status');
    assert.equal(options.redirect, 'error');
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      'Bearer ' + 'a'.repeat(64),
    );
    assert.equal(url.includes('a'.repeat(64)), false);
  }
});
test('invalid claims cannot reach the Muse composer', async () => {
  const h = harness();
  for (const value of [
    {},
    { job: { id: 'id', prompt: 7 } },
    { job: { id: '', prompt: 'text' } },
  ]) {
    h.reply(value);
    await assert.rejects(h.bridge.claim(), /Invalid/);
  }
  h.reply({ job: null });
  assert.deepEqual(JSON.parse(JSON.stringify(await h.bridge.claim())), {
    job: null,
  });
});
