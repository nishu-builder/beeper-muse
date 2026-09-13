import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, writePrivateJSON } from '../src/storage.ts';
import { loadConfig, loopbackURL } from '../src/config.ts';

test('state writes are private, replace atomically, and fail closed on corruption', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'beeper-muse-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  assert.equal(await store.read('relay'), null);
  await store.write('relay', { value: 1 });
  await store.write('relay', { value: 2 });
  assert.deepEqual(await store.read('relay'), { value: 2 });
  if (process.platform !== 'win32')
    assert.equal((await stat(join(dir, 'relay.json'))).mode & 0o777, 0o600);
  await writeFile(join(dir, 'relay.json'), '{broken');
  await assert.rejects(store.read('relay'), /Cannot read/);
});
test('exclusive lock rejects a second process until explicitly released', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'beeper-muse-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const a = new Store(dir),
    b = new Store(dir);
  const release = await a.lock();
  await assert.rejects(b.lock(), /lock exists/);
  assert.equal(
    JSON.parse(await readFile(join(dir, 'connector.lock'), 'utf8')).pid,
    process.pid,
  );
  await release();
  const release2 = await b.lock();
  await release2();
});
test('Beeper credentials can only be sent to a loopback HTTP origin', () => {
  assert.equal(
    loopbackURL('http://localhost:23373/'),
    'http://localhost:23373',
  );
  for (const value of [
    'https://example.com',
    'http://127.0.0.1.evil.test',
    'http://user:pass@localhost',
    'http://localhost/path',
    'file:///tmp/a',
    'http://localhost?x=1',
    'garbage',
  ])
    assert.throws(() => loopbackURL(value), /loopback/);
});
test('configuration honors private settings and rejects invalid polling limits', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'beeper-muse-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writePrivateJSON(join(dir, 'connection.json'), {
    beeperToken: 'fixture',
    chatID: 'self',
  });
  const config = await loadConfig({
    MUSE_DATA_DIR: dir,
    BEEPER_ACCESS_TOKEN: 'override',
  });
  assert.equal(config.chatID, 'self');
  assert.equal(config.beeperToken, 'override');
  await assert.rejects(
    loadConfig({ MUSE_DATA_DIR: dir, POLL_INTERVAL_MS: '0' }),
    /POLL_INTERVAL_MS/,
  );
});
