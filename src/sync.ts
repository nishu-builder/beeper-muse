// Generated JavaScript lives in extension/sync.js. Edit this TypeScript source.
(() => {
  'use strict';
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const matchesPrompt = (text: string, prompt: string) =>
    normalize(text) === normalize(prompt) ||
    normalize(text.replace(/^You:\s*/, '')) === normalize(prompt);
  function responseAfter(
    beforeIDs: Set<string>,
    prompt: string,
    snapshot: Muse.Snapshot,
  ) {
    const users = snapshot.messages.filter(
      (m) => m.role === 'user' && !beforeIDs.has(m.id),
    );
    if (users.some((m) => !matchesPrompt(m.text, prompt)) || users.length > 1)
      throw new Error('Another message was entered in the Muse tab.');
    const echo = users.find((m) => matchesPrompt(m.text, prompt));
    if (!echo) return null;
    const after = snapshot.messages.slice(snapshot.messages.indexOf(echo) + 1);
    const responses = after.filter(
      (m) =>
        m.role === 'assistant' && !beforeIDs.has(m.id) && !m.widget && m.text,
    );
    if (!responses.length) return null;
    const result = responses.map((m) => m.text).join('\n\n');
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
    const size = () => new TextEncoder().encode(JSON.stringify(out)).byteLength;
    for (const item of items) {
      const prepared = await prepare(item);
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
  class Tracker implements Muse.SyncTracker {
    private initialized = false;
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
      for (const m of items) {
        if (!this.firstSeen.has(m.id))
          this.firstSeen.set(m.id, {
            at: this.now(),
            historical: !this.initialized,
          });
      }
      if (!this.initialized) {
        const count = mode === 'all' ? items.length : mode === 'new' ? 0 : 20;
        this.remember(sources.slice(0, Math.max(0, items.length - count)));
        this.initialized = true;
      }
      const ready: { message: Muse.Message; source: Muse.Source }[] = [];
      for (let i = 0; i < items.length; i++) {
        const message = items[i]!,
          source = sources[i]!;
        if (this.seen.get(source.id) === source.hash) continue;
        let candidate = this.pending.get(source.id);
        if (!candidate || candidate.hash !== source.hash) {
          candidate = { ...source, at: this.now() };
          this.pending.set(source.id, candidate);
        }
        if (!view.busy && this.now() - candidate.at >= 4000)
          ready.push({ message, source });
      }
      for (let i = 0; i < ready.length; i += 1) {
        if (!active()) return;
        // Keep requests bounded even when both messages contain long Unicode text.
        const batch = ready.slice(i, i + 1);
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
        await this.send({
          type: 'import',
          messages: prepared,
        });
        this.remember(batch.map((item) => item.source));
      }
    }
  }
  globalThis.BeeperMuseSync = {
    Tracker,
    messages,
    fingerprint,
    responseAfter,
    prepareBatch,
  };
})();
