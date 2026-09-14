// Closed vocabulary: no exception strings, message text, identifiers or URLs.
export const explanations = {
  'image-composer-missing':
    'Muse has no recognized image upload form. The photo was not attached.',
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
  'image-upload-start',
  'image-submitted',
  'text-submit-start',
  'reply-wait',
  'reply-captured',
  'reply-delivered',
  'job-dismissed',
  'beeper-connected',
  'beeper-disconnected',
  'beeper-error',
  'startup-failed',
]);
const fields = [
  'composers',
  'hasForm',
  'fileInputs',
  'imageInputs',
  'existingFiles',
  'previews',
  'sendButtons',
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
export function logFile(value: unknown) {
  return (
    JSON.stringify(
      { format: 1, application: 'Beeper Muse', events: cleanEntries(value) },
      null,
      2,
    ) + '\n'
  );
}
