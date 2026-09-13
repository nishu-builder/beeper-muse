import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.MUSE_DATA_DIR || join(root, '.local'));
const configPath = join(dataDir, 'bridge.yaml');
const binary = join(root, 'bin', 'beeper-muse');
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
class UserError extends Error {}
async function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', cwd: root });
  const stop = (signal) => child.kill(signal);
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', () =>
        reject(
          new UserError(
            `Could not start ${command}. See the installation instructions.`,
          ),
        ),
      );
      child.once('exit', (code, signal) =>
        code === 0 || signal === 'SIGINT' || signal === 'SIGTERM'
          ? resolve()
          : reject(new UserError('Command failed. See the output above.')),
      );
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
async function privateWrite(path, contents) {
  const temp = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  await writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
async function setup() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  if (await exists(join(dataDir, 'connector.lock')))
    throw new UserError('Stop the current connector before running setup.');
  const bbctl = process.env.BBCTL_BIN || 'bbctl';
  const authPath = join(dataDir, 'bbctl.json');
  if (!(await exists(authPath)))
    await run(bbctl, ['--config', authPath, 'login']);
  if (!(await exists(configPath)))
    await run(bbctl, [
      '--config',
      authPath,
      'config',
      '--type',
      'bridgev2',
      '--output',
      configPath,
      'sh-muse',
    ]);
  const config = parse(await readFile(configPath, 'utf8'));
  const owners = Object.entries(config.bridge?.permissions || {}).filter(
    ([user, permission]) => user.startsWith('@') && permission === 'admin',
  );
  if (
    owners.length !== 1 ||
    !config.appservice?.as_token ||
    !config.appservice?.hs_token ||
    !config.homeserver?.address ||
    config.homeserver?.software !== 'hungry'
  )
    throw new UserError(
      'Expected a valid bbctl bridgev2 registration with one owner.',
    );
  const owner = owners[0][0];
  if (config.network?.owner && config.network.owner !== owner)
    throw new UserError(
      'Configured bridge owner changed. Restore the original registration.',
    );
  let token = config.network?.relay_token;
  if (!token) {
    // Preserve an existing private extension pairing when upgrading version 0.1.
    try {
      token = JSON.parse(
        await readFile(join(dataDir, 'connection.json'), 'utf8'),
      ).relayToken;
    } catch {
      /* A new installation has no legacy settings. */
    }
  }
  if (!/^[a-f0-9]{64}$/.test(token || ''))
    token = randomBytes(32).toString('hex');
  config.network = { owner, data_dir: dataDir, relay_token: token };
  config.appservice.hostname = '127.0.0.1';
  config.appservice.port = 24820;
  config.appservice.bot.displayname = 'Muse bridge';
  config.bridge.command_prefix = '!muse-bridge';
  config.bridge.permissions = { [owner]: 'admin' };
  config.bridge.relay = { ...config.bridge.relay, enabled: false };
  config.bridge.personal_filtering_spaces = false;
  config.bridge.private_chat_portal_meta = true;
  config.bridge.deduplicate_matrix_messages = true;
  config.bridge.cleanup_on_logout.enabled = false;
  config.backfill = {
    ...config.backfill,
    enabled: false,
    queue: { ...config.backfill?.queue, enabled: false },
  };
  config.database.uri =
    pathToFileURL(join(dataDir, 'bridge.db')).href + '?_txlock=immediate';
  config.encryption.allow = true;
  config.encryption.default = true;
  config.encryption.require = true;
  config.encryption.self_sign = true;
  if (config.encryption.pickle_key === 'bbctl')
    config.encryption.pickle_key = randomBytes(32).toString('hex');
  config.logging = {
    min_level: 'info',
    writers: [{ type: 'stdout', format: 'pretty' }],
  };
  await privateWrite(configPath, stringify(config));
  const extensionDir = join(dataDir, 'extension');
  await mkdir(extensionDir, { recursive: true, mode: 0o700 });
  await cp(join(root, 'extension'), extensionDir, { recursive: true });
  await privateWrite(
    join(extensionDir, 'local-config.json'),
    JSON.stringify({ baseURL: 'http://127.0.0.1:24819', token }) + '\n',
  );
  console.log(
    `Bridge configured. Load this private extension folder in Chrome:\n${extensionDir}\nThen run npm start -- start and connect a signed-in Muse tab.`,
  );
}

async function main() {
  const command = process.argv[2] || 'help';
  if (process.argv.length > 3) throw new Error('Unexpected arguments.');
  if (command === 'setup') return setup();
  if (command === 'start')
    return run(binary, ['--config', configPath, '--no-update']);
  if (command === 'acknowledge') return run(binary, ['acknowledge', dataDir]);
  if (command === 'status') {
    const config = parse(await readFile(configPath, 'utf8'));
    const response = await fetch('http://127.0.0.1:24819/v1/status', {
      headers: { Authorization: `Bearer ${config.network.relay_token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('The bridge is unavailable.');
    const status = await response.json();
    console.log(`Phase: ${status.phase}; queued: ${status.queued}`);
    return;
  }
  if (!['help', '--help', '-h'].includes(command))
    throw new Error('Unknown command.');
  console.log(
    'Beeper Muse custom bridge\n\n  npm start -- setup         Register the bridge and prepare the extension\n  npm start -- start         Run the bridge\n  npm start -- status        Inspect the queue without printing messages\n  npm start -- acknowledge   Resolve an interrupted job after checking both apps\n\nSend ordinary messages in the dedicated Muse chat. Keep the connected Muse browser tab open.',
  );
}
main().catch((error) => {
  if (error instanceof UserError) console.error(error.message);
  console.error(
    'Operation failed. Check the command output and docs/operations.md. Private configuration is never printed.',
  );
  process.exitCode = 1;
});
