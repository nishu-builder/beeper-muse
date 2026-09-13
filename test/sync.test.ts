import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(
  new URL('../extension/sync.js', import.meta.url),
  'utf8',
);
type Message = { id: string; role: string; text: string; widget?: boolean };
type View = { messages: Message[]; busy: boolean };
type Source = { id: string; hash: string };
interface Tracker {
  sync(view: View, mode: string, active: () => boolean): Promise<void>;
  remember(sources: Source[]): void;
}
function harness() {
  const context = { crypto: webcrypto, TextEncoder } as {
    crypto: typeof webcrypto;
    TextEncoder: typeof TextEncoder;
    BeeperMuseSync: {
      Tracker: new (
        send: (message: { messages: Message[] }) => Promise<void>,
        now: () => number,
      ) => Tracker;
      fingerprint: (message: Message) => Promise<Source>;
    };
  };
  runInNewContext(source, context);
  const sent: Message[] = [];
  let now = 0,
    fail = false;
  const tracker = new context.BeeperMuseSync.Tracker(
    async ({ messages }) => {
      if (fail) throw new Error('Offline');
      sent.push(...messages);
    },
    () => now,
  );
  return {
    tracker,
    sent,
    fingerprint: context.BeeperMuseSync.fingerprint,
    tick: (ms = 4000) => {
      now += ms;
    },
    offline: (value: boolean) => {
      fail = value;
    },
  };
}
const message = (id: string, text = 'Synthetic answer'): Message => ({
  id,
  role: 'assistant',
  text,
});
const view = (...messages: Message[]): View => ({ messages, busy: false });

test('recent catch-up imports only the latest twenty messages and never repeats them in the same tab', async () => {
  const h = harness(),
    v = view(...Array.from({ length: 24 }, (_, i) => message(String(i))));
  await h.tracker.sync(v, 'recent', () => true);
  h.tick();
  await h.tracker.sync(v, 'recent', () => true);
  assert.equal(h.sent.length, 20);
  assert.equal(h.sent[0]?.id, '4');
  await h.tracker.sync(v, 'recent', () => true);
  assert.equal(h.sent.length, 20);
});
test('all-loaded catch-up includes more than twenty messages', async () => {
  const h = harness(),
    v = view(...Array.from({ length: 25 }, (_, i) => message(String(i))));
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  await h.tracker.sync(v, 'all', () => true);
  assert.equal(h.sent.length, 25);
});
test('new-only mode ignores history but imports new user messages and later assistant replies', async () => {
  const h = harness(),
    v = view(message('old'));
  await h.tracker.sync(v, 'new', () => true);
  v.messages.push({ id: 'u', role: 'user', text: 'A question from Muse' });
  await h.tracker.sync(v, 'new', () => true);
  h.tick();
  await h.tracker.sync(v, 'new', () => true);
  v.messages.push(message('later'));
  await h.tracker.sync(v, 'new', () => true);
  h.tick();
  await h.tracker.sync(v, 'new', () => true);
  assert.deepEqual(
    h.sent.map((m) => m.id),
    ['u', 'later'],
  );
});
test('streaming text settles before import, and a later revision is delivered once', async () => {
  const h = harness(),
    v = view(message('a', 'Partial'));
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  v.busy = true;
  await h.tracker.sync(v, 'all', () => true);
  assert.equal(h.sent.length, 0);
  v.busy = false;
  v.messages[0]!.text = 'Complete';
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  await h.tracker.sync(v, 'all', () => true);
  v.messages[0]!.text = 'Complete with a later update';
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  await h.tracker.sync(v, 'all', () => true);
  assert.deepEqual(
    h.sent.map((m) => m.text),
    ['Complete', 'Complete with a later update'],
  );
});
test('failed imports retry without losing messages, and cancellation prevents sending', async () => {
  const h = harness(),
    v = view(message('a'));
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  h.offline(true);
  await assert.rejects(
    h.tracker.sync(v, 'all', () => true),
    /Offline/,
  );
  h.offline(false);
  await h.tracker.sync(v, 'all', () => false);
  assert.equal(h.sent.length, 0);
  await h.tracker.sync(v, 'all', () => true);
  assert.equal(h.sent.length, 1);
});
test('a Beeper reply receipt suppresses its echo but not a later assistant message', async () => {
  const h = harness(),
    first = message('reply'),
    later = message('later');
  h.tracker.remember([await h.fingerprint(first)]);
  const v = view(first, later, { ...message('widget'), widget: true });
  await h.tracker.sync(v, 'all', () => true);
  h.tick();
  await h.tracker.sync(v, 'all', () => true);
  assert.deepEqual(
    h.sent.map((m) => m.id),
    ['later'],
  );
});

test('catch-up is silent history; later observations keep their first-seen time', async () => {
  const h = harness();
  const v = view(message('old'));
  await h.tracker.sync(v, 'recent', () => true);
  h.tick();
  await h.tracker.sync(v, 'recent', () => true);
  const first = h.sent[0] as Message & {
    historical: boolean;
    observedAtMs: number;
  };
  assert.equal(first.historical, true);
  assert.equal(first.observedAtMs, 0);
  v.messages.push(message('live'));
  await h.tracker.sync(v, 'recent', () => true);
  h.tick();
  await h.tracker.sync(v, 'recent', () => true);
  const live = h.sent[1] as typeof first;
  assert.equal(live.historical, false);
  assert.equal(live.observedAtMs, 4000);
});
test('a richer source revision changes identity, but observation time and image bytes do not', async () => {
  const h = harness();
  const a = message('a');
  const b = { ...a, html: '<strong>Synthetic answer</strong>' };
  assert.notEqual((await h.fingerprint(a)).hash, (await h.fingerprint(b)).hash);
  assert.equal(
    (await h.fingerprint(b)).hash,
    (
      await h.fingerprint({
        ...b,
        observedAtMs: 123,
        historical: true,
      } as Message)
    ).hash,
  );
});
