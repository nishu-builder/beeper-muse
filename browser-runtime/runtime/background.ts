import { connectedBridgeState } from './bridge-metadata.js';
import { BrowserBridge } from './bridge.js';
import { configuration, type Configuration } from './matrix.js';
import { startupFailure } from './diagnostics.js';
import {
  DocumentSocket,
  CONNECTION_PAGE,
  CONNECTION_PORT,
} from './document-socket.js';
import { StartupProgress } from './startup.js';
let bridge: BrowserBridge | undefined;
let socket: DocumentSocket | undefined;
let starting: Promise<void> | undefined;
let phase = 'disconnected';
let failure = '';
const startup = new StartupProgress((stage) => {
  phase = 'error';
  failure =
    stage +
    ' has not finished after 60 seconds. Reload the extension to retry. Saved data has not been cleared.';
});
let retryAt = 0;
let failures = 0;
const secure = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
const museURL = (url?: string) => {
  try {
    const u = new URL(url!);
    return u.origin === 'https://muse.ai' && u.pathname === '/';
  } catch {
    return false;
  }
};
async function start() {
  await secure;
  if (starting) return starting;
  if (
    phase === 'connected' ||
    (phase === 'connecting' && socket) ||
    Date.now() < retryAt
  )
    return;
  starting = (async () => {
    const saved = await chrome.storage.local.get([
      'configuration',
      'enabled',
      'conflict',
    ]);
    if (!saved.configuration || saved.enabled === false || saved.conflict)
      return;
    const config = configuration(saved.configuration);
    phase = 'connecting';
    failure = '';
    startup.begin();
    try {
      if (socket) await socket.stop();
      if (!bridge)
        bridge = await BrowserBridge.open(
          config,
          chrome.runtime.getURL('crypto.wasm'),
          indexedDB,
          false,
          (value) => {
            startup.step(value);
          },
        );
      if ((await chrome.storage.local.get('enabled')).enabled === false) {
        startup.stop();
        bridge.pause();
        phase = 'paused';
        return;
      }
      bridge.resume();
      socket = new DocumentSocket(
        config,
        (frame, send) => bridge!.receive(frame, send),
        (state, reason) => {
          startup.stop();
          if (reason) failure = reason;
          phase = state;
          if (state === 'connected') {
            socket?.publishBridgeState(connectedBridgeState(config.owner));
            failure = '';
            failures = 0;
            retryAt = 0;
          }
          if (state === 'disconnected' || state === 'error') {
            retryAt =
              Date.now() +
              Math.min(300000, 5000 * 2 ** Math.min(failures++, 6));
          }
          if (state === 'conflict')
            void chrome.storage.local.set({ conflict: true });
        },
        (value) => startup.step(value),
      );
      await socket.start();
    } catch (error) {
      startup.stop();
      phase = 'error';
      failure =
        'Beeper could not start at ' +
        startup.snapshot().stage +
        '. ' +
        startupFailure(error) +
        ' Saved data has not been cleared.';
      retryAt =
        Date.now() + Math.min(300000, 10000 * 2 ** Math.min(failures++, 5));
    }
  })().finally(() => {
    starting = undefined;
  });
  return starting;
}
async function detach() {
  const { tabID } = await chrome.storage.session.get('tabID');
  await chrome.storage.session.remove('tabID');
  if (bridge) await bridge.activity('idle').catch(() => {});
  if (typeof tabID === 'number')
    await chrome.tabs.sendMessage(tabID, { type: 'stop' }).catch(() => {});
}
async function setConfig(value: unknown) {
  const config = configuration(value);
  const saved = await chrome.storage.local.get('configuration');
  if (
    saved.configuration &&
    JSON.stringify(saved.configuration) !== JSON.stringify(config)
  )
    throw Error(
      'Disconnect and export your current registration before replacing it.',
    );
  await chrome.storage.local.set({
    configuration: config,
    enabled: true,
    conflict: false,
  });
  retryAt = 0;
  await start();
}
async function report() {
  const { tabID } = await chrome.storage.session.get('tabID');
  const {
    configuration: config,
    historyMode,
    conflict,
    enabled,
  } = await chrome.storage.local.get([
    'configuration',
    'historyMode',
    'conflict',
    'enabled',
  ]);
  let tab: Record<string, unknown> = {};
  if (typeof tabID === 'number')
    try {
      tab = await chrome.tabs.sendMessage(tabID, { type: 'probe' });
    } catch {
      tab = { health: 'reload' };
    }
  const progress = bridge
    ? await bridge.status()
    : { queued: 0, blocked: 0, pending: 0 };
  return {
    ok: true,
    configured: !!config,
    phase: conflict ? 'conflict' : enabled === false ? 'paused' : phase,
    failure,
    startup: startup.snapshot(),
    starting: !!starting,
    retrySeconds: Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)),
    connected:
      !!tabID && ['ready', 'busy', 'draft'].includes(String(tab.health)),
    health: tab.health,
    progress: tab.progress,
    historyMode: historyMode || 'recent',
    ...progress,
  };
}
let offer: Promise<unknown> | undefined;
async function handle(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
) {
  await secure;
  if (sender.id !== chrome.runtime.id) throw Error('Invalid sender.');
  const popup =
    sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  if (popup) {
    if (message.type === 'status') {
      void start();
      return report();
    }
    if (message.type === 'configure') {
      await setConfig(message.configuration);
      return report();
    }
    if (message.type === 'resume') {
      await chrome.storage.local.set({ enabled: true, conflict: false });
      retryAt = 0;
      await start();
      return report();
    }
    if (message.type === 'pause') {
      await chrome.storage.local.set({ enabled: false });
      bridge?.pause();
      await detach();
      await starting;
      await socket?.stop();
      phase = 'paused';
      return report();
    }
    if (message.type === 'detach') {
      await detach();
      return { ok: true };
    }
    if (message.type === 'attach') {
      await start();
      if (!bridge || phase !== 'connected')
        throw Error('Wait for Beeper to connect.');
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !museURL(tab.url))
        throw Error('Open the main Muse chat first.');
      const health = await chrome.tabs
        .sendMessage(tab.id, { type: 'probe' })
        .catch(() => null);
      if (!health || !['ready', 'busy', 'draft'].includes(health.health))
        throw Error(
          'Refresh the Muse webpage and sign in, then connect again.',
        );
      await detach();
      const historyMode = ['recent', 'all', 'new'].includes(
        String(message.historyMode),
      )
        ? message.historyMode
        : 'recent';
      await chrome.storage.local.set({ historyMode });
      await chrome.storage.session.set({ tabID: tab.id });
      await chrome.tabs.sendMessage(tab.id, { type: 'start' });
      return { ok: true };
    }
    if (message.type === 'rescan') {
      const { tabID } = await chrome.storage.session.get('tabID');
      if (typeof tabID !== 'number') throw Error('Connect a Muse tab first.');
      if (['recent', 'all', 'new'].includes(String(message.historyMode)))
        await chrome.storage.local.set({ historyMode: message.historyMode });
      await chrome.tabs.sendMessage(tabID, { type: 'rescan' });
      return { ok: true };
    }
    if (message.type === 'resolve-blocked') {
      // Explicitly discard uncertain prompts, never silently resend them.
      if (typeof message.id !== 'string')
        throw Error('Choose an interrupted prompt.');
      await bridge?.resolve(message.id);
      return { ok: true };
    }
    throw Error('Unknown setup action.');
  }
  if (sender.frameId !== 0 || !sender.tab?.id || !museURL(sender.url))
    throw Error('Open the main Muse chat.');
  if (message.type === 'offer-popup') {
    if (offer) return { ok: true, offered: false };
    offer = (async () => {
      const saved = await chrome.storage.session.get(['tabID', 'offered']);
      const tabID = saved.tabID,
        offered = Array.isArray(saved.offered) ? saved.offered : [];
      if (tabID || offered.includes(sender.tab!.id))
        return { ok: true, offered: true };
      const [active] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!active || active.id !== sender.tab!.id)
        return { ok: true, offered: false };
      if (
        !(
          await chrome.runtime.getContexts({
            contextTypes: ['POPUP' as chrome.runtime.ContextType],
          })
        ).length
      )
        await chrome.action.openPopup({ windowId: active.windowId });
      await chrome.storage.session.set({
        offered: [...offered, sender.tab!.id],
      });
      return { ok: true, offered: true };
    })().finally(() => {
      offer = undefined;
    });
    return offer;
  }
  const { tabID } = await chrome.storage.session.get('tabID');
  if (sender.tab.id !== tabID) {
    if (message.type === 'connected') return { ok: true, connected: false };
    throw Error('This Muse tab is not connected.');
  }
  await start();
  if (!bridge || phase !== 'connected') throw Error('Beeper is reconnecting.');
  if (message.type === 'connected') {
    const { historyMode } = await chrome.storage.local.get('historyMode');
    return {
      ok: true,
      connected: true,
      museSync: true,
      sourceProtocol: 2,
      activitySync: true,
      partialSync: true,
      historyMode: historyMode || 'recent',
    };
  }
  if (message.type === 'import' && Array.isArray(message.messages))
    return {
      ok: true,
      ...(await bridge.importMessages(message.messages as Muse.Message[])),
    };
  if (
    message.type === 'activity' &&
    (message.activity === 'idle' || message.activity === 'working')
  ) {
    await bridge.activity(message.activity);
    return { ok: true };
  }
  if (message.type === 'claim') return { ok: true, ...(await bridge.claim()) };
  if (
    message.type === 'result' &&
    typeof message.id === 'string' &&
    Array.isArray(message.messages)
  ) {
    await bridge.complete({
      id: message.id,
      messages: message.messages as Muse.Message[],
    });
    return { ok: true };
  }
  if (message.type === 'block' && typeof message.id === 'string') {
    await bridge.block(message.id);
    return { ok: true };
  }
  throw Error('Unknown Muse action.');
}
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, sender, respond) => {
    void handle(message, sender).then(respond, () =>
      respond({
        ok: false,
        error:
          'Beeper Muse could not complete that action. Check the connection and refresh Muse.',
      }),
    );
    return true;
  },
);
chrome.alarms.onAlarm.addListener(() => {
  void start()
    .then(() => (phase === 'connected' ? bridge?.tick() : undefined))
    .catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create('beeper-muse-reconnect', { periodInMinutes: 0.5 });
  void start();
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('beeper-muse-reconnect', { periodInMinutes: 0.5 });
  // Private development builds can carry a local registration. Public builds do not.
  void secure
    .then(async () => {
      const saved = await chrome.storage.local.get('configuration');
      if (!saved.configuration) {
        const response = await fetch(
          chrome.runtime.getURL('local-config.json'),
        ).catch(() => null);
        if (response?.ok) await setConfig(await response.json());
      }
      await start();
    })
    .catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabID) => {
  void chrome.storage.session.get('tabID').then((saved) => {
    if (saved.tabID === tabID) return detach();
  });
});
void secure.then(() => start()).catch(() => {});
// Kept as a type check for the credential boundary; never exported to Muse.
export type { Configuration };

// Connections are accepted only from our own top-level extension document.
chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  if (
    port.name !== CONNECTION_PORT ||
    sender?.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL(CONNECTION_PAGE) ||
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id)
  ) {
    port.disconnect();
    return;
  }
  void start()
    .then(() => {
      if (socket) socket.accept(port);
      else port.disconnect();
    })
    .catch(() => port.disconnect());
});
