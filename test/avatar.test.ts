import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { AvatarSync } from '../browser-runtime/runtime/avatar.ts';
import {
  MatrixAPI,
  type Configuration,
} from '../browser-runtime/runtime/matrix.ts';
import { StateStore } from '../browser-runtime/runtime/state.ts';
import { colorPNG } from '../scripts/dev/fixture.ts';

const config: Configuration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
  registrationID: 'sh-muse-chrome-test',
  appserviceToken: 'synthetic',
  owner: '@test:beeper.com',
  bot: '@bot:beeper.local',
};
const picture = { mime: 'image/png', data: colorPNG('RED').toString('base64') };
async function harness() {
  const state = await StateStore.open('avatar-test', new IDBFactory());
  const metadata = new Map<string, Record<string, unknown>>();
  const writes: { path: string; body: any }[] = [];
  let uploads = 0,
    outsider = false,
    failRoom = false;
  const api = new MatrixAPI(config, async (input, init) => {
    const path = decodeURIComponent(new URL(String(input)).pathname);
    if (path.endsWith('/members'))
      return Response.json({
        chunk: [
          config.owner,
          config.bot,
          ...(outsider ? ['@other:beeper.com'] : []),
        ].map((state_key) => ({ state_key, content: { membership: 'join' } })),
      });
    if (path.endsWith('/upload')) {
      uploads++;
      assert.equal(new Headers(init?.headers).get('Content-Type'), 'image/png');
      assert.deepEqual(Buffer.from(init?.body as Uint8Array), colorPNG('RED'));
      return Response.json({ content_uri: 'mxc://beeper.local/avatar' });
    }
    if (init?.method === 'GET')
      return Response.json(
        metadata.get(path) ||
          (path.includes('/m.room.member/')
            ? { membership: 'join', displayname: 'Muse', custom: true }
            : {
                bridgebot: config.bot,
                protocol: { id: 'muse' },
                channel: { id: 'muse', 'fi.mau.receiver': 'browser' },
                custom: true,
              }),
      );
    if (path.includes('/m.room.avatar/') && failRoom) {
      failRoom = false;
      throw Error('Synthetic lost response');
    }
    const body = JSON.parse(String(init?.body));
    writes.push({ path, body });
    metadata.set(path, body);
    return Response.json({});
  });
  return {
    sync: new AvatarSync(api, state, '!test:beeper.local'),
    state,
    api,
    writes,
    get uploads() {
      return uploads;
    },
    set outsider(value: boolean) {
      outsider = value;
    },
    set failRoom(value: boolean) {
      failRoom = value;
    },
  };
}
test('avatar sets native room, member and bridge metadata, preserves unrelated fields and deduplicates across restarts', async (t) => {
  const h = await harness();
  t.after(() => h.state.close());
  assert.equal(await h.sync.update(picture), true);
  assert.equal(h.uploads, 1);
  assert.equal(h.writes.length, 5);
  const member = h.writes.find((w) => w.path.includes('/m.room.member/'))!.body;
  assert.deepEqual(member, {
    membership: 'join',
    displayname: 'Muse',
    custom: true,
    avatar_url: 'mxc://beeper.local/avatar',
  });
  const bridge = h.writes.find((w) => w.path.includes('/m.bridge/'))!.body;
  assert.equal(bridge.custom, true);
  assert.equal(bridge.protocol.id, 'muse');
  assert.equal(bridge.channel['fi.mau.receiver'], 'browser');
  assert.equal(bridge.channel.avatar_url, 'mxc://beeper.local/avatar');
  assert.equal(
    await new AvatarSync(h.api, h.state, '!test:beeper.local').update(picture),
    false,
  );
  assert.equal(h.uploads, 1);
  assert.equal(h.writes.length, 5);
});
test('partial avatar failures retry metadata without another upload and serialize concurrent refreshes', async (t) => {
  const h = await harness();
  t.after(() => h.state.close());
  h.failRoom = true;
  await assert.rejects(h.sync.update(picture));
  assert.equal(
    (await h.state.get<{ applied: boolean }>('avatar'))?.applied,
    false,
  );
  assert.deepEqual(
    await Promise.all([h.sync.update(picture), h.sync.update(picture)]),
    [true, false],
  );
  assert.equal(h.uploads, 1);
});
test('avatar refuses untrusted bytes, remote URLs and changed room membership before mutation', async (t) => {
  const h = await harness();
  t.after(() => h.state.close());
  for (const value of [
    null,
    {},
    { url: 'https://private.example/photo' },
    { ...picture, mime: 'text/html' },
    { ...picture, data: btoa('<html>invalid</html>') },
    { ...picture, data: 'A'.repeat(700001) },
  ])
    await assert.rejects(h.sync.update(value));
  h.outsider = true;
  await assert.rejects(h.sync.update(picture));
  assert.equal(h.uploads, 0);
  assert.equal(h.writes.length, 0);
});
