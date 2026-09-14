import { RULE_ID, type HeaderRule } from '../transport.js';
declare const chrome: {
  tabs: {
    create(options: { url: string }): Promise<unknown>;
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  runtime: {
    getURL(path: string): string;
    onInstalled: {
      addListener(listener: (details: { reason: string }) => void): void;
    };
    onStartup: { addListener(listener: () => void): void };
  };
  action: { onClicked: { addListener(listener: () => void): void } };
  declarativeNetRequest: {
    getSessionRules(): Promise<HeaderRule[]>;
    updateSessionRules(change: { removeRuleIds: number[] }): Promise<void>;
  };
};
const open = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?autorun=1') });
const clear = (tabId?: number) =>
  navigator.locks.request(
    'beeper-muse-connection-probe',
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      if (
        tabId === undefined ||
        rules.some(
          (r) => r.id === RULE_ID && r.condition.tabIds?.includes(tabId),
        )
      )
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [RULE_ID],
        });
    },
  );
chrome.runtime.onInstalled.addListener(({ reason }) => {
  void clear()
    .then(() => {
      if (reason === 'install') return open();
    })
    .catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void clear().catch(() => {});
});
chrome.action.onClicked.addListener(() => {
  void open();
});
// Page-owned rules are also scoped to its tab. A worker wakeup must not clear
// another live document's connection. Closed tabs cannot use retained rules.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clear(tabId).catch(() => {});
});
