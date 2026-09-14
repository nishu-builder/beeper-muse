import { BeeperSocket } from './socket.js';
import { endpoint, type Registration } from '../transport.js';
import { CONNECTION_PORT } from './document-socket.js';
const status = document.getElementById('connection-status')!;
const stage = document.getElementById('connection-stage')!;
const pending = new Map<
  number,
  { resolve: () => void; reject: (error: Error) => void }
>();
let sequence = 0;
let socket: BeeperSocket | undefined;
let port: chrome.runtime.Port | undefined;
let sendToBeeper: ((data: string) => void) | undefined;
let changes = Promise.resolve();
let reconnect: ReturnType<typeof setTimeout> | undefined;
let leaving = false;
function serialized(action: () => Promise<void>) {
  changes = changes.then(action).catch(() => {
    status.textContent =
      'The Chrome connection could not start. Reconnect from the Beeper Muse popup.';
    try {
      port?.postMessage({
        type: 'state',
        state: 'error',
        reason: 'The Chrome connection tab could not initialize its socket.',
      });
    } catch {}
  });
}
async function closeSocket() {
  await socket?.stop();
  socket = undefined;
  sendToBeeper = undefined;
  for (const p of pending.values()) p.reject(Error('Connection restarted.'));
  pending.clear();
}
function connect() {
  if (leaving) return;
  const current = chrome.runtime.connect({ name: CONNECTION_PORT });
  port = current;
  let configured = false;
  const waiting = setTimeout(() => {
    if (!configured) disconnect();
  }, 10000);
  function lost() {
    clearTimeout(waiting);
    if (port !== current) return;
    port = undefined;
    status.textContent = 'Waiting for Beeper Muse to reconnect…';
    serialized(closeSocket);
    if (!leaving) reconnect = setTimeout(connect, 3000);
  }
  function disconnect() {
    current.disconnect();
    // Chrome notifies the other endpoint, not the caller of disconnect().
    lost();
  }
  current.onDisconnect.addListener(lost);
  current.onMessage.addListener((value: unknown) => {
    if (port !== current || !value || typeof value !== 'object') return;
    const m = value as Record<string, unknown>;
    if (m.type === 'pulse') {
      try {
        socket?.pulse();
        current.postMessage({ type: 'alive' });
      } catch {
        disconnect();
      }
    } else if (m.type === 'configure') {
      if (configured) return;
      configured = true;
      clearTimeout(waiting);
      serialized(async () => {
        await closeSocket();
        if (port !== current || leaving) return;
        const registration = m.registration as Registration;
        endpoint(registration);
        if (!Number.isInteger(m.tabId) || Number(m.tabId) < 0)
          throw Error('Invalid connection tab.');
        socket = new BeeperSocket(
          registration,
          (frame, send) => {
            if (port !== current || pending.size >= 128)
              return Promise.reject(Error('Connection queue unavailable.'));
            sendToBeeper = send;
            return new Promise<void>((resolve, reject) => {
              const id = ++sequence;
              pending.set(id, { resolve, reject });
              current.postMessage({ type: 'frame', id, frame });
            });
          },
          (state, reason) => {
            status.textContent =
              state === 'connected'
                ? 'Connected to Beeper. You can return to Muse.'
                : reason ||
                  (state === 'conflict'
                    ? 'Another instance is connected. Reconnect from the popup after closing it.'
                    : 'Connecting to Beeper…');
            if (port === current)
              current.postMessage({ type: 'state', state, reason });
          },
          (text) => {
            stage.textContent = text;
            if (port === current)
              current.postMessage({ type: 'stage', stage: text });
          },
          Number(m.tabId),
          true,
        );
        await socket.start();
      });
    } else if (
      m.type === 'send' &&
      typeof m.data === 'string' &&
      m.data.length <= 1024 * 1024
    ) {
      try {
        sendToBeeper?.(m.data);
      } catch {
        disconnect();
      }
    } else if (
      (m.type === 'processed' || m.type === 'failed') &&
      typeof m.id === 'number'
    ) {
      const item = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === 'processed') item?.resolve();
      else item?.reject(Error('Message processing failed.'));
    }
  });
}
// A restored or duplicate tab must never create a second socket for this registration.
void navigator.locks.request(
  'beeper-muse-socket-document',
  { ifAvailable: true },
  async (lock) => {
    if (!lock) {
      status.textContent =
        'Another connection tab is already running. You can close this duplicate.';
      return;
    }
    connect();
    window.addEventListener(
      'pagehide',
      () => {
        leaving = true;
        if (reconnect) clearTimeout(reconnect);
        port?.disconnect();
      },
      { once: true },
    );
    await new Promise<void>(() => {});
  },
);
