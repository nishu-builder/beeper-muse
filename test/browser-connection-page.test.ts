import { connectedBridgeState } from '../browser-runtime/runtime/bridge-metadata.ts';
/// <reference types="chrome" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';
import {
  DocumentSocket,
  CONNECTION_PORT,
} from '../browser-runtime/runtime/document-socket.ts';

test('bundled connection page uses tab-scoped socket headers and relays only worker ACKs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let connectionAttempts = 0;
  const bundle = await build({
    entryPoints: ['browser-runtime/runtime/connection.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const extensionID = 'a'.repeat(32),
    url = `chrome-extension://${extensionID}/connection.html`;
  const c = {
    homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
    registrationID: 'sh-muse-chrome-012345abcdef',
    appserviceToken: 'synthetic-test-token',
  };
  const states: string[] = [],
    rules: any[] = [];
  let commit!: () => void;
  const durable = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const adapter = new DocumentSocket(
    c,
    async (_frame, send) => {
      await durable;
      send('{"command":"response","id":9,"data":{"txn_id":"tx"}}');
    },
    (state) => states.push(state),
    () => {},
  );
  class Port {
    name = CONNECTION_PORT;
    sender = { id: extensionID, url, tab: { id: 3 }, frameId: 0 };
    peer!: Port;
    listeners: Array<(m: unknown) => void> = [];
    closed = false;
    disconnectListeners: Array<() => void> = [];
    onMessage = {
      addListener: (fn: (m: unknown) => void) => this.listeners.push(fn),
    };
    onDisconnect = {
      addListener: (fn: () => void) => this.disconnectListeners.push(fn),
    };
    postMessage(m: unknown) {
      if (this.closed) throw Error('port closed');
      queueMicrotask(() => {
        if (!this.peer.closed) this.peer.listeners.forEach((fn) => fn(m));
      });
    }
    disconnect() {
      if (this.closed) return;
      this.closed = this.peer.closed = true;
      this.peer.disconnectListeners.forEach((fn) => fn());
    }
  }
  let network: FakeSocket | undefined;
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    onopen?: () => void;
    onmessage?: (e: { data: string }) => void;
    onclose?: (e: { code: number }) => void;
    closed = false;
    constructor() {
      network = this;
    }
    send(value: string) {
      this.sent.push(value);
    }
    close() {
      this.closed = true;
      this.onclose?.({ code: 1000 });
    }
  }
  const chromeMock = {
    runtime: {
      id: extensionID,
      getURL: (path: string) => `chrome-extension://${extensionID}/${path}`,
      getContexts: async () => [{ tabId: 3 }],
      connect: () => {
        const client = new Port(),
          server = new Port();
        client.peer = server;
        server.peer = client;
        if (++connectionAttempts > 1)
          queueMicrotask(() =>
            adapter.accept(server as unknown as chrome.runtime.Port),
          );
        return client;
      },
    },
    tabs: { reload: async () => {} },
    declarativeNetRequest: {
      updateSessionRules: async (change: unknown) => {
        rules.push(change);
      },
    },
  };
  const old = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: chromeMock,
  });
  const { window } = new JSDOM(
    '<p id="connection-status"></p><p id="connection-stage"></p>',
  );
  t.after(async () => {
    window.dispatchEvent(new window.Event('pagehide'));
    await adapter.stop();
    await new Promise((resolve) => setImmediate(resolve));
    window.close();
    if (old) Object.defineProperty(globalThis, 'chrome', old);
    else Reflect.deleteProperty(globalThis, 'chrome');
  });
  await adapter.start();
  runInNewContext(bundle.outputFiles[0]!.text, {
    document: window.document,
    window,
    navigator: {
      locks: {
        request: (
          _name: string,
          _options: unknown,
          fn: (lock: object) => void,
        ) => fn({}),
      },
    },
    chrome: chromeMock,
    WebSocket: FakeSocket,
    crypto: globalThis.crypto,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Boolean(network), false);
  t.mock.timers.tick(10000);
  t.mock.timers.tick(3000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connectionAttempts, 2);
  assert(network);
  assert.deepEqual(Array.from(rules[0].addRules[0].condition.tabIds), [3]);
  assert(
    rules[0].addRules[0].action.requestHeaders.some(
      (h: any) => h.header === 'Origin' && h.operation === 'remove',
    ),
  );
  network.readyState = 1;
  network.onopen!();
  network.onmessage!({ data: '{"command":"response","id":1}' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1), 'connected');
  adapter.publishBridgeState(
    connectedBridgeState('@test:beeper.com', 1700000000000),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(network.sent[1]!), {
    command: 'bridge_status',
    data: {
      state_event: 'CONNECTED',
      source: 'bridge',
      timestamp: 1700000000,
      ttl: 90,
      user_id: '@test:beeper.com',
      remote_id: 'browser',
      remote_name: 'Muse browser',
    },
  });
  network.onmessage!({
    data: '{"command":"transaction","id":9,"txn_id":"tx","events":[]}',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(network.sent.length, 2); // Ping and bridge status; no transaction ACK yet.
  commit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(network.sent[2]!).data.txn_id, 'tx');
  await adapter.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(network.closed, true);
});
