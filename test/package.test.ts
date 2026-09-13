import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// @ts-expect-error The release builder is a plain JavaScript command.
import { packageExtension, extensionFiles } from '../scripts/package.mjs';

test('release ZIP is reproducible, readable by unzip, and excludes private files', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'beeper-muse-package-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'extension');
  await cp(new URL('../extension/', import.meta.url), source, {
    recursive: true,
  });
  const privateValue = 'private-pairing-must-not-ship';
  await writeFile(join(source, 'local-config.json'), privateValue);
  await writeFile(join(source, 'pairing-code.txt'), privateValue);
  const zip = await packageExtension(source);
  assert.deepEqual(await packageExtension(source), zip);
  const path = join(temp, 'extension.zip');
  await writeFile(path, zip);
  execFileSync('unzip', ['-t', path]);
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.deepEqual(names.sort(), [...extensionFiles].sort());
  const extracted = execFileSync('unzip', ['-p', path]);
  assert.ok(!extracted.includes(privateValue));
  const manifest = JSON.parse(
    execFileSync('unzip', ['-p', path, 'manifest.json'], { encoding: 'utf8' }),
  );
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
});
