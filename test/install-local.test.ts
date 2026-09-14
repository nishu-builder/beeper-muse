import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Local package installer is a plain JavaScript command.
import { installLocal } from '../scripts/install-local.mjs';
test('local install preserves private configuration, rejects concurrent writers and leaves a working folder on staging failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'beeper-muse-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'build'),
    destination = join(root, 'installed');
  await cp(new URL('../dist/chrome-extension/', import.meta.url), source, {
    recursive: true,
  });
  await installLocal(source, destination, {
    secret: 'synthetic-private-registration',
  });
  const before = await readFile(join(destination, 'background.js'));
  assert.equal(
    JSON.parse(await readFile(join(destination, 'dev-update.json'), 'utf8'))
      .ready,
    true,
  );
  await writeFile(join(source, 'background.js'), 'new-worker');
  await installLocal(source, destination + '/');
  assert.equal(
    JSON.parse(await readFile(join(destination, 'local-config.json'), 'utf8'))
      .secret,
    'synthetic-private-registration',
  );
  assert.equal(
    await readFile(join(destination, 'background.js'), 'utf8'),
    'new-worker',
  );
  assert.notDeepEqual(before, Buffer.from('new-worker'));
  await mkdir(destination + '.update-lock');
  await assert.rejects(installLocal(source, destination));
  await rm(destination + '.update-lock', { recursive: true });
  await rm(join(source, 'content.js'));
  await assert.rejects(installLocal(source, destination));
  assert.equal(
    await readFile(join(destination, 'background.js'), 'utf8'),
    'new-worker',
  );
  assert.equal(
    JSON.parse(await readFile(join(destination, 'local-config.json'), 'utf8'))
      .secret,
    'synthetic-private-registration',
  );
});
