/** Delivery boundary. Source adapters never receive Matrix credentials or room IDs. */
declare namespace MuseBridge {
  interface Status {
    phase: 'idle' | 'queued' | 'claimed' | 'ready' | 'delivering' | 'blocked';
    queued: number;
    museSync: boolean;
    sourceProtocol?: number;
    activitySync: boolean;
    partialSync: boolean;
  }
  interface Job {
    id: string;
    prompt: string;
  }
  interface Completion {
    id: string;
    text: string;
    sources?: Muse.Source[];
    messages?: Muse.Message[];
  }
  interface Transport {
    status(): Promise<Status>;
    activity(activity: Muse.Activity): Promise<void>;
    importMessages(messages: Muse.Message[]): Promise<{ added: number }>;
    claim(): Promise<{ job: Job | null }>;
    complete(result: Completion): Promise<void>;
    block(id: string): Promise<void>;
  }
}
(() => {
  const phases = [
    'idle',
    'queued',
    'claimed',
    'ready',
    'delivering',
    'blocked',
  ];
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Invalid bridge response.');
    return value as Record<string, unknown>;
  };
  class LocalBridge implements MuseBridge.Transport {
    constructor(private token: () => Promise<string | null>) {}
    private async request(
      path: string,
      body?: unknown,
      timeoutMs = 20000,
    ): Promise<Record<string, unknown>> {
      const token = await this.token();
      if (!token || !/^[a-f0-9]{64}$/.test(token))
        throw Error('Pair the extension first.');
      const response = await fetch('http://127.0.0.1:24819' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw Error('Bridge unavailable.');
      return record(await response.json());
    }
    async status(): Promise<MuseBridge.Status> {
      const s = await this.request('/v1/status');
      if (
        !phases.includes(String(s.phase)) ||
        !Number.isSafeInteger(s.queued) ||
        Number(s.queued) < 0
      )
        throw Error('Invalid bridge status.');
      return {
        phase: s.phase as MuseBridge.Status['phase'],
        queued: Number(s.queued),
        museSync: s.museSync === true,
        activitySync: s.activitySync === true,
        partialSync: s.partialSync === true,
        sourceProtocol:
          typeof s.sourceProtocol === 'number' ? s.sourceProtocol : undefined,
      };
    }
    async activity(activity: Muse.Activity) {
      await this.request('/v1/activity', { activity }, 3000);
    }
    async importMessages(messages: Muse.Message[]) {
      const status = await this.status();
      if (messages.some((m) => m.partial) && !status.partialSync)
        throw Error('Update the bridge for virtualized history.');
      if (status.sourceProtocol !== 2)
        throw Error('Update the local bridge for structured sync.');
      const result = await this.request('/v1/import', { messages });
      if (
        !Number.isSafeInteger(result.added) ||
        Number(result.added) < 0 ||
        Number(result.added) > messages.length
      )
        throw Error('Invalid import receipt.');
      return { added: Number(result.added) };
    }
    async claim(): Promise<{ job: MuseBridge.Job | null }> {
      const { job } = await this.request('/v1/claim', {});
      if (job === null) return { job: null };
      const j = record(job);
      if (
        typeof j.id !== 'string' ||
        !j.id ||
        typeof j.prompt !== 'string' ||
        !j.prompt
      )
        throw Error('Invalid prompt.');
      return { job: { id: j.id, prompt: j.prompt } };
    }
    async complete(result: MuseBridge.Completion) {
      const status = await this.status();
      if (status.sourceProtocol === 2 && result.messages) {
        await this.request('/v2/result', {
          id: result.id,
          messages: result.messages,
        });
      } else {
        await this.request('/v1/result', {
          id: result.id,
          text: result.text,
          ...(status.museSync ? { sources: result.sources || [] } : {}),
        });
      }
    }
    async block(id: string) {
      await this.request('/v1/block', { id });
    }
  }
  globalThis.BeeperMuseBridge = { LocalBridge };
})();
declare var BeeperMuseBridge: {
  LocalBridge: new (
    token: () => Promise<string | null>,
  ) => MuseBridge.Transport;
};
