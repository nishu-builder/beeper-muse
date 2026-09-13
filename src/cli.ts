#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import BeeperDesktop from '@beeper/desktop-api';
import { loadConfig, requireConfig } from './config.ts';
import { beeperClient, BeeperAdapter, validateSelfChat } from './beeper.ts';
import { Store, writePrivateJSON } from './storage.ts';
import { Relay, parseState } from './relay.ts';
import { relayServer } from './server.ts';
import { login } from './oauth.ts';

const USAGE = `Beeper Muse — direct local browser connector (experimental)

  npm start -- login              Connect to Beeper
  npm start -- setup              Choose Note to self and prepare the extension
  npm start -- doctor             Check Beeper and configuration (read only)
  npm start -- start              Run the local relay
  npm start -- status             Inspect the relay without printing prompts
  npm start -- acknowledge        Resolve a blocked job after checking both apps
  npm start -- open               Open the selected Beeper self-chat

Load .local/extension as an unpacked extension in Chrome. Open muse.ai,
then click the extension's Connect this Muse tab button. In Beeper Note
to self, send !muse followed by your prompt. No WhatsApp connection needed.
`;
function safeError(error: unknown): string {
  if (error instanceof BeeperDesktop.APIError)
    return `Beeper request failed${error.status ? ` (HTTP ${error.status})` : ''}. Check Beeper and its approved connection.`;
  if (error instanceof TypeError || error instanceof SyntaxError)
    return 'A network or response error occurred. Check the connection.';
  return error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
}
async function main(): Promise<void> {
  const command = process.argv[2] || 'help';
  if (process.argv.length > 3)
    throw new Error('Unexpected arguments. Run npm start -- help.');
  if (['help', '--help', '-h'].includes(command)) {
    console.log(USAGE);
    return;
  }
  const config = await loadConfig();
  const store = new Store(config.dataDir);
  const connectionPath = resolve(config.dataDir, 'connection.json');
  if (command === 'login') {
    const unlock = await store.lock();
    try {
      console.log('Opening Beeper authorization for Beeper Muse.');
      const beeperToken = await login(config.beeperURL);
      await writePrivateJSON(connectionPath, {
        beeperToken,
        chatID: config.chatID,
        relayToken: config.relayToken,
      });
      console.log('Beeper connected. Next: npm start -- setup');
    } finally {
      await unlock();
    }
    return;
  }
  if (!config.beeperToken)
    throw new Error('Connect Beeper first: npm start -- login');
  const client = beeperClient(config.beeperURL, config.beeperToken);
  if (command === 'setup') {
    const unlock = await store.lock();
    try {
      let chatID = config.chatID;
      if (!chatID) {
        const page = await client.chats.search({
          query: 'Note to self',
          type: 'single',
          limit: 20,
          includeMuted: true,
        });
        const self = page.items.filter(
          (c) =>
            !c.participants.hasMore &&
            c.participants.items.length === 1 &&
            c.participants.items[0]?.isSelf === true,
        );
        const preferred = self.filter((c) => c.accountID === 'matrix');
        const choices = preferred.length === 1 ? preferred : self;
        if (choices.length !== 1)
          throw new Error(
            'Could not identify one Note to self chat. Open or create Beeper Note to self, then retry.',
          );
        chatID = choices[0]!.id;
      }
      await validateSelfChat(client, chatID);
      parseState(await store.read('relay'), chatID);
      const relayToken = config.relayToken || randomBytes(32).toString('hex');
      await writePrivateJSON(connectionPath, {
        beeperToken: config.beeperToken,
        chatID,
        relayToken,
      });
      const destination = resolve(config.dataDir, 'extension');
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await cp(
        fileURLToPath(new URL('../extension/', import.meta.url)),
        destination,
        { recursive: true },
      );
      await writePrivateJSON(resolve(destination, 'local-config.json'), {
        baseURL: `http://127.0.0.1:${config.port}`,
        token: relayToken,
      });
      console.log(
        `Prepared private extension: ${destination}\nLoad this directory in chrome://extensions with Developer mode enabled.\nOpen muse.ai and use the extension button to connect that tab.\nStart the relay with npm start -- start.`,
      );
    } finally {
      await unlock();
    }
    return;
  }
  requireConfig(config);
  if (command === 'doctor') {
    await validateSelfChat(client, config.chatID);
    console.log(
      'Beeper connected; selected chat contains only you. No message sent.',
    );
    if (!/^[a-f0-9]{64}$/.test(config.relayToken))
      throw new Error('Invalid relay token. Run setup again.');
    parseState(await store.read('relay'), config.chatID);
    console.log(
      'Configuration valid. Muse access is checked by the browser extension.',
    );
    return;
  }
  if (command === 'open') {
    await validateSelfChat(client, config.chatID);
    await client.focus({ chatID: config.chatID });
    return;
  }
  if (command === 'status') {
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/status`, {
      headers: { Authorization: `Bearer ${config.relayToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Could not read relay status.');
    const s = (await response.json()) as { phase: string; queued: number };
    console.log(`Phase: ${s.phase}; queued: ${s.queued}`);
    return;
  }
  if (command === 'acknowledge') {
    const unlock = await store.lock();
    try {
      const state = parseState(await store.read('relay'), config.chatID);
      const job = state?.jobs[0];
      if (!job || !['blocked', 'claimed', 'sending'].includes(job.phase)) {
        console.log('No blocked job.');
        return;
      }
      if (!process.stdin.isTTY)
        throw new Error('Acknowledgment requires an interactive terminal.');
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        console.log(
          'Disconnect the extension and inspect both Muse and Beeper. This marks the interrupted prompt handled without retrying it.',
        );
        if ((await rl.question('Type checked to continue: ')) !== 'checked')
          throw new Error('Acknowledgment cancelled.');
      } finally {
        rl.close();
      }
      state!.jobs.shift();
      await store.write('relay', state);
      console.log(
        'Acknowledged. Restart the relay and reconnect the extension. Enter a new prompt only if needed.',
      );
    } finally {
      await unlock();
    }
    return;
  }
  if (command !== 'start')
    throw new Error('Unknown command. Run npm start -- help.');
  const unlock = await store.lock();
  const abort = new AbortController();
  const stop = () => abort.abort();
  let server: ReturnType<typeof relayServer> | undefined;
  let relay: Relay | undefined;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await validateSelfChat(client, config.chatID);
    relay = new Relay(config.chatID, new BeeperAdapter(client), store, () =>
      validateSelfChat(client, config.chatID),
    );
    await relay.initialize();
    server = relayServer(relay, config.relayToken, config.port);
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(config.port, '127.0.0.1', resolve);
    });
    console.log(
      `Relay listening on 127.0.0.1:${config.port}. In Beeper Note to self, send !muse followed by your prompt.\nConnect one Muse tab with the extension. Press Ctrl+C to stop.`,
    );
    let failures = 0;
    while (!abort.signal.aborted) {
      try {
        await relay.tick();
        failures = 0;
      } catch (error) {
        if (
          !(error instanceof BeeperDesktop.APIError) ||
          [401, 403, 404].includes(error.status || 0)
        )
          throw error;
        failures++;
        console.error('Beeper read failed; retrying with backoff.');
      }
      await sleep(
        failures
          ? Math.min(60000, config.pollMs * 2 ** Math.min(failures, 5))
          : config.pollMs,
        undefined,
        { signal: abort.signal },
      ).catch(() => {});
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await relay?.exclusive(async () => {});
    await unlock();
  }
}
main().catch((error) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
