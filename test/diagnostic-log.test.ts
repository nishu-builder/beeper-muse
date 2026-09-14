import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DiagnosticLog,
  cleanEntries,
  logFile,
  type LogEntry,
} from '../browser-runtime/runtime/diagnostic-log.ts';
import { LogFileWriter } from '../browser-runtime/runtime/log-file.ts';
test('diagnostics use a closed schema and cannot export private values', async () => {
  let stored: LogEntry[] = [];
  const log = new DiagnosticLog(
    {
      get: async () => stored,
      set: async (entries) => {
        stored = entries;
      },
    },
    '0.8.1',
    () => 123,
  );
  await log.record('image-readiness', {
    hasForm: false,
    composers: 1,
    imageInputs: 0,
    token: 'PRIVATE',
    url: 'PRIVATE',
    text: 'PRIVATE',
    existingFiles: Infinity,
    previews: 99999,
  });
  await log.record('PRIVATE', { imageInputs: 1 });
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]?.facts, {
    composers: 1,
    hasForm: false,
    imageInputs: 0,
  });
  const exported = logFile([
    ...stored,
    {
      ...stored[0],
      secret: 'PRIVATE',
      facts: { hasForm: true, caption: 'PRIVATE' },
    },
  ]);
  assert.ok(!exported.includes('PRIVATE'));
  assert.equal(cleanEntries([{ ...stored[0], version: 'PRIVATE' }]).length, 0);
});
test('diagnostic writes are ordered, bounded, deduplicated and tolerate storage failures', async () => {
  let stored: LogEntry[] = [];
  let fail = true;
  let now = 100000;
  const log = new DiagnosticLog(
    {
      get: async () => stored,
      set: async (entries) => {
        if (fail) {
          fail = false;
          throw Error('PRIVATE');
        }
        stored = entries;
      },
    },
    '0.8.1',
    () => (now += 11000),
  );
  await log.record('image-upload-start');
  await Promise.all(
    Array.from({ length: 220 }, () => log.record('image-submitted')),
  );
  assert.equal(stored.length, 200);
  assert.ok(stored.every((e, i) => !i || e.time > stored[i - 1]!.time));
  const same = new DiagnosticLog(
    {
      get: async () => stored,
      set: async (entries) => {
        stored = entries;
      },
    },
    '0.8.1',
    () => now,
  );
  await same.record('image-submitted');
  assert.equal(stored.at(-1)?.time, now);
});
test('log files serialize writes, skip unchanged data and do not prompt for file permissions in background', async () => {
  let granted = true,
    writes = 0,
    active = 0,
    max = 0,
    aborts = 0;
  const writer = new LogFileWriter({
    queryPermission: async () => (granted ? 'granted' : 'prompt'),
    createWritable: async () => {
      active++;
      max = Math.max(max, active);
      return {
        write: async (text) => {
          writes++;
          assert.ok(!text.includes('PRIVATE'));
        },
        close: async () => {
          active--;
        },
        abort: async () => {
          active--;
          aborts++;
        },
      };
    },
  });
  const entries = [
    { time: 123, version: '0.8.1', code: 'image-submitted', secret: 'PRIVATE' },
  ];
  await Promise.all([writer.write(entries), writer.write(entries)]);
  assert.equal(writes, 1);
  assert.equal(max, 1);
  granted = false;
  await assert.rejects(writer.write([]), /permission/);
  assert.equal(writes, 1);
  assert.equal(aborts, 0);
  granted = true;
  await writer.write([]);
  assert.equal(writes, 2);
});
test('failed file writes abort and can be retried without poisoning the writer', async () => {
  let fail = true,
    aborted = false;
  const writer = new LogFileWriter({
    queryPermission: async () => 'granted',
    createWritable: async () => ({
      write: async () => {
        if (fail) throw Error('disk full');
      },
      close: async () => {},
      abort: async () => {
        aborted = true;
      },
    }),
  });
  await assert.rejects(writer.write([]));
  assert.equal(aborted, true);
  fail = false;
  await writer.write([]);
});

test('log controls save a chosen handle, flush automatically and stop writing on request', async (t) => {
  const { startLogControls } =
    await import('../browser-runtime/runtime/log-controls.ts');
  const { StateStore } = await import('../browser-runtime/runtime/state.ts');
  const elements = new Map(
    ['choose-log', 'stop-log', 'log-status', 'allow-log'].map((id) => [
      id,
      { onclick: () => {}, textContent: '' },
    ]),
  );
  const values = new Map<string, unknown>();
  let writes = 0,
    chooseCalls = 0;
  let cleanup = () => {};
  const file = {
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async () => {
        writes++;
      },
      close: async () => {},
      abort: async () => {},
    }),
  };
  const fake = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    close: () => {},
  };
  t.mock.method(StateStore, 'open', async () => fake);
  const previous = new Map(
    ['document', 'window', 'chrome'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  const globals = {
    document: { getElementById: (id: string) => elements.get(id) },
    window: {
      showSaveFilePicker: async () => {
        chooseCalls++;
        return file;
      },
      addEventListener: (_name: string, fn: () => void) => {
        cleanup = fn;
      },
    },
    chrome: {
      storage: { local: { get: async () => ({ diagnosticEvents: [] }) } },
    },
  };
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  t.after(() => {
    cleanup();
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const flush = startLogControls()!;
  await flush();
  assert.equal(writes, 0, 'no file access before selection');
  elements.get('choose-log')!.onclick();
  assert.equal(
    chooseCalls,
    1,
    'picker called immediately within user activation',
  );
  await new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(writes, 1);
  assert.equal(values.get('handle'), file);
  elements.get('stop-log')!.onclick();
  await new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(writes, 1);
  assert.equal(values.get('handle'), null);
});
