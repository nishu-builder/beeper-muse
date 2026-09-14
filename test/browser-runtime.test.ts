import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import * as Rust from '@matrix-org/matrix-sdk-crypto-wasm';
import {
  BrowserBridge,
  validateSourceHTML,
} from '../browser-runtime/runtime/bridge.ts';
import {
  MatrixAPI,
  MatrixError,
  configuration,
  type Configuration,
} from '../browser-runtime/runtime/matrix.ts';
import { StateStore } from '../browser-runtime/runtime/state.ts';
import { IndexedDBInbox } from '../browser-runtime/inbox.ts';
const config: Configuration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
  registrationID: 'sh-muse-chrome-012345abcdef',
  appserviceToken: 'synthetic-test-token',
  owner: '@test:beeper.com',
  bot: '@sh-muse-chrome-012345abcdefbot:beeper.local',
};
const room = '!test:beeper.local';
async function harness() {
  const factory = new IDBFactory(),
    state = await StateStore.open('test', factory),
    inbox = await IndexedDBInbox.open(config, factory);
  const batches: Record<string, any>[] = [];
  let fail = false;
  let outsider = false;
  let encryptions = 0;
  const api = new MatrixAPI(config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic-test-token',
    );
    if (url.pathname.endsWith('/members'))
      return Response.json({
        chunk: [
          config.bot,
          config.owner,
          ...(outsider ? ['@stranger:beeper.com'] : []),
        ].map((state_key) => ({ state_key, content: { membership: 'join' } })),
      });
    if (url.pathname.endsWith('/batch_send')) {
      const batch = JSON.parse(String(init?.body));
      batches.push(batch);
      if (fail) throw Error('Simulated lost network response');
      return Response.json({
        event_ids: batch.events.map((e: { event_id: string }) => e.event_id),
      });
    }
    if (url.pathname.includes('/redact/'))
      return Response.json({ event_id: '$redaction' });
    throw Error('Unexpected request in test');
  });
  const crypto = {
    encrypt: async (_room: string, type: string, content: unknown) => {
      encryptions++;
      return { algorithm: 'synthetic-test-only', type, content };
    },
    decrypt: async (e: unknown) => e,
    receive: async () => {},
    image: async () => ({
      url: 'mxc://example/encrypted',
      key: { k: 'synthetic' },
    }),
    close() {},
  };
  const bridge = Reflect.construct(BrowserBridge, [
    api,
    state,
    inbox,
    crypto,
    room,
  ]) as BrowserBridge;
  return {
    bridge,
    state,
    batches,
    close: () => bridge.close(),
    set fail(value: boolean) {
      fail = value;
    },
    set outsider(value: boolean) {
      outsider = value;
    },
    get encryptions() {
      return encryptions;
    },
  };
}

test('configuration rejects foreign accounts and Matrix client never redirects credentials', async () => {
  assert.deepEqual(configuration(config), config);
  assert.throws(() => configuration({ ...config, owner: '@other:beeper.com' }));
  assert.throws(() =>
    configuration({ ...config, homeserverURL: 'https://attacker.test' }),
  );
  const api = new MatrixAPI(config, async (input, init) => {
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal(
      new URL(String(input)).searchParams.get('user_id'),
      config.owner,
    );
    assert.ok(!String(input).includes(config.appserviceToken));
    return Response.json(
      { errcode: 'M_FORBIDDEN', error: 'private server detail' },
      { status: 403 },
    );
  });
  await assert.rejects(
    api.request(
      'GET',
      '/_matrix/client/v3/account/whoami',
      undefined,
      config.owner,
    ),
    (e: unknown) =>
      e instanceof MatrixError &&
      e.code === 'M_FORBIDDEN' &&
      !e.message.includes('private'),
  );
});

test('history preserves native owner identity and source time without notifications', async () => {
  const h = await harness();
  const message = {
    id: 'source-1',
    role: 'user' as const,
    text: 'A message',
    timestampMs: 123456,
    historical: true,
    read: true,
  };
  await h.bridge.importMessages([message]);
  const batch = h.batches[0]!;
  assert.equal(batch.send_notification, false);
  assert.equal(batch.mark_read_by, config.owner);
  assert.equal(batch.events[0].sender, config.owner);
  assert.equal(batch.events[0].origin_server_ts, 123456);
  assert.equal(batch.events[0].content.content.body, 'A message');
  assert.equal((await h.bridge.importMessages([message])).added, 0);
  assert.equal(h.batches.length, 1);
  h.close();
});

test('reaction-only changes use annotations without manufacturing a text edit', async () => {
  const h = await harness();
  const message = {
    id: 'source-2',
    role: 'assistant' as const,
    text: 'A reply',
    historical: true,
  };
  await h.bridge.importMessages([message]);
  await h.bridge.importMessages([
    { ...message, reactions: [{ actor: 'user', key: 'test-reaction' }] },
  ]);
  const events = h.batches[1]!.events;
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'm.reaction');
  assert.equal(events[0].sender, config.owner);
  assert.equal(
    events[0].content['m.relates_to'].event_id,
    h.batches[0]!.events[0].event_id,
  );
  h.close();
});

test('edits reference the original event; partial observations cannot overwrite it', async () => {
  const h = await harness();
  await h.bridge.importMessages([
    { id: 'edit', role: 'assistant', text: 'Original' },
  ]);
  await h.bridge.importMessages([
    { id: 'edit', role: 'assistant', text: 'Revised' },
  ]);
  const content = h.batches[1]!.events[0].content.content;
  assert.equal(content['m.relates_to'].rel_type, 'm.replace');
  assert.equal(content['m.new_content'].body, 'Revised');
  assert.equal(
    (
      await h.bridge.importMessages([
        { id: 'edit', role: 'assistant', text: 'truncated', partial: true },
      ])
    ).added,
    0,
  );
  await assert.rejects(
    h.bridge.importMessages([{ id: 'edit', role: 'user', text: 'Revised' }]),
    /identity changed/,
  );
  h.close();
});

