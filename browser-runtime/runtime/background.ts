import { DiagnosticLog, failureCode } from './diagnostic-log.js';
import { Updates, localUpdate } from './updates.js';
import { ensureMuseTab, isMuseURL, resumeTicket } from './muse-tab.js';
declare const __BEEPER_MUSE_BUILD_ID__: string;
import { ActivityPulse } from './activity-pulse.js';
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
let applyingUpdate = false;
let handling = 0;
let restoring: Promise<void> | undefined;
const museTabs = {
  get: (id: number) => chrome.tabs.get(id),
  send: (id: number, message: { type: string }) =>
    chrome.tabs.sendMessage(id, message),
  inject: (id: number, files: string[]) =>
    chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      files,
    }),
};
const secure = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
const log = new DiagnosticLog(
  {
    get: async () =>
      (await chrome.storage.local.get('diagnosticEvents')).diagnosticEvents,
    set: async (entries) =>
      chrome.storage.local.set({ diagnosticEvents: entries }),
  },
  chrome.runtime.getManifest().version,
);
const museURL = isMuseURL;
async function start() {
  await secure;
  if (applyingUpdate) return;
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
          void log.record('beeper-' + state);
          if (state === 'connected') {
            socket?.publishBridgeState(connectedBridgeState(config.owner));
            failure = '';
            failures = 0;
            retryAt = 0;
            void restoreAfterUpdate();
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
      void log.record('startup-failed');
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
let reportedFailures = '';
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
    : { queued: 0, blocked: 0, pending: 0, diagnosticFailures: [] };
  const failureSignature = JSON.stringify(progress.diagnosticFailures);
  if (failureSignature !== reportedFailures) {
    reportedFailures = failureSignature;
    for (const code of new Set(progress.diagnosticFailures))
      void log.record(code);
  }
  return {
    ok: true,
    configured: !!config,
    phase: conflict ? 'conflict' : enabled === false ? 'paused' : phase,
    failure,
    update: updates.message,
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
  if (applyingUpdate && message.type !== 'status')
    throw Error('Update in progress.');
  const popup =
    sender.url === chrome.runtime.getURL('popup.html') && !sender.tab;
  if (popup) {
    if (message.type === 'status') {
      void start();
      return report();
    }
    if (message.type === 'open-diagnostics') {
      const url = chrome.runtime.getURL(CONNECTION_PAGE);
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['TAB' as chrome.runtime.ContextType],
      });
      const existing = contexts.find(
        (c) => c.documentUrl === url && c.tabId >= 0,
      );
      if (existing) await chrome.tabs.update(existing.tabId, { active: true });
      else await chrome.tabs.create({ url });
      const { tabID } = await chrome.storage.session.get('tabID');
      if (typeof tabID === 'number')
        await chrome.tabs
          .sendMessage(tabID, { type: 'check-upload' })
          .catch(() => {});
      return { ok: true };
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
      await ensureMuseTab(museTabs, tab.id);
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
      void log.record('job-dismissed');
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
  if (message.type === 'diagnostic') {
    await log.record(message.code, message.facts);
    return { ok: true };
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
      deliveryStatus: true,
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
  if (message.type === 'claim')
    return updates.pending
      ? { ok: true, job: null }
      : { ok: true, ...(await bridge.claim()) };
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
  if (
    message.type === 'delivered' &&
    typeof message.id === 'string' &&
    message.echo &&
    typeof message.echo === 'object'
  ) {
    await bridge.confirm(message.id, message.echo as Muse.Message);
    return { ok: true };
  }
  if (message.type === 'block' && typeof message.id === 'string') {
    await bridge.block(message.id, failureCode(message.code));
    return { ok: true };
  }
  throw Error('Unknown Muse action.');
}
chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>, sender, respond) => {
    handling++;
    void handle(message, sender)
      .finally(() => {
        handling--;
      })
      .then(respond, () =>
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
  void updates.tick();
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
      const pending = await chrome.storage.local.get('availableUpdate');
      if (pending.availableUpdate === chrome.runtime.getManifest().version)
        await chrome.storage.local.remove('availableUpdate');
      await start();
      await restoreAfterUpdate();
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

// Ask the selected tab for fresh activity independently of its throttled timers.
// The content script still checks connection/generation before reporting it.
const activityPulse = new ActivityPulse(
  async () => {
    if (phase !== 'connected' || !bridge) return;
    const { tabID } = await chrome.storage.session.get('tabID');
    if (Number.isInteger(tabID)) return tabID as number;
  },
  (tabID) => chrome.tabs.sendMessage(tabID, { type: 'activity-pulse' }),
);
setInterval(() => void activityPulse.tick(), 4000);

// A short-lived ticket exists only for an update we initiated. Ordinary browser
// startup does not choose an arbitrary Muse tab or erase crypto/session storage.
async function restoreAfterUpdate() {
  if (restoring) return restoring;
  if (phase !== 'connected' || applyingUpdate) return;
  restoring = (async () => {
    const saved = await chrome.storage.local.get([
      'updateResume',
      'enabled',
      'conflict',
    ]);
    if (!saved.updateResume) return;
    const ticket = resumeTicket(saved.updateResume);
    if (saved.enabled === false || saved.conflict || !ticket) {
      await chrome.storage.local.remove('updateResume');
      return;
    }
    try {
      await ensureMuseTab(
        {
          get: museTabs.get,
          send: (id, message) =>
            chrome.tabs.sendMessage(id, message, {
              documentId: ticket.documentID,
            }),
          inject: (id, files) =>
            chrome.scripting.executeScript({
              target: { tabId: id, documentIds: [ticket.documentID] },
              files,
            }),
        },
        ticket.tabID,
      );
      await chrome.storage.session.set({ tabID: ticket.tabID });
      await chrome.tabs.sendMessage(
        ticket.tabID,
        { type: 'start' },
        { documentId: ticket.documentID },
      );
      await chrome.storage.local.remove('updateResume');
    } catch {
      // Missing/discarded/loading tabs stay disconnected; a later retry may work.
    }
  })().finally(() => {
    restoring = undefined;
  });
  return restoring;
}
const development = chrome.management
  .getSelf()
  .then((info) => info.installType === 'development')
  .catch(() => false);
const updates = new Updates({
  async candidate() {
    await secure;
    if (await development) {
      const response = await fetch(chrome.runtime.getURL('dev-update.json'), {
        cache: 'no-store',
      }).catch(() => null);
      if (!response?.ok) return;
      return localUpdate(await response.json(), __BEEPER_MUSE_BUILD_ID__);
    }
    const { availableUpdate } =
      await chrome.storage.local.get('availableUpdate');
    return typeof availableUpdate === 'string' &&
      availableUpdate !== chrome.runtime.getManifest().version
      ? 'store:' + availableUpdate
      : undefined;
  },
  async ready() {
    if (starting || handling || applyingUpdate || restoring) return false;
    return !bridge || (await bridge.status()).claimed === 0;
  },
  async prepareSource() {
    const { tabID } = await chrome.storage.session.get('tabID');
    if (typeof tabID !== 'number' || !Number.isInteger(tabID)) return true;
    try {
      const reply = await chrome.tabs.sendMessage(tabID, {
        type: 'prepare-update',
      });
      return reply?.ready === true;
    } catch {
      // Do not guess whether an unreachable selected tab was in the middle of work.
      return false;
    }
  },
  async apply() {
    applyingUpdate = true;
    try {
      if (handling || starting || (bridge && (await bridge.status()).claimed))
        throw Error('Work started while preparing update.');
      const { tabID } = await chrome.storage.session.get('tabID');
      if (typeof tabID === 'number' && Number.isInteger(tabID)) {
        const [document] = await chrome.scripting.executeScript({
          target: { tabId: tabID, frameIds: [0] },
          func: () =>
            location.origin === 'https://muse.ai' && location.pathname === '/',
        });
        if (!document?.result || !document.documentId)
          throw Error('Muse navigated during update.');
        await chrome.storage.local.set({
          updateResume: {
            tabID,
            documentID: document.documentId,
            expires: Date.now() + 120000,
          },
        });
      }
      bridge?.pause();
      phase = 'updating';
      await socket?.stop();
      await bridge?.checkpoint();
      chrome.runtime.reload();
    } catch (error) {
      applyingUpdate = false;
      throw error;
    }
  },
  async recover() {
    applyingUpdate = false;
    const { enabled } = await chrome.storage.local.get('enabled');
    if (enabled === false) return;
    bridge?.resume();
    const { tabID } = await chrome.storage.session.get('tabID');
    if (typeof tabID === 'number' && Number.isInteger(tabID))
      await chrome.tabs.sendMessage(tabID, { type: 'start' }).catch(() => {});
    if (phase === 'updating') phase = 'disconnected';
    retryAt = 0;
    await start();
  },
});
chrome.runtime.onUpdateAvailable.addListener(({ version }) => {
  void secure
    .then(() => chrome.storage.local.set({ availableUpdate: version }))
    .then(() => updates.tick())
    .catch(() => {});
});
setInterval(() => {
  void updates.tick();
  void restoreAfterUpdate();
}, 5000);
