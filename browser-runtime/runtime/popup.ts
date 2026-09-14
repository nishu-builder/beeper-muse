const el = (id: string) => document.getElementById(id)!;
const history = el('history') as HTMLSelectElement;
async function send(type: string, extra: Record<string, unknown> = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...extra });
  if (!reply?.ok) throw Error(reply?.error || 'Beeper Muse is unavailable.');
  return reply;
}
async function refresh() {
  try {
    const s = await send('status');
    el('setup').hidden = s.configured;
    el('controls').hidden = !s.configured;
    el('status').textContent = !s.configured
      ? 'Import your Beeper registration to begin.'
      : s.phase === 'connected'
        ? s.connected
          ? 'Connected to Beeper and Muse.'
          : 'Beeper connected. Connect a Muse tab.'
        : s.phase === 'conflict'
          ? 'Another bridge owns this registration. Stop it, then reconnect here.'
          : s.phase === 'paused'
            ? 'Paused. Reconnect to resume.'
            : s.failure || 'Connecting to Beeper…';
    if (document.activeElement !== history)
      history.value = s.historyMode || 'recent';
    el('progress').textContent =
      `${s.queued || 0} queued · ${s.pending || 0} awaiting decryption · ${s.blocked || 0} interrupted`;
    el('connect').textContent = s.connected
      ? 'Muse tab connected'
      : 'Connect this Muse tab';
    (el('connect') as HTMLButtonElement).disabled =
      s.connected || s.phase !== 'connected';
    if (s.health === 'reload')
      el('status').textContent =
        'Refresh the Muse webpage, then connect again.';
    el('blocked').replaceChildren();
    for (const job of s.blockedJobs || []) {
      const p = document.createElement('p');
      p.textContent =
        'This prompt was interrupted. Check Muse before sending it again: ' +
        job.prompt;
      const button = document.createElement('button');
      button.textContent = 'I handled this in Muse';
      button.onclick = () => {
        void action('resolve-blocked', { id: job.id });
      };
      el('blocked').append(p, button);
    }
  } catch {
    el('status').textContent = 'Reload the extension, then reopen this panel.';
  }
}
async function action(type: string, extra: Record<string, unknown> = {}) {
  try {
    await send(type, extra);
    await refresh();
  } catch (error) {
    el('status').textContent =
      error instanceof Error ? error.message : 'Action failed.';
  }
}
for (const [id, type] of Object.entries({
  connect: 'attach',
  rescan: 'rescan',
  disconnect: 'detach',
  resume: 'resume',
  pause: 'pause',
}))
  el(id).onclick = () => {
    void action(type, { historyMode: history.value });
  };
(el('registration') as HTMLInputElement).onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file || file.size > 32768) {
    el('status').textContent =
      'Choose the small registration JSON file from setup.';
    return;
  }
  try {
    const value = JSON.parse(await file.text());
    input.value = '';
    await action('configure', { configuration: value });
  } catch {
    el('status').textContent = 'That registration file could not be read.';
  }
};
void refresh();
setInterval(() => void refresh(), 2000);
