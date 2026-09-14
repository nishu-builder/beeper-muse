// One-time conversion of an existing bbctl bridgev2 config; no process remains.
import { readFile, writeFile, cp, mkdir, chmod } from 'node:fs/promises';
import { parse } from 'yaml';
import { resolve } from 'node:path';
const root = new URL('../', import.meta.url);
const input = process.argv[2];
if (!input) {
  console.error(
    'Usage: npm run prepare:browser-runtime -- /path/to/bridge.yaml',
  );
  process.exit(1);
}
try {
  const config = parse(await readFile(resolve(input), 'utf8'));
  const homeserverURL = config.homeserver.address;
  const owner =
    '@' +
    new URL(homeserverURL).pathname.split('/').filter(Boolean).at(-1) +
    ':beeper.com';
  const registrationID = config.appservice.bot.username.replace(/bot$/, '');
  if (!/^sh-muse-(?:chrome|probe)-[a-f0-9]{12}$/.test(registrationID))
    throw Error('invalid registration name');
  const registration = {
    homeserverURL,
    owner,
    registrationID,
    appserviceToken: config.appservice.as_token,
    bot: '@' + config.appservice.bot.username + ':' + config.homeserver.domain,
  };
  const directory = new URL('.local/chrome-extension/', root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await cp(new URL('dist/chrome-extension/', root), directory, {
    recursive: true,
  });
  await writeFile(
    new URL('local-config.json', directory),
    JSON.stringify(registration),
    { mode: 0o600 },
  );
  console.log('Prepared private extension at ' + directory.pathname);
  console.log('Load that directory unpacked in Chrome, then refresh Muse.');
} catch {
  console.error(
    'Could not prepare the extension. Check the bridgev2 config and build. No credentials were printed.',
  );
  process.exitCode = 1;
}
