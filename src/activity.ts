/** Ephemeral source activity. Never persisted or replayed as message history. */
(() => {
  class Reporter {
    private last?: Muse.Activity;
    private sentAt = 0;
    private desired: Muse.Activity = 'idle';
    private pending: Promise<void> = Promise.resolve();
    constructor(
      private send: (activity: Muse.Activity) => Promise<unknown>,
      private now = () => Date.now(),
    ) {}
    update(activity: Muse.Activity): Promise<void> {
      this.desired = activity;
      // Serialize transitions so an in-flight working heartbeat cannot overtake
      // a later idle signal. A failed update is retried on the next observation.
      this.pending = this.pending
        .catch(() => {})
        .then(async () => {
          const current = this.desired;
          if (
            current === this.last &&
            (current === 'idle' || this.now() - this.sentAt < 5000)
          )
            return;
          await this.send(current);
          this.last = current;
          this.sentAt = this.now();
        });
      return this.pending;
    }
  }
  globalThis.BeeperMuseActivity = { Reporter };
})();
declare var BeeperMuseActivity: {
  Reporter: new (
    send: (activity: Muse.Activity) => Promise<unknown>,
    now?: () => number,
  ) => {
    update(activity: Muse.Activity): Promise<void>;
  };
};
