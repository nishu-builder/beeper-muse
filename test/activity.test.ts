import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(
  new URL('../extension/activity.js', import.meta.url),
  'utf8',
);
type Activity = 'idle' | 'working';
function reporter(
  send: (activity: Activity) => Promise<unknown>,
  now: () => number,
) {
  const context = {} as {
    BeeperMuseActivity: {
      Reporter: new (
        send: (activity: Activity) => Promise<unknown>,
        now: () => number,
      ) => { update(activity: Activity): Promise<void> };
    };
  };
  runInNewContext(source, context);
  return new context.BeeperMuseActivity.Reporter(send, now);
}
test('working activity renews on a heartbeat and clears immediately without repeating idle', async () => {
  const calls: Activity[] = [];
  let now = 0;
  const r = reporter(
    async (v) => {
      calls.push(v);
    },
    () => now,
  );
  await r.update('working');
  now = 4000;
  await r.update('working');
  now = 5000;
  await r.update('working');
  await r.update('idle');
  now = 100000;
  await r.update('idle');
  assert.deepEqual(calls, ['working', 'working', 'idle']);
});
test('disconnect during an in-flight heartbeat clears after that heartbeat, never before it', async () => {
  const calls: Activity[] = [];
  let resolve!: () => void;
  const waiting = new Promise<void>((done) => {
    resolve = done;
  });
  const r = reporter(
    async (v) => {
      calls.push(v);
      if (v === 'working') await waiting;
    },
    () => 0,
  );
  const started = r.update('working');
  await Promise.resolve();
  await Promise.resolve();
  const stopped = r.update('idle');
  resolve();
  await Promise.all([started, stopped]);
  assert.deepEqual(calls, ['working', 'idle']);
});
test('a failed update retries and a new reporter never replays stale working state', async () => {
  let failed = true;
  const calls: Activity[] = [];
  const send = async (v: Activity) => {
    if (failed) throw Error('Offline');
    calls.push(v);
  };
  const r = reporter(send, () => 0);
  await assert.rejects(r.update('working'), /Offline/);
  failed = false;
  await r.update('working');
  const restarted = reporter(send, () => 0);
  await restarted.update('idle');
  assert.deepEqual(calls, ['working', 'idle']);
});
