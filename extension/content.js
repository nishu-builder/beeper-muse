(() => {
  'use strict';
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let polling = false;
  let stopped = false;
  let generation = 0;
  function health() {
    if (location.origin !== 'https://muse.ai' || location.pathname !== '/')
      return 'unavailable';
    try {
      const view = BeeperMuseDOM.snapshot(document);
      return view.busy ? 'busy' : view.draft.trim() ? 'draft' : 'ready';
    } catch {
      return 'unavailable';
    }
  }
  const send = (message) =>
    chrome.runtime.sendMessage(message).then((result) => {
      if (!result?.ok) throw new Error('Local connector request failed.');
      return result;
    });
  async function execute(job, current) {
    const active = () => !stopped && generation === current;
    try {
      if (!active()) throw new Error('Tab disconnected.');
      const before = await BeeperMuseDOM.submit(
        document,
        job.prompt,
        wait,
        active,
      );
      let stableSince = Date.now();
      let previous = '';
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline && active()) {
        await wait(1000);
        if (!active()) throw new Error('Tab disconnected.');
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
              if (!active()) throw new Error('Tab disconnected.');
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
    const current = generation;
    try {
      const connected = await send({ type: 'connected' });
      if (!connected.connected || stopped || generation !== current) return;
      const view = BeeperMuseDOM.snapshot(document);
      if (view.busy || view.draft.trim()) return;
      const result = await send({ type: 'claim' });
      if (result.job) await execute(result.job, current);
    } catch {
      /* Keep private data and server failures out of page logs. */
    } finally {
      polling = false;
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'probe') {
      respond({ protocol: 1, health: health() });
      return;
    }
    if (message.type === 'stop') {
      stopped = true;
      generation++;
      respond({ protocol: 1 });
    }
    if (message.type === 'start') {
      stopped = false;
      respond({ protocol: 1, health: health() });
      void poll();
    }
  });
  setInterval(() => void poll(), 2000);
})();
