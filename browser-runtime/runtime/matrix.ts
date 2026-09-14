import { boundedBytes, mediaPath, imageTypes } from './media.js';
import { endpoint, type Registration } from '../transport.js';
export interface Configuration extends Registration {
  owner: string;
  bot: string;
}
export function configuration(value: unknown): Configuration {
  if (!value || typeof value !== 'object')
    throw Error('Invalid Beeper registration.');
  const c = value as Configuration;
  endpoint(c);
  const local = (id: string) =>
    typeof id === 'string' && /^@[a-zA-Z0-9._=/-]+:beeper\.com$/.test(id);
  if (
    !local(c.owner) ||
    typeof c.bot !== 'string' ||
    !/^@[a-zA-Z0-9._=/-]+:beeper\.local$/.test(c.bot) ||
    c.owner === c.bot
  )
    throw Error('Invalid Beeper identities.');
  const expected = new URL(c.homeserverURL).pathname.split('/').at(-1);
  if (c.owner !== '@' + expected + ':beeper.com')
    throw Error('Registration belongs to another account.');
  return {
    homeserverURL: c.homeserverURL,
    appserviceToken: c.appserviceToken,
    registrationID: c.registrationID,
    owner: c.owner,
    bot: c.bot,
  };
}
export class MatrixError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Beeper request failed (' + status + ', ' + code + ').');
  }
}
export class MatrixAPI {
  constructor(
    readonly config: Configuration,
    // Native browser fetch checks its receiver; calling an unbound copy as
    // this.fetcher() supplies MatrixAPI instead of the worker global.
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    user = this.config.bot,
    token = this.config.appserviceToken,
    binaryMime = 'application/octet-stream',
  ): Promise<T> {
    if (
      !path.startsWith('/_matrix/') ||
      path.includes('?') ||
      path.includes('#')
    )
      throw Error('Invalid Matrix endpoint.');
    if (user !== this.config.bot && user !== this.config.owner)
      throw Error('Invalid Matrix sender.');
    const url = new URL(this.config.homeserverURL.replace(/\/$/, '') + path);
    if (token === this.config.appserviceToken)
      url.searchParams.set('user_id', user);
    const binary = body instanceof Uint8Array;
    if (
      binary &&
      binaryMime !== 'application/octet-stream' &&
      !imageTypes.has(binaryMime)
    )
      throw Error('Invalid media type.');
    const response = await this.fetcher(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body !== undefined
          ? {
              'Content-Type': binary ? binaryMime : 'application/json',
            }
          : {}),
      },
      ...(body !== undefined
        ? {
            body: binary
              ? (body as Uint8Array<ArrayBuffer>)
              : JSON.stringify(body),
          }
        : {}),
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) throw Error('Invalid Beeper response.');
    }
    if (!response.ok)
      throw new MatrixError(
        response.status,
        typeof data.errcode === 'string' && /^M_[A-Z0-9_]+$/.test(data.errcode)
          ? data.errcode
          : 'UNKNOWN',
      );
    return data as T;
  }
  async downloadImage(uri: string) {
    const url = new URL(
      this.config.homeserverURL.replace(/\/$/, '') + mediaPath(uri),
    );
    url.searchParams.set('user_id', this.config.bot);
    return boundedBytes(
      await this.fetcher(url, {
        headers: { Authorization: 'Bearer ' + this.config.appserviceToken },
        credentials: 'omit',
        // Authenticated Matrix media may redirect to signed object storage.
        // Native fetch strips Authorization on cross-origin redirects; the
        // extension CSP permits only Beeper and its HTTPS storage provider.
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(30000),
      }),
    );
  }
  async members(room: string) {
    const data = await this.request<{
      chunk: Array<{ state_key: string; content: { membership: string } }>;
    }>(
      'GET',
      '/_matrix/client/v3/rooms/' + encodeURIComponent(room) + '/members',
    );
    const joined = data.chunk
      .filter((e) => ['join', 'invite'].includes(e.content.membership))
      .map((e) => e.state_key);
    if (
      joined.some((u) => u !== this.config.owner && u !== this.config.bot) ||
      !joined.includes(this.config.bot) ||
      !joined.includes(this.config.owner)
    )
      throw Error('The Muse chat membership changed. Delivery stopped.');
    return joined;
  }
}
export async function eventID(room: string, source: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(room + '\0' + source),
    ),
  );
  return (
    '$' +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '') +
    ':muse.ai'
  );
}
