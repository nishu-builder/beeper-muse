import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  IndexedDBInbox,
  parseTransaction,
  receiveTransaction,
  type TransactionAcknowledgement,
} from '../browser-runtime/inbox.ts';

const registration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/example',
  appserviceToken: 'synthetic-test-token',
  registrationID: 'sh-muse-probe-012345abcdef',
};
const payload = {
  events: [
    {
      type: 'm.room.encrypted',
      origin_server_ts: 1234,
      content: { ciphertext: 'synthetic' },
    },
  ],
  to_device: [
    { type: 'm.room.encrypted', content: { ciphertext: 'synthetic-key' } },
  ],
  ephemeral: [{ type: 'm.receipt', content: {} }],
  device_lists: { changed: ['@synthetic:example.org'], left: [] },
  device_one_time_keys_count: {
    '@synthetic:example.org': { DEVICE: { signed_curve25519: 50 } },
  },
  'future.extension': { preserve: true },
};
function frame(transactionID = 'txn-1', id = 1, body = payload) {
  return JSON.stringify({
    command: 'transaction',
    id,
    txn_id: transactionID,
    ...body,
  });
}

test('transaction parsing retains crypto updates, unknown fields, and timestamps', () => {
  assert.deepEqual(parseTransaction(frame()), {
    transactionID: 'txn-1',
    requestID: 1,
    payload,
  });
  assert.equal(
    parseTransaction('{"command":"response","id":1,"data":{}}'),
    null,
  );
  for (const invalid of [
    null,
    '{}',
    '[]',
    'null',
    '{',
    frame('', 1),
    frame('txn', 0),
    frame('txn', 1.5),
    'x'.repeat(1024 * 1024 + 1),
  ])
    assert.throws(() => parseTransaction(invalid), /inbox: invalid/);
});

test('pending transactions survive close/reopen and keep arrival order', async () => {
  const factory = new IDBFactory();
  let inbox = await IndexedDBInbox.open(registration, factory);
  for (const id of ['z', 'a', 'm'])
    await inbox.save(parseTransaction(frame(id))!);
  inbox.close();
  inbox = await IndexedDBInbox.open(registration, factory);
  const pending = await inbox.pending();
  assert.deepEqual(
    pending.map((p) => p.transactionID),
    ['z', 'a', 'm'],
  );
  assert.deepEqual(pending[0]!.payload, payload);
  assert.equal((await inbox.pending(1)).length, 1);
  inbox.close();
});

test('duplicate delivery uses the current request ID without adding or reordering work', async () => {
  const inbox = await IndexedDBInbox.open(registration, new IDBFactory());
  const responses: TransactionAcknowledgement[] = [];
  assert.equal(
    await receiveTransaction(inbox, frame(), (r) => responses.push(r)),
    'stored',
  );
  assert.equal(
    await receiveTransaction(inbox, frame('txn-1', 99), (r) =>
      responses.push(r),
    ),
    'duplicate',
  );
  assert.deepEqual(
    responses,
    [1, 99].map((id) => ({
      id,
      command: 'response',
      data: { txn_id: 'txn-1' },
    })),
  );
  assert.equal((await inbox.pending()).length, 1);
  inbox.close();
});

test('concurrent copies and reordered JSON keys do not create duplicate records', async () => {
  const factory = new IDBFactory();
  const first = await IndexedDBInbox.open(registration, factory);
  const second = await IndexedDBInbox.open(registration, factory);
  const reordered = Object.fromEntries(
    Object.entries(payload).reverse(),
  ) as typeof payload;
  const results = await Promise.all([
    first.save(parseTransaction(frame())!),
    second.save(parseTransaction(frame('txn-1', 2, reordered))!),
  ]);
  assert.deepEqual(results.sort(), ['duplicate', 'stored']);
  assert.equal((await first.pending()).length, 1);
  first.close();
  second.close();
});

test('completed receipts survive restart without replaying work', async () => {
  const factory = new IDBFactory();
  let inbox = await IndexedDBInbox.open(registration, factory);
  await inbox.save(parseTransaction(frame())!);
  await inbox.complete('txn-1');
  inbox.close();
  inbox = await IndexedDBInbox.open(registration, factory);
  assert.equal(await inbox.save(parseTransaction(frame())!), 'duplicate');
  assert.deepEqual(await inbox.pending(), []);
  await inbox.complete('txn-1');
  await assert.rejects(inbox.complete('missing'), /inbox: missing/);
  inbox.close();
});

test('conflicting payloads under the same transaction ID are never acknowledged', async () => {
  const inbox = await IndexedDBInbox.open(registration, new IDBFactory());
  await inbox.save(parseTransaction(frame())!);
  let acked = false;
  await assert.rejects(
    receiveTransaction(
      inbox,
      frame('txn-1', 2, { ...payload, events: [] }),
      () => {
        acked = true;
      },
    ),
    /inbox: conflict/,
  );
  assert.equal(acked, false);
  assert.deepEqual((await inbox.pending())[0]!.payload, payload);
  inbox.close();
});

test('separate registrations never share pending work or receipts', async () => {
  const factory = new IDBFactory();
  const first = await IndexedDBInbox.open(registration, factory);
  const second = await IndexedDBInbox.open(
    { ...registration, registrationID: 'sh-muse-probe-abcdef012345' },
    factory,
  );
  await first.save(parseTransaction(frame())!);
  assert.deepEqual(await second.pending(), []);
  assert.equal(await second.save(parseTransaction(frame())!), 'stored');
  await first.complete('txn-1');
  assert.equal((await second.pending()).length, 1);
  first.close();
  second.close();
});

test('an IndexedDB abort after add succeeds does not acknowledge the transaction', async (t) => {
  const inbox = await IndexedDBInbox.open(registration, new IDBFactory());
  const original = IDBObjectStore.prototype.add;
  t.mock.method(
    IDBObjectStore.prototype,
    'add',
    function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const req = original.apply(this, args);
      req.addEventListener('success', () => this.transaction.abort());
      return req;
    },
  );
  let acked = false;
  await assert.rejects(
    receiveTransaction(inbox, frame(), () => {
      acked = true;
    }),
    /inbox: storage/,
  );
  assert.equal(acked, false);
  assert.deepEqual(await inbox.pending(), []);
  inbox.close();
});

test('a lost acknowledgement leaves durable work for server redelivery', async () => {
  const inbox = await IndexedDBInbox.open(registration, new IDBFactory());
  await assert.rejects(
    receiveTransaction(inbox, frame(), () => {
      throw new Error('socket closed');
    }),
    /socket closed/,
  );
  assert.equal((await inbox.pending()).length, 1);
  assert.equal(
    await receiveTransaction(inbox, frame('txn-1', 9), () => {}),
    'duplicate',
  );
  inbox.close();
});

test('capacity exhaustion preserves queued work and withholds acknowledgement', async () => {
  const inbox = await IndexedDBInbox.open(registration, new IDBFactory());
  for (let i = 0; i < 128; i++)
    await inbox.save(parseTransaction(frame('txn-' + i))!);
  let acked = false;
  await assert.rejects(
    receiveTransaction(inbox, frame('overflow'), () => {
      acked = true;
    }),
    /inbox: full/,
  );
  assert.equal(acked, false);
  assert.equal((await inbox.pending(128)).length, 128);
  assert.equal(
    await inbox.save(parseTransaction(frame('txn-0'))!),
    'duplicate',
  );
  await inbox.complete('txn-0');
  assert.equal(
    await inbox.save(parseTransaction(frame('overflow'))!),
    'stored',
  );
  inbox.close();
});
