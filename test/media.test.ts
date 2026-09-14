import test from 'node:test';
import assert from 'node:assert/strict';
import * as Rust from '@matrix-org/matrix-sdk-crypto-wasm';
import {
  boundedBytes,
  incomingImage,
  mediaPath,
  imageSignature,
} from '../browser-runtime/runtime/media.ts';
import { MatrixAPI } from '../browser-runtime/runtime/matrix.ts';
import { MatrixCrypto } from '../browser-runtime/runtime/crypto.ts';
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const config = {
  homeserverURL: 'https://matrix.beeper.com/user/test',
  owner: '@test:beeper.com',
  bot: '@muse:beeper.local',
  registrationID: 'test',
  appserviceToken: 'synthetic',
};
test('image descriptors reject arbitrary URLs, oversize and unsupported content', () => {
  const content = {
    msgtype: 'm.image',
    body: 'photo.png',
    url: 'mxc://example.org/abc_123',
    info: { mimetype: 'image/png', size: 8 },
  };
  assert.equal(incomingImage(content).name, 'photo.png');
  for (const url of [
    'https://attacker.test/photo',
    'mxc://user:password@host/x',
    'mxc://example.org/../../secret',
    'mxc://example.org/id?token=x',
  ])
    assert.throws(() => mediaPath(url));
  assert.throws(() =>
    incomingImage({ ...content, info: { mimetype: 'image/svg+xml' } }),
  );
  assert.throws(() =>
    incomingImage({
      ...content,
      info: { mimetype: 'image/png', size: 99999999 },
    }),
  );
  assert.throws(() =>
    incomingImage({ ...content, file: { url: content.url } }),
  );
});
test('streamed image size limits work without trusting Content-Length', async () => {
  await assert.rejects(boundedBytes(new Response(new Uint8Array(9)), 8));
  await assert.rejects(
    boundedBytes(
      new Response(new Uint8Array(8), { headers: { 'Content-Length': '9' } }),
      8,
    ),
  );
  assert.deepEqual(await boundedBytes(new Response(png), 8), png);
  assert.equal(imageSignature(png, 'image/png'), true);
  assert.equal(imageSignature(png, 'image/jpeg'), false);
});
test('Matrix media download starts at the configured homeserver and permits native media redirects', async () => {
  const api = new MatrixAPI(config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://matrix.beeper.com');
    assert.equal(
      url.pathname,
      '/user/test/_matrix/client/v1/media/download/example.org/abc',
    );
    assert.equal(init?.redirect, 'follow');
    assert.equal(init?.referrerPolicy, 'no-referrer');
    assert.equal(init?.credentials, 'omit');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer synthetic',
    );
    return new Response(png);
  });
  assert.deepEqual(await api.downloadImage('mxc://example.org/abc'), png);
  await assert.rejects(api.downloadImage('https://attacker.test/picture'));
});
test('real Matrix attachment decryption authenticates image bytes before delivering them to Muse', async () => {
  await Rust.initAsync();
  const attachment = Rust.Attachment.encrypt(png);
  const file = {
    ...JSON.parse(attachment.mediaEncryptionInfo!),
    url: 'mxc://example.org/photo',
  };
  const bytes = attachment.encryptedData;
  const fake = {
    api: { downloadImage: async () => bytes },
  } as unknown as MatrixCrypto;
  const image = incomingImage({
    body: 'photo.png',
    file,
    info: { mimetype: 'image/png' },
  });
  const result = await MatrixCrypto.prototype.downloadImage.call(fake, image);
  assert.deepEqual(Buffer.from(result.data, 'base64'), Buffer.from(png));
  bytes[0] = bytes[0]! ^ 1;
  await assert.rejects(MatrixCrypto.prototype.downloadImage.call(fake, image));
  attachment.free();
});

test('native fetch strips credentials when Matrix redirects to another origin', async () => {
  const { createServer } = await import('node:http');
  let authorization: string | undefined;
  let cookie: string | undefined;
  const storage = createServer((req, res) => {
    authorization = req.headers.authorization;
    cookie = req.headers.cookie;
    res.end(png);
  });
  const matrix = createServer((_req, res) => {
    res.writeHead(307, {
      location: `http://127.0.0.1:${(storage.address() as { port: number }).port}/photo`,
    });
    res.end();
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => matrix.listen(0, '127.0.0.1', resolve));
  try {
    const api = new MatrixAPI({
      ...config,
      homeserverURL: `http://127.0.0.1:${(matrix.address() as { port: number }).port}`,
    });
    assert.deepEqual(await api.downloadImage('mxc://example.org/photo'), png);
    assert.equal(authorization, undefined);
    assert.equal(cookie, undefined);
  } finally {
    matrix.closeAllConnections();
    storage.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => matrix.close(() => r())),
      new Promise<void>((r) => storage.close(() => r())),
    ]);
  }
});
test('extension network policy constrains redirects to HTTPS Beeper storage', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(
      new URL('../browser-runtime/runtime/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(
    manifest.host_permissions.includes('https://*.r2.cloudflarestorage.com/*'),
  );
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src 'self' https:\/\/matrix\.beeper\.com wss:\/\/matrix\.beeper\.com https:\/\/\*\.r2\.cloudflarestorage\.com$/,
  );
});