test('a lost batch response replays the exact persisted ciphertext and event IDs', async () => {
  const h = await harness();
  h.fail = true;
  await assert.rejects(
    h.bridge.importMessages([
      { id: 'uncertain', role: 'assistant', text: 'Persist me' },
    ]),
  );
  assert.equal(h.encryptions, 1);
  assert.ok(await h.state.get('delivery:uncertain'));
  h.fail = false;
  await h.bridge.tick();
  assert.deepEqual(h.batches[0], h.batches[1]);
  assert.equal(h.encryptions, 1);
  assert.equal(await h.state.get('delivery:uncertain'), null);
  assert.equal(
    (
      await h.bridge.importMessages([
        { id: 'uncertain', role: 'assistant', text: 'Persist me' },
      ])
    ).added,
    0,
  );
  h.close();
});

test('unexpected room members stop delivery before sending private content', async () => {
  const h = await harness();
  h.outsider = true;
  await assert.rejects(
    h.bridge.importMessages([
      { id: 'private', role: 'assistant', text: 'Private' },
    ]),
    /membership changed/,
  );
  assert.equal(h.batches.length, 0);
  h.close();
});

test('incoming events queue only the owner in the configured room and claims never repeat', async () => {
  const h = await harness();
  const event = {
    type: 'm.room.message',
    event_id: '$owner',
    room_id: room,
    sender: config.owner,
    origin_server_ts: 100,
    content: { msgtype: 'm.text', body: 'Prompt' },
  };
  await h.bridge.receive(
    JSON.stringify({
      command: 'transaction',
      txn_id: 'tx',
      id: 5,
      events: [
        { ...event, event_id: '$wrong-room', room_id: '!other:beeper.local' },
        { ...event, event_id: '$wrong-user', sender: config.bot },
        event,
        {
          ...event,
          event_id: '$echo',
          content: {
            ...event.content,
            'fi.mau.double_puppet_source': 'beeper-muse-chrome',
          },
        },
      ],
    }),
    () => {},
  );
  assert.equal((await h.bridge.status()).queued, 1);
  assert.deepEqual(await h.bridge.claim(), {
    job: { id: '$owner', prompt: 'Prompt' },
  });
  assert.deepEqual(await h.bridge.claim(), { job: null });
  await h.bridge.block('$owner');
  assert.equal((await h.bridge.status()).blocked, 1);
  await h.bridge.resolve('$owner');
  assert.equal((await h.bridge.status()).blocked, 0);
  h.close();
});

test('HTML allows formatting and HTTP links without active attributes', () => {
  const html = validateSourceHTML(
    '<p onclick="secret()"><strong>Text</strong><a href="javascript:alert(1)">bad</a><a href="https://example.org">good</a><img src="x" onerror="secret()"></p>',
  );
  assert.equal(
    html,
    '<p><strong>Text</strong><a>bad</a><a href="https://example.org">good</a></p>',
  );
});

test('bundled Matrix WASM encrypts and decrypts messages and attachments', async () => {
  await Rust.initAsync();
  const machine = await Rust.OlmMachine.initialize(
    new Rust.UserId('@test:example.org'),
    new Rust.DeviceId('TEST'),
  );
  try {
    const settings = new Rust.EncryptionSettings();
    settings.algorithm = Rust.EncryptionAlgorithm.MegolmV1AesSha2;
    await machine.shareRoomKey(
      new Rust.RoomId('!test:example.org'),
      [],
      settings,
    );
    const encrypted = await machine.encryptRoomEvent(
      new Rust.RoomId('!test:example.org'),
      'm.room.message',
      JSON.stringify({ msgtype: 'm.text', body: 'Round trip' }),
    );
    assert.ok(!encrypted.includes('Round trip'));
    const decrypted = await machine.decryptRoomEvent(
      JSON.stringify({
        type: 'm.room.encrypted',
        event_id: '$test',
        sender: '@test:example.org',
        origin_server_ts: 1,
        content: JSON.parse(encrypted),
      }),
      new Rust.RoomId('!test:example.org'),
      new Rust.DecryptionSettings(Rust.TrustRequirement.Untrusted),
    );
    assert.equal(JSON.parse(decrypted.event).content.body, 'Round trip');
    const bytes = new TextEncoder().encode('Image fixture'),
      attachment = Rust.Attachment.encrypt(bytes);
    assert.notDeepEqual(attachment.encryptedData, bytes);
    assert.deepEqual(Rust.Attachment.decrypt(attachment), bytes);
  } finally {
    machine.close();
  }
});

test('images which become accessible later are encrypted and imported once', async () => {
  const h = await harness();
  const source = {
    id: 'image-source',
    role: 'assistant' as const,
    text: 'Picture',
    images: [{ url: 'https://example.org/a.png' }],
  };
  await h.bridge.importMessages([source]);
  const richer = {
    ...source,
    images: [
      {
        url: 'https://example.org/a.png',
        mime: 'image/png',
        data: btoa('synthetic image'),
      },
    ],
  };
  await h.bridge.importMessages([richer]);
  const images = h.batches[1]!.events.filter(
    (e: Record<string, any>) => e.content.content.msgtype === 'm.image',
  );
  assert.equal(images.length, 1);
  assert.ok(images[0].content.content.file.key);
  assert.equal((await h.bridge.importMessages([richer])).added, 0);
  h.close();
});
