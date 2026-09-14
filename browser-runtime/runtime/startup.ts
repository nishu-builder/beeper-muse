// Observe a pending startup without abandoning it: racing a timeout against
// crypto initialization could leave a second writer opening the same keys.
export class StartupProgress {
  private timer?: ReturnType<typeof setTimeout>;
  private stage = '';
  private since = 0;
  private steps: string[] = [];
  constructor(private stalled: (stage: string) => void) {}
  begin() {
    this.stop();
    this.steps = [];
    this.step('Starting the Chrome connection');
  }
  step(stage: string) {
    this.stop();
    this.stage = stage;
    this.since = Date.now();
    this.steps = [...this.steps, stage].slice(-16);
    this.timer = setTimeout(() => this.stalled(stage), 60000);
  }
  stop() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  snapshot() {
    return {
      stage: this.stage,
      stageSeconds: Math.max(0, Math.floor((Date.now() - this.since) / 1000)),
      steps: [...this.steps],
    };
  }
}
