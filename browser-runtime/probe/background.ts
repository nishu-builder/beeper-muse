import {
  probe,
  type Registration,
  type Rules,
  type ProbeResult,
  type Socket,
  RULE_ID,
} from '../transport.js';
declare const chrome: {
  tabs: { create(options: { url: string }): Promise<unknown> };
  runtime: {
    onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    id: string;
    getURL(path: string): string;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { id?: string; url?: string },
          reply: (value: unknown) => void,
        ) => boolean,
      ): void;
    };
  };
  declarativeNetRequest: Rules;
};
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install')
    void chrome.tabs.create({
      url: chrome.runtime.getURL('popup.html?autorun=1'),
    });
});
let active: AbortController | undefined;
let result: ProbeResult | 'idle' | 'connecting' = 'idle';
// Session rules survive worker suspension, but must not outlive their socket.
const ready = chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [RULE_ID],
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    (sender.url !== chrome.runtime.getURL('popup.html') &&
      sender.url !== chrome.runtime.getURL('popup.html?autorun=1'))
  )
    return false;
  const m = message as { type?: string };
  if (m?.type === 'status') {
    reply({ result });
    return false;
  }
  if (m?.type === 'stop') {
    active?.abort();
    reply({ ok: true });
    return false;
  }
  if (m?.type !== 'probe') {
    reply({ ok: false });
    return false;
  }
  if (active) {
    reply({ result: 'connecting' });
    return false;
  }
  const controller = new AbortController();
  active = controller;
  result = 'connecting';
  void (async () => {
    try {
      await ready;
      // Private local experiment only. The public build does not contain this
      // file, and the extension never reads the production bridge's credentials.
      const response = await fetch(
        chrome.runtime.getURL('probe-registration.json'),
      );
      if (!response.ok) throw Error('Registration unavailable.');
      const registration = (await response.json()) as Registration;
      result = await probe(
        registration,
        chrome.runtime.id,
        chrome.declarativeNetRequest,
        (url) => new WebSocket(url) as Socket,
        controller.signal,
      );
    } catch {
      result = 'failed';
    } finally {
      active = undefined;
      reply({ result });
    }
  })();
  return true;
});
