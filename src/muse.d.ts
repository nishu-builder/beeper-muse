/** Source-neutral adapter contract. Times are Unix milliseconds, never seconds.
 * No DOM nodes, Matrix IDs, credentials, or Beeper endpoints cross this boundary.
 * A future API adapter implements Adapter; sync and Matrix delivery stay intact.
 */
declare namespace Muse {
  type PreparationEvent =
    | 'image-compressed'
    | 'image-prepared'
    | 'image-fetch-failed'
    | 'image-format-unsupported'
    | 'image-too-large';
  type PreparationReporter = (event: PreparationEvent) => void;
  type Activity = 'idle' | 'working';
  type Role = 'user' | 'assistant';
  interface Image {
    url: string;
    alt?: string;
    data?: string;
    mime?: string;
  }
  interface Profile {
    avatar: Image;
  }
  interface ActivityReadiness {
    stopButtons: number;
    composerBusy: boolean;
    assistantBusy: boolean;
  }
  interface UploadReadiness {
    composers: number;
    hasForm: boolean;
    hasUploadRegion: boolean;
    pageFileInputs: number;
    pageImageInputs: number;
    fileInputs: number;
    imageInputs: number;
    existingFiles: number;
    previews: number;
    sendButtons: number;
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
    /** An observed image presentation has not exposed any image bytes/URL yet. */
    imageState?: 'loading';
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
  interface MediaReadiness {
    sourceVisible: boolean;
    sourceFocused: boolean;
    tailImageBusy: number;
    tailImageChildNodes: number;
    tailImageNodes: number;
    tailImagePresentations: number;
    tailIframes: number;
    tailWidgetsOnscreen: number;
    tailWidgetsSized: number;
    tailCanvases: number;
    tailVideos: number;
    tailFileCards: number;
    tailGeneratedControls: number;
    tailGeneratedImages: number;
    tailDeferred: number;
  }
  interface Adapter {
    readonly capabilities: Capabilities;
    snapshot(): Snapshot | Promise<Snapshot>;
    /** Lightweight observation that does not require a usable composer or transcript. */
    activity?(): Activity | Promise<Activity>;
    activityReadiness?(): ActivityReadiness;
    mediaReadiness?(): MediaReadiness;
    profile?(): Promise<Profile | undefined>;
    submit(
      prompt: string,
      wait: (ms: number) => Promise<void>,
      active?: () => boolean,
    ): Promise<Set<string>>;
    imageReadiness?(): UploadReadiness;
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
    create(document: Document, report?: PreparationReporter): Adapter;
    snapshot(document: Document): Snapshot;
    submit(
      document: Document,
      prompt: string,
      wait: (ms: number) => Promise<void>,
      active?: () => boolean,
    ): Promise<Set<string>>;
  }
  interface SyncAPI {
    mediaReady(message: Message): boolean;
    prepareBatch(
      messages: Message[],
      prepare: (message: Message) => Promise<Message>,
    ): Promise<Message[]>;
    promptEcho(
      beforeIDs: Set<string>,
      prompt: string,
      snapshot: Snapshot,
      imageName?: string,
    ): Message | undefined;
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
