(() => {
  'use strict';
  const muse = BeeperMuseDOM.create(document);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let polling = false;
  let activityEnabled = false;
  let rescanPending = false;
  let stopped = false;
  let generation = 0;
  let closeGuard = false;
  let popupOffered = false;
  let offeringPopup = false;
  const warnBeforeClosing = (event) => {
    event.preventDefault();
    event.returnValue = true;
  };
  function guardClosing(connected) {
    if (connected === closeGuard) return;
    closeGuard = connected;
    if (connected) window.addEventListener('beforeunload', warnBeforeClosing);
    else window.removeEventListener('beforeunload', warnBeforeClosing);
  }
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
  const activity = new BeeperMuseActivity.Reporter((value) =>
    activityEnabled
      ? send({ type: 'activity', activity: value })
      : Promise.resolve(),
  );
  const reportActivity = (view) =>
    activity
      .update(view?.activity || (view?.busy ? 'working' : 'idle'))
      .catch(() => {});
  let tracker = new BeeperMuseSync.Tracker(send, undefined, muse.prepare);
  async function offerPopup() {
    if (
      popupOffered ||
      offeringPopup ||
      stopped ||
      document.visibilityState !== 'visible' ||
      location.origin !== 'https://muse.ai' ||
      location.pathname !== '/'
    )
      return;
    offeringPopup = true;
    try {
      const result = await send({ type: 'offer-popup' });
      popupOffered = result.offered === true;
    } catch {
      // The toolbar remains available if Chrome cannot open a popup automatically.
    } finally {
      offeringPopup = false;
    }
  }
  async function execute(job, current, sourceProtocol) {
    const active = () => !stopped && generation === current;
    try {
      if (!active()) throw new Error('Tab disconnected.');
      const before = await muse.submit(job.prompt, wait, active);
      let stableSince = Date.now();
      let previous = '';
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline && active()) {
        await wait(1000);
        if (!active()) throw new Error('Tab disconnected.');
        const view = await muse.snapshot();
        if (!active()) throw new Error('Tab disconnected.');
        await reportActivity(view);
        if (!active()) throw new Error('Tab disconnected.');
        if (view.draft.trim()) throw new Error('A new draft was entered.');
        const answer = BeeperMuseSync.responseAfter(before, job.prompt, view);
        if (view.busy || !answer || answer !== previous) {
          previous = answer || '';
          stableSince = Date.now();
          continue;
        }
        if (Date.now() - stableSince >= 4000) {
          const candidates = BeeperMuseSync.messages(view).filter(
            (message) => !before.has(message.id),
          );
          const echoIndex = candidates.findIndex(
            (message) => message.role === 'user',
          );
          if (echoIndex < 0) throw new Error('Prompt echo unavailable.');
          const observed = candidates.slice(echoIndex, echoIndex + 20);
          const sources = await Promise.all(
            observed.map(BeeperMuseSync.fingerprint),
          );
          const messages =
            sourceProtocol === 2
              ? await BeeperMuseSync.prepareBatch(
                  observed.map((message) => ({
                    ...message,
                    observedAtMs: Date.now(),
                    historical: false,
                  })),
                  muse.prepare,
                )
              : undefined;
          // Retrying a result is safe: the relay accepts it idempotently. Never
          // repeat a claim or a Muse send after an uncertain network result.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              if (!active()) throw new Error('Tab disconnected.');
              await send({
                type: 'result',
                id: job.id,
                text: answer,
                sources,
                messages,
              });
              tracker.remember(sources);
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
    } finally {
      await reportActivity(null);
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
      if (stopped || generation !== current) return;
      activityEnabled = connected.activitySync === true;
      guardClosing(connected.connected);
      if (!connected.connected) return;
      if (rescanPending) {
        tracker = new BeeperMuseSync.Tracker(send, undefined, muse.prepare);
        rescanPending = false;
      }
      const view = await muse.snapshot();
      if (stopped || generation !== current) return;
      await reportActivity(view);
      if (stopped || generation !== current) return;
      if (connected.museSync) {
        try {
          await tracker.sync(
            view,
            connected.historyMode,
            () => !stopped && current === generation,
          );
        } catch {
          // Import failures must not prevent a queued Beeper prompt from running.
        }
      }
      if (stopped || current !== generation) return;
      if (view.busy || view.draft.trim()) return;
      const result = await send({ type: 'claim' });
      if (result.job)
        await execute(result.job, current, connected.sourceProtocol);
    } catch {
      await reportActivity(null);
      /* Keep private data and server failures out of page logs. */
    } finally {
      polling = false;
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'probe') {
      respond({
        protocol: 6,
        health: health(),
        progress: tracker.progress,
        rescanning: rescanPending,
      });
      return;
    }
    if (message.type === 'rescan') {
      rescanPending = true;
      respond({ ok: true });
      void poll();
      return;
    }
    if (message.type === 'stop') {
      stopped = true;
      generation++;
      void reportActivity(null);
      guardClosing(false);
      respond({ protocol: 6 });
    }
    if (message.type === 'start') {
      stopped = false;
      tracker = new BeeperMuseSync.Tracker(send, undefined, muse.prepare);
      const state = health();
      guardClosing(state !== 'unavailable');
      respond({ protocol: 6, health: state });
      void poll();
    }
  });
  let pulsing = false;
  async function pulseActivity() {
    if (pulsing || stopped || !closeGuard || !activityEnabled) return;
    pulsing = true;
    const current = generation;
    try {
      const view = await muse.snapshot();
      if (stopped || current !== generation || !closeGuard) return;
      await reportActivity(view);
    } catch {
      await reportActivity(null);
    } finally {
      pulsing = false;
    }
  }
  setInterval(() => void pulseActivity(), 2000);
  document.addEventListener('visibilitychange', () => void offerPopup());
  window.addEventListener('pagehide', () => void reportActivity(null));
  window.addEventListener('focus', () => void offerPopup());
  void offerPopup();
  setInterval(() => void poll(), 2000);
})();
