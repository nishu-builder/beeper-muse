import test from 'node:test';
import assert from 'node:assert/strict';
import { LogCollector } from '../browser-runtime/runtime/log-collector.ts';
import {
  cleanCollection,
  cleanUpdate,
  logFile,
} from '../browser-runtime/runtime/diagnostic-log.ts';
import {
  RuntimeWork,
  isConnectionDiagnostic,
} from '../browser-runtime/runtime/runtime-work.ts';
const build = 'a'.repeat(64);
const health = () => ({
  at: 10000,
  version: '0.8.8',
  build,
  beeperConnected: true,
  museConnected: true,
  ready: true,
  queued: 0,
  claimed: 0,
  blocked: 0,
  pending: 0,
});
const update = { stage: 'waiting-source', elapsedMs: 2000, pending: true };
const event = { time: 10000, version: '0.8.8', code: 'muse-disconnected' };
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('hung health reads do not stop the diagnostic heartbeat or start overlapping reads', async () => {
  let reads = 0,
    now = 12345;
  let resolveHealth!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    resolveHealth = resolve;
  });
  const collector = new LogCollector(
    '0.8.8',
    build,
    async () => [event],
    () => {
      reads++;
      return held;
    },
    async () => update,
    () => now,
    5,
  );
  const first = await collector.collect();
  assert.equal(first.health, undefined);
  assert.deepEqual(first.collection, {
    at: 10000,
    version: '0.8.8',
    build,
    events: 'available',
    health: 'unavailable',
    update,
  });
  now = 17345;
  const second = await collector.collect();
  assert.equal(second.collection.at, 15000);
  assert.equal(reads, 1);
  assert.equal(second.health, undefined);
  const file = JSON.parse(
    logFile(first.events, first.health, first.collection),
  );
  assert.equal(
    'health' in file,
    false,
    'a fresh file must not fabricate healthy runtime state',
  );
  resolveHealth(health());
  await flush();
  assert.equal(
    first.health,
    undefined,
    'late completion cannot change a prior sample',
  );
  assert.equal((await collector.collect()).health?.ready, true);
  assert.equal(reads, 2);
});
test('storage failures preserve known sanitized events and clearly mark incomplete collection', async () => {
  let fail = false;
  const collector = new LogCollector(
    '0.8.8',
    build,
    async () => {
      if (fail) throw Error('PRIVATE');
      return [{ ...event, text: 'PRIVATE' }];
    },
    async () => health(),
    async () => ({ ...update, room: 'PRIVATE' }),
    () => 10000,
    5,
  );
  await collector.collect();
  fail = true;
  const result = await collector.collect();
  assert.deepEqual(result.events, [event]);
  assert.equal(result.collection.events, 'unavailable');
  assert.equal(result.collection.health, 'available');
  assert.ok(
    !logFile(result.events, result.health, result.collection).includes(
      'PRIVATE',
    ),
  );
});
test('all unavailable channels are bounded and invalid health does not become ready', async () => {
  const never = () => new Promise(() => {});
  const collector = new LogCollector(
    '0.8.8',
    build,
    never,
    async () => ({ ready: true, error: 'PRIVATE' }),
    never,
    () => 10000,
    5,
  );
  const result = await collector.collect();
  assert.deepEqual(result.events, []);
  assert.equal(result.health, undefined);
  assert.equal(result.collection.update, undefined);
  assert.equal(result.collection.events, 'unavailable');
  assert.equal(result.collection.health, 'unavailable');
});
test('diagnostic collection and update progress accept only the closed public schema', () => {
  const collection = {
    at: 10000,
    version: '0.8.8',
    build,
    events: 'available',
    health: 'unavailable',
    update,
  };
  assert.deepEqual(
    cleanCollection({ ...collection, token: 'PRIVATE' }),
    collection,
  );
  for (const invalid of [
    { ...collection, health: 'PRIVATE' },
    { ...collection, events: { toString: () => 'available' } },
    { ...collection, build: 'PRIVATE' },
    { ...collection, at: NaN },
  ])
    assert.equal(cleanCollection(invalid), undefined);
  for (const invalid of [
    { ...update, stage: 'PRIVATE' },
    { ...update, pending: 1 },
    { ...update, elapsedMs: -1 },
    { ...update, elapsedMs: 86400001 },
    { ...update, elapsedMs: 1.5 },
  ])
    assert.equal(cleanUpdate(invalid), undefined);
});
test('only authenticated top-level diagnostic requests bypass the update work guard', async () => {
  const sender = {
    id: 'extension',
    url: 'chrome-extension://extension/connection.html',
    frameId: 0,
  };
  const classify = (type: unknown, s = sender) =>
    isConnectionDiagnostic(type, s, 'extension', sender.url);
  assert.equal(classify('diagnostic-health'), true);
  assert.equal(classify('diagnostic-progress'), true);
  for (const type of ['claim', 'complete', 'status', undefined])
    assert.equal(classify(type), false);
  for (const s of [
    { ...sender, id: 'other' },
    { ...sender, frameId: 1 },
    { ...sender, url: 'https://muse.ai/' },
  ])
    assert.equal(classify('diagnostic-health', s), false);
  const work = new RuntimeWork();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const diagnostic = work.run(() => held, classify('diagnostic-health'));
  assert.equal(work.active, 0);
  const mutation = work.run(() => held, classify('complete'));
  assert.equal(work.active, 1);
  await assert.rejects(
    work.run(async () => {
      throw Error('failure');
    }),
  );
  assert.equal(work.active, 1);
  finish();
  await Promise.all([diagnostic, mutation]);
  assert.equal(work.active, 0);
});
