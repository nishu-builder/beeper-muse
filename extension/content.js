(() => {
  'use strict';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let polling = false;
  let stopped = false;
  const send = (message) =>
    chrome.runtime.sendMessage(message).then((result) => {
      if (!result?.ok) throw new Error('Local connector request failed.');
      return result;
    });
  async function execute(job) {
    try {
      const before = await BeeperMuseDOM.submit(document, job.prompt, wait);
      let stableSince = Date.now();
      let previous = '';
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline && !stopped) {
        await wait(1000);
        const view = BeeperMuseDOM.snapshot(document);
        if (view.draft.trim()) throw new Error('A new draft was entered.');
        const answer = BeeperMuseDOM.responseAfter(before, job.prompt, view);
        if (view.busy || !answer || answer !== previous) {
          previous = answer || '';
          stableSince = Date.now();
          continue;
        }
        if (Date.now() - stableSince >= 4000) {
          // Retrying a result is safe: the relay accepts it idempotently. Never
          // repeat a claim or a Muse send after an uncertain network result.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await send({ type: 'result', id: job.id, text: answer });
              return;
            } catch {
              if (attempt === 2) throw new Error('Result delivery failed.');
              await wait(2000);
            }
          }
        }
      }
      throw new Error('Response timed out or the tab was disconnected.');
    } catch {
      await send({ type: 'block', id: job.id }).catch(() => {});
    }
  }
  async function poll() {
    if (
      polling ||
      stopped ||
      location.origin !== 'https://muse.ai' ||
      location.pathname !== '/'
    )
      return;
    polling = true;
    try {
      const connected = await send({ type: 'connected' });
      if (!connected.connected) return;
      const view = BeeperMuseDOM.snapshot(document);
      if (view.busy || view.draft.trim()) return;
      const result = await send({ type: 'claim' });
      if (result.job) await execute(result.job);
    } catch {
      /* Keep private data and server failures out of page logs. */
    } finally {
      polling = false;
    }
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'stop') stopped = true;
    if (message.type === 'start') {
      stopped = false;
      void poll();
    }
  });
  setInterval(() => void poll(), 2000);
})();
