const status = document.getElementById('status');
async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'status' });
    status.textContent = result?.ok
      ? `${result.connected ? 'Tab connected' : 'No tab connected'} · ${result.phase} · ${result.queued} queued`
      : 'Start the local connector, then connect a Muse tab.';
  } catch {
    status.textContent = 'Run setup and start the local connector.';
  }
}
document.getElementById('connect').onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'attach' });
  if (!result?.ok) {
    status.textContent =
      'Open the main Muse chat and reload it after installing this extension.';
    return;
  }
  await refresh();
};
document.getElementById('disconnect').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'detach' });
  await refresh();
};
void refresh();
