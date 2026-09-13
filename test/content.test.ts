import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
const syncSource = await readFile(
  new URL('../extension/sync.js', import.meta.url),
  'utf8',
);

const source = await readFile(
  new URL('../extension/content.js', import.meta.url),
  'utf8',
);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
type Message = {
  type: string;
  text?: string;
  messages?: Array<{ role: string; text: string }>;
};
type Listener = (
  message: Message,
  sender: object,
  respond: (value: unknown) => void,
) => void;

function harness(deferred = false, structured = false) {
  let listener!: Listener;
  let resolveClaim!: (value: unknown) => void;
  let resolveExecution!: () => void;
  const executed = new Promise<void>((resolve) => {
    resolveExecution = resolve;
  });
  let now = 0;
  let submits = 0;
  let draft = '';
  let busy = false;
  let unavailable = false;
  let visibility = 'hidden';
  const events = new Map<
    string,
    (event: { preventDefault: () => void; returnValue?: boolean }) => void
  >();
  const timers: Array<{ fn: () => void; at: number }> = [];
  const messages: Message[] = [];
  const claim = new Promise((resolve) => {
    resolveClaim = resolve;
  });
  const job = { id: 'job', prompt: 'Synthetic prompt' };
  runInNewContext(syncSource + '\n' + source, {
    crypto: webcrypto,
    TextEncoder,
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: () => {},
    },
    window: {
      addEventListener: (
        name: string,
        fn: (event: {
          preventDefault: () => void;
          returnValue?: boolean;
        }) => void,
      ) => events.set(name, fn),
      removeEventListener: (name: string) => events.delete(name),
    },
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
          if (message.type === 'result' || message.type === 'block')
            resolveExecution();
          if (message.type === 'connected')
            return {
              ok: true,
              connected: true,
              sourceProtocol: structured ? 2 : undefined,
            };
          if (message.type === 'claim')
            return deferred ? claim : { ok: true, job };
          if (message.type === 'offer-popup')
            return { ok: true, offered: true };
          return { ok: true };
        },
      },
    },
    BeeperMuseDOM: {
      create() {
        return {
          snapshot: this.snapshot,
          submit: this.submit,
          prepare: async (m: unknown) => m,
        };
      },
      submit: async () => {
        submits++;
        return new Set();
      },
      snapshot: () => {
        if (unavailable) throw new Error('Missing composer');
        return {
          draft,
          busy,
          messages: submits
            ? [
                { id: 'u', role: 'user', text: 'Synthetic prompt' },
                { id: 'a', role: 'assistant', text: 'Synthetic answer' },
              ]
            : [],
        };
      },
      responseAfter: () => 'Synthetic answer',
    },
  });
  return {
    messages,
    executed,
    events,
    focus: async () => {
      visibility = 'visible';
      events.get('focus')?.({ preventDefault() {} });
      await flush();
    },
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

test('closing is guarded only while connected and disconnect removes the guard', async () => {
  const h = harness(true);
  assert.equal(h.events.has('beforeunload'), false);
  h.signal('start');
  await flush();
  let prevented = false;
  const event = {
    preventDefault: () => {
      prevented = true;
    },
    returnValue: false,
  };
  h.events.get('beforeunload')!(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, true);
  h.signal('stop');
  assert.equal(h.events.has('beforeunload'), false);
  h.claim();
  await flush();
});

test('a visible Muse tab offers the popup once, without claiming a prompt', async () => {
  const h = harness();
  await h.focus();
  await h.focus();
  assert.equal(h.messages.filter((m) => m.type === 'offer-popup').length, 1);
  assert.equal(h.submits, 0);
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
    assert.deepEqual(h.signal('probe'), { protocol: 3, health });
  }
  assert.equal(h.messages.length, 0);
});

test('structured results preserve the prompt echo and individual answers for native delivery', async () => {
  const h = harness(false, true);
  h.signal('start');
  await flush();
  await h.advance(6000);
  await h.executed;
  const result = h.messages.find((m) => m.type === 'result');
  assert.deepEqual(
    Array.from(result?.messages || [], (m) => m.role),
    ['user', 'assistant'],
  );
  assert.equal(result?.messages?.[1]?.text, 'Synthetic answer');
});
