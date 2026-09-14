import { logFile } from './diagnostic-log.js';
export interface LogHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  createWritable(): Promise<{
    write(value: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
export class LogFileWriter {
  private chain = Promise.resolve();
  private previous = '';
  constructor(private handle: LogHandle) {}
  write(
    entries: unknown,
    health?: unknown,
    collection?: unknown,
  ): Promise<void> {
    const text = logFile(entries, health, collection);
    const next = this.chain.then(async () => {
      if (text === this.previous) return;
      if (
        (await this.handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
      )
        throw Error('Log permission required.');
      const stream = await this.handle.createWritable();
      try {
        await stream.write(text);
        await stream.close();
        this.previous = text;
      } catch (error) {
        await stream.abort().catch(() => {});
        throw error;
      }
    });
    this.chain = next.catch(() => {});
    return next;
  }
  async idle() {
    await this.chain;
  }
}
