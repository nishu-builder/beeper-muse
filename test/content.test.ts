import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('../extension/content.js', import.meta.url),
  'utf8',
);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
type Message = { type: string; text?: string };
type Listener = (
  message: Message,
  sender: object,
  respond: (value: unknown) => void,
) => void;

function harness(deferred = false) {
  let listener!: Listener;
  let resolveClaim!: (value: unknown) => void;
  let now = 0;
  let submits = 0;
  let draft = '';
  let busy = false;
  let unavailable = false;
  const timers: Array<{ fn: () => void; at: number }> = [];
  const messages: Message[] = [];
  const claim = new Promise((resolve) => {
    resolveClaim = resolve;
  });
  const job = { id: 'job', prompt: 'Synthetic prompt' };
  runInNewContext(source, {
    document: {},
    location: { origin: 'https://muse.ai', pathname: '/' },
    Date: { now: () => now },
    setInterval: () => {},
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, at: now + ms });
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: (fn: Listener) => {
            listener = fn;
          },
        },
        sendMessage: async (message: Message) => {
          messages.push(message);
          if (message.type === 'connected')
            return { ok: true, connected: true };
          if (message.type === 'claim')
            return deferred ? claim : { ok: true, job };
          return { ok: true };
        },
      },
    },
    BeeperMuseDOM: {
      submit: async () => {
        submits++;
        return new Set();
      },
      snapshot: () => {
        if (unavailable) throw new Error('Missing composer');
        return { draft, busy, messages: [] };
      },
      responseAfter: () => 'Synthetic answer',
    },
  });
  return {
    messages,
    get submits() {
      return submits;
    },
    signal(type: string) {
      let result: unknown;
      listener({ type }, {}, (value) => {
        result = value;
      });
      return JSON.parse(JSON.stringify(result ?? null));
    },
    claim: () => resolveClaim({ ok: true, job }),
    view(value: { busy?: boolean; draft?: string; unavailable?: boolean }) {
      busy = value.busy ?? false;
      draft = value.draft ?? '';
      unavailable = value.unavailable ?? false;
    },
    async advance(ms: number) {
      const target = now + ms;
      while (timers.some((t) => t.at <= target)) {
        timers.sort((a, b) => a.at - b.at);
        const timer = timers.shift()!;
        now = timer.at;
        timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test('disconnect during a pending claim cannot submit the returned prompt', async () => {
  const h = harness(true);
  h.signal('start');
  await flush();
  assert.equal(h.messages.at(-1)?.type, 'claim');
  h.signal('stop');
  h.claim();
  await flush();
  assert.equal(h.submits, 0);
  assert.equal(h.messages.at(-1)?.type, 'block');
});

test('disconnect followed by reconnect cannot revive an earlier pending claim', async () => {
  const h = harness(true);
  h.signal('start');
  await flush();
  h.signal('stop');
  h.signal('start');
  h.claim();
  await flush();
  assert.equal(h.submits, 0);
});

test('disconnect while waiting for a reply prevents result delivery even after reconnect', async () => {
  const h = harness();
  h.signal('start');
  await flush();
  assert.equal(h.submits, 1);
  await h.advance(2000);
  h.signal('stop');
  h.signal('start');
  await h.advance(10000);
  assert.equal(h.messages.filter((m) => m.type === 'result').length, 0);
  assert.equal(h.messages.at(-1)?.type, 'block');
});

test('the normal content flow submits once and forwards a settled reply once', async () => {
  const h = harness();
  h.signal('start');
  await flush();
  await h.advance(10000);
  assert.equal(h.submits, 1);
  assert.equal(h.messages.filter((m) => m.type === 'result').length, 1);
  assert.equal(h.messages.at(-1)?.text, 'Synthetic answer');
});

test('readiness probes expose no draft or chat text', () => {
  const h = harness();
  for (const [view, health] of [
    [{}, 'ready'],
    [{ busy: true }, 'busy'],
    [{ draft: 'Private draft' }, 'draft'],
    [{ unavailable: true }, 'unavailable'],
  ] as const) {
    h.view(view);
    assert.deepEqual(h.signal('probe'), { protocol: 1, health });
  }
  assert.equal(h.messages.length, 0);
});
