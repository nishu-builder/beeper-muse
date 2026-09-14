importScripts('bridge.js');
// Keep the pairing token out of content-script storage and Chrome Sync.
const storageReady = chrome.storage.local
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .then(
    () => true,
    () => false,
  );
async function token() {
  if (!(await storageReady)) throw new Error('Private storage unavailable.');
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken');
  return /^[a-f0-9]{64}$/.test(bridgeToken || '') ? bridgeToken : null;
}
const bridgeTransport = new BeeperMuseBridge.LocalBridge(token);
let activityRequests = Promise.resolve();
function publishActivity(activity, selectedTab) {
  activityRequests = activityRequests
    .catch(() => {})
    .then(async () => {
      if (selectedTab) {
        const { tabID } = await chrome.storage.session.get('tabID');
        if (tabID !== selectedTab) return;
      }
      await bridgeTransport.activity(activity);
    });
  return activityRequests;
}
function museURL(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://muse.ai' && url.pathname === '/';
  } catch {
    return false;
  }
}
async function detach() {
  const { tabID } = await chrome.storage.session.get('tabID');
  // Revoke access before notifying the tab, including when it has navigated away.
  await chrome.storage.session.remove('tabID');
  if (tabID) await publishActivity('idle').catch(() => {});
  if (tabID)
    await chrome.tabs.sendMessage(tabID, { type: 'stop' }).catch(() => {});
}
async function tabReport(tabID, type = 'probe') {
  try {
    const result = await chrome.tabs.sendMessage(tabID, { type });
    if (
      [6, 7, 8, 9].includes(result?.protocol) &&
      ['ready', 'busy', 'draft', 'unavailable'].includes(result.health)
    )
      return {
        health: result.health,
        progress: result.progress,
        rescanning: result.rescanning,
      };
  } catch {
    // A tab opened before extension reload has no usable content script.
  }
  return { health: 'reload' };
}
async function tabHealth(tabID, type = 'probe') {
  return (await tabReport(tabID, type)).health;
}
const tabReady = (health) => ['ready', 'busy', 'draft'].includes(health);
let openingPopup = false;
async function offerPopup(sender) {
  if (!sender.tab?.id || !museURL(sender.url) || (sender.frameId ?? 0) !== 0)
    throw new Error('Open the main Muse chat.');
  if (openingPopup) return { ok: true, offered: false };
  openingPopup = true;
  try {
    const [active] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (active?.id !== sender.tab.id) return { ok: true, offered: false };
    const { tabID, offeredTabs = [] } = await chrome.storage.session.get([
      'tabID',
      'offeredTabs',
    ]);
    if (tabID && tabReady(await tabHealth(tabID)))
      return { ok: true, offered: false };
    if (offeredTabs.includes(sender.tab.id)) return { ok: true, offered: true };
    if (
      (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length
    ) {
      await chrome.storage.session.set({
        offeredTabs: [...offeredTabs, sender.tab.id],
      });
      return { ok: true, offered: true };
    }
    const [current] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (current?.id !== sender.tab.id) return { ok: true, offered: false };
    await chrome.action.openPopup({ windowId: current.windowId });
    await chrome.storage.session.set({
      offeredTabs: [...offeredTabs, sender.tab.id],
    });
    return { ok: true, offered: true };
  } finally {
    openingPopup = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid sender.');
    const popup =
      !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (message.type === 'offer-popup') return offerPopup(sender);
    if (popup && message.type === 'pair') {
      const candidate =
        typeof message.token === 'string'
          ? message.token.trim().toLowerCase()
          : '';
      if (!/^[a-f0-9]{64}$/.test(candidate) || !(await storageReady))
        return {
          ok: false,
          error: 'Enter the 64-character code from your bridge.',
        };
      try {
        const status = await new BeeperMuseBridge.LocalBridge(
          async () => candidate,
        ).status();
        if (
          typeof status.phase !== 'string' ||
          !Number.isInteger(status.queued)
        )
          throw new Error('Invalid bridge response.');
      } catch {
        return {
          ok: false,
          error:
            'Start your bridge and check the pairing code, then try again.',
        };
      }
      await detach();
      await chrome.storage.local.set({ bridgeToken: candidate });
      return { ok: true };
    }
    if (popup && message.type === 'forget') {
      await detach();
      if (!(await storageReady))
        throw new Error('Private storage unavailable.');
      await chrome.storage.local.remove('bridgeToken');
      return { ok: true };
    }
    if (popup && message.type === 'status') {
      const paired = !!(await token());
      const { tabID } = await chrome.storage.session.get('tabID');
      if (!paired) return { ok: true, paired: false, connected: false };
      try {
        const status = await bridgeTransport.status();
        const report = tabID
          ? await tabReport(tabID)
          : { health: 'disconnected' };
        const health = report.health;
        const sync = await chrome.storage.session.get([
          'imported',
          'syncError',
        ]);
        const settings = await chrome.storage.local.get('historyMode');
        return {
          ok: true,
          paired: true,
          reachable: true,
          attached: !!tabID,
          connected: tabReady(health),
          health,
          progress: report.progress,
          rescanning: report.rescanning,
          phase: status.phase,
          queued: status.queued,
          museSync: status.museSync === true,
          sourceProtocol: status.sourceProtocol,
          activitySync: status.activitySync,
          partialSync: status.partialSync,
          historyMode: settings.historyMode || 'recent',
          imported: sync.imported || 0,
          syncError: sync.syncError || false,
        };
      } catch {
        return {
          ok: true,
          paired: true,
          reachable: false,
          attached: !!tabID,
          connected: false,
        };
      }
    }
    if (popup && message.type === 'attach') {
      const bridge = await bridgeTransport.status();
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      // Automatic popups don't grant activeTab; a Muse-only content script
      // can verify the page when Chrome does not expose its URL to the popup.
      if (!tab?.id || (tab.url && !museURL(tab.url)))
        return {
          ok: false,
          error: 'Open the main Muse chat in this Chrome window first.',
        };
      const health = await tabHealth(tab.id);
      if (!tabReady(health))
        return {
          ok: false,
          error:
            health === 'reload'
              ? 'Refresh the Muse webpage, then click Connect again. Reloading the extension alone is not enough.'
              : 'Sign in to Muse and open its main chat, then click Connect again.',
        };
      await detach();
      const historyMode = ['recent', 'all', 'new'].includes(message.historyMode)
        ? message.historyMode
        : 'recent';
      await chrome.storage.local.set({ historyMode });
      await chrome.storage.session.set({
        tabID: tab.id,
        museSync: bridge.museSync === true,
        sourceProtocol: bridge.sourceProtocol,
        imported: 0,
        syncError: false,
      });
      if (!tabReady(await tabHealth(tab.id, 'start'))) {
        await chrome.storage.session.remove('tabID');
        return {
          ok: false,
          error: 'Refresh the Muse webpage, then click Connect again.',
        };
      }
      return { ok: true };
    }
    if (popup && message.type === 'rescan') {
      const { tabID } = await chrome.storage.session.get('tabID');
      if (!tabID || !tabReady(await tabHealth(tabID)))
        return { ok: false, error: 'Connect a Muse tab first.' };
      const historyMode = ['recent', 'all', 'new'].includes(message.historyMode)
        ? message.historyMode
        : 'recent';
      await chrome.storage.local.set({ historyMode });
      return await chrome.tabs.sendMessage(tabID, { type: 'rescan' });
    }
    if (popup && message.type === 'detach') {
      await detach();
      return { ok: true };
    }
    const { tabID } = await chrome.storage.session.get('tabID');
    if (
      !sender.tab ||
      !museURL(sender.url) ||
      sender.tab.id !== tabID ||
      !(await token())
    ) {
      if (message.type === 'connected') return { ok: true, connected: false };
      throw new Error('This Muse tab is not connected.');
    }
    if (message.type === 'connected') {
      const bridge = await bridgeTransport.status();
      const { historyMode } = await chrome.storage.local.get('historyMode');
      return {
        ok: true,
        connected: true,
        museSync: bridge.museSync === true,
        sourceProtocol: bridge.sourceProtocol,
        activitySync: bridge.activitySync,
        historyMode: historyMode || 'recent',
      };
    }
    if (message.type === 'import' && Array.isArray(message.messages)) {
      try {
        const result = await bridgeTransport.importMessages(message.messages);
        const { imported = 0 } = await chrome.storage.session.get('imported');
        await chrome.storage.session.set({
          imported: imported + (result.added || 0),
          syncError: false,
        });
        return { ok: true };
      } catch {
        await chrome.storage.session.set({ syncError: true });
        throw new Error('Muse import unavailable.');
      }
    }
    if (
      message.type === 'activity' &&
      ['idle', 'working'].includes(message.activity)
    ) {
      await publishActivity(message.activity, sender.tab.id);
      return { ok: true };
    }
    if (message.type === 'claim')
      return { ok: true, ...(await bridgeTransport.claim()) };
    if (
      message.type === 'result' &&
      typeof message.id === 'string' &&
      typeof message.text === 'string'
    ) {
      await bridgeTransport.complete(message);
      return { ok: true };
    }
    if (message.type === 'block' && typeof message.id === 'string') {
      await bridgeTransport.block(message.id);
      return { ok: true };
    }
    throw new Error('Unknown request.');
  })().then(respond, () =>
    respond({
      ok: false,
      error: 'Check that your local bridge is running and try again.',
    }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener(async (tabID) => {
  const saved = await chrome.storage.session.get(['tabID', 'offeredTabs']);
  if (saved.tabID === tabID) await detach();
  if (saved.offeredTabs?.includes(tabID))
    await chrome.storage.session.set({
      offeredTabs: saved.offeredTabs.filter((id) => id !== tabID),
    });
});
