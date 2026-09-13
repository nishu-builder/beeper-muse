import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Relay } from './relay.ts';

export function equalToken(
  actual: string | undefined,
  expected: string,
): boolean {
  if (
    !actual ||
    !expected ||
    Buffer.byteLength(actual) !== Buffer.byteLength(expected)
  )
    return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
export function relayServer(relay: Relay, token: string, port: number) {
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const reply = (status: number, value: unknown) => {
      response.writeHead(status).end(JSON.stringify(value));
    };
    const address = server.address();
    const expectedPort =
      port || (address && typeof address !== 'string' ? address.port : 0);
    if (
      request.headers.host !== `127.0.0.1:${expectedPort}` ||
      (request.headers.origin &&
        !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin)) ||
      !equalToken(request.headers.authorization, `Bearer ${token}`)
    ) {
      reply(403, { error: 'Forbidden' });
      return;
    }
    try {
      if (request.method === 'GET' && request.url === '/v1/status') {
        reply(200, relay.status());
        return;
      }
      if (
        request.method !== 'POST' ||
        request.headers['content-type'] !== 'application/json'
      ) {
        reply(404, { error: 'Not found' });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 65536) {
          response.setHeader('Connection', 'close');
          reply(413, { error: 'Too large' });
          return;
        }
        chunks.push(buffer);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        reply(400, { error: 'Invalid request' });
        return;
      }
      const d = data as Record<string, unknown>;
      if (request.url === '/v1/claim') {
        reply(200, { job: await relay.claim() });
        return;
      }
      if (typeof d.id !== 'string') {
        reply(400, { error: 'Invalid job' });
        return;
      }
      if (request.url === '/v1/result' && typeof d.text === 'string') {
        await relay.result(d.id, d.text);
        reply(200, { ok: true });
        return;
      }
      if (request.url === '/v1/block') {
        await relay.block(d.id);
        reply(200, { ok: true });
        return;
      }
      reply(404, { error: 'Not found' });
    } catch {
      reply(409, {
        error: 'Request could not be completed. Check the local connector.',
      });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.timeout = 30000;
  return server;
}
