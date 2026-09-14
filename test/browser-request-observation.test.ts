import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRequest,
  type RequestScope,
} from '../browser-runtime/request-observation.ts';
const scope: RequestScope = {
  url: 'wss://matrix.beeper.com/_hungryserv/example/_matrix/client/unstable/fi.mau.as_sync',
  origin: 'chrome-extension://' + 'a'.repeat(32),
  tabId: 42,
  headers: [
    { header: 'Authorization', value: 'Bearer synthetic-private-value' },
    { header: 'X-Mautrix-Process-ID', value: 'private-process-id' },
    { header: 'X-Mautrix-Websocket-Version', value: '3' },
  ],
};
const request = { url: scope.url, initiator: scope.origin, tabId: scope.tabId };
test('handshake diagnostics verify headers without displaying any values', () => {
  const lines = describeRequest(scope, {
    ...request,
    requestHeaders: scope.headers.map((h) => ({
      name: h.header.toLowerCase(),
      value: h.value,
    })),
    statusCode: 101,
  });
  assert.deepEqual(lines, [
    'Authorization: verified',
    'X-Mautrix-Process-ID: verified',
    'X-Mautrix-Websocket-Version: verified',
    'Handshake HTTP status: 101',
  ]);
  assert.doesNotMatch(lines.join('\n'), /synthetic|private-process|hungryserv/);
});
test('other tabs, sites, and endpoints cannot enter the diagnostic output', () => {
  for (const override of [
    { tabId: 43 },
    { initiator: 'https://muse.ai' },
    { url: scope.url + '?anything' },
    { initiator: undefined },
  ])
    assert.deepEqual(
      describeRequest(scope, { ...request, ...override, statusCode: 401 }),
      [],
    );
});
test('missing and duplicate headers are not mistaken for correct authentication', () => {
  for (const requestHeaders of [
    [],
    [
      { name: 'Authorization', value: scope.headers[0]!.value },
      { name: 'authorization', value: 'wrong' },
    ],
  ]) {
    const lines = describeRequest(scope, { ...request, requestHeaders });
    assert.equal(lines[0], 'Authorization: missing or changed');
  }
});
test('raw network errors and invalid status values are never reflected', () => {
  assert.deepEqual(
    describeRequest(scope, { ...request, error: 'net::ERR_BLOCKED_BY_CLIENT' }),
    ['net::ERR_BLOCKED_BY_CLIENT'],
  );
  assert.deepEqual(
    describeRequest(scope, {
      ...request,
      error: 'Bearer private-token https://private.example',
      statusCode: 999,
    }),
    ['Network request failed'],
  );
});
