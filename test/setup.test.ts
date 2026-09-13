import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const syntheticToken = 'b'.repeat(64);
function registration() {
  return {
    homeserver: { address: 'https://matrix.example.test', software: 'hungry' },
    appservice: { as_token: 'synthetic-as', hs_token: 'synthetic-hs', bot: {} },
    bridge: {
      permissions: { '@owner:test': 'admin', '*': 'user' },
      cleanup_on_logout: { enabled: true },
    },
    encryption: {
      pickle_key: 'bbctl',
      appservice: true,
      msc4190: false,
      verification_levels: {
        receive: 'cross-signed-tofu',
        send: 'cross-signed-tofu',
        share: 'cross-signed-tofu',
      },
    },
    database: {},
  };
}
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'beeper-muse-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'bbctl.json'), '{}');
  await writeFile(join(dir, 'bridge.yaml'), stringify(registration()));
  return {
    dir,
    run: () =>
      spawnSync(process.execPath, ['scripts/manage.mjs', 'setup'], {
        cwd: root,
        env: {
          ...process.env,
          MUSE_DATA_DIR: dir,
          BBCTL_BIN: 'must-not-contact-live-services',
        },
        encoding: 'utf8',
      }),
  };
}

test('setup preserves credentials, restricts recipients, and writes a private pairing code', async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.dir, 'connection.json'),
    JSON.stringify({ relayToken: syntheticToken }),
  );
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const config = parse(await readFile(join(f.dir, 'bridge.yaml'), 'utf8'));
  assert.equal(config.appservice.as_token, 'synthetic-as');
  assert.equal(config.appservice.hostname, '127.0.0.1');
  assert.deepEqual(config.bridge.permissions, { '@owner:test': 'admin' });
  assert.equal(config.bridge.relay.enabled, false);
  assert.equal(config.backfill.enabled, false);
  assert.equal(config.encryption.require, true);
  assert.equal(config.encryption.default, true);
  assert.equal(config.encryption.self_sign, true);
  assert.equal(config.encryption.msc4190, false);
  assert.equal(
    config.encryption.verification_levels.receive,
    'cross-signed-tofu',
  );
  assert.match(config.encryption.pickle_key, /^[a-f0-9]{64}$/);
  assert.equal(config.network.relay_token, syntheticToken);
  assert.equal(
    (await readFile(join(f.dir, 'pairing-code.txt'), 'utf8')).trim(),
    syntheticToken,
  );
  await assert.rejects(stat(join(f.dir, 'extension')));
  assert.equal(
    (await stat(join(f.dir, 'pairing-code.txt'))).mode & 0o777,
    0o600,
  );
  assert.equal((await stat(join(f.dir, 'bridge.yaml'))).mode & 0o777, 0o600);
  assert.equal((await stat(f.dir)).mode & 0o777, 0o700);
  assert.ok(!result.stdout.includes(syntheticToken));
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const second = parse(await readFile(join(f.dir, 'bridge.yaml'), 'utf8'));
  assert.equal(second.encryption.pickle_key, config.encryption.pickle_key);
  assert.equal(second.network.relay_token, syntheticToken);
});

test('setup refuses an active lock or changed owner without altering registration', async (t) => {
  const f = await fixture(t);
  const original = await readFile(join(f.dir, 'bridge.yaml'), 'utf8');
  await writeFile(join(f.dir, 'connector.lock'), '{}');
  let result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stop the current connector/);
  assert.equal(await readFile(join(f.dir, 'bridge.yaml'), 'utf8'), original);
  await rm(join(f.dir, 'connector.lock'));
  await writeFile(
    join(f.dir, 'bridge.yaml'),
    stringify({ ...registration(), network: { owner: '@someone-else:test' } }),
  );
  result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owner changed/);
});

test('malformed private configuration is never echoed in an error', async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.dir, 'bridge.yaml'),
    'private_secret: [synthetic-do-not-print\n',
  );
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.ok(
    !(result.stdout + result.stderr).includes('synthetic-do-not-print'),
  );
});
