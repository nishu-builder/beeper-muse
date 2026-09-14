// Beeper's appservice WebSocket v3 wire format is documented by the pinned
// mautrix implementation linked in docs/browser-runtime.md.
export interface Registration {
  homeserverURL: string;
  appserviceToken: string;
  registrationID: string;
}
export interface HeaderRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: Array<
      | { header: string; operation: 'set'; value: string }
      | { header: string; operation: 'remove'; value?: never }
    >;
  };
  condition: {
    urlFilter: string;
    isUrlFilterCaseSensitive: boolean;
    initiatorDomains: string[];
    resourceTypes: ['websocket'];
    tabIds?: number[];
  };
}
export interface Rules {
  updateSessionRules(change: {
    removeRuleIds: number[];
    addRules?: HeaderRule[];
  }): Promise<void>;
}
export const RULE_ID = 1;
export function endpoint(registration: Registration): string {
  const u = new URL(registration.homeserverURL);
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'matrix.beeper.com' ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^\/_hungryserv\/[a-z0-9._=-]+\/?$/.test(u.pathname)
  ) {
    throw new Error('Expected a Beeper homeserver URL.');
  }
  if (!/^sh-muse-probe-[a-f0-9]{12}$/.test(registration.registrationID)) {
    throw new Error('Use a separate Chrome probe registration.');
  }
  if (!/^[\x21-\x7e]{16,4096}$/.test(registration.appserviceToken)) {
    throw new Error('Invalid appservice credential.');
  }
  u.protocol = 'wss:';
  u.pathname =
    u.pathname.replace(/\/$/, '') + '/_matrix/client/unstable/fi.mau.as_sync';
  return u.href;
}
export function authenticationRule(
  registration: Registration,
  extensionID: string,
  processID: string,
): HeaderRule {
  if (
    !/^[a-p]{32}$/.test(extensionID) ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(processID)
  ) {
    throw new Error('Invalid extension connection identity.');
  }
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Authorization',
          operation: 'set',
          value: 'Bearer ' + registration.appserviceToken,
        },
        { header: 'X-Mautrix-Process-ID', operation: 'set', value: processID },
        { header: 'X-Mautrix-Websocket-Version', operation: 'set', value: '3' },
        // The appservice endpoint rejects the Chrome extension Origin. Match
        // the native, bearer-authenticated handshake on this exact socket only.
        { header: 'Origin', operation: 'remove' },
      ],
    },
    condition: {
      urlFilter: '|' + endpoint(registration) + '|',
      isUrlFilterCaseSensitive: true,
      initiatorDomains: [extensionID],
      resourceTypes: ['websocket'],
    },
  };
}
export type ProbeResult =
  'confirmed' | 'conflict' | 'failed' | 'timeout' | 'cancelled';
export interface Socket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
// A bounded handshake probe, not a message bridge. It never acknowledges a
// transaction: encrypted processing and a durable inbox must exist first.
export async function probe(
  registration: Registration,
  extensionID: string,
  rules: Rules,
  makeSocket: (url: string) => Socket,
  signal: AbortSignal,
  timeoutMs = 15000,
  report: (stage: string) => void = () => {},
): Promise<ProbeResult> {
  const rule = authenticationRule(
    registration,
    extensionID,
    crypto.randomUUID(),
  );
  let socket: Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) return 'cancelled';
    report('Installing authentication rule');
    await rules.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [rule],
    });
    report('Authentication rule installed');
    if (signal.aborted) return 'cancelled';
    return await new Promise<ProbeResult>((resolve, reject) => {
      let settled = false;
      const finish = (result: ProbeResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      stop = () => finish('cancelled');
      signal.addEventListener('abort', stop, { once: true });
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      try {
        report('Opening WebSocket');
        socket = makeSocket(endpoint(registration));
      } catch {
        reject(new Error('Could not open connection.'));
        return;
      }
      socket.onopen = () => {
        report('WebSocket upgraded; sending protocol ping');
        try {
          socket!.send(
            JSON.stringify({
              id: 1,
              command: 'ping',
              data: { timestamp: Date.now() },
            }),
          );
        } catch {
          report('Could not send protocol ping');
          finish('failed');
        }
      };
      socket.onerror = () => {
        report('WebSocket connection error');
        finish('failed');
      };
      socket.onclose = ({ code }) => {
        report(
          'WebSocket closed (' +
            (Number.isInteger(code) ? code : 'unknown') +
            ')',
        );
        finish(code === 4001 ? 'conflict' : 'failed');
      };
      socket.onmessage = ({ data }) => {
        if (typeof data !== 'string' || data.length > 1024 * 1024) {
          finish('failed');
          return;
        }
        try {
          const message: unknown = JSON.parse(data);
          if (
            !message ||
            typeof message !== 'object' ||
            Array.isArray(message)
          ) {
            report('Invalid protocol message');
            finish('failed');
            return;
          }
          const m = message as Record<string, unknown>;
          if (
            m.command === 'connect' ||
            (m.command === 'response' && m.id === 1)
          ) {
            report('Beeper protocol confirmed');
            finish('confirmed');
          } else if (m.command === 'disconnect')
            finish(m.status === 'conn_replaced' ? 'conflict' : 'failed');
          else if (
            (m.command === 'transaction' || m.command === undefined) &&
            typeof m.txn_id === 'string'
          ) {
            // This also proves authentication. Leave it unacknowledged for a
            // future bridge to process; never silently consume account events.
            finish('confirmed');
          } else {
            report('Unexpected protocol command');
            finish('failed');
          }
        } catch {
          finish('failed');
        }
      };
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (stop) signal.removeEventListener('abort', stop);
    try {
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    } finally {
      await rules.updateSessionRules({ removeRuleIds: [RULE_ID] });
    }
  }
}
