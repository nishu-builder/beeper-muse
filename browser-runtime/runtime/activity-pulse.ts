/** Requests a fresh source observation; never caches or invents working state. */
export class ActivityPulse {
  private pending = false;
  constructor(
    private selectedTab: () => Promise<number | undefined>,
    private request: (tabID: number) => Promise<unknown>,
  ) {}
  async tick() {
    if (this.pending) return;
    this.pending = true;
    try {
      const tabID = await this.selectedTab();
      if (tabID !== undefined) await this.request(tabID);
    } catch {
      // Closed/discarded tabs cannot renew typing; the remote event expires.
    } finally {
      this.pending = false;
    }
  }
}
