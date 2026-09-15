import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginBackground,
  observeBackground,
  validBackground,
} from '../scripts/dev/background.ts';
import { newRun, readRun } from '../scripts/dev/runner.ts';
const now = 100000;
const sample = (time: number, sourceVisible?: boolean) => ({
  time,
  code: 'source-readiness',
  facts: { sourceVisible },
});

test('background preflight rejects visible, unknown, future and stale source evidence', () => {
  for (const events of [
    [],
    [sample(now, true)],
    [sample(now)],
    [sample(now + 1, false)],
    [sample(now - 40001, false)],
    [sample(now - 1, false), sample(now, true)],
  ])
    assert.throws(() => beginBackground(events, now));
  assert.equal(beginBackground([sample(now, false)], now).samples, 1);
});

test('delivery must be followed by a hidden observation, and duplicates cannot satisfy it', () => {
  const s = beginBackground([sample(now, false)], now);
  assert.equal(
    observeBackground(s, [sample(now, false)], true, now + 1000),
    'waiting',
  );
  assert.equal(
    observeBackground(s, [sample(now, false)], true, now + 2000),
    'waiting',
  );
  assert.equal(s.samples, 1);
  assert.equal(
    observeBackground(s, [sample(now + 30000, false)], true, now + 31000),
    'passed',
  );
});

test('visibility or missing coverage permanently fails across later hidden samples', () => {
  for (const bad of [
    sample(now + 30000, true),
    sample(now + 30000),
    sample(now + 45000, false),
  ]) {
    const s = beginBackground([sample(now, false)], now);
    assert.equal(observeBackground(s, [bad], true, now + 45000), 'failed');
    assert.equal(
      observeBackground(s, [sample(now + 60000, false)], true, now + 61000),
      'failed',
    );
  }
  const s = beginBackground([sample(now, false)], now);
  assert.equal(observeBackground(s, [], false, now + 41000), 'failed');
});

test('background evidence survives journal recovery and invalid records are rejected', () => {
  const target = {
    chatID: '!room:example',
    ownerID: '@owner:example',
    botID: '@bot:example',
  };
  const run = newRun(target, 'receive-image');
  run.background = beginBackground([sample(now, false)], now);
  observeBackground(
    run.background,
    [sample(now + 1000, true)],
    false,
    now + 1000,
  );
  const restored = readRun(JSON.parse(JSON.stringify(run)), target);
  assert.equal(restored.background?.failed, true);
  assert.throws(() => readRun({ ...run, scenario: 'text' }, target));
  assert.throws(() =>
    readRun({ ...run, background: { ...run.background, samples: 0 } }, target),
  );
  assert.equal(
    validBackground({ ...run.background, lastSample: now - 1 }),
    false,
  );
});
