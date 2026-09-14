import { imageSignature, imageTypes, mediaPath } from './media.js';
import type { MatrixAPI } from './matrix.js';
import type { StateStore } from './state.js';
interface SavedAvatar {
  hash: string;
  url: string;
  applied: boolean;
}
/** Avatars are ordinary Matrix profile/state media, not encrypted chat attachments. */
export class AvatarSync {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private api: MatrixAPI,
    private state: StateStore,
    private room: string,
  ) {}
  update(value: unknown): Promise<boolean> {
    const next = this.chain.then(() => this.apply(value));
    this.chain = next.catch(() => {});
    return next;
  }
  private async apply(value: unknown) {
    if (!value || typeof value !== 'object') throw Error('Invalid avatar.');
    const image = value as { mime?: unknown; data?: unknown };
    if (
      typeof image.mime !== 'string' ||
      !imageTypes.has(image.mime) ||
      typeof image.data !== 'string' ||
      image.data.length > 700000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
    )
      throw Error('Invalid avatar.');
    const raw = atob(image.data),
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (
      !bytes.length ||
      bytes.length > 512 * 1024 ||
      !imageSignature(bytes, image.mime)
    )
      throw Error('Invalid avatar.');
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const previous = await this.state.get<SavedAvatar>('avatar');
    if (previous?.hash === hash && previous.applied) return false;
    await this.api.members(this.room);
    let saved = previous?.hash === hash ? previous : undefined;
    if (!saved) {
      const uploaded = await this.api.request<{ content_uri: string }>(
        'POST',
        '/_matrix/media/v3/upload',
        bytes,
        this.api.config.bot,
        this.api.config.appserviceToken,
        image.mime,
      );
      mediaPath(uploaded.content_uri);
      saved = { hash, url: uploaded.content_uri, applied: false };
      // Retain the upload across a partial state-update failure, without image bytes.
      await this.state.put('avatar', saved);
    }
    mediaPath(saved.url);
    const roomPath =
      '/_matrix/client/v3/rooms/' + encodeURIComponent(this.room) + '/state/';
    const bot = encodeURIComponent(this.api.config.bot);
    await this.api.request(
      'PUT',
      '/_matrix/client/v3/profile/' + bot + '/avatar_url',
      { avatar_url: saved.url },
    );
    const member = await this.api.request<Record<string, unknown>>(
      'GET',
      roomPath + 'm.room.member/' + bot,
    );
    if (member.membership !== 'join')
      throw Error('Muse identity is not joined.');
    if (member.avatar_url !== saved.url)
      await this.api.request('PUT', roomPath + 'm.room.member/' + bot, {
        ...member,
        avatar_url: saved.url,
      });
    await this.api.request('PUT', roomPath + 'm.room.avatar/', {
      url: saved.url,
      info: { mimetype: image.mime, size: bytes.length },
    });
    for (const type of ['m.bridge', 'uk.half-shot.bridge']) {
      const path = roomPath + type + '/' + encodeURIComponent('muse://muse');
      const info = await this.api.request<Record<string, unknown>>('GET', path);
      if (info.bridgebot !== this.api.config.bot)
        throw Error('Muse bridge identity changed.');
      const channel =
        info.channel && typeof info.channel === 'object' ? info.channel : {};
      await this.api.request('PUT', path, {
        ...info,
        channel: { ...channel, avatar_url: saved.url },
      });
    }
    await this.state.put('avatar', { ...saved, applied: true });
    return true;
  }
}
