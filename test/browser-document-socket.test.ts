/// <reference types="chrome" />
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DocumentSocket,
  CONNECTION_PORT,
} from '../browser-runtime/runtime/document-socket.ts';
const registration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
  registrationID: 'sh-muse-chrome-012345abcdef',
  appserviceToken: 'synthetic-test-token',
};
const extensionID = 'a'.repeat(32);
const page = `chrome-extension://${extensionID}/connection.html`;
class Port {
  name = CONNECTION_PORT;
  sender = { id: extensionID, url: page, tab: { id: 3 }, frameId: 0 };
  sent: any[] = [];
  closed = false;
  listeners: Array<(m: unknown) => void> = [];
  disconnectListeners: Array<() => void> = [];
  onMessage = {
    addListener: (fn: (m: unknown) => void) => this.listeners.push(fn),
  };
  onDisconnect = {
    addListener: (fn: () => void) => this.disconnectListeners.push(fn),
  };
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  disconnect() {
    if (!this.closed) {
      this.closed = true;
      for (const fn of this.disconnectListeners) fn();
    }
  }
  message(m: unknown) {
    for (const fn of this.listeners) fn(m);
  }
  asChrome() {
    return this as unknown as chrome.runtime.Port;
  }
}
function harness(t: import('node:test').TestContext, contexts: unknown[] = []) {
  const created: unknown[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        id: extensionID,
        getURL: (path: string) => `chrome-extension://${extensionID}/${path}`,
        getContexts: async () => contexts,
      },
      tabs: {
        create: async (input: unknown) => {
          created.push(input);
          return { id: 3 };
        },
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  });
  return { created };
}

test('connection document reuses a restored tab and rejects foreign ports before sending credentials', async (t) => {
  const h = harness(t, [{ tabId: 3 }]);
  const socket = new DocumentSocket(
    registration,
    async () => {},
    () => {},
    () => {},
  );
  await socket.start();
  assert.equal(h.created.length, 0);
  for (const change of [
    { url: 'https://muse.ai/' },
    { frameId: 1 },
    { id: 'b'.repeat(32) },
  ]) {
    const port = new Port();
    Object.assign(port.sender, change);
    socket.accept(port.asChrome());
    assert.equal(port.closed, true);
    assert.deepEqual(port.sent, []);
  }
  await socket.stop();
});

test('document transport waits for durable consumer ACK and isolates disconnected ports', async (t) => {
  const h = harness(t);
  let acknowledge: ((data: string) => void) | undefined;
  let complete: (() => void) | undefined;
  const states: string[] = [];
  const socket = new DocumentSocket(
    registration,
    async (_frame, send) => {
      acknowledge = send;
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
    },
    (state) => states.push(state),
    () => {},
  );
  await socket.start();
  assert.deepEqual(h.created, [{ url: page, active: false }]);
  const port = new Port();
  socket.accept(port.asChrome());
  assert.equal(port.sent[0].type, 'configure');
  assert.equal(port.sent[0].tabId, 3);
  port.message({ type: 'frame', id: 8, frame: '{"txn_id":"fixture"}' });
  assert.equal(port.sent.length, 1);
  acknowledge!('{"command":"response"}');
  assert.deepEqual(port.sent[1], {
    type: 'send',
    data: '{"command":"response"}',
  });
  complete!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(port.sent[2], { type: 'processed', id: 8 });
  await socket.stop();
  const count = port.sent.length;
  port.message({ type: 'state', state: 'connected' });
  assert.equal(port.sent.length, count);
  assert.deepEqual(states, []);
});

test('consumer failure never manufactures an ACK', async (t) => {
  harness(t);
  const states: string[] = [];
  const socket = new DocumentSocket(
    registration,
    async () => {
      throw Error('storage failed');
    },
    (state) => states.push(state),
    () => {},
  );
  await socket.start();
  const port = new Port();
  socket.accept(port.asChrome());
  port.message({ type: 'frame', id: 2, frame: '{}' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(port.sent.filter((m) => m.type === 'send').length, 0);
  assert.deepEqual(port.sent.at(-1), { type: 'failed', id: 2 });
  assert.equal(states.at(-1), 'error');
  await socket.stop();
});
