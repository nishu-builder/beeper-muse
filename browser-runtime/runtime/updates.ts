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
  constructor(private hooks: UpdateHooks) {}
  async tick() {
    if (this.checking) return;
    this.checking = true;
    let prepared = false;
    try {
      const candidate = await this.hooks.candidate();
      this.pending = !!candidate;
      if (!candidate) {
        this.message = '';
        return;
      }
      this.message =
        'Update ready. Waiting for the current activity to finish.';
      if (!(await this.hooks.ready()) || !(await this.hooks.prepareSource()))
        return;
      prepared = true;
      // Recheck: a build may have started while the source was being stopped.
      if ((await this.hooks.candidate()) !== candidate) {
        await this.hooks.recover();
        return;
      }
      this.message =
        'Applying update. Your saved messages and keys are retained.';
      await this.hooks.apply();
    } catch {
      this.message =
        'Update could not finish. Retrying without clearing saved data.';
      if (prepared) await this.hooks.recover().catch(() => {});
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
