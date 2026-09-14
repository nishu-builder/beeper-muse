import { randomUUID, randomInt } from 'node:crypto';
import {
  cleanEntries,
  cleanCollection,
  cleanHealth,
} from '../../browser-runtime/runtime/diagnostic-log.ts';
import {
  DevError,
  type Desktop,
  type Target,
  type Message,
  object,
} from './desktop.ts';
import { colorPNG } from './fixture.ts';
export type Scenario = 'text' | 'image' | 'receive-image';
export interface Run {
  format: 1;
  id: string;
  target: Target;
  scenario: Scenario;
  startedAt: number;
  marker: string;
  expected: string;
  prompt: string;
  color: 'RED' | 'BLUE';
  phase: 'prepared' | 'sending' | 'observing';
  pendingID?: string;
}
export function newRun(target: Target, scenario: Scenario): Run {
  const id = randomUUID(),
    marker = 'BEEPER_MUSE_TEST_' + id.replaceAll('-', '');
  const color = randomInt(2) ? 'RED' : 'BLUE';
  return {
    format: 1,
    id,
    target,
    scenario,
    startedAt: Date.now(),
    marker,
    color,
    expected: scenario === 'image' ? marker + ':' + color : marker,
    prompt:
      scenario === 'image'
        ? `Inspect the attached image. Reply only with ${marker}: followed by its dominant color in uppercase. If no image arrived, reply ${marker}:MISSING.`
        : scenario === 'receive-image'
          ? `Create a small plain square image for this integration test. Include ${marker} in your accompanying reply.`
          : `Integration test. Reply with exactly ${marker}.`,
    phase: 'prepared',
  };
}
export function readRun(value: unknown, target: Target): Run {
  const r = object(value),
    t = object(r.target);
  if (
    r.format !== 1 ||
    typeof r.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(r.id) ||
    t.chatID !== target.chatID ||
    t.ownerID !== target.ownerID ||
    t.botID !== target.botID ||
    !['text', 'image', 'receive-image'].includes(String(r.scenario)) ||
    !['prepared', 'sending', 'observing'].includes(String(r.phase)) ||
    typeof r.startedAt !== 'number' ||
    !Number.isFinite(r.startedAt) ||
    typeof r.marker !== 'string' ||
    !/^BEEPER_MUSE_TEST_[a-f0-9]{32}$/.test(r.marker) ||
    typeof r.expected !== 'string' ||
    typeof r.prompt !== 'string' ||
    !['RED', 'BLUE'].includes(String(r.color))
  )
    throw new DevError('Invalid saved run or different target.');
  return r as unknown as Run;
}
export function diagnostics(value: unknown, now = Date.now()) {
  const file = object(value);
  if (file.format !== 1 || file.application !== 'Beeper Muse')
    throw new DevError('Unrecognized diagnostic file.');
  const health = cleanHealth(file.health);
  const events = cleanEntries(file.events);
  const fresh = !!health && now - health.at >= -5000 && now - health.at < 30000;
  const collection = cleanCollection(file.collection);
  const collectionFresh =
    !!collection && now - collection.at >= -5000 && now - collection.at < 30000;
  return { health, fresh, events, collection, collectionFresh };
}
export function ready(value: unknown, version: string, build: string) {
  const d = diagnostics(value);
  if (
    d.collection &&
    (!d.collectionFresh || d.collection.health !== 'available')
  )
    throw new DevError(
      'Diagnostic collection is stale or runtime health is unavailable. No test was sent.',
    );
  if (!d.fresh && d.collectionFresh)
    throw new DevError(
      'Diagnostic file is updating, but runtime health is unavailable or stale. No test was sent.',
    );
  if (!d.fresh)
    throw new DevError(
      'Diagnostic file is missing a fresh heartbeat. Enable file logging in the connection tab.',
    );
  const h = d.health!;
  if (h.version !== version || h.build !== build)
    throw new DevError(
      'The installed extension has not loaded the current build.',
    );
  if (
    d.collection &&
    (d.collection.build !== build || d.collection.version !== version)
  )
    throw new DevError(
      'The connection tab has not loaded the current diagnostic build.',
    );
  if (
    [h.update, d.collection?.update].some(
      (update) =>
        update &&
        (update.pending || !['idle', 'failed'].includes(update.stage)),
    )
  )
    throw new DevError(
      'An extension update is pending or in progress. No test was sent.',
    );
  if (!h.beeperConnected || !h.museConnected || !h.ready)
    throw new DevError(
      'Beeper and Muse must be connected with an empty, idle composer.',
    );
  if (h.blocked || h.queued || h.claimed || h.pending)
    throw new DevError(
      'Existing work needs attention. No test was added to the queue.',
    );
  return d;
}
export async function sendOnce(
  desktop: Desktop,
  run: Run,
  save: (r: Run) => Promise<void>,
) {
  if (run.phase !== 'prepared')
    throw new DevError('This run may already have sent. Observe it instead.');
  // Persist BEFORE any mutation. Losing an upload/send response never causes replay.
  run.phase = 'sending';
  await save(run);
  const upload =
    run.scenario === 'image'
      ? await desktop.upload(colorPNG(run.color).toString('base64'))
      : undefined;
  run.pendingID = await desktop.send(run.target, run.prompt, upload);
  run.phase = 'observing';
  await save(run);
}
function plain(text: string) {
  return text.replace(/<[^>]*>/g, '').trim();
}
export function assess(run: Run, messages: Message[]) {
  const recent = messages.filter(
    (m) =>
      m.chatID === run.target.chatID &&
      Date.parse(m.timestamp) >= run.startedAt - 1000,
  );
  const own = recent.filter(
    (m) =>
      m.senderID === run.target.ownerID &&
      m.isSender === true &&
      m.text?.includes(run.marker),
  );
  const replies = recent.filter(
    (m) =>
      m.senderID === run.target.botID &&
      m.isSender !== true &&
      m.text?.includes(run.marker),
  );
  const reply = replies.find((m) =>
    run.scenario === 'receive-image'
      ? plain(m.text || '').includes(run.expected)
      : plain(m.text || '') === run.expected,
  );
  const duplicate = new Set(own.map((m) => m.id)).size > 1;
  const failure = own.some((m) =>
    ['FAIL_PERMANENT', 'FAIL_RETRIABLE'].includes(m.sendStatus?.status || ''),
  );
  const missing = replies.some(
    (m) => plain(m.text || '') === run.marker + ':MISSING',
  );
  const nativeDelivery = own.some(
    (m) =>
      m.sendStatus?.status === 'SUCCESS' &&
      m.sendStatus.deliveredToUsers?.includes(run.target.botID),
  );
  // For receiving images, require attachment on the marked reply itself. An unrelated
  // image in the conversation must not satisfy this test.
  const imageReceived = !!reply?.attachments?.some((a) => a.type === 'img');
  const roundTrip =
    !!reply && (run.scenario !== 'receive-image' || imageReceived);
  return {
    roundTrip,
    nativeDelivery,
    duplicate,
    imageMissing: missing,
    nativeFailure: failure,
    outcome:
      duplicate || failure || missing
        ? ('failed' as const)
        : roundTrip && nativeDelivery
          ? ('passed' as const)
          : ('waiting' as const),
    // UI indicators, OS notification banners and original source timestamps need
    // separate observations. Do not infer them from an API response.
    clientRendering: 'unverified',
    typingRendering: 'unverified',
    notifications: 'unverified',
    sourceTimestamps: 'unverified',
  };
}
