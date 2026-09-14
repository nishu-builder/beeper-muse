import test from 'node:test';
import assert from 'node:assert/strict';
import { StartupProgress } from '../browser-runtime/runtime/startup.ts';

test('a stalled startup reports its exact step without abandoning the operation', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const failures: string[] = [];
  const progress = new StartupProgress((stage) => failures.push(stage));
  progress.begin();
  progress.step('Opening the encrypted key store');
  t.mock.timers.tick(59000);
  assert.deepEqual(failures, []);
  t.mock.timers.tick(1000);
  assert.deepEqual(failures, ['Opening the encrypted key store']);
  assert.equal(progress.snapshot().stageSeconds, 60);
  // A slow operation may eventually finish. No competing startup is launched.
  progress.step('Preparing the Muse chat');
  progress.stop();
  t.mock.timers.tick(60000);
  assert.equal(failures.length, 1);
});

test('progress resets the stall timer and connection completion cancels it', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const failures: string[] = [];
  const progress = new StartupProgress((stage) => failures.push(stage));
  progress.begin();
  t.mock.timers.tick(59000);
  progress.step('Opening the Beeper WebSocket');
  t.mock.timers.tick(59000);
  assert.equal(failures.length, 0);
  progress.stop();
  t.mock.timers.tick(60000);
  assert.equal(failures.length, 0);
  assert.deepEqual(progress.snapshot().steps, [
    'Starting the Chrome connection',
    'Opening the Beeper WebSocket',
  ]);
  progress.begin();
  assert.equal(progress.snapshot().steps.length, 1);
  progress.stop();
});
