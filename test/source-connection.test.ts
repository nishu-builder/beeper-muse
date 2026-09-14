import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceConnectionHealth,
  SourceConnectionMonitor,
} from '../browser-runtime/runtime/source-connection.ts';
const owner = '@fixture:beeper.com';

test('source status requires fresh evidence and expires independently of the Beeper socket', () => {
  let now = 1700000000000;
  const health = new SourceConnectionHealth(() => now);
  assert.equal(health.state(owner).state_event, 'TRANSIENT_DISCONNECT');
  health.observe(true);
  const connected = health.state(owner);
  assert.equal(connected.state_event, 'CONNECTED');
  assert.equal(connected.timestamp, now / 1000);
  assert.equal(connected.ttl, 90);
  assert.equal(connected.remote_id, 'browser');
  now += 29999;
  assert.equal(health.state(owner).state_event, 'CONNECTED');
  now++;
  assert.equal(health.state(owner).state_event, 'TRANSIENT_DISCONNECT');
  health.observe(true);
  assert.equal(health.state(owner).state_event, 'CONNECTED');
  health.observe(false);
  assert.match(health.state(owner).message!, /Muse is disconnected/);
  health.observe(true);
  now -= 1; // A clock adjustment must not make old evidence fresh indefinitely.
  assert.equal(health.state(owner).state_event, 'TRANSIENT_DISCONNECT');
});

test('failed and hung probes publish disconnected and allow a subsequent recovery', async () => {
  const states: boolean[] = [];
  let mode = 'error';
  let complete: ((value: boolean) => void) | undefined;
  const monitor = new SourceConnectionMonitor(
    async () => {
      if (mode === 'error') throw Error('Tab closed');
      if (mode === 'hang')
        return new Promise<boolean>((resolve) => {
          complete = resolve;
        });
      return true;
    },
    (state) => states.push(state),
    10,
  );
  await monitor.tick();
  mode = 'hang';
  await monitor.tick();
  mode = 'ready';
  await monitor.tick();
  complete!(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states, [false, false, true]);
});

test('detach invalidates an in-flight probe without letting it replace a new probe', async () => {
  const pending: Array<(value: boolean) => void> = [];
  const states: boolean[] = [];
  const monitor = new SourceConnectionMonitor(
    () => new Promise<boolean>((resolve) => pending.push(resolve)),
    (state) => states.push(state),
  );
  const first = monitor.tick();
  await Promise.resolve();
  await monitor.tick(); // Overlapping pulses do not start a second probe.
  assert.equal(pending.length, 1);
  monitor.invalidate();
  const next = monitor.tick();
  await Promise.resolve();
  pending[0]!(true);
  await first;
  await monitor.tick(); // The old finally must not clear the new probe's lock.
  assert.equal(pending.length, 2);
  pending[1]!(false);
  await next;
  assert.deepEqual(states, [false, false]);
});

test('only the selected active Muse source can report connected', async () => {
  const { readSourceConnection } =
    await import('../browser-runtime/runtime/source-connection.ts');
  let connected = true;
  let selected: number | undefined = 1;
  let tab = { url: 'https://muse.ai/', discarded: false };
  let probe = { protocol: 17, health: 'ready', active: true };
  const api = {
    beeperConnected: () => connected,
    selectedTab: async () => selected,
    tab: async (id: number) => {
      assert.equal(id, 1);
      return tab;
    },
    probe: async (id: number) => {
      assert.equal(id, 1);
      return probe;
    },
  };
  for (const health of ['ready', 'draft', 'busy']) {
    probe.health = health;
    assert.equal(await readSourceConnection(api), true);
  }
  probe.health = 'unavailable';
  assert.equal(await readSourceConnection(api), false);
  probe = { protocol: 11, health: 'ready', active: true };
  assert.equal(await readSourceConnection(api), false);
  probe = { protocol: 17, health: 'ready', active: false };
  assert.equal(await readSourceConnection(api), false);
  probe.active = true;
  tab.discarded = true;
  assert.equal(await readSourceConnection(api), false);
  tab = { url: 'https://example.com/', discarded: false };
  assert.equal(await readSourceConnection(api), false);
  tab.url = 'https://muse.ai/';
  selected = undefined;
  assert.equal(await readSourceConnection(api), false);
  selected = 1;
  connected = false;
  assert.equal(await readSourceConnection(api), false);
  connected = true;
  api.probe = async () => {
    selected = 2;
    return probe;
  };
  assert.equal(await readSourceConnection(api), false);
});
