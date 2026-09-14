const el = (id: string) => document.getElementById(id)!;
const history = el('history') as HTMLSelectElement;
el('version').textContent = 'v' + chrome.runtime.getManifest().version;
let actionError = '';
function connection(id: string, label: string, ready: boolean) {
  el(id).textContent = label;
  el(id).dataset.ready = String(ready);
}
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
    const beeperReady = s.phase === 'connected';
    connection(
      'beeper-state',
      !s.configured
        ? 'Needs setup'
        : beeperReady
          ? 'Connected'
          : s.phase === 'paused'
            ? 'Paused'
            : s.phase === 'conflict'
              ? 'Connection conflict'
              : s.failure || s.phase === 'error'
                ? 'Needs attention'
                : 'Connecting…',
      beeperReady,
    );
    connection(
      'muse-state',
      s.health === 'reload'
        ? 'Refresh the page'
        : s.connected
          ? s.health === 'draft'
            ? 'Message box has a draft'
            : s.health === 'busy'
              ? 'Muse is responding'
              : 'Connected'
          : 'Not connected',
      s.connected,
    );
    el('status').textContent = !s.configured
      ? 'Import your Beeper registration to begin.'
      : s.phase === 'connected'
        ? s.connected
          ? 'Connected to Beeper and Muse.'
          : 'Beeper connected. Connect a Muse tab.'
        : s.phase === 'conflict'
          ? 'Another Beeper Muse instance is connected. Disable older copies or the connection test, then reconnect here.'
          : s.phase === 'paused'
            ? 'Paused. Open Connection settings below to reconnect.'
            : s.failure ||
              (s.phase === 'error' || s.phase === 'disconnected'
                ? 'Beeper is disconnected. Retrying automatically.'
                : (s.startup?.stage || 'Connecting to Beeper') + '…');
    el('startup-progress').textContent =
      !beeperReady && s.configured && s.phase !== 'paused'
        ? (s.retrySeconds && !s.starting
            ? `Retrying in ${s.retrySeconds}s. `
            : '') +
          (s.startup?.stage
            ? `${s.startup.stage} · ${s.startup.stageSeconds}s`
            : '')
        : '';
    el('startup-steps').textContent = (s.startup?.steps || []).join(' → ');
    if (document.activeElement !== history)
      history.value = s.historyMode || 'recent';
    el('progress').textContent =
      s.queued || s.pending || s.blocked
        ? `${s.queued || 0} queued · ${s.pending || 0} waiting for message keys · ${s.blocked || 0} interrupted`
        : beeperReady && s.connected
          ? 'Watching for new messages.'
          : '';
    el('connect').textContent = s.connected
      ? 'Muse tab connected'
      : 'Connect this Muse tab';
    el('connect').hidden = s.connected;
    el('disconnect').hidden = !s.connected && s.health !== 'reload';
    (el('rescan') as HTMLButtonElement).disabled = !s.connected || !beeperReady;
    (el('pause') as HTMLButtonElement).disabled = s.phase === 'paused';
    (el('resume') as HTMLButtonElement).disabled =
      beeperReady || s.phase === 'connecting' || s.starting;
    (el('connect') as HTMLButtonElement).disabled =
      s.connected || s.phase !== 'connected';
    if (s.health === 'reload')
      el('status').textContent =
        'Refresh the Muse webpage, then connect again.';
    if (s.connected && beeperReady && s.health === 'draft')
      el('status').textContent =
        'Send or clear your draft in Muse to resume sending from Beeper.';
    if (actionError) el('status').textContent = actionError;
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
  actionError = '';
  try {
    await send(type, extra);
    await refresh();
  } catch (error) {
    actionError = error instanceof Error ? error.message : 'Action failed.';
    el('status').textContent = actionError;
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
