import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
const syncSource = await readFile(
  new URL('../extension/sync.js', import.meta.url),
  'utf8',
);

const activitySource = await readFile(
  new URL('../extension/activity.js', import.meta.url),
  'utf8',
);
const source = await readFile(
  new URL('../extension/content.js', import.meta.url),
  'utf8',
);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
type Message = {
  type: string;
  activity?: 'idle' | 'working';
  text?: string;
  messages?: Array<{ role: string; text: string }>;
};
type Listener = (
  message: Message,
  sender: object,
  respond: (value: unknown) => void,
) => void;

function harness(
  deferred = false,
  structured = false,
  activityEnabled = false,
  photo = false,
  uploadSupported = true,
  profile?: () => Promise<unknown>,
) {
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
  let reply = true;
  let unavailable = false;
  let activityUnavailable = false;
  let visibility = 'hidden';
  const events = new Map<
    string,
    (event: { preventDefault: () => void; returnValue?: boolean }) => void
  >();
  const intervals: Array<() => void> = [];
  const timers: Array<{ fn: () => void; at: number }> = [];
  const messages: Message[] = [];
  const claim = new Promise((resolve) => {
    resolveClaim = resolve;
  });
  const image = { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' };
  const job = {
    id: 'job',
    prompt: 'Synthetic prompt',
    ...(photo ? { image } : {}),
  };
  let photoSubmits = 0;
  let disposedTimers = 0;
  const context = {
    crypto: webcrypto,
    TextEncoder,
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
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
    clearInterval: () => {
      disposedTimers++;
    },
    setInterval: (fn: () => void) => {
      intervals.push(fn);
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, at: now + ms });
    },
    chrome: {
      runtime: {
        id: 'synthetic-extension',
        onMessage: {
          removeListener: () => {},
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
              activitySync: activityEnabled,
              profileSync: !!profile,
              deliveryStatus: true,
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
          profile,
          activity: () => {
            if (activityUnavailable)
              throw Error('Synthetic unreadable activity');
            return busy ? 'working' : 'idle';
          },
          snapshot: this.snapshot,
          submit: this.submit,
          submitImage: uploadSupported
            ? async (prompt: string, upload: unknown) => {
                assert.equal(prompt, job.prompt);
                assert.deepEqual(upload, image);
                photoSubmits++;
                submits++;
                return new Set();
              }
            : undefined,
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
                {
                  id: 'u',
                  role: 'user',
                  text: 'Synthetic prompt',
                  ...(photo
                    ? { images: [{ url: 'https://muse.ai/photo.png' }] }
                    : {}),
                },
                ...(reply
                  ? [{ id: 'a', role: 'assistant', text: 'Synthetic answer' }]
                  : []),
              ]
            : [],
        };
      },
      responseAfter: () => 'Synthetic answer',
    },
  };
  runInNewContext(activitySource + '\n' + syncSource + '\n' + source, context);
  return {
    reinstall: () => runInNewContext(source, context),
    get disposedTimers() {
      return disposedTimers;
    },
    messages,
    pulse: async () => {
      intervals[0]!();
      await flush();
    },
    executed,
    events,
    focus: async () => {
      visibility = 'visible';
      events.get('focus')?.({ preventDefault() {} });
      await flush();
    },
    get photoSubmits() {
      return photoSubmits;
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
    view(value: {
      busy?: boolean;
      draft?: string;
      unavailable?: boolean;
      activityUnavailable?: boolean;
      reply?: boolean;
    }) {
      reply = value.reply ?? true;
      busy = value.busy ?? false;
      draft = value.draft ?? '';
      unavailable = value.unavailable ?? false;
      activityUnavailable = value.activityUnavailable ?? false;
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
test('slow or failed avatar reads do not block message delivery and stale results are discarded', async () => {
  let resolveProfile!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    resolveProfile = resolve;
  });
  const h = harness(false, true, false, false, true, () => pending);
  h.signal('start');
  await flush();
  assert.equal(h.submits, 1);
  h.signal('stop');
  resolveProfile({ avatar: { mime: 'image/png', data: 'synthetic' } });
  await flush();
  assert.equal(
    h.messages.some((m) => m.type === 'profile'),
    false,
  );
  const failed = harness(false, true, false, false, true, async () => {
    throw Error('Synthetic source failure');
  });
  failed.signal('start');
  await flush();
  assert.equal(failed.submits, 1);
});

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
  await h.executed;
  assert.equal(h.submits, 1);
  assert.equal(h.messages.filter((m) => m.type === 'result').length, 1);
  assert.equal(
    h.messages.find((m) => m.type === 'result')?.text,
    'Synthetic answer',
  );
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
    const probe = h.signal('probe');
    assert.equal(probe.protocol, 12);
    assert.equal(probe.health, health);
    assert.deepEqual(Object.keys(probe).sort(), [
      'active',
      'health',
      'progress',
      'protocol',
      'rescanning',
    ]);
    assert.deepEqual(probe.progress, {
      loaded: 0,
      eligible: 0,
      checked: 0,
      waiting: 0,
      missingTimes: 0,
      skippedWidgets: 0,
    });
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

test('Muse working activity renews independently and clears when the tab disconnects', async () => {
  const h = harness(false, false, true);
  h.view({ busy: true });
  h.signal('start');
  await flush();
  assert.deepEqual(
    h.messages.filter((m) => m.type === 'activity').map((m) => m.activity),
    ['working'],
  );
  assert.equal(h.submits, 0);
  await h.advance(6000);
  await h.pulse();
  h.signal('stop');
  await flush();
  assert.deepEqual(
    h.messages.filter((m) => m.type === 'activity').map((m) => m.activity),
    ['working', 'working', 'idle'],
  );
});

test('an activity read failure does not invent an idle transition', async () => {
  const h = harness(false, false, true);
  h.view({ busy: true });
  h.signal('start');
  await flush();
  h.view({ busy: true, activityUnavailable: true });
  await h.advance(6000);
  await h.pulse();
  assert.deepEqual(
    h.messages.filter((m) => m.type === 'activity').map((m) => m.activity),
    ['working'],
  );
  h.signal('stop');
  await flush();
  assert.deepEqual(
    h.messages.filter((m) => m.type === 'activity').map((m) => m.activity),
    ['working', 'idle'],
  );
});

test('worker pulses renew and clear typing without tab timers or a readable transcript', async () => {
  const h = harness(false, false, true);
  const activities = () =>
    h.messages.filter((m) => m.type === 'activity').map((m) => m.activity);
  h.view({ busy: true });
  h.signal('start');
  await flush();
  assert.deepEqual(activities(), ['working']);

  // advance changes the clock but never fires the tab's interval callbacks.
  h.view({ busy: true, unavailable: true });
  await h.advance(6000);
  assert.deepEqual(h.signal('activity-pulse'), { ok: true });
  await flush();
  assert.deepEqual(activities(), ['working', 'working']);

  // A failing full snapshot must not clear a valid independent activity signal.
  h.signal('rescan');
  await flush();
  assert.deepEqual(activities(), ['working', 'working']);

  h.view({ unavailable: true });
  h.signal('activity-pulse');
  await flush();
  assert.deepEqual(activities(), ['working', 'working', 'idle']);

  h.signal('stop');
  h.view({ busy: true });
  await h.advance(6000);
  h.signal('activity-pulse');
  await flush();
  assert.deepEqual(activities(), ['working', 'working', 'idle']);
  assert.equal(h.submits, 0);
});

test('update preparation waits for a claimed prompt and Muse activity, preserving drafts', async () => {
  const h = harness(true);
  h.signal('start');
  await flush();
  assert.equal(h.signal('prepare-update').ready, false);
  h.signal('stop');
  h.claim();
  await flush();
  h.view({ busy: true });
  assert.equal(h.signal('prepare-update').ready, false);
  h.view({ unavailable: true });
  assert.equal(h.signal('prepare-update').ready, false);
  h.view({ draft: 'Keep my draft' });
  assert.equal(h.signal('prepare-update').ready, true);
  assert.equal(h.events.has('beforeunload'), false);
  assert.equal(h.submits, 0);
});

test('reinjecting the content script disposes old timers and cannot revive its pending claim', async () => {
  const h = harness(true);
  h.signal('start');
  await flush();
  h.reinstall();
  assert.equal(h.disposedTimers, 2);
  assert.equal(h.events.has('beforeunload'), false);
  h.claim();
  await flush();
  assert.equal(h.submits, 0);
});

test('a photo claim uses the upload adapter and delivers its image-attributed reply once', async () => {
  const h = harness(false, true, false, true);
  h.signal('start');
  await flush();
  await h.advance(10000);
  await h.executed;
  assert.equal(h.photoSubmits, 1);
  assert.equal(h.submits, 1);
  assert.equal(h.messages.filter((m) => m.type === 'result').length, 1);
  assert.equal(h.messages.filter((m) => m.type === 'block').length, 0);
});
test('a missing upload adapter blocks a photo instead of sending its caption alone', async () => {
  const h = harness(false, true, false, true, false);
  h.signal('start');
  await flush();
  await h.executed;
  assert.equal(h.submits, 0);
  assert.equal(h.photoSubmits, 0);
  assert.equal(h.messages.filter((m) => m.type === 'block').length, 1);
});

test('delivery confirmation waits for the matching source echo and a new Muse reply', async () => {
  const h = harness();
  h.view({ reply: false });
  h.signal('start');
  await flush();
  await h.advance(10000);
  assert.equal(h.messages.filter((m) => m.type === 'delivered').length, 0);
  h.view({ reply: true });
  await h.advance(10000);
  await h.executed;
  assert.equal(h.messages.filter((m) => m.type === 'delivered').length, 1);
  assert.ok(
    h.messages.findIndex((m) => m.type === 'delivered') <
      h.messages.findIndex((m) => m.type === 'result'),
  );
});

test('source health distinguishes a stopped connector from an available composer', () => {
  const h = harness();
  assert.equal(h.signal('probe').active, false);
  h.signal('start');
  assert.equal(h.signal('probe').active, true);
  h.signal('stop');
  assert.equal(h.signal('probe').health, 'ready');
  assert.equal(h.signal('probe').active, false);
});
