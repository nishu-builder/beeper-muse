import test from 'node:test';
import assert from 'node:assert/strict';
import { provisioningResponse } from '../browser-runtime/runtime/provisioning.ts';
import { MatrixAPI } from '../browser-runtime/runtime/matrix.ts';
const config = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
  registrationID: 'sh-muse-chrome-012345abcdef',
  appserviceToken: 'synthetic-appservice-token',
  owner: '@test:beeper.com',
  bot: '@sh-muse-chrome-012345abcdefbot:beeper.local',
};
const request = (route: string, overrides = {}) => ({
  id: 42,
  command: 'http_proxy',
  data: {
    method: 'GET',
    path: '/_matrix/provision/v3/' + route,
    query: 'user_id=%40test%3Abeeper.com',
    headers: { Authorization: ['Bearer synthetic-client-token'] },
    ...overrides,
  },
});
test('Desktop capabilities reply uses native HTTP-over-WebSocket framing, without a network request', async () => {
  const api = new MatrixAPI(config, async () => {
    throw Error('Unexpected fetch');
  });
  const raw = await provisioningResponse(request('capabilities'), api);
  const reply = JSON.parse(raw);
  assert.equal(reply.id, 42);
  assert.equal(reply.command, 'response');
  assert.equal(reply.data.status, 200);
  assert.deepEqual(reply.data.headers, {
    'Content-Type': ['application/json'],
  });
  assert.equal(reply.data.body.resolve_identifier.create_dm, false);
  assert.equal(reply.data.body.resolve_identifier.contact_list, false);
  assert.deepEqual(reply.data.body.group_creation, {});
  assert.ok(!raw.includes(config.owner));
  assert.ok(!raw.includes('token'));
});
test('account discovery validates the client identity against the fixed homeserver', async () => {
  const api = new MatrixAPI(config, async (url, init) => {
    assert.equal(
      new URL(String(url)).pathname,
      '/_hungryserv/test/_matrix/client/v3/account/whoami',
    );
    assert.equal(new URL(String(url)).search, '');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic-client-token',
    );
    assert.equal(init?.redirect, 'error');
    return Response.json({ user_id: config.owner });
  });
  const raw = await provisioningResponse(request('whoami'), api);
  const reply = JSON.parse(raw);
  assert.equal(reply.data.status, 200);
  assert.equal(reply.data.body.logins[0].id, 'browser');
  assert.equal(reply.data.body.bridge_bot, config.bot);
  assert.ok(!raw.includes('token'));
  assert.deepEqual(
    JSON.parse(await provisioningResponse(request('logins'), api)).data.body,
    { login_ids: ['browser'] },
  );
});
test('foreign identities, malformed requests and unsupported writes fail explicitly', async () => {
  let calls = 0;
  const api = new MatrixAPI(config, async () => {
    calls++;
    return Response.json({ user_id: '@other:beeper.com' });
  });
  for (const [frame, expected] of [
    [request('whoami', { query: 'user_id=%40other%3Abeeper.com' }), 403],
    [request('whoami', { headers: {} }), 401],
    [
      request('whoami', {
        headers: { Authorization: ['Bearer a'], authorization: ['Bearer b'] },
      }),
      401,
    ],
    [request('whoami'), 403],
    [request('capabilities', { method: 'DELETE' }), 405],
    [request('https://example.com'), 404],
    [request('capabilities', { path: '%ZZ', escaped_path: true }), 400],
    [{ id: 42, command: 'http_proxy' }, 400],
  ] as const) {
    assert.equal(
      JSON.parse(await provisioningResponse(frame, api)).data.status,
      expected,
    );
  }
  assert.equal(calls, 1);
});

test('account discovery reports current source availability instead of unconditional Connected', async () => {
  const { SourceConnectionHealth } =
    await import('../browser-runtime/runtime/source-connection.ts');
  const health = new SourceConnectionHealth();
  const api = new MatrixAPI(config, async () =>
    Response.json({ user_id: config.owner }),
  );
  const state = async () =>
    JSON.parse(
      await provisioningResponse(request('whoami'), api, () =>
        health.state(config.owner),
      ),
    ).data.body.logins[0];
  assert.equal((await state()).state_event, 'TRANSIENT_DISCONNECT');
  health.observe(true);
  assert.equal((await state()).state_event, 'CONNECTED');
  health.observe(false);
  const disconnected = await state();
  assert.equal(disconnected.state_event, 'TRANSIENT_DISCONNECT');
  assert.equal(
    disconnected.state.message,
    'Muse is disconnected. Open Chrome and connect your Muse tab.',
  );
});
