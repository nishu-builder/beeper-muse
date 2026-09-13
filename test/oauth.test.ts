import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { login, validState } from '../src/oauth.ts';

test('OAuth uses PKCE, validates state, and exchanges the code without exposing a token in the URL', async (t) => {
  let challenge = '',
    redirect = '';
  let registrations = 0,
    tokens = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/oauth/register') {
      const data = JSON.parse(body);
      assert.equal(data.token_endpoint_auth_method, 'none');
      assert.deepEqual(data.grant_types, ['authorization_code']);
      redirect = data.redirect_uris[0];
      registrations++;
      response.end(JSON.stringify({ client_id: 'test-client' }));
      return;
    }
    assert.equal(request.url, '/oauth/token');
    const data = new URLSearchParams(body);
    assert.equal(data.get('code'), 'test-code');
    assert.equal(data.get('redirect_uri'), redirect);
    assert.equal(
      createHash('sha256')
        .update(data.get('code_verifier')!)
        .digest('base64url'),
      challenge,
    );
    tokens++;
    response.end(JSON.stringify({ access_token: 'fixture-token' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const token = await login(`http://127.0.0.1:${address.port}`, async (raw) => {
    const url = new URL(raw);
    challenge = url.searchParams.get('code_challenge')!;
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'read write');
    assert.equal(url.searchParams.has('access_token'), false);
    const callback = new URL(redirect);
    callback.searchParams.set('code', 'test-code');
    callback.searchParams.set('state', 'wrong');
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    assert.equal((await fetch(callback)).status, 200);
  });
  assert.equal(token, 'fixture-token');
  assert.equal(registrations, 1);
  assert.equal(tokens, 1);
});
test('OAuth state checks reject unequal and missing values', () => {
  assert.equal(validState(null, 'expected'), false);
  assert.equal(validState('wrong', 'expected'), false);
  assert.equal(validState('expected', 'expected'), true);
});
