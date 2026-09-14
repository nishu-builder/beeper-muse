import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  stat,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readRegistration,
  saveRegistration,
} from '../scripts/registration.mjs';
import { configuration } from '../browser-runtime/runtime/matrix.ts';
const fixture = {
  homeserver: {
    address: 'https://matrix.beeper.com/_hungryserv/test',
    domain: 'beeper.local',
  },
  appservice: {
    bot: { username: 'sh-muse-chrome-012345abcdefbot' },
    as_token: 'synthetic-private-token',
  },
};
test('registration converter produces an importable private file and refuses overwrite or symlinks', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'muse-registration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'bridge.yaml'),
    output = join(dir, 'private', 'registration.json');
  await writeFile(input, JSON.stringify(fixture));
  await saveRegistration(input, output);
  const value = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(configuration(value), value);
  assert.equal(value.owner, '@test:beeper.com');
  if (process.platform !== 'win32')
    assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(saveRegistration(input, output));
  const linked = join(dir, 'linked.json');
  await symlink(output, linked);
  await assert.rejects(saveRegistration(input, linked));
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), value);
});
test('registration converter rejects foreign endpoints and credentials without including them in errors', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'muse-registration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = join(dir, 'bridge.yaml');
  for (const address of [
    'http://matrix.beeper.com/_hungryserv/test',
    'https://other.example/_hungryserv/test',
    'https://matrix.beeper.com/_hungryserv/test?token=private',
    'https://secret@matrix.beeper.com/_hungryserv/test',
    'https://matrix.beeper.com/_hungryserv/test/extra',
  ]) {
    await writeFile(
      input,
      JSON.stringify({
        ...fixture,
        homeserver: { ...fixture.homeserver, address },
      }),
    );
    await assert.rejects(readRegistration(input), /Invalid homeserver/);
  }
  await writeFile(
    input,
    JSON.stringify({
      ...fixture,
      appservice: { ...fixture.appservice, as_token: 'private\nvalue' },
    }),
  );
  await assert.rejects(
    readRegistration(input),
    /Invalid registration credential/,
  );
});
