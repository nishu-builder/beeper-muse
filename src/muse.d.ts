/** Source-neutral adapter contract. Times are Unix milliseconds, never seconds.
 * No DOM nodes, Matrix IDs, credentials, or Beeper endpoints cross this boundary.
 * A future API adapter implements Adapter; sync and Matrix delivery stay intact.
 */
declare namespace Muse {
  type Activity = 'idle' | 'working';
  type Role = 'user' | 'assistant';
  interface Image {
    url: string;
    alt?: string;
    data?: string;
    mime?: string;
  }
  interface Upload {
    name: string;
    mime: string;
    data: string;
  }
  interface Reaction {
    actor: Role;
    key: string;
  }
  interface Message {
    id: string;
    role: Role;
    text: string;
    html?: string;
    images?: Image[];
    timestampMs?: number;
    observedAtMs?: number;
    /** Incomplete text fallback: may create missing history, never overwrite a known message. */
    partial?: boolean;
    historical?: boolean;
    read?: boolean;
    reactions?: Reaction[];
  }
  interface Observation extends Message {
    widget?: boolean;
  }
  interface Snapshot {
    activity: Activity;
    busy: boolean;
    draft: string;
    messages: Observation[];
  }
  interface Capabilities {
    activity: boolean;
    images: boolean;
    formatting: boolean;
    timestamps: boolean;
    reactions: boolean;
    readReceipts: boolean;
  }
  interface Adapter {
    readonly capabilities: Capabilities;
    snapshot(): Snapshot | Promise<Snapshot>;
    /** Lightweight observation that does not require a usable composer or transcript. */
    activity?(): Activity | Promise<Activity>;
    submit(
      prompt: string,
      wait: (ms: number) => Promise<void>,
      active?: () => boolean,
    ): Promise<Set<string>>;
    submitImage?(
      prompt: string,
      image: Upload,
      wait: (ms: number) => Promise<void>,
      active?: () => boolean,
    ): Promise<Set<string>>;
    prepare(message: Message): Promise<Message>;
  }
  type HistoryMode = 'recent' | 'all' | 'new';
  interface Source {
    id: string;
    hash: string;
  }
  interface SyncProgress {
    loaded: number;
    eligible: number;
    checked: number;
    waiting: number;
    missingTimes: number;
    skippedWidgets: number;
  }
  interface SyncTracker {
    readonly progress: SyncProgress;
    remember(sources: Source[]): void;
    sync(
      view: Snapshot,
      mode: HistoryMode,
      active: () => boolean,
    ): Promise<void>;
  }
  interface DOMAdapter {
    create(document: Document): Adapter;
    snapshot(document: Document): Snapshot;
    submit(
      document: Document,
      prompt: string,
      wait: (ms: number) => Promise<void>,
      active?: () => boolean,
    ): Promise<Set<string>>;
  }
  interface SyncAPI {
    prepareBatch(
      messages: Message[],
      prepare: (message: Message) => Promise<Message>,
    ): Promise<Message[]>;
    responseAfter(
      before: Set<string>,
      prompt: string,
      snapshot: Snapshot,
      imageName?: string,
    ): string | null;
    messages(view: Snapshot): Message[];
    fingerprint(message: Message): Promise<Source>;
    Tracker: new (
      send: (message: {
        type: 'import';
        messages: Message[];
      }) => Promise<unknown>,
      now?: () => number,
      prepare?: (message: Message) => Promise<Message>,
    ) => SyncTracker;
  }
}
declare var BeeperMuseDOM: Muse.DOMAdapter;
declare var BeeperMuseSync: Muse.SyncAPI;
