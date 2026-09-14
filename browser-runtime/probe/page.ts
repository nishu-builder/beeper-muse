import {
  endpoint,
  probe,
  type Registration,
  type Rules,
  type HeaderRule,
  type ProbeResult,
  type Socket,
  RULE_ID,
} from '../transport.js';
import {
  describeRequest,
  type RequestObservation,
  type RequestScope,
} from '../request-observation.js';
interface RequestEvent {
  addListener(
    listener: (event: RequestObservation) => void,
    filter: { urls: string[]; types: ['websocket']; tabId: number },
    extra?: string[],
  ): void;
  removeListener(listener: (event: RequestObservation) => void): void;
}
declare const chrome: {
  runtime: { id: string; getURL(path: string): string };
  tabs: { getCurrent(): Promise<{ id?: number } | undefined> };
  permissions: {
    contains(permission: { origins: string[] }): Promise<boolean>;
  };
  declarativeNetRequest: Rules & {
    testMatchOutcome(request: {
      url: string;
      initiator: string;
      tabId: number;
      type: 'websocket';
    }): Promise<{ matchedRules: Array<{ ruleId: number }> }>;
  };
  webRequest: {
    onSendHeaders: RequestEvent;
    onHeadersReceived: RequestEvent;
    onErrorOccurred: RequestEvent;
  };
};
const labels: Record<ProbeResult | 'idle' | 'connecting', string> = {
  idle: 'Ready',
  connecting: 'Connecting directly to Beeper…',
  confirmed: 'Authenticated Beeper connection confirmed.',
  conflict: 'Another connection owns this registration. Test stopped.',
  failed: 'Connection test failed.',
  timeout: 'Connection timed out.',
  cancelled: 'Test stopped.',
};
const status = document.getElementById('status')!;
const details = document.getElementById('details')!;
let active: AbortController | undefined;
let lines: string[] = ['Connection test 0.1.3 — extension document'];
const show = (result: keyof typeof labels) => {
  status.textContent = labels[result];
  details.textContent = lines.join('\n');
};
const report = (line: string) => {
  if (lines.length < 30 && !lines.includes(line)) lines.push(line);
  details.textContent = lines.join('\n');
};
async function run() {
  if (active) return;
  const abort = new AbortController();
  active = abort;
  lines = ['Connection test 0.1.3 — extension document'];
  show('connecting');
  try {
    report('Acquiring test ownership');
    await navigator.locks.request(
      'beeper-muse-connection-probe',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          report('Another test tab is running.');
          show('conflict');
          return;
        }
        const tab = await chrome.tabs.getCurrent();
        if (!Number.isInteger(tab?.id) || tab!.id! < 0) {
          report('Open this diagnostic as a browser tab.');
          throw Error('Tab required');
        }
        const tabId = tab!.id!;
        report('Checking WebSocket permission');
        if (
          !(await chrome.permissions.contains({
            origins: ['wss://matrix.beeper.com/*'],
          }))
        ) {
          report('Missing WebSocket permission. Reload the extension.');
          throw Error('Missing permission');
        }
        report('WebSocket permission granted');
        const response = await fetch(
          chrome.runtime.getURL('probe-registration.json'),
        );
        if (!response.ok) {
          report('Private test registration unavailable');
          throw Error('No registration');
        }
        const registration = (await response.json()) as Registration;
        const url = endpoint(registration),
          origin = chrome.runtime.getURL('').replace(/\/$/, '');
        report('Private test registration loaded');
        let scope: RequestScope = { url, origin, tabId, headers: [] };
        let observed = false;
        const observe = (request: RequestObservation) => {
          for (const line of describeRequest(scope, request)) {
            observed = true;
            report(line);
          }
        };
        report('Installing handshake diagnostics');
        if (!chrome.webRequest?.onSendHeaders) {
          report('Reload the extension to enable handshake diagnostics');
          throw Error('Missing diagnostic permission');
        }
        const events = [
          chrome.webRequest.onSendHeaders,
          chrome.webRequest.onHeadersReceived,
          chrome.webRequest.onErrorOccurred,
        ];
        const filter = {
          urls: [url],
          types: ['websocket'] as ['websocket'],
          tabId,
        };
        try {
          events[0]!.addListener(observe, filter, [
            'requestHeaders',
            'extraHeaders',
          ]);
          events[1]!.addListener(observe, filter);
          events[2]!.addListener(observe, filter);
          const rules: Rules = {
            async updateSessionRules(change) {
              const addRules = change.addRules?.map((rule): HeaderRule => ({
                ...rule,
                condition: { ...rule.condition, tabIds: [tabId] },
              }));
              await chrome.declarativeNetRequest.updateSessionRules({
                ...change,
                ...(addRules ? { addRules } : {}),
              });
              if (addRules?.length) {
                scope = {
                  ...scope,
                  headers: addRules[0]!.action.requestHeaders.flatMap((h) =>
                    h.operation === 'set' ? [h] : [],
                  ),
                };
                const match =
                  await chrome.declarativeNetRequest.testMatchOutcome({
                    url,
                    initiator: origin,
                    tabId,
                    type: 'websocket',
                  });
                if (!match.matchedRules.some((r) => r.ruleId === RULE_ID)) {
                  report('Authentication rule does not match this request');
                  throw Error('Rule mismatch');
                }
                report('Chrome rule match verified for this tab');
              }
            },
          };
          const result = await probe(
            registration,
            chrome.runtime.id,
            rules,
            (url) => new WebSocket(url) as Socket,
            abort.signal,
            15000,
            report,
          );
          if (!observed) report('Chrome did not expose handshake metadata');
          show(result);
        } finally {
          for (const event of events) event.removeListener(observe);
        }
      },
    );
  } catch {
    report('Test stopped at the preceding stage.');
    show('failed');
  } finally {
    active = undefined;
  }
}
document.getElementById('connect')!.onclick = () => {
  void run();
};
document.getElementById('stop')!.onclick = () => active?.abort();
addEventListener('pagehide', () => active?.abort());
show('idle');
if (new URLSearchParams(location.search).get('autorun') === '1') void run();
