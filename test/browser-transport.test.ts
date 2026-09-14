import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticationRule,
  endpoint,
  probe,
  type Socket,
  type Rules,
} from '../browser-runtime/transport.ts';
const registration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/example',
  appserviceToken: 'synthetic-test-token',
  registrationID: 'sh-muse-probe-012345abcdef',
};
const extensionID = 'a'.repeat(32);
function harness() {
  const changes: Parameters<Rules['updateSessionRules']>[0][] = [];
  let closed = false;
  const sent: string[] = [];
  const socket: Socket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data) {
      sent.push(data);
    },
    close() {
      closed = true;
    },
  };
  const rules: Rules = {
    async updateSessionRules(change) {
      changes.push(change);
    },
  };
  let opened!: () => void;
  const opening = new Promise<void>((r) => {
    opened = r;
  });
  return {
    socket,
    sent,
    changes,
    rules,
    opening,
    get closed() {
      return closed;
    },
    makeSocket(url: string) {
      assert.equal(url, endpoint(registration));
      opened();
      return socket;
    },
  };
}
test('authentication is limited to the exact socket URL and this extension initiator', () => {
  assert.ok(registration.registrationID.length <= 32);
  const rule = authenticationRule(registration, extensionID, 'probe-process');
  assert.equal(
    rule.condition.urlFilter,
    '|wss://matrix.beeper.com/_hungryserv/example/_matrix/client/unstable/fi.mau.as_sync|',
  );
  assert.deepEqual(rule.condition.initiatorDomains, [extensionID]);
  assert.deepEqual(rule.condition.resourceTypes, ['websocket']);
  assert.equal(
    rule.action.requestHeaders.find((h) => h.header === 'Authorization')?.value,
    'Bearer ' + registration.appserviceToken,
  );
  assert.ok(!rule.condition.urlFilter.includes(registration.appserviceToken));
  for (const homeserverURL of [
    'http://matrix.beeper.com/_hungryserv/example',
    'https://matrix.beeper.com.attacker.test/_hungryserv/example',
    'https://matrix.beeper.com/_hungryserv/example?token=secret',
    'https://user:pass@matrix.beeper.com/_hungryserv/example',
    'https://matrix.beeper.com/_hungryserv/*',
    'https://matrix.beeper.com/_hungryserv/example#fragment',
  ]) {
    assert.throws(() => endpoint({ ...registration, homeserverURL }));
  }
  assert.throws(() => endpoint({ ...registration, registrationID: 'sh-muse' }));
  assert.throws(() =>
    endpoint({ ...registration, appserviceToken: 'token\r\nInjected: value' }),
  );
});
test('protocol confirmation closes the socket and removes credential rules', async () => {
  const h = harness();
  const result = probe(
    registration,
    extensionID,
    h.rules,
    h.makeSocket,
    new AbortController().signal,
  );
  await h.opening;
  h.socket.onopen!();
  h.socket.onmessage!({ data: JSON.stringify({ command: 'connect' }) });
  assert.equal(await result, 'confirmed');
  assert.equal(h.closed, true);
  assert.deepEqual(h.changes.at(-1), { removeRuleIds: [1] });
});
test('transactions prove authentication without acknowledging or consuming them', async () => {
  const h = harness();
  const result = probe(
    registration,
    extensionID,
    h.rules,
    h.makeSocket,
    new AbortController().signal,
  );
  await h.opening;
  h.socket.onmessage!({
    data: JSON.stringify({
      command: 'transaction',
      txn_id: 'synthetic',
      events: [],
    }),
  });
  assert.equal(await result, 'confirmed');
  assert.equal(h.closed, true);
  assert.equal(
    h.sent.some((raw) => JSON.parse(raw).command === 'response'),
    false,
  );
});
test('connection conflicts stop without reconnecting and cancellation cleans up', async () => {
  for (const cancelled of [false, true]) {
    const h = harness(),
      abort = new AbortController();
    const result = probe(
      registration,
      extensionID,
      h.rules,
      h.makeSocket,
      abort.signal,
    );
    await h.opening;
    if (cancelled) abort.abort();
    else h.socket.onclose!({ code: 4001 });
    assert.equal(await result, cancelled ? 'cancelled' : 'conflict');
    assert.equal(h.closed, true);
    assert.equal(h.changes.length, 2);
  }
});
test('malformed server data and an unconfirmed upgrade never report success', async () => {
  for (const payload of ['{}', 'null', 'invalid']) {
    const h = harness();
    const result = probe(
      registration,
      extensionID,
      h.rules,
      h.makeSocket,
      new AbortController().signal,
    );
    await h.opening;
    h.socket.onmessage!({ data: payload });
    assert.equal(await result, 'failed');
  }
  const h = harness();
  const result = probe(
    registration,
    extensionID,
    h.rules,
    h.makeSocket,
    new AbortController().signal,
    5,
  );
  await h.opening;
  h.socket.onopen!();
  assert.equal(await result, 'timeout');
  assert.equal(h.closed, true);
});
test('cancellation while installing the header rule does not open a connection', async () => {
  const abort = new AbortController();
  let cleanup = false;
  const result = await probe(
    registration,
    extensionID,
    {
      async updateSessionRules(change) {
        if (change.addRules) abort.abort();
        else cleanup = true;
      },
    },
    () => {
      throw Error('Must not open');
    },
    abort.signal,
  );
  assert.equal(result, 'cancelled');
  assert.equal(cleanup, true);
});

test('an idle bridge is verified with a correlated protocol ping', async () => {
  const h = harness();
  const result = probe(
    registration,
    extensionID,
    h.rules,
    h.makeSocket,
    new AbortController().signal,
  );
  await h.opening;
  h.socket.onopen!();
  assert.equal(h.sent.length, 1);
  const ping = JSON.parse(h.sent[0]!);
  assert.equal(ping.command, 'ping');
  assert.equal(ping.id, 1);
  assert.ok(Number.isSafeInteger(ping.data.timestamp));
  h.socket.onmessage!({
    data: JSON.stringify({
      id: 1,
      command: 'response',
      data: { timestamp: Date.now() },
    }),
  });
  assert.equal(await result, 'confirmed');
  assert.equal(h.sent.length, 1);
});
