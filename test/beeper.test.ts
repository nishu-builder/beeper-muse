import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { beeperClient, BeeperAdapter } from '../src/beeper.ts';

test('Beeper SDK sends the documented payload once, even after HTTP 503', async (t) => {
  let attempts = 0;
  const server = createServer(async (request, response) => {
    attempts++;
    assert.equal(request.headers.authorization, 'Bearer fixture-token');
    assert.equal(request.url, '/v1/chats/self/messages');
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      text: 'fixture response',
      replyToMessageID: 'command',
    });
    response
      .writeHead(503, { 'Content-Type': 'application/json' })
      .end('{"error":"unavailable"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const adapter = new BeeperAdapter(
    beeperClient(`http://127.0.0.1:${address.port}`, 'fixture-token'),
  );
  await assert.rejects(adapter.send('self', 'fixture response', 'command'));
  assert.equal(attempts, 1);
});

test('redirects cannot forward the Beeper token to another listener', async (t) => {
  let received = false;
  const target = createServer((_request, response) => {
    received = true;
    response.end('{}');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetAddress = target.address();
  assert.ok(targetAddress && typeof targetAddress !== 'string');
  const source = createServer((_request, response) =>
    response
      .writeHead(307, { Location: `http://127.0.0.1:${targetAddress.port}` })
      .end(),
  );
  await new Promise<void>((resolve) => source.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    source.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => source.close(() => resolve())),
      new Promise<void>((resolve) => target.close(() => resolve())),
    ]);
  });
  const address = source.address();
  assert.ok(address && typeof address !== 'string');
  await assert.rejects(
    beeperClient(
      `http://127.0.0.1:${address.port}`,
      'fixture-token',
    ).accounts.list(),
  );
  assert.equal(received, false);
});
