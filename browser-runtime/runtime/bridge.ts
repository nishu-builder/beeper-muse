/// <reference path="../../src/muse.d.ts" />
import { AvatarSync } from './avatar.js';
import { explanations, failureCode } from './diagnostic-log.js';
import { incomingImage, type IncomingImage } from './media.js';
import { IndexedDBInbox, receiveTransaction } from '../inbox.js';
import {
  MatrixAPI,
  MatrixError,
  eventID,
  type Configuration,
} from './matrix.js';
import { MatrixCrypto, type Event } from './crypto.js';
import { StateStore } from './state.js';
import { museBridgeInfo } from './bridge-metadata.js';
import { provisioningResponse } from './provisioning.js';
export interface Job {
  id: string;
  prompt: string;
  phase: 'queued' | 'claimed' | 'done' | 'blocked';
  // Only set for failures known to happen before touching Muse's composer.
  safeToContinue?: boolean;
  image?: IncomingImage;
  error?: string;
  failureCode?: string;
  confirmed?: boolean;
  skipped?: boolean;
  statusFingerprint?: string;
}
interface SourceRecord {
  eventID: string;
  fingerprint: string;
  contentFingerprint?: string;
  originalImage?: boolean;
  role: Muse.Role;
  timestamp: number;
  reactions: Record<string, string>;
  partial: boolean;
  images?: Record<string, { eventID: string; fingerprint: string }>;
  read?: boolean;
}
interface Delivery {
  events: Event[];
  historical: boolean;
  read: boolean;
  record: SourceRecord;
}
const SOURCE = 'beeper-muse-chrome';
const enc = encodeURIComponent;
export class BrowserBridge {
  private chain: Promise<unknown> = Promise.resolve();
  private intake: Promise<unknown> = Promise.resolve();
  private paused = false;
  private avatarSync?: AvatarSync;
  profile(avatar: unknown) {
    this.avatarSync ??= new AvatarSync(this.api, this.state, this.room);
    return this.avatarSync.update(avatar);
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  private constructor(
    readonly api: MatrixAPI,
    private state: StateStore,
    private inbox: IndexedDBInbox,
    private crypto: MatrixCrypto,
    readonly room: string,
  ) {}
  private serial<T>(fn: () => Promise<T>) {
    const result = this.chain.then(fn);
    this.chain = result.catch(() => {});
    return result;
  }
  static async open(
    config: Configuration,
    wasmURL?: string,
    factory: IDBFactory = indexedDB,
    memoryOnly = false,
    report: (stage: string) => void = () => {},
  ) {
    report('Opening saved state');
    const api = new MatrixAPI(config);
    const state = await StateStore.open(
      config.homeserverURL + '/' + config.registrationID,
      factory,
    );
    let crypto: MatrixCrypto | undefined;
    let inbox: IndexedDBInbox | undefined;
    try {
      report('Registering the Beeper identity');
      try {
        await api.request('POST', '/_matrix/client/v3/register', {
          type: 'm.login.application_service',
          username: config.bot.slice(1).split(':')[0],
          inhibit_login: true,
        });
      } catch (error) {
        if (!(error instanceof MatrixError) || error.code !== 'M_USER_IN_USE')
          throw error;
      }
      await api.request(
        'PUT',
        '/_matrix/client/v3/profile/' + enc(config.bot) + '/displayname',
        { displayname: 'Muse' },
      );
      report('Opening encryption keys');
      crypto = await MatrixCrypto.open(api, state, wasmURL, memoryOnly, report);
      report('Preparing the Muse chat');
      let room = await state.get<string>('room');
      if (!room) {
        const alias = config.registrationID + '-muse';
        try {
          room = (
            await api.request<{ room_id: string }>(
              'GET',
              '/_matrix/client/v3/directory/room/' +
                enc('#' + alias + ':beeper.local'),
            )
          ).room_id;
        } catch (error) {
          if (!(error instanceof MatrixError) || error.code !== 'M_NOT_FOUND')
            throw error;
          const bridge = museBridgeInfo(config);
          room = (
            await api.request<{ room_id: string }>(
              'POST',
              '/_matrix/client/v3/createRoom',
              {
                room_alias_name: alias,
                name: 'Muse',
                topic: 'Your Muse conversation, connected through Chrome.',
                is_direct: true,
                visibility: 'private',
                preset: 'private_chat',
                invite: [config.owner],
                power_level_content_override: {
                  users: { [config.bot]: 100, [config.owner]: 0 },
                  invite: 100,
                  kick: 100,
                  ban: 100,
                  state_default: 100,
                },
                initial_state: [
                  {
                    type: 'm.room.encryption',
                    state_key: '',
                    content: { algorithm: 'm.megolm.v1.aes-sha2' },
                  },
                  {
                    type: 'm.bridge',
                    state_key: 'muse://muse',
                    content: bridge,
                  },
                  {
                    type: 'uk.half-shot.bridge',
                    state_key: 'muse://muse',
                    content: bridge,
                  },
                ],
              },
            )
          ).room_id;
        }
        if (!room || !room.startsWith('!'))
          throw Error('Muse room creation failed.');
        await state.put('room', room);
      }
      await api.request(
        'POST',
        '/_matrix/client/v3/rooms/' + enc(room) + '/join',
        {},
        config.owner,
      );
      const encryption = await api.request<{ algorithm: string }>(
        'GET',
        '/_matrix/client/v3/rooms/' + enc(room) + '/state/m.room.encryption/',
      );
      if (encryption.algorithm !== 'm.megolm.v1.aes-sha2')
        throw Error('Muse chat encryption is not enabled.');
      await api.members(room);
      // Migrate only this bridge's known state keys; preserve unrelated metadata.
      const metadata = museBridgeInfo(config);
      for (const type of ['m.bridge', 'uk.half-shot.bridge']) {
        const path =
          '/_matrix/client/v3/rooms/' +
          enc(room) +
          '/state/' +
          type +
          '/' +
          enc('muse://muse');
        const existing = await api.request<Record<string, unknown>>(
          'GET',
          path,
        );
        if (existing.bridgebot !== config.bot)
          throw Error('Muse room bridge identity changed.');
        const channel = existing.channel as Record<string, unknown> | undefined;
        if (
          existing['com.beeper.room_type.v2'] !== 'dm' ||
          existing['com.beeper.room_type'] !== 'dm' ||
          channel?.['fi.mau.receiver'] !== metadata.channel['fi.mau.receiver']
        ) {
          await api.request('PUT', path, {
            ...existing,
            'com.beeper.room_type': 'dm',
            'com.beeper.room_type.v2': 'dm',
            channel: {
              ...channel,
              'fi.mau.receiver': metadata.channel['fi.mau.receiver'],
            },
          });
        }
      }
      inbox = await IndexedDBInbox.open(config, factory);
      const bridge = new BrowserBridge(api, state, inbox, crypto, room);
      // Claims are uncertain after a worker restart; never submit them twice.
      const jobs = (await state.get<Job[]>('jobs')) || [];
      await state.put(
        'jobs',
        jobs.map((j) =>
          j.phase === 'claimed'
            ? { ...j, phase: 'blocked', failureCode: 'source-interrupted' }
            : j,
        ),
      );
      report('Recovering saved messages');
      await bridge.drain();
      await bridge.recoverDeliveries();
      return bridge;
    } catch (error) {
      inbox?.close();
      crypto?.close();
      state.close();
      throw error;
    }
  }
  async receive(frame: unknown, send: (data: string) => void) {
    const parsed = typeof frame === 'string' ? JSON.parse(frame) : frame;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.command === 'http_proxy'
    ) {
      send(await provisioningResponse(parsed, this.api));
      return;
    }
    // Persist/acknowledge in arrival order without waiting for image uploads or
    // outgoing encryption. Crypto processing still has exactly one owner.
    const received = this.intake.then(() =>
      receiveTransaction(this.inbox, frame, (response) =>
        send(JSON.stringify(response)),
      ),
    );
    this.intake = received.catch(() => {});
    await received;
    await this.serial(() => this.drain());
  }
  private async drain() {
    const pending = await this.inbox.pending(128);
    // Process key updates from later transactions even when an earlier room
    // event is waiting for a session. Crypto state is saved before the marker.
    for (const tx of pending) {
      if (await this.state.get<boolean>('crypto:' + tx.transactionID)) continue;
      await this.crypto.receive(tx.payload);
      await this.state.put('crypto:' + tx.transactionID, true);
    }
    for (const tx of pending) {
      let waiting = false;
      const events = tx.payload.events;
      if (events !== undefined && !Array.isArray(events))
        throw Error('Invalid Beeper transaction.');
      for (const raw of (events || []) as unknown as Event[]) {
        if (
          raw.room_id !== this.room ||
          raw.sender !== this.api.config.owner ||
          !raw.event_id
        )
          continue;
        if (raw.content?.['fi.mau.double_puppet_source'] === SOURCE) continue;
        let event: Event;
        try {
          event = await this.crypto.decrypt(raw);
        } catch {
          waiting = true;
          continue;
        }
        if (
          event.type !== 'm.room.message' ||
          event.content['fi.mau.double_puppet_source'] === SOURCE
        )
          continue;
        if (
          !['m.text', 'm.image'].includes(String(event.content.msgtype)) ||
          typeof event.content.body !== 'string'
        )
          continue;
        // Edits are not new prompts. Interactive approvals stay in Muse.
        if (
          (event.content['m.relates_to'] as Record<string, unknown>)
            ?.rel_type === 'm.replace'
        )
          continue;
        await this.api.members(this.room);
        const jobs = (await this.state.get<Job[]>('jobs')) || [];
        if (jobs.some((j) => j.id === event.event_id)) continue;
        const body = event.content.body.trim();
        if (
          (!body && event.content.msgtype !== 'm.image') ||
          body.length > 16000
        )
          continue;
        if (jobs.filter((j) => j.phase !== 'done').length >= 128)
          throw Error('Muse prompt queue is full.');
        if (event.content.msgtype === 'm.image') {
          try {
            const image = incomingImage(event.content);
            const caption =
              typeof event.content.filename === 'string' &&
              body !== event.content.filename
                ? body
                : '';
            jobs.push({
              id: event.event_id,
              prompt: caption,
              image,
              phase: 'queued',
            });
          } catch {
            jobs.push({
              id: event.event_id,
              prompt: body || 'Image',
              phase: 'blocked',
              safeToContinue: true,
              failureCode: 'image-unavailable',
              error:
                'Image unavailable. Use PNG, JPEG, GIF or WebP up to 5 MB.',
            });
          }
        } else jobs.push({ id: event.event_id, prompt: body, phase: 'queued' });
        await this.state.put('jobs', jobs);
      }
      if (!waiting) await this.inbox.complete(tx.transactionID);
    }
    await this.flushStatuses();
  }
  tick() {
    return this.serial(async () => {
      await this.drain();
      await this.recoverDeliveries();
    });
  }
  private async recoverDeliveries() {
    for (const key of await this.state.keys('delivery:')) {
      const delivery = await this.state.get<Delivery>(key);
      if (!delivery) continue;
      await this.deliver(delivery);
      await this.state.put('source:' + key.slice(9), delivery.record);
      await this.state.put(key, null);
    }
  }
  async status() {
    const jobs = (await this.state.get<Job[]>('jobs')) || [];
    return {
      diagnosticFailures: jobs
        .filter((j) => j.phase === 'blocked')
        .map((j) => failureCode(j.failureCode)),
      blockedJobs: jobs
        .filter((j) => j.phase === 'blocked')
        .map((j) => ({
          id: j.id,
          prompt: j.prompt || j.image?.name || 'Image',
          error: j.error,
        })),
      claimed: jobs.filter((j) => j.phase === 'claimed').length,
      queued: jobs.filter((j) => j.phase === 'queued').length,
      blocked: jobs.filter((j) => j.phase === 'blocked').length,
      held: jobs.filter((j) => j.phase === 'blocked' && !j.safeToContinue)
        .length,
      pending: (await this.inbox.pending(128)).length,
      room: this.room,
    };
  }
  async checkpoint() {
    await this.intake;
    await this.serial(async () => {});
  }
  claim() {
    return this.serial(async () => {
      if (this.paused) return { job: null };
      await this.api.members(this.room);
      const jobs = (await this.state.get<Job[]>('jobs')) || [];
      if (
        jobs.some(
          (j) =>
            j.phase === 'claimed' ||
            (j.phase === 'blocked' && !j.safeToContinue),
        )
      )
        return { job: null };
      const job = jobs.find((j) => j.phase === 'queued');
      if (!job) return { job: null };
      let image: Muse.Upload | undefined;
      if (job.image) {
        try {
          image = await this.crypto.downloadImage(job.image);
        } catch {
          job.phase = 'blocked';
          job.failureCode = 'image-download-failed';
          job.safeToContinue = true;
          job.error =
            'Image download or decryption failed. Check the original photo, dismiss this job, then send it again.';
          await this.state.put('jobs', jobs);
          await this.flushStatuses();
          return { job: null };
        }
      }
      job.phase = 'claimed';
      await this.state.put('jobs', jobs);
      return {
        job: { id: job.id, prompt: job.prompt, ...(image ? { image } : {}) },
      };
    });
  }
  block(id: string, code: unknown = 'source-interrupted') {
    return this.serial(async () => {
      const jobs = (await this.state.get<Job[]>('jobs')) || [];
      const job = jobs.find((j) => j.id === id);
      if (job && job.phase !== 'done') {
        job.phase = 'blocked';
        job.failureCode = failureCode(code);
        job.safeToContinue = [
          'image-composer-missing',
          'image-input-missing',
          'image-unavailable',
          'image-download-failed',
          'image-adapter-unavailable',
        ].includes(job.failureCode);
        job.error = explanations[failureCode(code)];
        await this.state.put('jobs', jobs);
        await this.flushStatuses();
      }
    });
  }
  resolve(id: string) {
    return this.serial(async () => {
      const jobs = (await this.state.get<Job[]>('jobs')) || [];
      const job = jobs.find((j) => j.id === id && j.phase === 'blocked');
      if (job) {
        job.phase = 'done';
        job.skipped = true;
        job.prompt = '';
        delete job.image;
        delete job.error;
        await this.state.put('jobs', jobs);
        await this.flushStatuses();
      }
    });
  }
  private validateEcho(
    job: Job,
    echo: Muse.Message | undefined,
  ): asserts echo is Muse.Message {
    if (
      !echo ||
      echo.role !== 'user' ||
      typeof echo.id !== 'string' ||
      !echo.id ||
      echo.id.length > 1024 ||
      typeof echo.text !== 'string' ||
      (job.image
        ? !echo.images?.length ||
          (echo.text.trim() !== job.prompt.trim() &&
            (!!job.prompt || echo.text.trim() !== job.image.name))
        : echo.text.trim() !== job.prompt.trim())
    )
      throw Error('Muse prompt attribution failed.');
  }
  confirm(id: string, echo: Muse.Message) {
    return this.serial(async () => {
      const jobs = (await this.state.get<Job[]>('jobs')) || [];
      const job = jobs.find((j) => j.id === id);
      if (!job || !['claimed', 'blocked'].includes(job.phase))
        throw Error('Unknown Muse job.');
      this.validateEcho(job, echo);
      job.confirmed = true;
      await this.state.put('jobs', jobs);
      await this.flushStatuses();
    });
  }
  private async flushStatuses(currentJobs?: Job[]) {
    const jobs = currentJobs || (await this.state.get<Job[]>('jobs')) || [];
    // Old completed jobs predate native status tracking; do not relabel history.
    for (const job of jobs) {
      if (job.phase === 'done' && !job.confirmed && !job.skipped) continue;
      const status = job.confirmed
        ? 'SUCCESS'
        : job.phase === 'blocked' || job.skipped
          ? 'FAIL_PERMANENT'
          : 'PENDING';
      const message = job.confirmed
        ? 'Confirmed in Muse.'
        : status === 'PENDING'
          ? 'Waiting for confirmation from Muse.'
          : job.skipped
            ? 'Skipped. Delivery to Muse was not confirmed.'
            : 'Delivery to Muse was not confirmed. Check the interrupted message in Beeper Muse.';
      const content = {
        status,
        message,
        'm.relates_to': { rel_type: 'm.reference', event_id: job.id },
        delivered_to_users: job.confirmed ? [this.api.config.bot] : [],
        ...(status === 'FAIL_PERMANENT'
          ? { reason: 'm.foreign_network_error' }
          : {}),
      };
      const fingerprint = await eventID(this.room, JSON.stringify(content));
      if (job.statusFingerprint === fingerprint) continue;
      try {
        await this.api.members(this.room);
        await this.api.request(
          'PUT',
          '/_matrix/client/v3/rooms/' +
            enc(this.room) +
            '/send/com.beeper.message_send_status/' +
            enc(fingerprint),
          content,
        );
        job.statusFingerprint = fingerprint;
        await this.state.put('jobs', jobs);
      } catch {
        return;
      } // Retry status on the next tick, never resend the prompt.
    }
  }
  complete(result: { id: string; messages: Muse.Message[] }) {
    return this.serial(async () => {
      const jobs = (await this.state.get<Job[]>('jobs')) || [];
      const job = jobs.find((j) => j.id === result.id);
      if (!job || !['claimed', 'blocked', 'done'].includes(job.phase))
        throw Error('Unknown Muse job.');
      if (job.phase === 'done') return;
      const echo = result.messages.find((m) => m.role === 'user');
      this.validateEcho(job, echo);
      job.confirmed = true;
      await this.state.put('jobs', jobs);
      await this.flushStatuses(jobs);
      // Associate the observed prompt with its existing Beeper event.
      await this.state.put('source:' + echo.id, {
        eventID: job.id,
        originalImage: !!job.image,
        fingerprint: '',
        role: 'user',
        timestamp: echo.timestampMs || Date.now(),
        reactions: {},
        partial: false,
      } satisfies SourceRecord);
      for (const message of result.messages)
        if (message.id !== echo.id) await this.importOne(message);
      await this.api.request(
        'POST',
        '/_matrix/client/v3/rooms/' +
          enc(this.room) +
          '/receipt/m.read/' +
          enc(job.id),
        {},
      );
      job.phase = 'done';
      job.prompt = '';
      delete job.image;
      delete job.error;
      await this.state.put('jobs', jobs);
    });
  }
  importMessages(messages: Muse.Message[]) {
    return this.serial(async () => {
      if (!Array.isArray(messages) || messages.length > 100)
        throw Error('Invalid Muse import.');
      let added = 0;
      for (const message of messages)
        if (await this.importOne(message)) added++;
      return { added };
    });
  }
  private async importOne(message: Muse.Message): Promise<boolean> {
    if (
      !message ||
      !['user', 'assistant'].includes(message.role) ||
      typeof message.id !== 'string' ||
      message.id.length > 1024 ||
      typeof message.text !== 'string' ||
      message.text.length > 100000
    )
      throw Error('Invalid Muse message.');
    const key = 'source:' + message.id;
    const saved = await this.state.get<SourceRecord>(key);
    if (saved && message.partial) return false;
    if (saved && saved.role !== message.role)
      throw Error('Muse message identity changed.');
    const contentFingerprint = await eventID(
      this.room,
      JSON.stringify([message.text, message.html, message.images]),
    );
    const fingerprint = await eventID(
      this.room,
      JSON.stringify([contentFingerprint, message.reactions]),
    );
    if (message.read === true && saved && !saved.read) {
      await this.api.request(
        'POST',
        '/_matrix/client/v3/rooms/' + enc(this.room) + '/read_markers',
        { 'm.read.private': saved.eventID },
        this.api.config.owner,
      );
      saved.read = true;
      await this.state.put(key, saved);
    }
    if (saved?.fingerprint === fingerprint) return false;
    let delivery = await this.state.get<Delivery>('delivery:' + message.id);
    // Persist the exact encrypted batch before sending. On uncertain outcomes,
    // retry these same event IDs and ciphertext, then accept newer revisions.
    if (delivery) {
      await this.deliver(delivery);
      await this.state.put(key, delivery.record);
      await this.state.put('delivery:' + message.id, null);
      if (delivery.record.fingerprint === fingerprint) return true;
      return this.importOne(message);
    }
    const timestamp =
      saved?.timestamp ||
      (Number.isSafeInteger(message.timestampMs) && message.timestampMs! > 0
        ? message.timestampMs!
        : message.observedAtMs || Date.now());
    const baseID =
      saved?.eventID || (await eventID(this.room, 'source:' + message.id));
    const sender =
      message.role === 'user' ? this.api.config.owner : this.api.config.bot;
    const missingImages = (message.images || [])
      .filter((image, index) => !image.data && !saved?.images?.[String(index)])
      .map((image) => {
        try {
          const url = new URL(image.url);
          return ['https:', 'http:'].includes(url.protocol) &&
            !url.username &&
            !url.password
            ? (image.alt || 'Image') + ': ' + url.href
            : 'Image unavailable. Open Muse to view it.';
        } catch {
          return 'Image unavailable. Open Muse to view it.';
        }
      });
    const fallback = missingImages.join('\n');
    const content: Record<string, unknown> = {
      msgtype: 'm.text',
      body: [message.text, fallback].filter(Boolean).join('\n\n') || 'Image',
      'fi.mau.double_puppet_source': SOURCE,
      'com.beeper.muse.timestamp_source': message.timestampMs
        ? 'source'
        : 'observed',
    };
    // The adapter supplies a small allowed HTML vocabulary. Strip any attributes
    // beyond safe link URLs at the source boundary (see validateSourceHTML).
    if (message.html && !fallback) {
      content.format = 'org.matrix.custom.html';
      content.formatted_body = validateSourceHTML(message.html);
    }
    const plain = { ...content };
    if (saved) {
      content['m.new_content'] = plain;
      content['m.relates_to'] = { rel_type: 'm.replace', event_id: baseID };
    }
    const events: Event[] = [];
    if (
      !saved?.originalImage &&
      (!saved || saved.contentFingerprint !== contentFingerprint)
    ) {
      const encrypted = await this.crypto.encrypt(
        this.room,
        'm.room.message',
        content,
      );
      encrypted['fi.mau.double_puppet_source'] = SOURCE;
      events.push({
        type: 'm.room.encrypted',
        room_id: this.room,
        sender,
        event_id: saved
          ? await eventID(this.room, 'edit:' + message.id + ':' + fingerprint)
          : baseID,
        origin_server_ts: timestamp,
        content: encrypted,
      });
    }
    const imageRecords = { ...(saved?.images || {}) };
    for (const [index, image] of (message.images || []).slice(0, 8).entries()) {
      if (saved?.originalImage) break;
      if (!image.data || !/^image\/(png|jpeg|webp|gif)$/.test(image.mime || ''))
        continue;
      const encoded = image.data.replace(/^data:[^,]+,/, '');
      if (
        encoded.length > 8 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/=]+$/.test(encoded)
      )
        continue;
      const imageFingerprint = await eventID(this.room, encoded);
      const previousImage = imageRecords[String(index)];
      if (previousImage?.fingerprint === imageFingerprint) continue;
      const imageID =
        previousImage?.eventID ||
        (await eventID(this.room, 'image:' + message.id + ':' + index));
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const file = await this.crypto.image(bytes);
      const imageMessage: Record<string, unknown> = {
        msgtype: 'm.image',
        body: image.alt || 'Muse image',
        file,
        info: { mimetype: image.mime, size: bytes.length },
        'fi.mau.double_puppet_source': SOURCE,
      };
      if (previousImage) {
        imageMessage['m.new_content'] = { ...imageMessage };
        imageMessage['m.relates_to'] = {
          rel_type: 'm.replace',
          event_id: imageID,
        };
      }
      const imageContent = await this.crypto.encrypt(
        this.room,
        'm.room.message',
        imageMessage,
      );
      imageRecords[String(index)] = {
        eventID: imageID,
        fingerprint: imageFingerprint,
      };
      events.push({
        type: 'm.room.encrypted',
        room_id: this.room,
        sender,
        event_id: previousImage
          ? await eventID(
              this.room,
              'image-edit:' + message.id + ':' + index + ':' + imageFingerprint,
            )
          : imageID,
        origin_server_ts: timestamp,
        content: imageContent,
      });
    }
    const reactions: Record<string, string> = {};
    for (const reaction of (message.reactions || []).slice(0, 32)) {
      if (
        !['user', 'assistant'].includes(reaction.actor) ||
        typeof reaction.key !== 'string' ||
        reaction.key.length > 64 ||
        !reaction.key
      )
        continue;
      const rk = JSON.stringify([reaction.actor, reaction.key]);
      const id =
        saved?.reactions[rk] ||
        (await eventID(
          this.room,
          'reaction:' + message.id + ':' + rk + ':' + fingerprint,
        ));
      reactions[rk] = id;
      if (!saved?.reactions[rk])
        events.push({
          type: 'm.reaction',
          room_id: this.room,
          sender:
            reaction.actor === 'user'
              ? this.api.config.owner
              : this.api.config.bot,
          event_id: id,
          origin_server_ts: timestamp,
          content: {
            'm.relates_to': {
              rel_type: 'm.annotation',
              event_id: baseID,
              key: reaction.key,
            },
          },
        });
    }
    for (const [rk, id] of Object.entries(saved?.reactions || {}))
      if (!reactions[rk]) {
        const actor = JSON.parse(rk)[0];
        await this.api.request(
          'PUT',
          '/_matrix/client/v3/rooms/' +
            enc(this.room) +
            '/redact/' +
            enc(id) +
            '/' +
            enc(await eventID(this.room, 'remove:' + id)),
          {},
          actor === 'user' ? this.api.config.owner : this.api.config.bot,
        );
      }
    delivery = {
      events,
      historical: message.historical === true,
      read: message.read === true || message.historical === true,
      record: {
        eventID: baseID,
        fingerprint,
        contentFingerprint,
        originalImage: saved?.originalImage,
        role: message.role,
        timestamp,
        reactions,
        images: imageRecords,
        read: message.read === true || message.historical === true,
        partial: message.partial === true,
      },
    };
    await this.state.put('delivery:' + message.id, delivery);
    await this.deliver(delivery);
    await this.state.put(key, delivery.record);
    await this.state.put('delivery:' + message.id, null);
    return true;
  }
  private async deliver(delivery: Delivery) {
    if (this.paused) throw Error('Beeper connection is paused.');
    await this.api.members(this.room);
    if (!delivery.events.length) return;
    const response = await this.api.request<{ event_ids: string[] }>(
      'POST',
      '/_matrix/client/unstable/com.beeper.backfill/rooms/' +
        enc(this.room) +
        '/batch_send',
      {
        forward: true,
        forward_if_no_messages: true,
        send_notification: !delivery.historical && !delivery.read,
        ...(delivery.read ? { mark_read_by: this.api.config.owner } : {}),
        events: delivery.events,
      },
    );
    if (
      !Array.isArray(response.event_ids) ||
      response.event_ids.length !== delivery.events.length ||
      response.event_ids.some((id, i) => id !== delivery.events[i]!.event_id)
    )
      throw Error('Beeper did not confirm the complete message batch.');
  }
  async activity(activity: Muse.Activity) {
    if (!['idle', 'working'].includes(activity))
      throw Error('Invalid Muse activity.');
    await this.api.request(
      'PUT',
      '/_matrix/client/v3/rooms/' +
        enc(this.room) +
        '/typing/' +
        enc(this.api.config.bot),
      { typing: activity === 'working', timeout: 12000 },
    );
  }
  close() {
    this.inbox.close();
    this.crypto.close();
    this.state.close();
  }
}
export function validateSourceHTML(html: string): string {
  if (html.length > 200000) throw Error('Muse formatting is too large.');
  // Fail closed to plain text if the adapter ever returns unfamiliar markup.
  const allowed =
    /^(?:p|br|strong|b|em|i|u|s|del|code|pre|blockquote|ul|ol|li|a|span)$/;
  return html.replace(/<([^>]+)>/g, (_whole, tag: string) => {
    const match = /^\/?([a-z]+)([^]*)$/i.exec(tag);
    if (!match || !allowed.test(match[1]!.toLowerCase())) return '';
    if (tag.startsWith('/')) return '</' + match[1]!.toLowerCase() + '>';
    if (match[1]!.toLowerCase() !== 'a')
      return '<' + match[1]!.toLowerCase() + '>';
    const href = /^\s+href="(https?:\/\/[^"<>\s]+)"\s*$/i.exec(match[2]!);
    return href ? '<a href="' + href[1] + '">' : '<a>';
  });
}
