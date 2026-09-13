const status = document.getElementById('status');
const pairing = document.getElementById('pairing');
const controls = document.getElementById('controls');
const code = document.getElementById('pair-code');
const connect = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');
const history = document.getElementById('history-mode');
let settingsLoaded = false;
let actionPending = false;
let actionFailed = false;
async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return { ok: false, error: 'Reload the extension and try again.' };
  }
}
async function refresh() {
  const result = await send({ type: 'status' });
  if (!result?.ok) {
    status.textContent = result?.error || 'Cannot check the local bridge.';
    return;
  }
  pairing.hidden = result.paired;
  controls.hidden = !result.paired;
  history.disabled = result.connected;
  if (!settingsLoaded && result.historyMode) {
    history.value = result.historyMode;
    settingsLoaded = true;
  }
  connect.disabled = !result.reachable || result.connected;
  connect.textContent = result.connected
    ? 'Muse tab connected'
    : 'Connect this Muse tab';
  disconnect.disabled = !result.attached;
  if (!result.paired)
    status.textContent = 'First, pair with the bridge on this computer.';
  else if (!result.reachable)
    status.textContent = 'Paired. Start the local bridge to continue.';
  else if (result.phase === 'blocked')
    status.textContent =
      'A message needs attention. Follow Recovery in the setup guide.';
  else if (result.health === 'reload')
    status.textContent =
      'Refresh the Muse webpage, then connect again. Reloading the extension alone is not enough.';
  else if (result.health === 'unavailable')
    status.textContent =
      'Sign in to Muse and open its main chat, then connect again.';
  else if (
    result.connected &&
    (!result.museSync || result.sourceProtocol !== 2)
  )
    status.textContent =
      'Update and restart the local bridge to enable catch-up and new Muse messages.';
  else if (result.syncError)
    status.textContent =
      'Muse messages are waiting to be saved. Check the bridge; the extension will retry.';
  else if (result.health === 'draft')
    status.textContent = `Connected · ${result.queued} queued. Clear the draft in Muse to continue.`;
  else if (result.health === 'busy')
    status.textContent = `Connected · ${result.queued} queued. Waiting for Muse to finish.`;
  else if (result.connected)
    status.textContent = result.queued
      ? `Connected · ${result.queued} messages waiting for delivery to Beeper.`
      : `Connected · watching for new Muse messages. ${result.imported || 0} saved for delivery this session.`;
  else status.textContent = 'Bridge ready. Open Muse and connect its tab.';
}
document.getElementById('pair-form').onsubmit = async (event) => {
  event.preventDefault();
  actionPending = true;
  actionFailed = false;
  const button = document.getElementById('pair');
  button.disabled = true;
  const candidate = code.value;
  code.value = '';
  status.textContent = 'Checking your pairing code…';
  const result = await send({ type: 'pair', token: candidate });
  actionPending = false;
  button.disabled = false;
  if (!result?.ok) {
    actionFailed = true;
    status.textContent = result?.error || 'Could not pair with the bridge.';
    return;
  }
  await refresh();
};
connect.onclick = async () => {
  actionPending = true;
  actionFailed = false;
  connect.disabled = true;
  status.textContent = 'Connecting this Muse tab…';
  const result = await send({ type: 'attach', historyMode: history.value });
  actionPending = false;
  if (!result?.ok) {
    actionFailed = true;
    connect.disabled = false;
    status.textContent = result?.error || 'Could not connect this Muse tab.';
    return;
  }
  await refresh();
};
disconnect.onclick = async () => {
  actionPending = true;
  actionFailed = false;
  await send({ type: 'detach' });
  actionPending = false;
  await refresh();
};
document.getElementById('forget').onclick = async () => {
  actionPending = true;
  actionFailed = false;
  const result = await send({ type: 'forget' });
  actionPending = false;
  if (!result?.ok) {
    actionFailed = true;
    status.textContent = result?.error || 'Could not remove the pairing.';
    return;
  }
  code.value = '';
  await refresh();
};
void refresh();
setInterval(() => {
  if (!actionPending && !actionFailed) void refresh();
}, 2000);
