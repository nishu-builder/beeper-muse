import { updateStages, type UpdateSnapshot } from './updates.js';
// Closed vocabulary: no exception strings, message text, identifiers or URLs.
export const explanations = {
  'image-composer-missing':
    'Muse has no recognized image upload controls beside its message box. The photo was not attached.',
  'image-input-missing':
    'Muse has no recognized image file input in its message form. The photo was not attached.',
  'image-composer-ambiguous':
    'Muse has multiple image inputs or an existing attachment. Check the message form.',
  'image-draft': 'Muse is busy or its message box already contains a draft.',
  'image-input-changed':
    'Muse changed or cleared the file input after the photo was attached. Check the staged photo.',
  'image-submit-changed':
    'The message form changed before Send. Check the staged photo and caption.',
  'image-preview-timeout':
    'The photo preview or Send button did not become ready within 60 seconds.',
  'image-unavailable': 'This image format or size is not supported.',
  'image-download-failed': 'The photo could not be downloaded or decrypted.',
  'image-adapter-unavailable':
    'The Muse tab has an older upload adapter. Reconnect the tab after updating.',
  'reply-attribution':
    'Another message appeared in Muse, so the reply could not be matched safely.',
  'reply-timeout': 'Muse did not provide a confirmed reply before the timeout.',
  'result-delivery-failed':
    'Muse replied, but the result could not be saved to Beeper.',
  'source-interrupted':
    'Submission or reply confirmation was interrupted. Check Muse before sending again.',
} as const;
export type FailureCode = keyof typeof explanations;
const events = new Set<string>([
  ...Object.keys(explanations),
  'image-readiness',
  'image-prepared',
  'image-fetch-failed',
  'image-format-unsupported',
  'image-too-large',
  'image-upload-start',
  'image-submitted',
  'text-submit-start',
  'reply-wait',
  'reply-captured',
  'reply-delivered',
  'job-dismissed',
  'beeper-connected',
  'muse-connected',
  'muse-disconnected',
  'beeper-disconnected',
  'beeper-error',
  'startup-failed',
  'activity-readiness',
  'source-readiness',
  'source-import-failed',
  'activity-unavailable',
  'typing-accepted',
  'typing-cleared',
  'typing-failed',
  'avatar-source-missing',
  'avatar-updated',
  'avatar-failed',
]);
const fields = [
  'composers',
  'hasForm',
  'hasUploadRegion',
  'pageFileInputs',
  'pageImageInputs',
  'fileInputs',
  'imageInputs',
  'existingFiles',
  'previews',
  'sendButtons',
  'stopButtons',
  'composerBusy',
  'assistantBusy',
  'sourceMessages',
  'sourceTailImages',
  'sourceTailPartial',
  'sourceTailWidgets',
  'sourceImages',
  'sourcePartial',
  'syncChecked',
  'syncWaiting',
  'syncPolling',
] as const;
export interface LogEntry {
  time: number;
  version: string;
  code: string;
  facts?: Record<string, number | boolean>;
}
export function failureCode(value: unknown): FailureCode {
  return typeof value === 'string' && Object.hasOwn(explanations, value)
    ? (value as FailureCode)
    : 'source-interrupted';
}
export function cleanFacts(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, number | boolean> = {};
  for (const key of fields) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === 'boolean') result[key] = v;
    else if (
      typeof v === 'number' &&
      Number.isSafeInteger(v) &&
      v >= 0 &&
      v <= 100
    )
      result[key] = v;
  }
  return Object.keys(result).length ? result : undefined;
}
export function cleanEntries(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap((v): LogEntry[] => {
    if (
      !v ||
      typeof v !== 'object' ||
      !events.has(v.code) ||
      !Number.isSafeInteger(v.time) ||
      v.time < 0 ||
      v.time > 8640000000000000 ||
      typeof v.version !== 'string' ||
      !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v.version)
    )
      return [];
    return [
      {
        time: v.time,
        version: v.version,
        code: v.code,
        ...(cleanFacts(v.facts) ? { facts: cleanFacts(v.facts) } : {}),
      },
    ];
  });
}
export interface LogStorage {
  get(): Promise<unknown>;
  set(entries: LogEntry[]): Promise<void>;
}
export class DiagnosticLog {
  private chain = Promise.resolve();
  constructor(
    private storage: LogStorage,
    private version: string,
    private now = Date.now,
  ) {}
  record(code: unknown, facts?: unknown): Promise<void> {
    if (typeof code !== 'string' || !events.has(code)) return Promise.resolve();
    this.chain = this.chain
      .then(async () => {
        const entries = cleanEntries(await this.storage.get());
        const entry = cleanEntries([
          { time: this.now(), version: this.version, code, facts },
        ])[0];
        if (!entry) return;
        const last = entries.at(-1);
        if (
          last?.code === entry.code &&
          last.version === entry.version &&
          JSON.stringify(last.facts) === JSON.stringify(entry.facts) &&
          entry.time - last.time < 10000
        )
          return;
        await this.storage.set([...entries, entry].slice(-200));
      })
      .catch(() => {}); // Logging must never interrupt a prompt or the connection.
    return this.chain;
  }
}
export interface DiagnosticCollection {
  at: number;
  version: string;
  build: string;
  events: 'available' | 'unavailable';
  health: 'available' | 'unavailable';
  update?: UpdateSnapshot;
}
function identity(value: Record<string, unknown>) {
  return (
    typeof value.at === 'number' &&
    Number.isSafeInteger(value.at) &&
    value.at >= 0 &&
    typeof value.version === 'string' &&
    /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value.version) &&
    typeof value.build === 'string' &&
    /^[a-f0-9]{64}$/.test(value.build)
  );
}
export function cleanCollection(
  value: unknown,
): DiagnosticCollection | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (
    !identity(v) ||
    (v.events !== 'available' && v.events !== 'unavailable') ||
    (v.health !== 'available' && v.health !== 'unavailable')
  )
    return;
  return {
    at: v.at as number,
    version: v.version as string,
    build: v.build as string,
    events: v.events as DiagnosticCollection['events'],
    health: v.health as DiagnosticCollection['health'],
    ...(cleanUpdate(v.update) ? { update: cleanUpdate(v.update) } : {}),
  };
}
export function cleanUpdate(value: unknown): UpdateSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (
    !updateStages.includes(v.stage as UpdateSnapshot['stage']) ||
    typeof v.pending !== 'boolean' ||
    typeof v.elapsedMs !== 'number' ||
    !Number.isSafeInteger(v.elapsedMs) ||
    v.elapsedMs < 0 ||
    v.elapsedMs > 86400000
  )
    return;
  return {
    stage: v.stage as UpdateSnapshot['stage'],
    pending: v.pending,
    elapsedMs: v.elapsedMs,
  };
}
export interface DiagnosticHealth {
  at: number;
  version: string;
  build: string;
  beeperConnected: boolean;
  museConnected: boolean;
  ready: boolean;
  queued: number;
  claimed: number;
  blocked: number;
  pending: number;
  update?: UpdateSnapshot;
}
export function cleanHealth(value: unknown): DiagnosticHealth | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (!identity(v)) return;
  for (const key of ['beeperConnected', 'museConnected', 'ready'])
    if (typeof v[key] !== 'boolean') return;
  for (const key of ['queued', 'claimed', 'blocked', 'pending'])
    if (
      typeof v[key] !== 'number' ||
      !Number.isSafeInteger(v[key]) ||
      v[key] < 0 ||
      v[key] > 10000
    )
      return;
  return {
    at: v.at as number,
    version: v.version as string,
    build: v.build as string,
    beeperConnected: v.beeperConnected as boolean,
    museConnected: v.museConnected as boolean,
    ready: v.ready as boolean,
    queued: v.queued as number,
    claimed: v.claimed as number,
    blocked: v.blocked as number,
    pending: v.pending as number,
    ...(cleanUpdate(v.update) ? { update: cleanUpdate(v.update) } : {}),
  };
}
export function logFile(
  value: unknown,
  health?: unknown,
  collection?: unknown,
) {
  return (
    JSON.stringify(
      {
        format: 1,
        application: 'Beeper Muse',
        events: cleanEntries(value),
        ...(cleanCollection(collection)
          ? { collection: cleanCollection(collection) }
          : {}),
        ...(cleanHealth(health) ? { health: cleanHealth(health) } : {}),
      },
      null,
      2,
    ) + '\n'
  );
}
