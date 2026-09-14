const status = document.getElementById('status');
const labels = {
  idle: 'Ready',
  connecting: 'Connecting directly to Beeper…',
  confirmed: 'Authenticated Beeper connection confirmed.',
  conflict: 'Another connection owns this registration. Test stopped.',
  failed: 'Connection test failed.',
  timeout: 'Connection timed out.',
  cancelled: 'Test stopped.',
};
const show = (result) => {
  status.textContent = labels[result] || 'Could not read test status.';
};
const run = async () => {
  show('connecting');
  try {
    show((await chrome.runtime.sendMessage({ type: 'probe' })).result);
  } catch {
    show('failed');
  }
};
document.getElementById('connect').onclick = run;
document.getElementById('stop').onclick = () =>
  chrome.runtime.sendMessage({ type: 'stop' });
chrome.runtime
  .sendMessage({ type: 'status' })
  .then((r) => {
    if (
      new URLSearchParams(location.search).get('autorun') === '1' &&
      r.result === 'idle'
    )
      void run();
    else show(r.result);
  })
  .catch(() => show('failed'));
