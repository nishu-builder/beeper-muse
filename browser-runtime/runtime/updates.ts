export const updateStages = [
  'idle',
  'checking',
  'waiting-work',
  'waiting-source',
  'rechecking',
  'applying',
  'recovering',
  'failed',
] as const;
export interface UpdateSnapshot {
  stage: (typeof updateStages)[number];
  elapsedMs: number;
  pending: boolean;
}
export interface UpdateHooks {
  candidate(): Promise<string | undefined>;
  ready(): Promise<boolean>;
  prepareSource(): Promise<boolean>;
  apply(): Promise<void>;
  recover(): Promise<void>;
}
/** Reloads only after work and the selected source have reached a safe boundary. */
export class Updates {
  pending = false;
  message = '';
  private checking = false;
  private stage: UpdateSnapshot['stage'] = 'idle';
  private stageAt: number;
  constructor(
    private hooks: UpdateHooks,
    private now = () => Date.now(),
  ) {
    this.stageAt = now();
  }
  private step(stage: UpdateSnapshot['stage']) {
    if (stage !== this.stage) {
      this.stage = stage;
      this.stageAt = this.now();
    }
  }
  snapshot(): UpdateSnapshot {
    return {
      stage: this.stage,
      elapsedMs: Math.min(86400000, Math.max(0, this.now() - this.stageAt)),
      pending: this.pending,
    };
  }
  async tick() {
    if (this.checking) return;
    this.checking = true;
    let prepared = false;
    try {
      this.step('checking');
      const candidate = await this.hooks.candidate();
      this.pending = !!candidate;
      if (!candidate) {
        this.message = '';
        this.step('idle');
        return;
      }
      this.message =
        'Update ready. Waiting for the current activity to finish.';
      this.step('waiting-work');
      if (!(await this.hooks.ready())) return;
      this.step('waiting-source');
      if (!(await this.hooks.prepareSource())) return;
      prepared = true;
      // Recheck: a build may have started while the source was being stopped.
      this.step('rechecking');
      if ((await this.hooks.candidate()) !== candidate) {
        this.step('recovering');
        await this.hooks.recover();
        return;
      }
      this.message =
        'Applying update. Your saved messages and keys are retained.';
      this.step('applying');
      await this.hooks.apply();
    } catch {
      this.message =
        'Update could not finish. Retrying without clearing saved data.';
      if (prepared) {
        this.step('recovering');
        await this.hooks.recover().catch(() => {});
      }
      this.step('failed');
    } finally {
      this.checking = false;
    }
  }
}
export function localUpdate(
  value: unknown,
  running: string,
): string | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (
    v.ready === true &&
    typeof v.build === 'string' &&
    /^[a-f0-9]{64}$/.test(v.build) &&
    v.build !== running
  )
    return 'local:' + v.build;
}
