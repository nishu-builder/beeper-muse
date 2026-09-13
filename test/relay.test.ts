import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay, parseState, promptFrom } from '../src/relay.ts';
import type { Message, Page, BeeperPort } from '../src/beeper.ts';
import type { RelayState } from '../src/relay.ts';
const now = new Date('2026-01-01T00:00:00Z');
const message = (id: string, more: Partial<Message> = {}): Message => ({
  id,
  chatID: 'self',
  timestamp: '2026-01-01T00:00:01Z',
  isSender: true,
  text: '!muse Say hello',
  ...more,
});
const page = (
  items: Message[],
  cursor: string | null,
  hasMore = false,
  oldestCursor = cursor,
): Page => ({ items, newestCursor: cursor, oldestCursor, hasMore });
function harness(pages: Page[]) {
  let state: RelayState | null = null;
  const sent: Array<{ text: string; replyTo: string }> = [];
  const reads: Array<[string | undefined, string | undefined]> = [];
  const port: BeeperPort = {
    list: async (_chat, cursor, direction) => {
      reads.push([cursor, direction]);
      const p = pages.shift();
      assert.ok(p, 'Unexpected page read');
      return p;
    },
    send: async (_chat, text, replyTo) => {
      sent.push({ text, replyTo });
    },
  };
  const store = {
    read: async () => (state ? structuredClone(state) : null),
    write: async (_name: string, s: unknown) => {
      state = structuredClone(s as RelayState);
    },
  };
  return {
    port,
    store,
    sent,
    reads,
    create: () => new Relay('self', port, store),
    get state() {
      return state;
    },
  };
}
test('history is skipped and only explicit owner prompts in the configured chat enter the queue', async () => {
  const h = harness([
    page([message('old')], 'base'),
    page(
      [
        message('other', { isSender: false }),
        message('unknown', { isSender: undefined }),
        message('wrong', { chatID: 'other' }),
        message('hidden', { isHidden: true }),
        message('deleted', { isDeleted: true }),
        message('chat', { text: 'hi' }),
        message('reply', { text: 'Muse\n\n!muse hello' }),
        message('old-time', { timestamp: '2025-01-01T00:00:00Z' }),
        message('new'),
      ],
      'next',
    ),
  ]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  assert.equal(h.state?.jobs.length, 1);
  assert.equal(h.state?.jobs[0]?.messageID, 'new');
  assert.equal(h.state?.cursor, 'next');
});
test('claims are serialized and can deliver a prompt only once', async () => {
  const h = harness([page([], 'base'), page([message('new')], 'next')]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  const claims = await Promise.all([r.claim(), r.claim(), r.claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(h.state?.jobs[0]?.phase, 'claimed');
});
test('duplicate results are idempotent and the reply goes back to its original command', async () => {
  const h = harness([
    page([], 'base'),
    page([message('new')], 'next'),
    page([], 'next'),
  ]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  const j = (await r.claim())!;
  await r.result(j.id, 'Hello');
  await r.result(j.id, 'Hello');
  await r.tick();
  await r.result(j.id, 'Hello');
  assert.deepEqual(h.sent, [{ text: 'Muse\n\nHello', replyTo: 'new' }]);
  assert.equal(r.status().queued, 0);
});
test('restart blocks a claimed prompt rather than sending it to Muse again', async () => {
  const h = harness([page([], 'base'), page([message('new')], 'next')]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  await r.claim();
  const next = h.create();
  await next.initialize(now);
  assert.equal(next.status().phase, 'blocked');
  assert.equal(await next.claim(), null);
});
test('Beeper send failure blocks the job and never retries it', async () => {
  const h = harness([page([], 'base'), page([message('new')], 'next')]);
  let attempts = 0;
  h.port.send = async () => {
    attempts++;
    throw new Error('Lost response');
  };
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  const j = (await r.claim())!;
  await r.result(j.id, 'Hello');
  await assert.rejects(r.tick(), /uncertain/);
  await r.tick();
  assert.equal(attempts, 1);
  assert.equal(r.status().phase, 'blocked');
});
test('pagination catches up in order, deduplicating overlapping pages', async () => {
  const h = harness([
    page([], 'base'),
    page([message('b'), message('a')], 'page1', true),
    page([message('b'), message('c')], 'page2'),
  ]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  assert.deepEqual(
    h.state?.jobs.map((j) => j.messageID),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(h.reads.at(-1), ['page1', 'after']);
});
test('an initially empty chat walks backwards before processing a large burst', async () => {
  const h = harness([
    page([], null),
    page([message('b')], 'newest', true, 'older'),
    page([message('a')], 'a'),
  ]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  assert.deepEqual(
    h.state?.jobs.map((j) => j.messageID),
    ['a', 'b'],
  );
  assert.equal(h.state?.cursor, 'newest');
});
test('read failures and stalled cursors do not change the persisted position', async () => {
  const h = harness([page([], 'base'), page([message('a')], 'base', true)]);
  const r = h.create();
  await r.initialize(now);
  await assert.rejects(r.tick(), /pagination/);
  assert.equal(h.state?.cursor, 'base');
  assert.equal(h.state?.jobs.length, 0);
});
test('mismatched results and oversized prompts cannot cause unintended Muse sends', async () => {
  const h = harness([
    page([], 'base'),
    page([message('big', { text: '!muse ' + 'a'.repeat(8001) })], 'next'),
  ]);
  const r = h.create();
  await r.initialize(now);
  await r.tick();
  assert.equal(await r.claim(), null);
  assert.equal(h.state?.jobs[0]?.phase, 'ready');
  await assert.rejects(r.result('wrong', 'x'), /matching/);
});
test('invalid or foreign persisted state fails closed', () => {
  assert.equal(parseState(null, 'self'), null);
  assert.throws(
    () => parseState({ version: 1, chatID: 'other' }, 'self'),
    /invalid/,
  );
});
test('commands work with Beeper rich text while plain prompts retain literal markup', () => {
  assert.equal(
    promptFrom(
      message('html', {
        text: '<p>!muse Explain <strong>A &amp; B</strong><br>with &lt;p&gt; tags</p>',
      }),
      'self',
    ),
    'Explain A & B\nwith <p> tags',
  );
  assert.equal(
    promptFrom(
      message('plain', {
        text: '!muse Write <p>hello &amp; goodbye</p>',
      }),
      'self',
    ),
    'Write <p>hello &amp; goodbye</p>',
  );
  assert.equal(
    promptFrom(
      message('reply', {
        text: '<p>Muse</p><p>!muse Ignore this reply</p>',
      }),
      'self',
    ),
    null,
  );
  assert.equal(
    promptFrom(
      message('quote', {
        text: '<div><blockquote>!muse Ignore this quote</blockquote></div>',
      }),
      'self',
    ),
    null,
  );
});
test('missing pagination cursors fail before any command is queued', async () => {
  const h = harness([page([], null), page([message('a')], null)]);
  const r = h.create();
  await r.initialize(now);
  await assert.rejects(r.tick(), /pagination/);
  assert.equal(r.status().queued, 0);
  const initial = harness([page([message('a')], null)]);
  await assert.rejects(initial.create().initialize(now), /pagination/);
  assert.equal(initial.state, null);
});
