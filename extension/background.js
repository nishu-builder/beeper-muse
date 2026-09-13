let configPromise;
async function config() {
  configPromise ||= fetch(chrome.runtime.getURL('local-config.json'))
    .then((r) => r.json())
    .then((c) => {
      if (
        c.baseURL !== 'http://127.0.0.1:24819' ||
        !/^[a-f0-9]{64}$/.test(c.token)
      )
        throw new Error('Run setup again.');
      return c;
    });
  return configPromise;
}
async function api(path, body) {
  const c = await config();
  const response = await fetch(c.baseURL + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Connector unavailable.');
  return response.json();
}
function museURL(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://muse.ai' && url.pathname === '/';
  } catch {
    return false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid sender.');
    const saved = await chrome.storage.session.get('tabID');
    const popup =
      !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (popup && message.type === 'attach') {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || !museURL(tab.url))
        throw new Error('Open your main Muse chat first.');
      if (saved.tabID && saved.tabID !== tab.id)
        await chrome.tabs
          .sendMessage(saved.tabID, { type: 'stop' })
          .catch(() => {});
      await chrome.storage.session.set({ tabID: tab.id });
      await chrome.tabs.sendMessage(tab.id, { type: 'start' });
      return { ok: true };
    }
    if (popup && message.type === 'detach') {
      if (saved.tabID)
        await chrome.tabs
          .sendMessage(saved.tabID, { type: 'stop' })
          .catch(() => {});
      await chrome.storage.session.remove('tabID');
      return { ok: true };
    }
    if (popup && message.type === 'status')
      return {
        ok: true,
        connected: !!saved.tabID,
        ...(await api('/v1/status')),
      };
    if (!sender.tab || !museURL(sender.url) || sender.tab.id !== saved.tabID) {
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
  })().then(respond, () => respond({ ok: false }));
  return true;
});
chrome.tabs.onRemoved.addListener(async (tabID) => {
  const saved = await chrome.storage.session.get('tabID');
  if (saved.tabID === tabID) await chrome.storage.session.remove('tabID');
});
