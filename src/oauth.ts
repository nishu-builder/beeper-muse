import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loopbackURL } from './config.ts';

export function validState(actual: string | null, expected: string): boolean {
  return (
    actual !== null &&
    Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

export async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Cannot open browser.')),
    );
  });
}

export async function login(
  baseURL: string,
  launch = openBrowser,
): Promise<string> {
  const origin = loopbackURL(baseURL);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  let finish: (code: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const callback = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Avoid an unhandled rejection while registration or browser opening is active.
  void callback.catch(() => {});
  let redirectURI = '';
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (
      request.method !== 'GET' ||
      url.pathname !== '/callback' ||
      !validState(url.searchParams.get('state'), state)
    ) {
      response.writeHead(400).end('Invalid authorization callback.');
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) {
      response.writeHead(400).end('Authorization was not granted.');
      fail(new Error('Beeper authorization was not granted.'));
      return;
    }
    response.end(
      'Beeper authorization received. Return to the terminal to finish setup.',
    );
    finish(code);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Cannot create local OAuth callback.');
    redirectURI = `http://127.0.0.1:${address.port}/callback`;
    timer = setTimeout(
      () =>
        fail(
          new Error('Beeper login timed out after 3 minutes. Run login again.'),
        ),
      180000,
    );
    const register = await fetch(`${origin}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        client_name: 'Beeper Muse',
        redirect_uris: [redirectURI],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    if (!register.ok)
      throw new Error(
        `Beeper client registration failed (HTTP ${register.status}).`,
      );
    const registration = (await register.json()) as { client_id?: unknown };
    if (typeof registration.client_id !== 'string')
      throw new Error('Beeper returned invalid client registration.');
    const url = new URL(`${origin}/oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: redirectURI,
      response_type: 'code',
      scope: 'read write',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    await launch(url.href);
    const code = await callback;
    const tokenResponse = await fetch(`${origin}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: registration.client_id,
        redirect_uri: redirectURI,
        code_verifier: verifier,
        code,
      }),
    });
    if (!tokenResponse.ok)
      throw new Error(
        `Beeper token exchange failed (HTTP ${tokenResponse.status}).`,
      );
    const token = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof token.access_token !== 'string' || !token.access_token)
      throw new Error('Beeper returned no access token.');
    return token.access_token;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
