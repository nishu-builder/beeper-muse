import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityPulse } from '../browser-runtime/runtime/activity-pulse.ts';
test('worker pulses the selected tab without overlapping or replaying after disconnect', async () => {
  let tab: number | undefined = 7;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const sent: number[] = [];
  const pulse = new ActivityPulse(
    async () => tab,
    async (id) => {
      sent.push(id);
      await pending;
    },
  );
  const first = pulse.tick();
  await pulse.tick();
  assert.deepEqual(sent, [7]);
  tab = undefined;
  finish();
  await first;
  await pulse.tick();
  assert.deepEqual(sent, [7]);
});
test('discarded tab failures allow later fresh observations', async () => {
  let attempts = 0;
  const pulse = new ActivityPulse(
    async () => 9,
    async () => {
      attempts++;
      if (attempts === 1) throw Error('Tab closed');
    },
  );
  await pulse.tick();
  await pulse.tick();
  assert.equal(attempts, 2);
});
