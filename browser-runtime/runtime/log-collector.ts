import {
  cleanEntries,
  cleanHealth,
  cleanUpdate,
  type LogEntry,
  type DiagnosticCollection,
} from './diagnostic-log.js';

type ReadResult = { ok: true; value: unknown } | { ok: false };
/** At most one underlying read remains in flight after an observation timeout. */
class DiagnosticRead {
  private pending = false;
  private waiting = new Set<(result: ReadResult) => void>();
  constructor(private read: () => Promise<unknown>) {}
  sample(timeoutMs: number): Promise<ReadResult> {
    return new Promise((resolve) => {
      const complete = (result: ReadResult) => {
        clearTimeout(timer);
        this.waiting.delete(complete);
        resolve(result);
      };
      const timer = setTimeout(() => complete({ ok: false }), timeoutMs);
      this.waiting.add(complete);
      if (!this.pending) {
        this.pending = true;
        void Promise.resolve()
          .then(this.read)
          .then(
            (value): ReadResult => ({ ok: true, value }),
            (): ReadResult => ({ ok: false }),
          )
          .then((result) => {
            this.pending = false;
            for (const waiter of [...this.waiting]) waiter(result);
          });
      }
    });
  }
}
export class LogCollector {
  private events: DiagnosticRead;
  private health: DiagnosticRead;
  private progress: DiagnosticRead;
  private lastEvents: LogEntry[] = [];
  constructor(
    private version: string,
    private build: string,
    readEvents: () => Promise<unknown>,
    readHealth: () => Promise<unknown>,
    readProgress: () => Promise<unknown>,
    private now = () => Date.now(),
    private timeoutMs = 3000,
  ) {
    this.events = new DiagnosticRead(readEvents);
    this.health = new DiagnosticRead(readHealth);
    this.progress = new DiagnosticRead(readProgress);
  }
  async collect() {
    const [events, result, progress] = await Promise.all([
      this.events.sample(this.timeoutMs),
      this.health.sample(this.timeoutMs),
      this.progress.sample(this.timeoutMs),
    ]);
    const health = result.ok ? cleanHealth(result.value) : undefined;
    if (events.ok) this.lastEvents = cleanEntries(events.value);
    const update = progress.ok ? cleanUpdate(progress.value) : undefined;
    const collection: DiagnosticCollection = {
      at: Math.floor(this.now() / 5000) * 5000,
      version: this.version,
      build: this.build,
      events: events.ok ? 'available' : 'unavailable',
      health: health ? 'available' : 'unavailable',
      ...(update ? { update } : {}),
    };
    return {
      events: this.lastEvents,
      health,
      collection,
    };
  }
}
