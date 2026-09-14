import type { BridgeState } from './bridge-metadata.js';
import type { Registration } from '../transport.js';
export const CONNECTION_PAGE = 'connection.html';
export const CONNECTION_PORT = 'beeper-muse-connection';
type State = 'connected' | 'disconnected' | 'conflict' | 'error';

// Only the socket lives in the extension document. The worker remains the
// single owner of crypto, queues and Matrix delivery. No ACK is sent here.
export class DocumentSocket {
  private port?: chrome.runtime.Port;
  private stopped = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private registration: Registration,
    private receive: (
      frame: string,
      send: (data: string) => void,
    ) => Promise<void>,
    private status: (state: State, reason?: string) => void,
    private report: (stage: string) => void,
  ) {}
  async start() {
    this.report('Opening the Chrome connection tab');
    // Drive heartbeats from the worker, avoiding hidden-tab timer throttling.
    this.heartbeat = setInterval(() => {
      try {
        this.port?.postMessage({ type: 'pulse' });
      } catch {
        this.port?.disconnect();
      }
    }, 20000);
    this.timer = setTimeout(() => {
      if (!this.port && !this.stopped)
        this.status(
          'error',
          'The Chrome connection tab did not respond. Reopen the connection from this panel.',
        );
    }, 15000);
    const contexts = await chrome.runtime.getContexts({
      documentUrls: [chrome.runtime.getURL(CONNECTION_PAGE)],
    });
    if (this.stopped) return;
    const existingTab = contexts.find((context) => context.tabId >= 0);
    if (existingTab) {
      // Updating an unpacked extension can leave an old document alive. Reload
      // only our exact connection page so both ends use the current protocol.
      await chrome.tabs.reload(existingTab.tabId);
    } else if (!contexts.length)
      await chrome.tabs.create({
        url: chrome.runtime.getURL(CONNECTION_PAGE),
        active: false,
      });
  }
  accept(port: chrome.runtime.Port) {
    const sender = port.sender;
    if (
      this.stopped ||
      port.name !== CONNECTION_PORT ||
      sender?.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL(CONNECTION_PAGE) ||
      !Number.isInteger(sender.tab?.id) ||
      sender.frameId !== 0
    ) {
      port.disconnect();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.port?.disconnect();
    this.port = port;
    const send = (message: unknown) => {
      if (this.port !== port || this.stopped)
        throw Error('Connection tab closed.');
      port.postMessage(message);
    };
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = undefined;
      if (!this.stopped)
        this.status(
          'disconnected',
          'The Chrome connection tab closed or restarted. Retrying automatically.',
        );
    });
    port.onMessage.addListener((message: unknown) => {
      if (
        this.port !== port ||
        this.stopped ||
        !message ||
        typeof message !== 'object'
      )
        return;
      const m = message as Record<string, unknown>;
      if (m.type === 'alive') return;
      if (
        m.type === 'stage' &&
        typeof m.stage === 'string' &&
        m.stage.length < 200
      ) {
        this.report(m.stage);
      } else if (
        m.type === 'state' &&
        ['connected', 'disconnected', 'conflict', 'error'].includes(
          String(m.state),
        )
      ) {
        this.status(
          m.state as State,
          typeof m.reason === 'string' && m.reason.length < 400
            ? m.reason
            : undefined,
        );
      } else if (
        m.type === 'frame' &&
        Number.isSafeInteger(m.id) &&
        typeof m.frame === 'string' &&
        m.frame.length <= 1024 * 1024
      ) {
        const id = m.id;
        void this.receive(m.frame, (data) => send({ type: 'send', data }))
          .then(() => send({ type: 'processed', id }))
          .catch(() => {
            if (this.port === port && !this.stopped) {
              send({ type: 'failed', id });
              this.status(
                'error',
                'Incoming Beeper messages could not be processed. Saved messages are retained.',
              );
            }
          });
      }
    });
    send({
      type: 'configure',
      registration: this.registration,
      tabId: sender.tab!.id,
    });
  }
  publishBridgeState(state: BridgeState) {
    if (!this.port || this.stopped) return;
    this.port.postMessage({ type: 'bridge-state', state });
  }
  async stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.timer) clearTimeout(this.timer);
    this.port?.disconnect();
    this.port = undefined;
  }
}
