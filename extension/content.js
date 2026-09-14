(() => {
  'use strict';
  globalThis.__beeperMuseContent?.dispose();
  const muse = BeeperMuseDOM.create(document);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let polling = false;
  let activityEnabled = false;
  let profiling = false;
  let profileCheckedAt = -Infinity;
  let activityCheckedAt = -Infinity;
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
  const send = async (message) => {
    if (!chrome.runtime.id) {
      dispose();
      throw new Error('Extension updated.');
    }
    return chrome.runtime.sendMessage(message).then((result) => {
      if (!result?.ok) throw new Error('Local connector request failed.');
      return result;
    });
  };
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
  function diagnostic(code, facts) {
    void send({ type: 'diagnostic', code, facts }).catch(() => {});
  }
  function checkUpload() {
    try {
      diagnostic('image-readiness', muse.imageReadiness?.());
    } catch {}
  }
  async function syncProfile(current) {
    if (profiling || !muse.profile || Date.now() - profileCheckedAt < 30000)
      return;
    profiling = true;
    profileCheckedAt = Date.now();
    try {
      const profile = await muse.profile();
      if (stopped || current !== generation || !closeGuard) return;
      if (profile) await send({ type: 'profile', avatar: profile.avatar });
      else diagnostic('avatar-source-missing');
    } catch {
      diagnostic('avatar-failed');
    } finally {
      profiling = false;
    }
  }
  async function execute(job, current, sourceProtocol, deliveryStatus) {
    const active = () => !stopped && generation === current;
    try {
      if (!active()) throw new Error('Tab disconnected.');
      if (job.image && !muse.submitImage)
        throw Object.assign(Error('Muse image uploads are unavailable.'), {
          code: 'image-adapter-unavailable',
        });
      if (job.image) checkUpload();
      diagnostic(job.image ? 'image-upload-start' : 'text-submit-start');
      const before = job.image
        ? await muse.submitImage(job.prompt, job.image, wait, active)
        : await muse.submit(job.prompt, wait, active);
      diagnostic(job.image ? 'image-submitted' : 'reply-wait');
      let confirmed = false;
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
        const echo = BeeperMuseSync.promptEcho(
          before,
          job.prompt,
          view,
          job.image?.name,
        );
        const answer = BeeperMuseSync.responseAfter(
          before,
          job.prompt,
          view,
          job.image?.name,
        );
        if (deliveryStatus && answer && echo && !confirmed) {
          await send({ type: 'delivered', id: job.id, echo });
          confirmed = true;
        }
        if (view.busy || !answer || answer !== previous) {
          previous = answer || '';
          stableSince = Date.now();
          continue;
        }
        if (Date.now() - stableSince >= 4000) {
          diagnostic('reply-captured');
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
              diagnostic('reply-delivered');
              tracker.remember(sources);
              return;
            } catch {
              if (attempt === 2)
                throw Object.assign(new Error('Result delivery failed.'), {
                  code: 'result-delivery-failed',
                });
              await wait(2000);
            }
          }
        }
      }
      throw Object.assign(
        new Error('Response timed out or the tab was disconnected.'),
        { code: 'reply-timeout' },
      );
    } catch (error) {
      const code =
        error?.message === 'Another message was entered in the Muse tab.'
          ? 'reply-attribution'
          : error?.code || 'source-interrupted';
      if (job.image) checkUpload();
      diagnostic(code);
      await send({ type: 'block', id: job.id, code }).catch(() => {});
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
      if (connected.profileSync === true) void syncProfile(current);
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
        await execute(
          result.job,
          current,
          connected.sourceProtocol,
          connected.deliveryStatus === true,
        );
    } catch {
      await pulseActivity();
      /* Keep private data and server failures out of page logs. */
    } finally {
      polling = false;
    }
  }
  const listener = (message, _sender, respond) => {
    if (message.type === 'prepare-update') {
      let ready = false;
      try {
        ready =
          !polling &&
          !pulsing &&
          !profiling &&
          health() !== 'busy' &&
          health() !== 'unavailable';
      } catch {}
      if (ready) {
        stopped = true;
        generation++;
        guardClosing(false);
      }
      respond({ ok: true, ready });
      return;
    }
    if (message.type === 'activity-pulse') {
      respond({ ok: true });
      void pulseActivity();
      return;
    }
    if (message.type === 'check-upload') {
      checkUpload();
      respond({ ok: true });
      return;
    }
    if (message.type === 'probe') {
      respond({
        protocol: 17,
        health: health(),
        active: !stopped && closeGuard,
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
      respond({ protocol: 17 });
    }
    if (message.type === 'start') {
      stopped = false;
      tracker = new BeeperMuseSync.Tracker(send, undefined, muse.prepare);
      const state = health();
      guardClosing(state !== 'unavailable');
      respond({ protocol: 17, health: state });
      checkUpload();
      void poll();
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  let pulsing = false;
  async function pulseActivity() {
    if (pulsing || stopped || !closeGuard || !activityEnabled) return;
    pulsing = true;
    const current = generation;
    try {
      if (Date.now() - activityCheckedAt >= 30000 && muse.activityReadiness) {
        try {
          diagnostic('activity-readiness', muse.activityReadiness());
        } catch {}
        activityCheckedAt = Date.now();
      }
      const value = muse.activity
        ? await muse.activity()
        : ((view) => view.activity || (view.busy ? 'working' : 'idle'))(
            await muse.snapshot(),
          );
      if (stopped || current !== generation || !closeGuard) return;
      await reportActivity({ activity: value });
    } catch {
      // An unreadable source is unknown, not evidence that Muse stopped working.
      // The server's short typing lease expires if observations cannot resume.
      diagnostic('activity-unavailable');
    } finally {
      pulsing = false;
    }
  }
  const pulseTimer = setInterval(() => {
    if (!chrome.runtime.id) dispose();
    else void pulseActivity();
  }, 2000);
  const pollTimer = setInterval(() => void poll(), 2000);
  const offerListener = () => void offerPopup();
  const hideListener = () => void reportActivity(null);
  document.addEventListener('visibilitychange', offerListener);
  window.addEventListener('pagehide', hideListener);
  window.addEventListener('focus', offerListener);
  function dispose() {
    stopped = true;
    generation++;
    guardClosing(false);
    clearInterval(pulseTimer);
    clearInterval(pollTimer);
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      /* Old extension context. */
    }
    document.removeEventListener('visibilitychange', offerListener);
    window.removeEventListener('pagehide', hideListener);
    window.removeEventListener('focus', offerListener);
  }
  globalThis.__beeperMuseContent = { dispose };
  void offerPopup();
})();
