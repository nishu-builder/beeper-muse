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
async function harness(beforeEncrypt: () => Promise<void> = async () => {}) {
  const factory = new IDBFactory(),
    state = await StateStore.open('test', factory),
    inbox = await IndexedDBInbox.open(config, factory);
  const batches: Record<string, any>[] = [];
  const statuses: Record<string, any>[] = [];
  const statusAttempts: { path: string; content: Record<string, any> }[] = [];
  const redactions: string[] = [];
  let statusFailure = false;
  let fail = false;
  let outsider = false;
  let imageFailure = false;
  let redactionFailure = false;
  let downloads = 0;
  let encryptions = 0;
  const api = new MatrixAPI(config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic-test-token',
    );
    if (url.pathname.includes('/send/com.beeper.message_send_status/')) {
      assert.equal(url.searchParams.get('user_id'), config.bot);
      statusAttempts.push({
        path: url.pathname,
        content: JSON.parse(String(init?.body)),
      });
      if (statusFailure) throw Error('Synthetic status failure');
      statuses.push(JSON.parse(String(init?.body)));
      return Response.json({ event_id: '$status' });
    }
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
    if (url.pathname.includes('/receipt/')) return Response.json({});
    if (url.pathname.includes('/redact/')) {
      redactions.push(
        decodeURIComponent(url.pathname.split('/redact/')[1]!.split('/')[0]!),
      );
      if (redactionFailure) throw Error('Synthetic lost redaction response');
      return Response.json({ event_id: '$redaction' });
    }
    throw Error('Unexpected request in test');
  });
  const crypto = {
    encrypt: async (_room: string, type: string, content: unknown) => {
      await beforeEncrypt();
      encryptions++;
      return { algorithm: 'synthetic-test-only', type, content };
    },
    decrypt: async (e: unknown) => e,
    receive: async () => {},
    image: async () => ({
      url: 'mxc://example/encrypted',
      key: { k: 'synthetic' },
    }),
    downloadImage: async (image: { name: string; mime: string }) => {
      downloads++;
      if (imageFailure) throw Error('Synthetic failure');
      return { ...image, data: 'iVBORw0KGgo=' };
    },
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
    statuses,
    statusAttempts,
    redactions,
    set statusFailure(value: boolean) {
      statusFailure = value;
    },
    close: () => bridge.close(),
    set fail(value: boolean) {
      fail = value;
    },
    set outsider(value: boolean) {
      outsider = value;
    },
    set imageFailure(value: boolean) {
      imageFailure = value;
    },
    set redactionFailure(value: boolean) {
      redactionFailure = value;
    },
    get downloads() {
      return downloads;
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

test('unknown reactions preserve known state; explicit removal and re-addition produce a new native reaction', async (t) => {
  const h = await harness();
  t.after(h.close);
  const message = {
    id: 'reaction-cycle',
    role: 'assistant' as const,
    text: 'A reply',
    timestampMs: 123456,
  };
  const reaction = { actor: 'user' as const, key: 'synthetic reaction' };
  await h.bridge.importMessages([{ ...message, reactions: [reaction] }]);
  const first = h.batches[0]!.events.find((e: any) => e.type === 'm.reaction');
  assert.equal((await h.bridge.importMessages([message])).added, 0);
  assert.equal(h.redactions.length, 0);
  await h.bridge.importMessages([{ ...message, text: 'An edited reply' }]);
  assert.equal(
    h.redactions.length,
    0,
    'unreadable reaction controls cannot erase an existing reaction during an edit',
  );
  await h.bridge.importMessages([message]);
  await h.bridge.importMessages([{ ...message, reactions: [] }]);
  assert.deepEqual(h.redactions, [first.event_id]);
  await h.bridge.importMessages([{ ...message, reactions: [reaction] }]);
  const readded = h.batches.at(-1)!.events[0];
  assert.equal(readded.type, 'm.reaction');
  assert.notEqual(readded.event_id, first.event_id);
  assert.equal(
    readded.content['m.relates_to'].event_id,
    first.content['m.relates_to'].event_id,
  );
  assert.equal(readded.sender, config.owner);
  assert.ok(readded.origin_server_ts > first.origin_server_ts);
});

test('malformed reaction observations cannot become an authoritative empty set', async (t) => {
  const h = await harness();
  t.after(h.close);
  const message = {
    id: 'malformed-reaction',
    role: 'assistant' as const,
    text: 'Reply',
    reactions: [{ actor: 'assistant' as const, key: 'ack' }],
  };
  await h.bridge.importMessages([message]);
  for (const reactions of [
    null,
    {},
    ['wrong'],
    [{ actor: 'other', key: 'ack' }],
    [{ actor: 'user', key: '' }],
    Array.from({ length: 33 }, () => ({ actor: 'user', key: 'x' })),
  ]) {
    await assert.rejects(
      h.bridge.importMessages([{ ...message, reactions } as any]),
    );
  }
  assert.equal(h.redactions.length, 0);
  assert.equal(h.batches.length, 1);
});

test('an uncertain reaction removal is journaled and recovered before a source re-addition', async (t) => {
  const h = await harness();
  t.after(h.close);
  const message = {
    id: 'uncertain-removal',
    role: 'assistant' as const,
    text: 'Reply',
    reactions: [{ actor: 'assistant' as const, key: 'ack' }],
  };
  await h.bridge.importMessages([message]);
  const original = h.batches[0]!.events.find(
    (e: any) => e.type === 'm.reaction',
  ).event_id;
  h.redactionFailure = true;
  await assert.rejects(
    h.bridge.importMessages([{ ...message, reactions: [] }]),
  );
  const pending = await h.state.get<{ redactions: unknown[] }>(
    'delivery:' + message.id,
  );
  assert.equal(pending?.redactions.length, 1);
  h.redactionFailure = false;
  await h.bridge.importMessages([message]);
  assert.deepEqual(h.redactions, [original, original]);
  assert.equal(h.batches.at(-1)!.events[0].type, 'm.reaction');
  assert.notEqual(h.batches.at(-1)!.events[0].event_id, original);
  assert.equal(await h.state.get('delivery:' + message.id), null);
});

test('a source reverting after an uncertain edit recovers the pending batch then emits the reversion', async (t) => {
  const h = await harness();
  t.after(h.close);
  const message = {
    id: 'uncertain-edit',
    role: 'assistant' as const,
    text: 'Original',
  };
  await h.bridge.importMessages([message]);
  h.fail = true;
  await assert.rejects(
    h.bridge.importMessages([{ ...message, text: 'Changed' }]),
  );
  const pending = h.batches.at(-1)!.events;
  h.fail = false;
  await h.bridge.importMessages([message]);
  assert.deepEqual(h.batches[2]!.events, pending);
  assert.equal(
    h.batches[3]!.events[0].content.content['m.new_content'].body,
    'Original',
  );
  assert.notEqual(h.batches[3]!.events[0].event_id, pending[0].event_id);
  assert.equal(await h.state.get('delivery:' + message.id), null);
});

test('reverting text and image revisions uses new event IDs and times, while retries keep their exact payload', async (t) => {
  const h = await harness();
  t.after(h.close);
  const message = {
    id: 'revision-cycle',
    role: 'assistant' as const,
    text: 'Original',
    timestampMs: 123456,
  };
  const image = (data: string) => ({
    url: 'https://example.com/image.png',
    mime: 'image/png',
    data,
  });
  await h.bridge.importMessages([{ ...message, images: [image('AQID')] }]);
  await h.bridge.importMessages([
    { ...message, text: 'Changed', images: [image('BAUG')] },
  ]);
  await h.bridge.importMessages([{ ...message, images: [image('AQID')] }]);
  const firstEdit = h.batches[1]!.events;
  h.fail = true;
  await assert.rejects(
    h.bridge.importMessages([
      { ...message, text: 'Changed', images: [image('BAUG')] },
    ]),
  );
  const pending = h.batches.at(-1)!.events;
  assert.notEqual(pending[0].event_id, firstEdit[0].event_id);
  assert.notEqual(pending[1].event_id, firstEdit[1].event_id);
  assert.ok(
    pending[0].origin_server_ts > h.batches[2]!.events[0].origin_server_ts,
  );
  assert.equal(h.batches[0]!.events[0].origin_server_ts, message.timestampMs);
  h.fail = false;
  await h.bridge.importMessages([
    { ...message, text: 'Changed', images: [image('BAUG')] },
  ]);
  assert.deepEqual(h.batches.at(-1)!.events, pending);
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
    '<p><strong>Text</strong><a>bad</a><a href="https://example.org/">good</a></p>',
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

test('durable incoming receipt is not delayed by a slow outgoing upload', async () => {
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = await harness(async () => {
    entered();
    await waiting;
  });
  const sending = h.bridge.importMessages([
    { id: 'slow', role: 'assistant', text: 'Uploading' },
  ]);
  await started;
  let acknowledge!: () => void;
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const receiving = h.bridge.receive(
    JSON.stringify({
      command: 'transaction',
      id: 1,
      txn_id: 'concurrent',
      events: [],
    }),
    () => acknowledge(),
  );
  await acknowledged;
  assert.equal(h.batches.length, 0);
  release();
  await Promise.all([sending, receiving]);
  h.close();
});

test('default fetch retains the worker global receiver for native browser calls', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async function (this: unknown, _input, _init) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    calls++;
    return Response.json({ ok: true });
  };
  try {
    const api = new MatrixAPI(config);
    assert.deepEqual(
      await api.request('GET', '/_matrix/client/v3/account/whoami'),
      { ok: true },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('startup diagnostics expose categories without raw account or credential text', async () => {
  const { startupFailure } =
    await import('../browser-runtime/runtime/diagnostics.ts');
  const secret = 'private-account-and-token';
  assert.match(startupFailure(new TypeError(secret)), /TypeError/);
  assert(!startupFailure(new TypeError(secret)).includes(secret));
  const unexpected = new Error(secret);
  unexpected.name = secret;
  assert(!startupFailure(unexpected).includes(secret));
  assert.match(
    startupFailure(new Error('Browser storage unavailable.')),
    /saved data/,
  );
  assert.match(startupFailure(new MatrixError(401, 'M_UNKNOWN_TOKEN')), /401/);
});

test('Muse room metadata identifies a DM and the same login advertised in bridge status', async () => {
  const { museBridgeInfo, connectedBridgeState } =
    await import('../browser-runtime/runtime/bridge-metadata.ts');
  const info = museBridgeInfo(config);
  const state = connectedBridgeState(config.owner);
  assert.equal(info['com.beeper.room_type'], 'dm');
  assert.equal(info['com.beeper.room_type.v2'], 'dm');
  assert.equal(info.channel['fi.mau.receiver'], state.remote_id);
  assert.equal(state.user_id, config.owner);
  assert.equal(info.bridgebot, config.bot);
  assert(!JSON.stringify({ info, state }).includes(config.appserviceToken));
});

test('Desktop provisioning bypasses message persistence and encryption', async () => {
  const h = await harness();
  try {
    const sent: string[] = [];
    await h.bridge.receive(
      JSON.stringify({
        command: 'http_proxy',
        id: 61,
        data: { method: 'GET', path: '/_matrix/provision/v3/capabilities' },
      }),
      (data) => sent.push(data),
    );
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0]!).data.status, 200);
    assert.equal(h.encryptions, 0);
    assert.equal(h.batches.length, 0);
  } finally {
    h.close();
  }
});

test('update checkpoint waits for durable delivery and preserves saved state', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await harness(() => pending);
  await h.state.put('test-saved-key', 'synthetic-key');
  const delivery = h.bridge.importMessages([
    { id: 'update-in-flight', role: 'assistant', text: 'Synthetic reply' },
  ]);
  let finished = false;
  const checkpoint = h.bridge.checkpoint().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await delivery;
  await checkpoint;
  assert.equal(h.batches.length, 1);
  assert.equal(await h.state.get('test-saved-key'), 'synthetic-key');
  assert.equal((await h.bridge.status()).claimed, 0);
  h.close();
});

async function receivePhoto(
  h: Awaited<ReturnType<typeof harness>>,
  content = {},
) {
  await h.bridge.receive(
    JSON.stringify({
      command: 'transaction',
      txn_id: 'photo-tx',
      id: 77,
      events: [
        {
          type: 'm.room.message',
          event_id: '$photo',
          room_id: room,
          sender: config.owner,
          origin_server_ts: 100,
          content: {
            msgtype: 'm.image',
            body: 'Describe this',
            filename: 'photo.png',
            info: { mimetype: 'image/png', size: 8 },
            url: 'mxc://example.org/photo',
            ...content,
          },
        },
      ],
    }),
    () => {},
  );
}
test('incoming photos retain captions, claim once, and keep their original Beeper event', async () => {
  const h = await harness();
  await receivePhoto(h);
  await receivePhoto(h);
  assert.equal((await h.bridge.status()).queued, 1);
  const result = await h.bridge.claim();
  assert.equal(result.job?.prompt, 'Describe this');
  assert.equal(result.job?.image?.name, 'photo.png');
  assert.equal(h.downloads, 1);
  assert.equal((await h.bridge.claim()).job, null);
  await assert.rejects(
    h.bridge.complete({
      id: '$photo',
      messages: [{ id: 'echo', role: 'user', text: 'Describe this' }],
    }),
  );
  const echo = {
    id: 'echo',
    role: 'user' as const,
    text: 'Describe this',
    images: [
      {
        url: 'https://muse.ai/photo.png',
        data: 'iVBORw0KGgo=',
        mime: 'image/png',
      },
    ],
  };
  await h.bridge.complete({ id: '$photo', messages: [echo] });
  assert.equal(h.batches.length, 0);
  await h.bridge.importMessages([echo]);
  assert.equal(
    h.batches.length,
    0,
    'echo must not replace a native image with text or duplicate the image',
  );
  await h.bridge.importMessages([
    { ...echo, reactions: [{ actor: 'assistant', key: 'ack' }] },
  ]);
  assert.equal(
    h.batches.at(-1)?.events[0].content['m.relates_to'].event_id,
    '$photo',
  );
  const jobs =
    await h.state.get<Array<{ image?: unknown; prompt: string }>>('jobs');
  assert.equal(jobs?.[0]?.image, undefined);
  assert.equal(jobs?.[0]?.prompt, '');
  h.close();
});
test('unsupported and failed photos block visibly without falling back to an empty text prompt', async () => {
  const h = await harness();
  await receivePhoto(h, { info: { mimetype: 'image/svg+xml' } });
  assert.equal((await h.bridge.status()).blocked, 1);
  assert.equal((await h.bridge.claim()).job, null);
  assert.equal(h.downloads, 0);
  h.close();
  const other = await harness();
  other.imageFailure = true;
  await receivePhoto(other);
  assert.equal((await other.bridge.claim()).job, null);
  assert.equal((await other.bridge.status()).blocked, 1);
  assert.equal((await other.bridge.claim()).job, null);
  assert.equal(
    other.downloads,
    1,
    'uncertain jobs are never retried automatically',
  );
  other.close();
});
test('inaccessible images have visible fallbacks but a previously delivered image stays native', async () => {
  const h = await harness();
  const source = {
    id: 'fallback',
    role: 'assistant' as const,
    text: 'Picture',
    html: '<p>Picture</p>',
    images: [{ url: 'https://example.org/photo.png' }],
  };
  await h.bridge.importMessages([source]);
  assert.match(
    h.batches[0]!.events[0].content.content.body,
    /https:\/\/example.org\/photo.png/,
  );
  assert.equal(
    h.batches[0]!.events[0].content.content.formatted_body,
    undefined,
  );
  await h.bridge.importMessages([
    {
      ...source,
      images: [
        { ...source.images[0]!, mime: 'image/png', data: 'iVBORw0KGgo=' },
      ],
    },
  ]);
  await h.bridge.importMessages([source]);
  const edit = h.batches.at(-1)!.events[0].content.content;
  assert.equal(edit['m.new_content'].body, 'Picture');
  assert.equal(
    h.batches
      .flatMap((b) => b.events)
      .filter((e) => e.content?.content?.msgtype === 'm.image').length,
    1,
  );
  h.close();
});

test('native status stays pending until Muse confirms, and interrupted sends fail without claiming success', async () => {
  const h = await harness();
  await receivePhoto(h);
  assert.equal(h.statuses.at(-1)?.status, 'PENDING');
  assert.ok(Number.isSafeInteger(h.statuses.at(-1)?.ts));
  assert.ok(h.statuses.at(-1)!.ts > 0);
  assert.equal(h.statuses.at(-1)?.network, 'muse://muse');
  assert.deepEqual(h.statuses.at(-1)?.delivered_to_users, []);
  await h.bridge.claim();
  assert.equal(h.statuses.at(-1)?.status, 'PENDING');
  await h.bridge.block('$photo', 'image-input-missing');
  assert.equal(h.statuses.at(-1)?.status, 'FAIL_PERMANENT');
  assert.equal(h.statuses.at(-1)?.['m.relates_to'].event_id, '$photo');
  assert.ok(
    !(await h.bridge.status()).blockedJobs[0]?.error?.includes('PRIVATE'),
  );
  await h.bridge.resolve('$photo');
  assert.equal(h.statuses.at(-1)?.status, 'FAIL_PERMANENT');
  h.close();
});
test('Muse image confirmation requires an image echo, publishes delivered users, and survives reply capture failure', async () => {
  const h = await harness();
  await receivePhoto(h);
  await h.bridge.claim();
  await assert.rejects(
    h.bridge.confirm('$photo', {
      id: 'echo',
      role: 'user',
      text: 'Describe this',
    }),
  );
  assert.equal(h.statuses.at(-1)?.status, 'PENDING');
  await h.bridge.confirm('$photo', {
    id: 'echo',
    role: 'user',
    text: 'Describe this',
    images: [{ url: 'https://muse.ai/photo.png' }],
  });
  assert.equal(h.statuses.at(-1)?.status, 'SUCCESS');
  assert.deepEqual(h.statuses.at(-1)?.delivered_to_users, [config.bot]);
  const count = h.statuses.length;
  await h.bridge.block('$photo', 'result-delivery-failed');
  await h.bridge.tick();
  assert.equal(
    h.statuses.length,
    count,
    'confirmed delivery is not reversed by failure returning the reply',
  );
  h.close();
});
test('failed status requests retry independently without resubmitting the prompt', async () => {
  const h = await harness();
  h.statusFailure = true;
  await receivePhoto(h);
  assert.equal(h.statuses.length, 0);
  await h.bridge.claim();
  h.statusFailure = false;
  await h.bridge.tick();
  assert.equal(h.statuses.at(-1)?.status, 'PENDING');
  assert.ok(h.statusAttempts.length >= 2);
  assert.ok(
    h.statusAttempts.every(
      (attempt) =>
        attempt.path === h.statusAttempts[0]!.path &&
        attempt.content.ts === h.statusAttempts[0]!.content.ts,
    ),
  );
  assert.equal((await h.bridge.claim()).job, null);
  h.close();
});

test('legacy confirmed jobs receive timestamped status once without replaying a prompt', async () => {
  const h = await harness();
  await h.state.put('jobs', [
    {
      id: '$legacy',
      prompt: 'Already delivered',
      phase: 'done',
      confirmed: true,
      statusFingerprint: '$legacy-untimestamped-status',
    },
  ]);
  await h.bridge.tick();
  assert.equal(h.statuses.length, 1);
  assert.equal(h.statuses[0]?.status, 'SUCCESS');
  assert.ok(Number.isSafeInteger(h.statuses[0]?.ts));
  assert.deepEqual(h.statuses[0]?.delivered_to_users, [config.bot]);
  assert.equal(h.statuses[0]?.['m.relates_to'].event_id, '$legacy');
  await h.bridge.tick();
  assert.equal(h.statuses.length, 1);
  assert.equal((await h.bridge.claim()).job, null);
  assert.equal(h.batches.length, 0);
  h.close();
});

test('known pre-upload failures keep the photo failed but do not hold later text; uncertain uploads still hold', async () => {
  for (const code of [
    'image-input-missing',
    'image-composer-missing',
    'image-unavailable',
    'image-download-failed',
    'image-preview-timeout',
    'image-input-changed',
    'source-interrupted',
  ]) {
    const h = await harness();
    try {
      await receivePhoto(h);
      await h.bridge.claim();
      await h.bridge.block('$photo', code);
      await h.bridge.receive(
        JSON.stringify({
          command: 'transaction',
          txn_id: 'following-text',
          id: 78,
          events: [
            {
              type: 'm.room.message',
              event_id: '$following',
              room_id: room,
              sender: config.owner,
              origin_server_ts: 200,
              content: { msgtype: 'm.text', body: 'Following text' },
            },
          ],
        }),
        () => {},
      );
      const safe = [
        'image-input-missing',
        'image-composer-missing',
        'image-unavailable',
        'image-download-failed',
      ].includes(code);
      assert.equal((await h.bridge.status()).held, safe ? 0 : 1);
      assert.equal((await h.bridge.status()).blocked, 1);
      const claimed = await h.bridge.claim();
      assert.equal(claimed.job?.id, safe ? '$following' : undefined);
      assert.equal(
        h.statuses.find(
          (s) =>
            s['m.relates_to'].event_id === '$photo' &&
            s.status === 'FAIL_PERMANENT',
        )?.status,
        'FAIL_PERMANENT',
      );
      assert.equal(h.downloads, 1, 'failed photo was never downloaded again');
    } finally {
      h.close();
    }
  }
});

test('formatting beyond structural limits keeps a visible plain message', async () => {
  const h = await harness();
  try {
    await h.bridge.importMessages([
      {
        id: 'deep-format',
        role: 'assistant',
        text: 'Readable fallback',
        html: '<div>'.repeat(101) + 'Readable fallback' + '</div>'.repeat(101),
      },
    ]);
    const content = h.batches[0]!.events[0].content.content;
    assert.equal(content.body, 'Readable fallback');
    assert.equal(content.format, undefined);
    assert.equal(content.formatted_body, undefined);
  } finally {
    h.close();
  }
});
