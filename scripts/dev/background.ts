import { DevError } from './desktop.ts';

// Diagnostics sample source visibility every 30 seconds. This verifies sampled
// hidden state, not uninterrupted invisibility between samples.
const maxGap = 40000;
type Sample = { time: number; code: string; facts?: Record<string, unknown> };
export interface BackgroundEvidence {
  firstSample: number;
  lastSample: number;
  samples: number;
  failed: boolean;
  completedAt?: number;
}
function observations(events: Sample[]) {
  return events
    .filter((e) => e.code === 'source-readiness')
    .sort((a, b) => a.time - b.time);
}
export function beginBackground(
  events: Sample[],
  now = Date.now(),
): BackgroundEvidence {
  const last = observations(events).at(-1);
  if (
    !last ||
    last.time > now ||
    now - last.time > maxGap ||
    last.facts?.sourceVisible !== false
  )
    throw new DevError(
      'Background test not sent: wait for a fresh log sample with Muse hidden. Switch to another Chrome tab and leave it there.',
    );
  return {
    firstSample: last.time,
    lastSample: last.time,
    samples: 1,
    failed: false,
  };
}
export function validBackground(value: unknown): value is BackgroundEvidence {
  if (!value || typeof value !== 'object') return false;
  const s = value as BackgroundEvidence;
  return (
    Number.isFinite(s.firstSample) &&
    s.firstSample > 0 &&
    Number.isFinite(s.lastSample) &&
    s.lastSample >= s.firstSample &&
    Number.isSafeInteger(s.samples) &&
    s.samples > 0 &&
    typeof s.failed === 'boolean' &&
    (s.completedAt === undefined ||
      (Number.isFinite(s.completedAt) && s.completedAt >= s.firstSample))
  );
}
export function observeBackground(
  state: BackgroundEvidence,
  events: Sample[],
  delivered: boolean,
  now = Date.now(),
): 'waiting' | 'passed' | 'failed' {
  for (const sample of observations(events)) {
    if (sample.time <= state.lastSample) continue;
    if (
      sample.time > now ||
      sample.time - state.lastSample > maxGap ||
      sample.facts?.sourceVisible !== false
    )
      state.failed = true;
    state.lastSample = sample.time;
    state.samples++;
  }
  // A missing interval cannot later be replaced by one fresh hidden sample.
  if (now - state.lastSample > maxGap) state.failed = true;
  if (delivered && state.completedAt === undefined) state.completedAt = now;
  if (state.failed) return 'failed';
  return delivered &&
    state.completedAt !== undefined &&
    state.lastSample >= state.completedAt &&
    state.samples > 1
    ? 'passed'
    : 'waiting';
}
