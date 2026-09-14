import test from 'node:test';
import assert from 'node:assert/strict';
import { Desktop, type Target, type Message } from '../scripts/dev/desktop.ts';
import {
  newRun,
  sendOnce,
  assess,
  ready,
  diagnostics,
  readRun,
} from '../scripts/dev/runner.ts';
import {
  cleanHealth,
  logFile,
} from '../browser-runtime/runtime/diagnostic-log.ts';
import { colorPNG } from '../scripts/dev/fixture.ts';
import { inflateSync } from 'node:zlib';
const target: Target = {
  chatID: '!test:example',
  ownerID: '@owner:example',
  botID: '@bot:example',
};
const pinnedChat = () => ({
  id: target.chatID,
  isReadOnly: false,
  participants: {
    items: [{ id: target.botID }, { id: target.ownerID, isSelf: true }],
  },
});
function health() {
  return {
    at: Date.now(),
    version: '0.8.2',
    build: 'a'.repeat(64),
    beeperConnected: true,
    museConnected: true,
    ready: true,
    queued: 0,
    claimed: 0,
    blocked: 0,
    pending: 0,
  };
}
const exported = (h = health()) => ({
  format: 1,
  application: 'Beeper Muse',
  events: [],
  health: h,
});
test('live preflight refuses stale logs, wrong build, drafts and outstanding work', () => {
  assert.ok(ready(exported(), '0.8.2', 'a'.repeat(64)));
  for (const h of [
    { ...health(), at: Date.now() - 60000 },
    { ...health(), at: Date.now() + 60000 },
    { ...health(), build: 'b'.repeat(64) },
    { ...health(), ready: false },
    { ...health(), queued: 1 },
    { ...health(), claimed: 1 },
    { ...health(), blocked: 1 },
    { ...health(), pending: 1 },
    { ...health(), museConnected: false },
  ])
    assert.throws(() => ready(exported(h), '0.8.2', 'a'.repeat(64)));
  assert.equal(
    diagnostics({ format: 1, application: 'Beeper Muse', events: [] }).fresh,
    false,
  );
});
test('heartbeat exports only known fields; invalid counts or build strings are rejected', () => {
  const h = {
    ...health(),
    prompt: 'PRIVATE',
    token: 'PRIVATE',
    room: 'PRIVATE',
  };
  assert.ok(!logFile([], h).includes('PRIVATE'));
  assert.equal(cleanHealth({ ...h, build: 'PRIVATE' }), undefined);
  assert.equal(cleanHealth({ ...h, queued: -1 }), undefined);
  assert.equal(cleanHealth({ ...h, claimed: Infinity }), undefined);
});
test('Desktop verifies exact pinned participants and rejects cross-chat search results', async () => {
  const client = new Desktop('synthetic', async (input) => {
    if (String(input).includes('/messages/search'))
      return Response.json({ items: [{ id: 'x', chatID: 'wrong' }] });
    return Response.json({
      items: [
        {
          id: target.chatID,
          isReadOnly: false,
          participants: {
            items: [{ id: target.botID }, { id: target.ownerID, isSelf: true }],
          },
        },
      ],
    });
  });
  await client.verify(target);
  await assert.rejects(client.messages(target, Date.now()), /different chat/);
  await assert.rejects(
    client.verify({ ...target, botID: 'outsider' }),
    /expected owner/,
  );
});
test('Desktop credentials stay on loopback; response bodies and tokens are never in errors', async () => {
  let calls = 0;
  const client = new Desktop('PRIVATE', async (input, init) => {
    calls++;
    assert.equal(new URL(String(input)).origin, 'http://localhost:23373');
    assert.equal(init?.redirect, 'error');
    return new Response('PRIVATE message contents', { status: 500 });
  });
  await assert.rejects(
    client.send(target, 'test'),
    (e) => e instanceof Error && !e.message.includes('PRIVATE'),
  );
  assert.equal(calls, 1);
});
test('send journal precedes all mutations and an ambiguous response cannot be retried', async () => {
  const run = newRun(target, 'image');
  const sequence: string[] = [];
  const client = new Desktop('synthetic', async (input, init) => {
    if (init?.method === 'GET') return Response.json(pinnedChat());
    sequence.push(String(input).includes('upload') ? 'upload' : 'send');
    if (String(input).includes('upload'))
      return Response.json({ uploadID: 'fixture' });
    throw Error('Lost response');
  });
  const save = async () => {
    sequence.push(run.phase);
  };
  await assert.rejects(sendOnce(client, run, save), /No automatic resend/);
  assert.deepEqual(sequence, ['sending', 'upload', 'send']);
  await assert.rejects(sendOnce(client, run, save), /Observe/);
  assert.deepEqual(sequence, ['sending', 'upload', 'send']);
  assert.equal(
    readRun(JSON.parse(JSON.stringify(run)), target).phase,
    'sending',
  );
  assert.throws(() => readRun(run, { ...target, chatID: 'other' }));
});
test('failed journal persistence prevents network mutations', async () => {
  let calls = 0;
  const client = new Desktop('synthetic', async (_input, init) => {
    if (init?.method === 'GET') return Response.json(pinnedChat());
    calls++;
    return Response.json({});
  });
  await assert.rejects(
    sendOnce(client, newRun(target, 'text'), async () => {
      throw Error('disk full');
    }),
  );
  assert.equal(calls, 0);
});
test('working chat listing cannot authorize a send when per-chat lookup fails', async () => {
  const paths: string[] = [];
  const client = new Desktop('synthetic', async (input, init) => {
    assert.equal(init?.method, 'GET');
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === '/v1/chats') return Response.json({ items: [pinnedChat()] });
    if (path === '/v1/messages/search')
      return Response.json({ items: [], hasMore: false });
    return new Response('PRIVATE internal error', { status: 500 });
  });
  await client.verify(target);
  assert.deepEqual(await client.messages(target, Date.now()), []);
  const run = newRun(target, 'image');
  let saves = 0;
  await assert.rejects(
    sendOnce(client, run, async () => {
      saves++;
    }),
    /No test was sent/,
  );
  assert.equal(run.phase, 'prepared');
  assert.equal(saves, 0);
  assert.deepEqual(paths, [
    '/v1/chats',
    '/v1/messages/search',
    '/v1/chats/' + encodeURIComponent(target.chatID),
  ]);
});
test('send preflight rejects changed identity, read-only and malformed chat details', async () => {
  for (const chat of [
    { ...pinnedChat(), id: 'another-chat' },
    { ...pinnedChat(), isReadOnly: true },
    { ...pinnedChat(), participants: { items: [{ id: target.botID }] } },
    {
      ...pinnedChat(),
      participants: {
        items: [{ id: target.botID }, { id: target.ownerID, isSelf: false }],
      },
    },
    {},
  ]) {
    const client = new Desktop('synthetic', async (_input, init) => {
      assert.equal(init?.method, 'GET');
      return Response.json(chat);
    });
    await assert.rejects(client.verifySendPath(target), /No test was sent/);
  }
  const client = new Desktop('synthetic', async () =>
    Response.json(pinnedChat()),
  );
  await client.verifySendPath(target);
});
test('reply, native delivery and image evidence are independent; old/foreign/duplicate messages cannot pass', () => {
  const run = newRun(target, 'image');
  const own: Message = {
    id: 'own',
    chatID: target.chatID,
    senderID: target.ownerID,
    isSender: true,
    timestamp: new Date(run.startedAt).toISOString(),
    text: run.prompt,
  };
  const reply: Message = {
    ...own,
    id: 'reply',
    senderID: target.botID,
    isSender: false,
    text: run.expected,
  };
  assert.equal(assess(run, [own, reply]).roundTrip, true);
  assert.equal(assess(run, [own, reply]).outcome, 'waiting');
  const delivered: Message = {
    ...own,
    sendStatus: { status: 'SUCCESS', deliveredToUsers: [target.botID] },
  };
  assert.equal(assess(run, [delivered, reply]).outcome, 'passed');
  assert.equal(
    assess(run, [delivered, { ...reply, chatID: 'other' }]).roundTrip,
    false,
  );
  assert.equal(
    assess(run, [delivered, { ...reply, senderID: 'other' }]).roundTrip,
    false,
  );
  assert.equal(
    assess(run, [
      delivered,
      { ...reply, timestamp: new Date(run.startedAt - 10000).toISOString() },
    ]).roundTrip,
    false,
  );
  assert.equal(
    assess(run, [delivered, reply, { ...own, id: 'duplicate' }]).outcome,
    'failed',
  );
  assert.equal(
    assess(run, [own, { ...reply, text: run.marker + ':MISSING' }]).outcome,
    'failed',
  );
  assert.equal(
    assess(run, [{ ...own, sendStatus: { status: 'FAIL_PERMANENT' } }, reply])
      .outcome,
    'failed',
  );
});
test('a generated image must belong to the marked reply, not another message', () => {
  const run = newRun(target, 'receive-image');
  const reply: Message = {
    id: 'reply',
    chatID: target.chatID,
    senderID: target.botID,
    timestamp: new Date(run.startedAt).toISOString(),
    text: run.marker,
  };
  assert.equal(
    assess(run, [
      reply,
      {
        ...reply,
        id: 'other',
        text: 'unrelated',
        attachments: [{ type: 'img' }],
      },
    ]).roundTrip,
    false,
  );
  assert.equal(
    assess(run, [{ ...reply, attachments: [{ type: 'img' }] }]).roundTrip,
    true,
  );
});
test('synthetic PNG color matches the private expectation and is absent from the photo prompt', () => {
  for (const color of ['RED', 'BLUE'] as const) {
    const png = colorPNG(color);
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    let offset = 8;
    let data = Buffer.alloc(0);
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        data = inflateSync(png.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.equal(data.length, 64 * 193);
    assert.deepEqual(
      [...data.subarray(1, 4)],
      color === 'RED' ? [255, 0, 0] : [0, 0, 255],
    );
  }
  const run = newRun(target, 'image');
  assert.ok(!run.prompt.includes(run.color));
});

test('writer heartbeat alone, inconsistent collection and in-progress updates cannot authorize a live send', () => {
  const collection = {
    at: Date.now(),
    version: '0.8.2',
    build: 'a'.repeat(64),
    events: 'available',
    health: 'available',
  };
  const file = { ...exported(), collection };
  assert.ok(ready(file, '0.8.2', 'a'.repeat(64)));
  for (const c of [
    { ...collection, health: 'unavailable' },
    { ...collection, at: Date.now() - 60000 },
    { ...collection, build: 'b'.repeat(64) },
    {
      ...collection,
      update: { stage: 'waiting-source', pending: true, elapsedMs: 1000 },
    },
  ]) {
    assert.throws(() =>
      ready({ ...file, collection: c }, '0.8.2', 'a'.repeat(64)),
    );
  }
  assert.throws(
    () => ready({ ...file, health: undefined }, '0.8.2', 'a'.repeat(64)),
    /runtime health/,
  );
  for (const update of [
    { stage: 'applying', pending: true, elapsedMs: 0 },
    { stage: 'failed', pending: true, elapsedMs: 0 },
  ]) {
    assert.throws(
      () =>
        ready(
          { ...file, health: { ...health(), update } },
          '0.8.2',
          'a'.repeat(64),
        ),
      /update/,
    );
  }
});
