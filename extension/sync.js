(() => {
  'use strict';
  const messages = (view) =>
    view.messages
      .filter(
        (m) =>
          m.id &&
          ['user', 'assistant'].includes(m.role) &&
          !m.widget &&
          m.text.trim(),
      )
      .map((m) => ({
        id: m.id,
        role: m.role,
        text:
          m.text.length > 23000
            ? m.text.slice(0, 22900) +
              '\n\n[Message shortened. Open Muse for the full text.]'
            : m.text,
      }));
  async function fingerprint(message) {
    const bytes = new TextEncoder().encode(message.role + '\n' + message.text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return {
      id: message.id,
      hash: Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join(''),
    };
  }
  class Tracker {
    constructor(send, now = () => Date.now()) {
      this.send = send;
      this.now = now;
      this.initialized = false;
      this.seen = new Map();
      this.pending = new Map();
    }
    remember(sources) {
      for (const source of sources) {
        this.seen.set(source.id, source.hash);
        this.pending.delete(source.id);
      }
    }
    async sync(view, mode, active) {
      const items = messages(view);
      const sources = await Promise.all(items.map(fingerprint));
      if (!active()) return;
      if (!this.initialized) {
        const count = mode === 'all' ? items.length : mode === 'new' ? 0 : 20;
        this.remember(sources.slice(0, Math.max(0, items.length - count)));
        this.initialized = true;
      }
      const ready = [];
      for (let i = 0; i < items.length; i++) {
        const message = items[i],
          source = sources[i];
        if (this.seen.get(source.id) === source.hash) continue;
        let candidate = this.pending.get(source.id);
        if (!candidate || candidate.hash !== source.hash) {
          candidate = { ...source, at: this.now() };
          this.pending.set(source.id, candidate);
        }
        if (!view.busy && this.now() - candidate.at >= 4000)
          ready.push({ message, source });
      }
      for (let i = 0; i < ready.length; i += 2) {
        if (!active()) return;
        // Keep requests bounded even when both messages contain long Unicode text.
        const batch = ready.slice(i, i + 2);
        await this.send({
          type: 'import',
          messages: batch.map((item) => item.message),
        });
        this.remember(batch.map((item) => item.source));
      }
    }
  }
  globalThis.BeeperMuseSync = { Tracker, messages, fingerprint };
})();
