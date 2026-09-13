const bridgeURL = 'http://127.0.0.1:24819';
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
async function request(key, path, body) {
  if (!key) throw new Error('Pair the extension first.');
  const response = await fetch(bridgeURL + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Bridge unavailable.');
  return response.json();
}
async function api(path, body) {
  return request(await token(), path, body);
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
  if (tabID)
    await chrome.tabs.sendMessage(tabID, { type: 'stop' }).catch(() => {});
}
async function tabHealth(tabID, type = 'probe') {
  try {
    const result = await chrome.tabs.sendMessage(tabID, { type });
    if (
      result?.protocol === 1 &&
      ['ready', 'busy', 'draft', 'unavailable'].includes(result.health)
    )
      return result.health;
  } catch {
    // A tab opened before extension reload has no usable content script.
  }
  return 'reload';
}
const tabReady = (health) => ['ready', 'busy', 'draft'].includes(health);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid sender.');
    const popup =
      !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
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
        const status = await request(candidate, '/v1/status');
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
        const status = await api('/v1/status');
        const health = tabID ? await tabHealth(tabID) : 'disconnected';
        return {
          ok: true,
          paired: true,
          reachable: true,
          attached: !!tabID,
          connected: tabReady(health),
          health,
          phase: status.phase,
          queued: status.queued,
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
      await api('/v1/status');
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !museURL(tab.url))
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
      await chrome.storage.session.set({ tabID: tab.id });
      if (!tabReady(await tabHealth(tab.id, 'start'))) {
        await chrome.storage.session.remove('tabID');
        return {
          ok: false,
          error: 'Refresh the Muse webpage, then click Connect again.',
        };
      }
      return { ok: true };
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
    if (message.type === 'connected') return { ok: true, connected: true };
    if (message.type === 'claim')
      return { ok: true, ...(await api('/v1/claim', {})) };
    if (
      message.type === 'result' &&
      typeof message.id === 'string' &&
      typeof message.text === 'string'
    ) {
      await api('/v1/result', { id: message.id, text: message.text });
      return { ok: true };
    }
    if (message.type === 'block' && typeof message.id === 'string') {
      await api('/v1/block', { id: message.id });
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
  const saved = await chrome.storage.session.get('tabID');
  if (saved.tabID === tabID) await chrome.storage.session.remove('tabID');
});
