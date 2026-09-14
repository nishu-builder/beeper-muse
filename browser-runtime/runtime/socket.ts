import {
  authenticationRule,
  endpoint,
  RULE_ID,
  type Registration,
} from '../transport.js';
export class BeeperSocket {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setInterval>;
  private lastReply = 0;
  private ping = 0;
  private handshake?: ReturnType<typeof setTimeout>;
  private confirmed = false;
  private stopped = false;
  private failed = false;
  constructor(
    private registration: Registration,
    private receive: (
      frame: string,
      send: (data: string) => void,
    ) => Promise<void>,
    private status: (
      state: 'connected' | 'disconnected' | 'conflict' | 'error',
      reason?: string,
    ) => void,
    private report: (stage: string) => void = () => {},
  ) {}
  private fail(reason: string) {
    this.failed = true;
    this.status('error', reason);
  }
  async start() {
    const rule = authenticationRule(
      this.registration,
      chrome.runtime.id,
      crypto.randomUUID(),
    );
    this.report('Installing Beeper connection headers');
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [rule as chrome.declarativeNetRequest.Rule],
    });
    if (this.stopped) return;
    this.report('Opening the Beeper WebSocket');
    const socket = (this.socket = new WebSocket(endpoint(this.registration)));
    this.handshake = setTimeout(() => {
      if (!this.confirmed && !this.stopped) {
        this.fail(
          'Beeper did not confirm the connection within 15 seconds. Retrying automatically.',
        );
        socket.close();
      }
    }, 15000);
    const send = (data: string) => {
      if (socket.readyState !== WebSocket.OPEN)
        throw Error('Beeper connection closed.');
      socket.send(data);
    };
    socket.onopen = () => {
      this.report('Waiting for Beeper protocol confirmation');
      this.lastReply = Date.now();
      const ping = () => {
        if (Date.now() - this.lastReply > 50000) {
          socket.close();
          return;
        }
        send(
          JSON.stringify({
            id: ++this.ping,
            command: 'ping',
            data: { timestamp: Date.now() },
          }),
        );
      };
      ping();
      this.timer = setInterval(ping, 20000);
    };
    socket.onmessage = ({ data }) => {
      if (typeof data !== 'string' || data.length > 1024 * 1024) {
        this.fail(
          'Beeper sent an invalid connection frame. Retrying automatically.',
        );
        socket.close();
        return;
      }
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(data);
      } catch {
        this.fail(
          'Beeper sent an unreadable connection frame. Retrying automatically.',
        );
        socket.close();
        return;
      }
      if (!m || typeof m !== 'object') {
        this.fail(
          'Beeper sent an invalid connection frame. Retrying automatically.',
        );
        socket.close();
        return;
      }
      if (
        (m.command === 'response' && m.id === this.ping) ||
        m.command === 'connect'
      ) {
        this.lastReply = Date.now();
        this.confirmed = true;
        if (this.handshake) clearTimeout(this.handshake);
        this.status('connected');
        return;
      }
      if (m.command === 'disconnect') {
        if (m.status === 'conn_replaced') {
          this.status('conflict');
          this.stopped = true;
        }
        socket.close();
        return;
      }
      if (!m.command || m.command === 'transaction')
        void this.receive(data, send).catch(() => {
          if (!this.stopped)
            this.fail(
              'Incoming Beeper messages could not be processed. Retrying automatically; saved messages are retained.',
            );
          socket.close();
        });
    };
    socket.onerror = () => {
      if (!this.stopped) {
        this.fail(
          'Chrome could not open the Beeper WebSocket. Retrying automatically.',
        );
        socket.close();
      }
    };
    socket.onclose = ({ code }) => {
      if (this.timer) clearInterval(this.timer);
      if (this.handshake) clearTimeout(this.handshake);
      if (code === 4001) {
        this.status('conflict');
        this.stopped = true;
      }
      if (!this.stopped && !this.failed)
        this.status(
          'disconnected',
          'Beeper disconnected. Retrying automatically.',
        );
    };
  }
  async stop() {
    this.stopped = true;
    if (this.handshake) clearTimeout(this.handshake);
    if (this.timer) clearInterval(this.timer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.close();
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
    });
  }
}
