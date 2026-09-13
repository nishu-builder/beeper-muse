import test from 'node:test';
import assert from 'node:assert/strict';
import { relayServer, equalToken } from '../src/server.ts';
import { request } from 'node:http';
import type { Relay } from '../src/relay.ts';

test('relay requires bearer auth and rejects web origins and DNS rebinding hosts', async (t) => {
  let claims = 0;
  const relay = {
    status: () => ({ phase: 'idle', queued: 0 }),
    claim: async () => {
      claims++;
      return null;
    },
  } as unknown as Relay;
  // Listen on an ephemeral port for isolation; the expected Host header is kept
  // explicit, as it is for the fixed port in the installed extension.
  const server = relayServer(relay, 'fixture-token', 0);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const good = {
    Host: `127.0.0.1:${address.port}`,
    Authorization: 'Bearer fixture-token',
    'Content-Type': 'application/json',
  };
  for (const headers of [
    { ...good, Authorization: 'bad' },
    { ...good, Origin: 'https://muse.ai' },
    { ...good, Host: 'evil.test:24819' },
  ]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        url + '/v1/claim',
        { method: 'POST', headers },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(status, 403);
  }
  assert.equal(claims, 0);
  const response = await fetch(url + '/v1/claim', {
    method: 'POST',
    headers: { ...good, Origin: 'chrome-extension://' + 'a'.repeat(32) },
    body: '{}',
  });
  assert.equal(response.status, 200);
  assert.equal(claims, 1);
  assert.deepEqual(await response.json(), { job: null });
  assert.equal(
    (
      await fetch(url + '/v1/claim', {
        method: 'POST',
        headers: good,
        body: '{broken',
      })
    ).status,
    409,
  );
});
test('token comparison rejects missing or unequal tokens', () => {
  assert.equal(equalToken(undefined, 'x'), false);
  assert.equal(equalToken('x', ''), false);
  assert.equal(equalToken('x', 'xx'), false);
  assert.equal(equalToken('x', 'x'), true);
});
