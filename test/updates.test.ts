import test from 'node:test';
import assert from 'node:assert/strict';
import { Updates, localUpdate } from '../browser-runtime/runtime/updates.ts';
import {
  ensureMuseTab,
  resumeTicket,
  type MuseTabAPI,
} from '../browser-runtime/runtime/muse-tab.ts';
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('updates defer busy work, stop claims and apply once after the source is ready', async () => {
  let ready = false,
    source = false,
    applies = 0,
    prepare = 0;
  const u = new Updates({
    candidate: async () => 'store:next',
    ready: async () => ready,
    prepareSource: async () => {
      prepare++;
      return source;
    },
    apply: async () => {
      applies++;
    },
    recover: async () => {},
  });
  await u.tick();
  assert.equal(u.pending, true);
  assert.equal(prepare, 0);
  ready = true;
  await u.tick();
  assert.equal(applies, 0);
  source = true;
  await u.tick();
  assert.equal(applies, 1);
});
test('overlapping checks cannot trigger two reloads and partial builds never reload', async () => {
  let finish!: () => void,
    applies = 0;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const u = new Updates({
    candidate: async () => 'local:next',
    ready: async () => {
      await wait;
      return true;
    },
    prepareSource: async () => true,
    apply: async () => {
      applies++;
    },
    recover: async () => {},
  });
  const tick = u.tick();
  await flush();
  await u.tick();
  finish();
  await tick;
  assert.equal(applies, 1);
  const a = 'a'.repeat(64),
    b = 'b'.repeat(64);
  assert.equal(localUpdate({ ready: false, build: b }, a), undefined);
  assert.equal(localUpdate({ ready: true, build: a }, a), undefined);
  assert.equal(localUpdate({ ready: true, build: 'invalid' }, a), undefined);
  assert.equal(localUpdate({ ready: true, build: b }, a), 'local:' + b);
});
test('changed builds and failed reload preparation resume the source instead of losing its connection', async () => {
  let reads = 0,
    recovered = 0,
    applied = 0;
  const u = new Updates({
    candidate: async () => (++reads === 1 ? 'one' : 'two'),
    ready: async () => true,
    prepareSource: async () => true,
    apply: async () => {
      applied++;
      throw Error('Storage failed');
    },
    recover: async () => {
      recovered++;
    },
  });
  await u.tick();
  assert.equal(applied, 0);
  assert.equal(recovered, 1);
  await u.tick();
  assert.equal(applied, 1);
  assert.equal(recovered, 2);
  assert.match(u.message, /Retrying/);
});
test('reconnection injects only packaged scripts into the selected Muse main frame', async () => {
  let injected = false,
    sends = 0;
  const api: MuseTabAPI = {
    get: async (id) => ({ id, url: 'https://muse.ai/' }),
    send: async () => {
      sends++;
      if (!injected) throw Error('Old context invalidated');
      return { protocol: 10, health: 'draft' };
    },
    inject: async (id, files) => {
      assert.equal(id, 42);
      assert.deepEqual(files, [
        'adapter.js',
        'sync.js',
        'activity.js',
        'content.js',
      ]);
      injected = true;
    },
  };
  assert.equal((await ensureMuseTab(api, 42)).health, 'draft');
  assert.equal(sends, 2);
  await ensureMuseTab(api, 42);
  assert.equal(sends, 3);
  for (const tab of [
    { url: 'https://example.com/' },
    { url: 'https://muse.ai/other' },
    { url: 'https://muse.ai/', discarded: true },
  ]) {
    await assert.rejects(ensureMuseTab({ ...api, get: async () => tab }, 42));
  }
  assert.equal(sends, 3);
});
test('invalid and expired reconnect tickets cannot select a tab', () => {
  const ticket = {
    tabID: 4,
    documentID: '11111111-1111-1111-1111-111111111111',
    expires: 2000,
  };
  for (const value of [
    null,
    {},
    { ...ticket, tabID: '4' },
    { ...ticket, documentID: undefined },
    { ...ticket, documentID: 'invalid' },
    { ...ticket, expires: 500 },
    { ...ticket, expires: Infinity },
    { ...ticket, expires: 999999 },
  ])
    assert.equal(resumeTicket(value, 1000), undefined);
  assert.deepEqual(resumeTicket(ticket, 1000), ticket);
});

test('a failed update check never restarts an active source', async () => {
  let recovered = 0;
  const updates = new Updates({
    candidate: async () => {
      throw Error('Malformed marker');
    },
    ready: async () => false,
    prepareSource: async () => false,
    apply: async () => {},
    recover: async () => {
      recovered++;
    },
  });
  await updates.tick();
  assert.equal(recovered, 0);
});
