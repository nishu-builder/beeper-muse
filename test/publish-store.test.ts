import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
// @ts-expect-error The store publisher is a plain JavaScript command.
import { publish } from '../scripts/publish-store.mjs';

const { version } = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const env = {
  RELEASE_TAG: `v${version}`,
  CWS_PUBLISHER_ID: 'synthetic-publisher',
  CWS_EXTENSION_ID: 'a'.repeat(32),
  CWS_CLIENT_ID: 'synthetic-client',
  CWS_CLIENT_SECRET: 'synthetic-secret',
  CWS_REFRESH_TOKEN: 'synthetic-refresh',
};
execFileSync(process.execPath, ['scripts/package.mjs'], {
  cwd: new URL('../', import.meta.url),
});

test('store publisher waits for V2 async upload completion before requesting review', async () => {
  const calls: string[] = [];
  let sleeps = 0;
  await publish(
    env,
    async (_label: string, url: string, options: RequestInit) => {
      calls.push(url);
      if (url.endsWith('/token')) return { access_token: 'synthetic-access' };
      if (url.endsWith(':upload')) {
        assert.equal(options.method, 'POST');
        assert.ok(Buffer.isBuffer(options.body));
        return { uploadState: 'IN_PROGRESS' };
      }
      if (url.endsWith(':fetchStatus'))
        return { lastAsyncUploadState: 'SUCCEEDED' };
      assert.ok(url.endsWith(':publish'));
      assert.deepEqual(JSON.parse(String(options.body)), {
        publishType: 'DEFAULT_PUBLISH',
        blockOnWarnings: true,
      });
      return { itemId: env.CWS_EXTENSION_ID, state: 'PENDING_REVIEW' };
    },
    async () => {
      sleeps++;
    },
  );
  assert.equal(calls.length, 4);
  assert.equal(sleeps, 1);
});

test('failed store uploads never submit or retry publication', async () => {
  let calls = 0;
  await assert.rejects(
    publish(env, async (_label: string, url: string) => {
      calls++;
      if (url.endsWith('/token')) return { access_token: 'synthetic-access' };
      assert.ok(url.endsWith(':upload'));
      return { uploadState: 'FAILED' };
    }),
    /not confirmed successful/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    publish({ ...env, RELEASE_TAG: 'v999.0.0' }),
    /must match/,
  );
});
