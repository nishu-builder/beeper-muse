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
  await cp(new URL('../dist/chrome-extension/', import.meta.url), source, {
    recursive: true,
  });
  const privateValue = 'private-pairing-must-not-ship';
  await writeFile(join(source, 'local-config.json'), privateValue);
  await writeFile(join(source, 'pairing-code.txt'), privateValue);
  await writeFile(join(source, 'dev-update.json'), privateValue);
  await writeFile(join(source, 'build-info.json'), privateValue);
  const zip = await packageExtension(source);
  assert.deepEqual(await packageExtension(source), zip);
  const path = join(temp, 'extension.zip');
  await writeFile(path, zip);
  execFileSync('unzip', ['-t', path]);
  const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' })
    .trim()
    .split('\n');
  assert.deepEqual(names.sort(), [...extensionFiles].sort());
  // Check references, not just the allowlist: a new stylesheet can otherwise
  // work in a local build but silently disappear from the public ZIP.
  for (const page of names.filter((name) => name.endsWith('.html'))) {
    const html = execFileSync('unzip', ['-p', path, page], {
      encoding: 'utf8',
    });
    for (const match of html.matchAll(
      /<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g,
    )) {
      const asset = new URL(match[1], 'https://extension.test/' + page);
      if (asset.origin === 'https://extension.test')
        assert.ok(
          names.includes(asset.pathname.slice(1)),
          `${page} references missing packaged asset ${match[1]}`,
        );
    }
  }
  const extracted = execFileSync('unzip', ['-p', path], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.ok(!extracted.includes(privateValue));
  const manifest = JSON.parse(
    execFileSync('unzip', ['-p', path, 'manifest.json'], { encoding: 'utf8' }),
  );
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.version, pkg.version);
  assert.ok(
    manifest.permissions.includes('declarativeNetRequestWithHostAccess'),
  );
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  assert.ok(!manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('management'));
  assert.ok(!names.includes('dev-update.json'));
  assert.ok(!names.includes('build-info.json'));
  assert.ok(
    manifest.host_permissions.every(
      (h: string) => !h.includes('127.0.0.1') && !h.includes('localhost'),
    ),
  );
  assert.ok(names.includes('crypto.wasm'));
  assert.ok(names.includes('connection.js'));
  assert.ok(names.includes('MATRIX-CRYPTO-LICENSE'));
  assert.ok(names.includes('NOTICES.md'));
  const wasm = execFileSync('unzip', ['-p', path, 'crypto.wasm'], {
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109]);
});
