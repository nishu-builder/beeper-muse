const status = document.getElementById('status');
const pairing = document.getElementById('pairing');
const controls = document.getElementById('controls');
const code = document.getElementById('pair-code');
const connect = document.getElementById('connect');
const disconnect = document.getElementById('disconnect');
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
  else if (result.health === 'draft')
    status.textContent = `Connected · ${result.queued} queued. Clear the draft in Muse to continue.`;
  else if (result.health === 'busy')
    status.textContent = `Connected · ${result.queued} queued. Waiting for Muse to finish.`;
  else if (result.connected)
    status.textContent = `Connected · ${result.queued} queued. Send a message in Beeper.`;
  else status.textContent = 'Bridge ready. Open Muse and connect its tab.';
}
document.getElementById('pair-form').onsubmit = async (event) => {
  event.preventDefault();
  const button = document.getElementById('pair');
  button.disabled = true;
  const candidate = code.value;
  code.value = '';
  status.textContent = 'Checking your pairing code…';
  const result = await send({ type: 'pair', token: candidate });
  button.disabled = false;
  if (!result?.ok) {
    status.textContent = result?.error || 'Could not pair with the bridge.';
    return;
  }
  await refresh();
};
connect.onclick = async () => {
  connect.disabled = true;
  status.textContent = 'Connecting this Muse tab…';
  const result = await send({ type: 'attach' });
  if (!result?.ok) {
    connect.disabled = false;
    status.textContent = result?.error || 'Could not connect this Muse tab.';
    return;
  }
  await refresh();
};
disconnect.onclick = async () => {
  await send({ type: 'detach' });
  await refresh();
};
document.getElementById('forget').onclick = async () => {
  const result = await send({ type: 'forget' });
  if (!result?.ok) {
    status.textContent = result?.error || 'Could not remove the pairing.';
    return;
  }
  code.value = '';
  await refresh();
};
void refresh();
