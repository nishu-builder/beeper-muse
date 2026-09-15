// Generated JavaScript lives in extension/sync.js. Edit this TypeScript source.
(() => {
  'use strict';
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const matchesPrompt = (text: string, prompt: string) =>
    normalize(text) === normalize(prompt) ||
    normalize(text.replace(/^You:\s*/, '')) === normalize(prompt);
  function promptEcho(
    beforeIDs: Set<string>,
    prompt: string,
    snapshot: Muse.Snapshot,
    imageName?: string,
  ) {
    const users = snapshot.messages.filter(
      (m) => m.role === 'user' && !beforeIDs.has(m.id),
    );
    const matches = (m: Muse.Message) =>
      matchesPrompt(m.text, prompt) ||
      (!prompt &&
        imageName !== undefined &&
        normalize(m.text) === normalize(imageName));
    if (users.some((m) => !matches(m)) || users.length > 1)
      throw new Error('Another message was entered in the Muse tab.');
    const echo = users.find(matches);
    // Caption and media can mount separately. Missing media is incomplete
    // evidence, not proof that another user sent a different prompt.
    return imageName !== undefined && !echo?.images?.length ? undefined : echo;
  }
  function responseAfter(
    beforeIDs: Set<string>,
    prompt: string,
    snapshot: Muse.Snapshot,
    imageName?: string,
  ) {
    const echo = promptEcho(beforeIDs, prompt, snapshot, imageName);
    if (!echo) return null;
    const after = snapshot.messages.slice(snapshot.messages.indexOf(echo) + 1);
    const responses = after.filter(
      (m) =>
        m.role === 'assistant' &&
        !beforeIDs.has(m.id) &&
        (!m.widget || !!m.images?.length) &&
        (m.text || !!m.images?.length),
    );
    if (!responses.length) return null;
    const result = responses.map((m) => m.text || '[Image]').join('\n\n');
    return result.length > 23000
      ? result.slice(0, 23000) +
          '\n\n[Reply shortened. Open Muse for the full response.]'
      : result;
  }

  const messages = (view: Muse.Snapshot): Muse.Message[] =>
    view.messages
      .filter(
        (m) =>
          m.id &&
          ['user', 'assistant'].includes(m.role) &&
          (!m.widget || !!m.images?.length) &&
          (m.text.trim() || !!m.images?.length),
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        partial: m.partial,
        html: m.html ? Array.from(m.html).slice(0, 32000).join('') : undefined,
        images: m.images,
        timestampMs: m.timestampMs,
        read: m.read,
        reactions: m.reactions,
        text:
          m.text.length > 23000
            ? Array.from(m.text).slice(0, 22900).join('') +
              '\n\n[Message shortened. Open Muse for the full text.]'
            : m.text,
      }));
  async function fingerprint(message: Muse.Message): Promise<Muse.Source> {
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        message.role,
        message.partial === true,
        message.text,
        message.html || '',
        (message.images || []).map(({ url, alt }) => ({ url, alt })),
        message.read || false,
        message.reactions,
      ]),
    );
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      id: message.id,
      hash: Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join(''),
    };
  }
  async function prepareBatch(
    items: Muse.Message[],
    prepare: (m: Muse.Message) => Promise<Muse.Message>,
  ): Promise<Muse.Message[]> {
    const out: Muse.Message[] = [];
    const deadline = Date.now() + 60000;
    const size = () => new TextEncoder().encode(JSON.stringify(out)).byteLength;
    for (const item of items) {
      const prepared =
        Date.now() < deadline ? await prepare(item) : { ...item };
      out.push(prepared);
      if (size() > 6 * 1024 * 1024) {
        prepared.images = prepared.images?.map(({ url, alt }) => ({
          url,
          alt,
        }));
        if (size() > 6 * 1024 * 1024) for (const m of out) delete m.html;
      }
    }
    if (size() > 6 * 1024 * 1024)
      throw Error('Source result exceeds the message limit.');
    return out;
  }
  function mediaReady(message: Muse.Message) {
    return (message.images || []).every(
      (image) =>
        !!image.data && /^image\/(png|jpeg|gif|webp)$/.test(image.mime || ''),
    );
  }
  class Tracker implements Muse.SyncTracker {
    private initialized = false;
    private baseline = { ids: '', at: 0 };
    private excluded = new Set<string>();
    private current: Muse.SyncProgress = {
      loaded: 0,
      eligible: 0,
      checked: 0,
      waiting: 0,
      missingTimes: 0,
      skippedWidgets: 0,
    };
    get progress(): Muse.SyncProgress {
      return { ...this.current };
    }
    private mediaRetries = new Map<
      string,
      { hash: string; attempts: number; after: number; placeholder?: boolean }
    >();
    private seen = new Map<string, string>();
    private pending = new Map<string, Muse.Source & { at: number }>();
    private firstSeen = new Map<string, { at: number; historical: boolean }>();
    constructor(
      private send: (message: {
        type: 'import';
        messages: Muse.Message[];
      }) => Promise<unknown>,
      private now = () => Date.now(),
      private prepare: (
        message: Muse.Message,
      ) => Promise<Muse.Message> = async (m) => m,
    ) {
      this.send = send;
      this.now = now;
      this.initialized = false;
      this.seen = new Map();
      this.pending = new Map();
    }
    remember(sources: Muse.Source[]) {
      for (const source of sources) {
        this.seen.set(source.id, source.hash);
        this.pending.delete(source.id);
        this.mediaRetries.delete(source.id);
      }
    }
    async sync(
      view: Muse.Snapshot,
      mode: Muse.HistoryMode,
      active: () => boolean,
    ) {
      const items = messages(view);
      const sources = await Promise.all(items.map(fingerprint));
      if (!active()) return;
      this.current = {
        loaded: items.length,
        eligible: 0,
        checked: 0,
        waiting: 0,
        missingTimes: items.filter((m) => m.timestampMs === undefined).length,
        skippedWidgets: view.messages.filter(
          (m) => m.widget && !m.images?.length,
        ).length,
      };
      // The log can mount before its messages. An empty snapshot is not a
      // completed history scan. Wait for a stable ID list before choosing 20.
      if (!items.length) return;
      const ids = JSON.stringify(items.map((m) => m.id));
      if (ids !== this.baseline.ids) this.baseline = { ids, at: this.now() };
      let lastKnown = -1;
      items.forEach((m, i) => {
        if (this.firstSeen.has(m.id)) lastKnown = i;
      });
      for (let i = 0; i < items.length; i++) {
        const m = items[i]!;
        if (!this.firstSeen.has(m.id)) {
          const historical = !this.initialized || i < lastKnown;
          this.firstSeen.set(m.id, { at: this.now(), historical });
          // Prepending older DOM nodes must never turn them into live arrivals.
          if (
            this.initialized &&
            historical &&
            (mode === 'new' || (mode === 'recent' && i < items.length - 20))
          )
            this.excluded.add(m.id);
        }
      }
      for (const source of sources) {
        if (this.pending.get(source.id)?.hash !== source.hash)
          this.pending.set(source.id, { ...source, at: this.now() });
      }
      if (!this.initialized) {
        if (mode !== 'new' && this.now() - this.baseline.at < 4000) {
          this.current.eligible =
            mode === 'all' ? items.length : Math.min(20, items.length);
          this.current.waiting = this.current.eligible;
          return;
        }
        const count = mode === 'all' ? items.length : mode === 'new' ? 0 : 20;
        for (const item of items.slice(0, Math.max(0, items.length - count)))
          this.excluded.add(item.id);
        this.initialized = true;
      }
      const ready: { message: Muse.Message; source: Muse.Source }[] = [];
      let waitingForEarlierMessage = false;
      for (let i = 0; i < items.length; i++) {
        const message = items[i]!,
          source = sources[i]!;
        if (this.excluded.has(source.id)) continue;
        this.current.eligible++;
        if (
          this.seen.get(source.id) === source.hash ||
          (message.partial && this.seen.has(source.id))
        ) {
          this.current.checked++;
          continue;
        }
        const candidate = this.pending.get(source.id)!;
        // Only the trailing assistant bubble might still be streaming. A
        // long-running Muse task must not hold up settled earlier messages.
        const streaming =
          view.busy && message.role === 'assistant' && i === items.length - 1;
        if (
          !waitingForEarlierMessage &&
          !streaming &&
          this.now() - candidate.at >= 4000
        )
          ready.push({ message, source });
        else {
          this.current.waiting++;
          // A first delivery establishes timeline position. Later items must
          // not overtake it while it settles. An edit to an already imported
          // item keeps its original position and need not block new messages.
          if (!this.seen.has(source.id)) waitingForEarlierMessage = true;
        }
      }
      for (let i = 0; i < ready.length; i += 1) {
        if (!active()) return;
        // Keep requests bounded even when both messages contain long Unicode text.
        const batch = ready.slice(i, i + 1);
        const item = batch[0]!;
        const retry = this.mediaRetries.get(item.source.id);
        if (retry?.hash === item.source.hash && this.now() < retry.after) {
          this.current.waiting += retry.placeholder ? 1 : ready.length - i;
          if (retry.placeholder) continue;
          return;
        }
        const prepared = await Promise.all(
          batch.map(async ({ message }) => {
            const first = this.firstSeen.get(message.id)!;
            return this.prepare({
              ...message,
              historical: first.historical,
              observedAtMs: first.at,
            });
          }),
        );
        if (!active()) return;
        if (!prepared.every(mediaReady)) {
          const attempts =
            retry?.hash === item.source.hash ? retry.attempts + 1 : 1;
          const placeholder =
            retry?.hash === item.source.hash && retry.placeholder;
          // After bounded attempts, publish the runtime's honest unavailable-image
          // fallback so one inaccessible attachment cannot freeze the transcript.
          // Keep retrying its media; do not remember it as fully delivered.
          if (attempts >= 3 && !placeholder) {
            await this.send({ type: 'import', messages: prepared });
            if (!active()) return;
          }
          this.mediaRetries.set(item.source.id, {
            hash: item.source.hash,
            placeholder: placeholder || attempts >= 3,
            attempts: Math.min(attempts, 6),
            after:
              this.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)),
          });
          this.current.waiting += attempts >= 3 ? 1 : ready.length - i;
          if (attempts >= 3) continue;
          return;
        }
        await this.send({
          type: 'import',
          messages: prepared,
        });
        this.remember(batch.map((item) => item.source));
        this.current.checked += batch.length;
      }
    }
  }
  globalThis.BeeperMuseSync = {
    Tracker,
    messages,
    fingerprint,
    responseAfter,
    promptEcho,
    prepareBatch,
    mediaReady,
  };
})();
