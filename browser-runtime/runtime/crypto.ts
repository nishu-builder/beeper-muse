import * as Rust from '@matrix-org/matrix-sdk-crypto-wasm';
import { MatrixAPI } from './matrix.js';
import { StateStore } from './state.js';
export type Event = {
  type: string;
  sender: string;
  event_id: string;
  room_id: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
  state_key?: string;
};
interface Device {
  id: string;
  token: string;
  passphrase: string;
}
export class MatrixCrypto {
  private constructor(
    private machine: Rust.OlmMachine,
    private api: MatrixAPI,
    private device: Device,
  ) {}
  static async open(
    api: MatrixAPI,
    state: StateStore,
    wasmURL?: string,
    memoryOnly = false,
    report: (stage: string) => void = () => {},
  ) {
    report('Loading the encryption module');
    await Rust.initAsync(wasmURL);
    report('Reading the saved Beeper device');
    let device = await state.get<Device>('device');
    if (!device) {
      const id = 'MUSE_' + crypto.randomUUID().replace(/-/g, '');
      // Save device identity before login so a crash cannot create another device.
      const pending = (await state.get<string>('device-id')) || id;
      await state.put('device-id', pending);
      report('Signing in the Beeper device');
      const login = await api.request<{
        device_id: string;
        access_token: string;
        user_id: string;
      }>('POST', '/_matrix/client/v3/login', {
        type: 'm.login.application_service',
        identifier: { type: 'm.id.user', user: api.config.bot },
        device_id: pending,
        initial_device_display_name: 'Beeper Muse Chrome',
      });
      if (
        login.user_id !== api.config.bot ||
        login.device_id !== pending ||
        !login.access_token
      )
        throw Error('Beeper device login did not match.');
      device = {
        id: pending,
        token: login.access_token,
        passphrase: crypto.randomUUID() + crypto.randomUUID(),
      };
      await state.put('device', device);
    }
    report('Opening the encrypted key store');
    const machine = await Rust.OlmMachine.initialize(
      new Rust.UserId(api.config.bot),
      new Rust.DeviceId(device.id),
      memoryOnly
        ? undefined
        : 'beeper-muse-crypto-' + api.config.registrationID,
      memoryOnly ? undefined : device.passphrase,
      { debug() {}, info() {}, warn() {}, error() {} },
    );
    try {
      machine.roomKeyRequestsEnabled = true;
      report('Checking the Beeper device keys');
      const keys = await api.request<{
        device_keys?: Record<
          string,
          Record<string, { keys?: Record<string, string> }>
        >;
      }>(
        'POST',
        '/_matrix/client/v3/keys/query',
        { device_keys: { [api.config.bot]: [device.id] } },
        api.config.bot,
        device.token,
      );
      const existing =
        keys.device_keys?.[api.config.bot]?.[device.id]?.keys?.[
          'ed25519:' + device.id
        ];
      if (existing && existing !== machine.identityKeys.ed25519.toBase64()) {
        throw Error(
          'Encryption storage is missing or changed. Restore it before reconnecting.',
        );
      }
      const instance = new MatrixCrypto(machine, api, device);
      await machine.updateTrackedUsers([
        new Rust.UserId(api.config.owner),
        new Rust.UserId(api.config.bot),
      ]);
      report('Publishing encryption keys');
      await instance.flush();
      return instance;
    } catch (error) {
      machine.close();
      throw error;
    }
  }
  private async send(req: Rust.OutgoingRequest) {
    let path: string,
      method = 'POST';
    switch (req.type) {
      case Rust.RequestType.KeysUpload:
        path = '/keys/upload';
        break;
      case Rust.RequestType.KeysQuery:
        path = '/keys/query';
        break;
      case Rust.RequestType.KeysClaim:
        path = '/keys/claim';
        break;
      case Rust.RequestType.ToDevice: {
        const td = req as Rust.ToDeviceRequest;
        path =
          '/sendToDevice/' +
          encodeURIComponent(td.event_type) +
          '/' +
          encodeURIComponent(td.txn_id);
        method = 'PUT';
        break;
      }
      case Rust.RequestType.SignatureUpload:
        path = '/keys/signatures/upload';
        break;
      default:
        throw Error('Unsupported crypto request; delivery stopped.');
    }
    const response = await this.api.request(
      method,
      '/_matrix/client/v3' + path,
      JSON.parse(req.body),
      this.api.config.bot,
      this.device.token,
    );
    if (!req.id) throw Error('Crypto request has no durable identity.');
    await this.machine.markRequestAsSent(
      req.id,
      req.type,
      JSON.stringify(response),
    );
  }
  async flush() {
    for (const req of await this.machine.outgoingRequests())
      await this.send(req);
  }
  async receive(payload: Record<string, unknown>) {
    const changed = (payload.device_lists ||
      payload['org.matrix.msc3202.device_lists'] ||
      {}) as { changed?: string[]; left?: string[] };
    const counts = (payload.device_one_time_keys_count ||
      payload['org.matrix.msc3202.device_one_time_keys_count'] ||
      {}) as Record<string, Record<string, Record<string, number>>>;
    const fallback = (payload.device_unused_fallback_key_types ||
      payload['org.matrix.msc3202.device_unused_fallback_key_types'] ||
      {}) as Record<string, Record<string, string[]>>;
    const events = (payload.to_device ||
      payload['de.sorunome.msc2409.to_device'] ||
      []) as Array<Record<string, unknown>>;
    // Appservice transactions can contain updates for multiple ghost devices.
    const own = events.filter(
      (e) =>
        (!e.to_user_id || e.to_user_id === this.api.config.bot) &&
        (!e.to_device_id || e.to_device_id === this.device.id),
    );
    const lists = new Rust.DeviceLists(
      (changed.changed || []).map((u) => new Rust.UserId(u)),
      (changed.left || []).map((u) => new Rust.UserId(u)),
    );
    await this.machine.receiveSyncChanges(
      JSON.stringify(own),
      lists,
      new Map(
        Object.entries(counts[this.api.config.bot]?.[this.device.id] || {}),
      ),
      fallback[this.api.config.bot]?.[this.device.id]
        ? new Set(fallback[this.api.config.bot]![this.device.id])
        : undefined,
    );
    await this.flush();
  }
  async encrypt(room: string, type: string, content: Record<string, unknown>) {
    await this.api.members(room);
    const users = () => [
      new Rust.UserId(this.api.config.owner),
      new Rust.UserId(this.api.config.bot),
    ];
    await this.flush();
    const missing = await this.machine.getMissingSessions(users());
    if (missing) await this.send(missing);
    const settings = new Rust.EncryptionSettings();
    settings.algorithm = Rust.EncryptionAlgorithm.MegolmV1AesSha2;
    settings.historyVisibility = Rust.HistoryVisibility.Invited;
    settings.sharingStrategy = Rust.CollectStrategy.allDevices();
    for (const request of await this.machine.shareRoomKey(
      new Rust.RoomId(room),
      users(),
      settings,
    ))
      await this.send(request);
    return JSON.parse(
      await this.machine.encryptRoomEvent(
        new Rust.RoomId(room),
        type,
        JSON.stringify(content),
      ),
    ) as Record<string, unknown>;
  }
  async decrypt(event: Event): Promise<Event> {
    if (event.type !== 'm.room.encrypted') return event;
    const result = await this.machine.decryptRoomEvent(
      JSON.stringify(event),
      new Rust.RoomId(event.room_id),
      new Rust.DecryptionSettings(Rust.TrustRequirement.Untrusted),
    );
    const clear = JSON.parse(result.event) as Pick<Event, 'type' | 'content'>;
    return { ...event, type: clear.type, content: clear.content };
  }
  async image(bytes: Uint8Array) {
    const encrypted = Rust.Attachment.encrypt(bytes);
    const info = encrypted.mediaEncryptionInfo;
    if (!info) throw Error('Image encryption failed.');
    const file = JSON.parse(info) as Record<string, unknown>;
    const uploaded = await this.api.request<{ content_uri: string }>(
      'POST',
      '/_matrix/media/v3/upload',
      encrypted.encryptedData,
    );
    encrypted.free();
    if (!/^mxc:\/\//.test(uploaded.content_uri))
      throw Error('Beeper media upload failed.');
    return { ...file, url: uploaded.content_uri };
  }
  close() {
    this.machine.close();
  }
}
