import { randomUUID } from 'node:crypto';
import { Parser } from 'htmlparser2';
import type { BeeperPort, Message, Page } from './beeper.ts';
import type { Store } from './storage.ts';

export interface Job {
  id: string;
  messageID: string;
  prompt: string;
  phase: 'queued' | 'claimed' | 'ready' | 'sending' | 'blocked';
  createdAt: number;
  claimedAt?: number;
  result?: string;
}
export interface RelayState {
  version: 1;
  chatID: string;
  startedAt: string;
  cursor: string | null;
  seen: string[];
  completed: string[];
  jobs: Job[];
}
export function parseState(raw: unknown, chatID: string): RelayState | null {
  if (raw === null) return null;
  const s = raw as Partial<RelayState> | null;
  if (
    !s ||
    s.version !== 1 ||
    s.chatID !== chatID ||
    typeof s.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(s.startedAt)) ||
    !(s.cursor === null || typeof s.cursor === 'string') ||
    !Array.isArray(s.seen) ||
    !s.seen.every((x) => typeof x === 'string') ||
    !Array.isArray(s.completed) ||
    !s.completed.every((x) => typeof x === 'string') ||
    !Array.isArray(s.jobs) ||
    s.jobs.length > 20 ||
    !s.jobs.every(
      (j) =>
        j &&
        typeof j.id === 'string' &&
        typeof j.messageID === 'string' &&
        typeof j.prompt === 'string' &&
        j.prompt.length <= 8000 &&
        Number.isFinite(j.createdAt) &&
        ['queued', 'claimed', 'ready', 'sending', 'blocked'].includes(
          j.phase,
        ) &&
        (j.phase !== 'claimed' || Number.isFinite(j.claimedAt)) &&
        (!['ready', 'sending'].includes(j.phase) ||
          (typeof j.result === 'string' && j.result.length <= 24000)),
    )
  ) {
    throw new Error(
      'Relay state is invalid or belongs to another chat. Restore state before starting.',
    );
  }
  return s as RelayState;
}
function messageText(raw: string): string {
  // Beeper may return either plain text or an HTML body. Only decode a body
  // that starts with a container, preserving literal tags in plain prompts.
  if (!/^\s*<(?:p|div|span)(?:\s|>)/i.test(raw)) return raw;
  let text = '';
  let hidden = 0;
  const parser = new Parser({
    onopentag(name) {
      if (name === 'script' || name === 'style') hidden++;
      if (name === 'br') text += '\n';
      if (name === 'blockquote') text += '> ';
    },
    ontext(part) {
      if (!hidden) text += part;
    },
    onclosetag(name) {
      if (name === 'script' || name === 'style') hidden--;
      if (['p', 'div', 'li', 'pre', 'blockquote'].includes(name)) text += '\n';
    },
  });
  parser.end(raw);
  return text;
}
export function promptFrom(m: Message, chatID: string): string | null {
  if (
    m.chatID !== chatID ||
    m.isSender !== true ||
    m.isDeleted ||
    m.isHidden ||
    !m.text
  )
    return null;
  const match = /^!muse\s+([\s\S]+)$/i.exec(messageText(m.text).trim());
  return match?.[1]?.trim() || null;
}
export class Relay {
  state!: RelayState;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly chatID: string,
    private readonly port: BeeperPort,
    private readonly store: Pick<Store, 'read' | 'write'>,
    private readonly validate: () => Promise<void> = async () => {},
  ) {}

  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }
  private save(): Promise<void> {
    return this.store.write('relay', this.state);
  }

  async initialize(now = new Date()): Promise<void> {
    const saved = parseState(await this.store.read('relay'), this.chatID);
    if (saved) {
      this.state = saved;
      for (const j of saved.jobs)
        if (j.phase === 'claimed' || j.phase === 'sending') j.phase = 'blocked';
    } else {
      const page = await this.port.list(this.chatID);
      if (page.items.length && !page.newestCursor)
        throw new Error('Beeper pagination failed: missing initial cursor.');
      this.state = {
        version: 1,
        chatID: this.chatID,
        startedAt: now.toISOString(),
        cursor: page.newestCursor,
        seen: [],
        completed: [],
        jobs: [],
      };
    }
    await this.save();
  }
  status() {
    return {
      queued: this.state.jobs.length,
      phase: this.state.jobs[0]?.phase || 'idle',
    };
  }
  async claim(): Promise<{ id: string; prompt: string } | null> {
    return this.exclusive(async () => {
      const job = this.state.jobs[0];
      if (!job || job.phase !== 'queued') return null;
      job.phase = 'claimed';
      job.claimedAt = Date.now();
      await this.save();
      return { id: job.id, prompt: job.prompt };
    });
  }
  async result(id: string, text: string): Promise<void> {
    return this.exclusive(async () => {
      if (!text.trim() || text.length > 24000)
        throw new Error('Invalid result.');
      if (this.state.completed.includes(id)) return;
      const job = this.state.jobs[0];
      if (!job || job.id !== id) throw new Error('No matching job.');
      if (job.phase === 'ready' && job.result === text) {
        await this.save();
        return;
      }
      if (job.phase !== 'claimed')
        throw new Error('Job is not awaiting a result.');
      job.result = text;
      job.phase = 'ready';
      await this.save();
    });
  }
  async block(id: string): Promise<void> {
    return this.exclusive(async () => {
      const job = this.state.jobs[0];
      if (job?.id === id && job.phase === 'claimed') {
        job.phase = 'blocked';
        await this.save();
      }
    });
  }
  private async ingest(
    messages: Message[],
    cursor: string | null,
  ): Promise<void> {
    const additions: Job[] = [];
    const seen = new Set(this.state.seen);
    for (const m of [...messages].sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
        a.id.localeCompare(b.id),
    )) {
      if (
        !Number.isFinite(Date.parse(m.timestamp)) ||
        Date.parse(m.timestamp) < Date.parse(this.state.startedAt) ||
        seen.has(m.id)
      )
        continue;
      const prompt = promptFrom(m, this.chatID);
      if (prompt === null) continue;
      seen.add(m.id);
      additions.push({
        id: randomUUID(),
        messageID: m.id,
        prompt: prompt.slice(0, 8000),
        phase: prompt.length > 8000 ? 'ready' : 'queued',
        createdAt: Date.now(),
        ...(prompt.length > 8000
          ? {
              result:
                'The prompt was not sent. Please use at most 8000 characters.',
            }
          : {}),
      });
    }
    if (this.state.jobs.length + additions.length > 20)
      throw new Error(
        'Queue limit reached. Let queued prompts finish before restarting.',
      );
    this.state.jobs.push(...additions);
    this.state.seen = [...seen].slice(-500);
    this.state.cursor = cursor;
    await this.save();
  }
  async tick(): Promise<void> {
    return this.exclusive(async () => {
      await this.validate();
      const active = this.state.jobs[0];
      if (
        active?.phase === 'claimed' &&
        Date.now() - active.claimedAt! > 30 * 60 * 1000
      ) {
        active.phase = 'blocked';
        await this.save();
      }
      if (active?.phase === 'blocked') return;
      if (active?.phase === 'ready') {
        active.phase = 'sending';
        await this.save();
        try {
          await this.port.send(
            this.chatID,
            'Muse\n\n' + active.result!,
            active.messageID,
          );
        } catch {
          active.phase = 'blocked';
          await this.save();
          throw new Error(
            'Beeper delivery is uncertain. Check both apps, then acknowledge the job.',
          );
        }
        this.state.completed.push(active.id);
        this.state.completed = this.state.completed.slice(-500);
        this.state.jobs.shift();
        await this.save();
      }
      if (this.state.jobs.length >= 20) return;
      if (!this.state.cursor) {
        let page = await this.port.list(this.chatID);
        const newest = page.newestCursor;
        if (page.items.length && !newest)
          throw new Error('Beeper pagination failed: missing newest cursor.');
        const messages: Message[] = [];
        const visited = new Set<string>();
        for (let count = 0; ; count++) {
          messages.push(...page.items);
          if (
            !page.hasMore ||
            !page.items.length ||
            page.items.some(
              (m) => Date.parse(m.timestamp) < Date.parse(this.state.startedAt),
            )
          )
            break;
          if (
            count >= 99 ||
            !page.oldestCursor ||
            visited.has(page.oldestCursor)
          )
            throw new Error('Beeper pagination failed.');
          visited.add(page.oldestCursor);
          page = await this.port.list(this.chatID, page.oldestCursor, 'before');
        }
        await this.ingest(messages, newest);
        return;
      }
      const visited = new Set<string>([this.state.cursor]);
      for (let count = 0; count < 10; count++) {
        const page: Page = await this.port.list(
          this.chatID,
          this.state.cursor!,
          'after',
        );
        if (!page.items.length) return;
        if (!page.newestCursor || visited.has(page.newestCursor))
          throw new Error('Beeper pagination failed.');
        visited.add(page.newestCursor);
        await this.ingest(page.items, page.newestCursor);
        if (!page.hasMore || this.state.jobs.length >= 20) return;
      }
    });
  }
}
