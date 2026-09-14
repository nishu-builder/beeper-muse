import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { parse } from 'yaml';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readRegistration(input) {
  const config = parse(await readFile(resolve(input), 'utf8'));
  const homeserverURL = config?.homeserver?.address?.replace(/\/$/, '');
  const url = new URL(homeserverURL);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'matrix.beeper.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/_hungryserv\/[a-z0-9._=-]+\/?$/.test(url.pathname) ||
    config.homeserver.domain !== 'beeper.local'
  )
    throw Error('Invalid homeserver.');
  const username = config.appservice?.bot?.username;
  if (
    typeof username !== 'string' ||
    !/^sh-muse-(?:chrome|probe)-[a-f0-9]{12}bot$/.test(username)
  )
    throw Error('Invalid registration name.');
  const token = config.appservice?.as_token;
  if (
    typeof token !== 'string' ||
    !token ||
    !/^[\x21-\x7e]{16,4096}$/.test(token)
  )
    throw Error('Invalid registration credential.');
  return {
    homeserverURL,
    owner: '@' + url.pathname.split('/').at(-1) + ':beeper.com',
    registrationID: username.replace(/bot$/, ''),
    appserviceToken: token,
    bot: '@' + username + ':beeper.local',
  };
}
export async function saveRegistration(input, output) {
  const registration = await readRegistration(input);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  // Refuse to replace an existing credential or follow a destination symlink.
  await writeFile(output, JSON.stringify(registration), {
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(output, 0o600);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw Error('Missing input.');
    const output = fileURLToPath(
      new URL('../.local/chrome-registration.json', import.meta.url),
    );
    await saveRegistration(process.argv[2], output);
    console.log(
      'Created .local/chrome-registration.json. Import it in Beeper Muse; keep this file private.',
    );
  } catch {
    console.error(
      'Could not create registration JSON. Check the bbctl configuration and whether .local/chrome-registration.json already exists. No credentials were printed.',
    );
    process.exitCode = 1;
  }
}
