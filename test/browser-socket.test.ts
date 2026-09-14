/// <reference types="chrome" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { BeeperSocket } from '../browser-runtime/runtime/socket.ts';
import type { HeaderRule } from '../browser-runtime/transport.ts';
const registration = {
  homeserverURL: 'https://matrix.beeper.com/_hungryserv/test',
  registrationID: 'sh-muse-chrome-012345abcdef',
  appserviceToken: 'synthetic-test-token',
};
class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.latest = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  reply(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
async function harness(t: import('node:test').TestContext) {
  const changes: Array<{ removeRuleIds: number[]; addRules?: HeaderRule[] }> =
    [];
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'a'.repeat(32) },
      declarativeNetRequest: {
        updateSessionRules: async (change: {
          removeRuleIds: number[];
          addRules?: HeaderRule[];
        }) => {
          changes.push(change);
        },
      },
    },
  });
  const originalSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    'WebSocket',
  )!;
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: FakeSocket,
  });
  const states: string[] = [];
  const frames: string[] = [];
  const socket = new BeeperSocket(
    registration,
    async (frame, send) => {
      frames.push(frame);
      send('{"ack":"fixture"}');
    },
    (state) => states.push(state),
  );
  await socket.start();
  t.after(async () => {
    await socket.stop();
    Object.defineProperty(globalThis, 'WebSocket', originalSocket);
    if (originalChrome)
      Object.defineProperty(globalThis, 'chrome', originalChrome);
    else Reflect.deleteProperty(globalThis, 'chrome');
  });
  return { socket, network: FakeSocket.latest, states, frames, changes };
}

test('worker handshake uses scoped headers and sends heartbeats under the idle timeout', async (t) => {
  const h = await harness(t);
  h.network.open();
  assert.equal(h.network.sent.length, 1);
  h.network.reply({ command: 'response', id: 1 });
  assert.equal(h.states.at(-1), 'connected');
  t.mock.timers.tick(20000);
  assert.equal(h.network.sent.length, 2);
  assert.equal(JSON.parse(h.network.sent[1]!).command, 'ping');
  assert.deepEqual(h.changes[0]!.addRules![0]!.condition.initiatorDomains, [
    'a'.repeat(32),
  ]);
  assert.ok(
    h.changes[0]!.addRules![0]!.action.requestHeaders.some(
      (h) => h.header === 'Origin' && h.operation === 'remove',
    ),
  );
});

test('a connection conflict stops without reconnecting', async (t) => {
  const h = await harness(t);
  h.network.open();
  h.network.reply({ command: 'disconnect', status: 'conn_replaced' });
  assert.equal(h.states.at(-1), 'conflict');
  assert.equal(h.network.closed, true);
  t.mock.timers.tick(60000);
  assert.equal(h.states.at(-1), 'conflict');
  assert.equal(h.changes.length, 1);
});

test('stop removes header rules and suppresses callbacks from the retired socket', async (t) => {
  const h = await harness(t);
  h.network.open();
  await h.socket.stop();
  const before = [...h.states];
  h.network.reply({ command: 'connect' });
  t.mock.timers.tick(60000);
  assert.deepEqual(h.states, before);
  assert.deepEqual(h.changes.at(-1), { removeRuleIds: [1] });
});

test('transactions reach the durable consumer and no handshake means timeout', async (t) => {
  const h = await harness(t);
  h.network.open();
  h.network.reply({ command: 'transaction', id: 5, txn_id: 'tx', events: [] });
  await Promise.resolve();
  assert.equal(h.frames.length, 1);
  assert.equal(h.network.sent.at(-1), '{"ack":"fixture"}');
  t.mock.timers.tick(15000);
  assert.equal(h.network.closed, true);
  assert.ok(h.states.includes('error'));
});
