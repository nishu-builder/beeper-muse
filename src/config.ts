import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export interface Config {
  beeperURL: string;
  beeperToken: string;
  chatID: string;
  relayToken: string;
  port: number;
  pollMs: number;
  dataDir: string;
}
export function loopbackURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('BEEPER_URL must be a loopback HTTP URL.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('BEEPER_URL must be a loopback HTTP origin.');
  }
  return url.origin;
}
export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Config> {
  const dataDir = resolve(env.MUSE_DATA_DIR || '.local');
  let saved: Record<string, unknown> = {};
  try {
    saved = JSON.parse(
      await readFile(resolve(dataDir, 'connection.json'), 'utf8'),
    );
    if (!saved || typeof saved !== 'object' || Array.isArray(saved))
      throw new Error('invalid');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Cannot read local connection settings.');
  }
  const pollMs = Number(env.POLL_INTERVAL_MS ?? 3000);
  if (!Number.isInteger(pollMs) || pollMs < 2000 || pollMs > 60000)
    throw new Error('POLL_INTERVAL_MS must be an integer from 2000 to 60000.');
  return {
    beeperURL: loopbackURL(env.BEEPER_URL || 'http://127.0.0.1:23373'),
    beeperToken:
      env.BEEPER_ACCESS_TOKEN ||
      (typeof saved.beeperToken === 'string' ? saved.beeperToken : ''),
    chatID: typeof saved.chatID === 'string' ? saved.chatID : '',
    relayToken: typeof saved.relayToken === 'string' ? saved.relayToken : '',
    // Fixed to keep the browser extension's host permission narrow.
    port: 24819,
    pollMs,
    dataDir,
  };
}
export function requireConfig(config: Config): void {
  if (!config.beeperToken)
    throw new Error('Connect Beeper first: npm start -- login');
  if (!config.chatID || !config.relayToken)
    throw new Error('Configure a self-chat first: npm start -- setup');
}
