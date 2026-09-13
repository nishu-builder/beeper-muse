import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writePrivateJSON(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export class Store {
  constructor(readonly dataDir: string) {}
  async read(name: string): Promise<unknown | null> {
    try {
      return JSON.parse(
        await readFile(resolve(this.dataDir, name + '.json'), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(
        `Cannot read ${name}.json. Restore the file before continuing.`,
      );
    }
  }
  async write(name: string, value: unknown): Promise<void> {
    await writePrivateJSON(resolve(this.dataDir, name + '.json'), value);
  }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const path = resolve(this.dataDir, 'connector.lock');
    let file;
    try {
      file = await open(path, 'wx', 0o600);
    } catch {
      throw new Error(
        'connector.lock exists. Stop the other instance; see docs/operations.md for crash recovery.',
      );
    }
    try {
      await file.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
    } finally {
      await file.close();
    }
    return async () => {
      await unlink(path);
    };
  }
}
