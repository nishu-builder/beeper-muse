// Development-only setup. It creates a separate registration and never exports
// the existing bridge's token, room, queue, or encryption keys into Chrome.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  chmod,
  access,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
const root = fileURLToPath(new URL('../', import.meta.url));
const data = resolve(process.env.MUSE_DATA_DIR || join(root, '.local'));
const directory = join(data, 'chrome-probe');
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
let stage = 'checking the existing setup and probe build';
try {
  await access(join(data, 'bbctl.json'));
  await access(join(root, 'dist/browser-probe/transport.js'));
  if (await exists(join(directory, 'probe-registration.json')))
    throw Error('already prepared');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const idFile = join(directory, 'registration-id.txt');
  const registrationID = (await exists(idFile))
    ? (await readFile(idFile, 'utf8')).trim()
    : 'sh-muse-probe-' + randomBytes(6).toString('hex');
  if (!/^sh-muse-probe-[a-f0-9]{12}$/.test(registrationID))
    throw Error('invalid identity');
  await writeFile(idFile, registrationID + '\n', { mode: 0o600 });
  const configPath = join(directory, 'bridge.yaml');
  stage = 'creating the separate registration';
  if (!(await exists(configPath))) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.BBCTL_BIN || 'bbctl',
        [
          '--config',
          join(data, 'bbctl.json'),
          'config',
          '--type',
          'bridgev2',
          '--output',
          configPath,
          registrationID,
        ],
        { stdio: 'ignore' },
      );
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(Error('registration failed')),
      );
    });
  }
  stage = 'validating the separate registration';
  await chmod(configPath, 0o600);
  const config = parse(await readFile(configPath, 'utf8'));
  const original = parse(await readFile(join(data, 'bridge.yaml'), 'utf8'));
  if (
    !config.appservice?.as_token ||
    config.appservice.as_token === original.appservice?.as_token
  )
    throw Error('registration not isolated');
  const registration = {
    homeserverURL: config.homeserver?.address,
    appserviceToken: config.appservice.as_token,
    registrationID,
  };
  const { endpoint } = await import('../dist/browser-probe/transport.js');
  endpoint(registration);
  stage = 'copying the probe files';
  // Only allowlisted public build files enter the unpacked experiment.
  for (const name of [
    'manifest.json',
    'popup.html',
    'popup.js',
    'popup.css',
    'transport.js',
    'probe/background.js',
  ]) {
    await mkdir(join(directory, name, '..'), { recursive: true });
    await cp(join(root, 'dist/browser-probe', name), join(directory, name));
  }
  await writeFile(
    join(directory, 'probe-registration.json'),
    JSON.stringify(registration),
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Prepared isolated Chrome test at ' + directory);
  console.log(
    'Load this directory unpacked in Chrome, then click Test connection.',
  );
} catch {
  console.error(
    'Could not prepare the Chrome test while ' +
      stage +
      '. Check the setup guide and whether .local/chrome-probe already exists. No credentials were printed.',
  );
  process.exitCode = 1;
}
