import { isMuseURL } from './muse-tab.js';
import {
  connectedBridgeState,
  disconnectedBridgeState,
  type BridgeState,
} from './bridge-metadata.js';

export interface SourceConnectionAPI {
  beeperConnected(): boolean;
  selectedTab(): Promise<number | undefined>;
  tab(id: number): Promise<{ url?: string; discarded?: boolean }>;
  probe(
    id: number,
  ): Promise<{ protocol?: number; health?: string; active?: boolean }>;
}
export async function readSourceConnection(
  api: SourceConnectionAPI,
): Promise<boolean> {
  if (!api.beeperConnected()) return false;
  const id = await api.selectedTab();
  if (id === undefined) return false;
  const [tab, probe] = await Promise.all([api.tab(id), api.probe(id)]);
  const selected = await api.selectedTab();
  return (
    api.beeperConnected() &&
    selected === id &&
    isMuseURL(tab.url) &&
    !tab.discarded &&
    probe?.protocol === 19 &&
    probe.active === true &&
    ['ready', 'busy', 'draft'].includes(probe.health || '')
  );
}

/** Source liveness is separate from the Beeper transport and delivery receipts. */
export class SourceConnectionHealth {
  private checkedAt = -Infinity;
  private available = false;
  constructor(private now = () => Date.now()) {}
  observe(available: boolean) {
    this.available = available;
    this.checkedAt = this.now();
  }
  state(owner: string): BridgeState {
    const now = this.now();
    const age = now - this.checkedAt;
    return this.available && age >= 0 && age < 30000
      ? connectedBridgeState(owner, now)
      : disconnectedBridgeState(owner, now);
  }
}

/** A hung probe or a response from before detach must never renew Connected. */
export class SourceConnectionMonitor {
  private pending?: symbol;
  constructor(
    private probe: () => Promise<boolean>,
    private publish: (available: boolean) => void,
    private timeoutMs = 5000,
  ) {}
  invalidate() {
    this.pending = undefined;
    this.publish(false);
  }
  async tick() {
    if (this.pending) return;
    const token = Symbol();
    this.pending = token;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const available = await Promise.race([
        Promise.resolve()
          .then(this.probe)
          .catch(() => false),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), this.timeoutMs);
        }),
      ]);
      if (this.pending === token) this.publish(available === true);
    } finally {
      if (timer) clearTimeout(timer);
      if (this.pending === token) this.pending = undefined;
    }
  }
}
