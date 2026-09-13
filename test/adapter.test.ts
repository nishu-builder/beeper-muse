import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const adapter = await readFile(
  new URL('../extension/adapter.js', import.meta.url),
  'utf8',
);
function fixture() {
  const dom = new JSDOM(
    '<div role="log" aria-label="Chat messages"><div data-message-item data-message-id="old" data-message-role="assistant"><p>Old private content</p></div></div><textarea aria-label="Message"></textarea><button aria-label="Send">Send</button>',
    { url: 'https://muse.ai/', runScripts: 'outside-only' },
  );
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    top: 0,
    left: 0,
    right: 100,
    bottom: 40,
    toJSON: () => ({}),
  });
  dom.window.eval(adapter);
  return {
    dom,
    document: dom.window.document,
    adapter: dom.window.BeeperMuseDOM,
  };
}
test('browser adapter preserves an existing user draft and never sends it', async () => {
  const f = fixture();
  f.document.querySelector('textarea')!.value = 'My unfinished message';
  let sends = 0;
  f.document.querySelector('button')!.onclick = () => {
    sends++;
  };
  await assert.rejects(
    f.adapter.submit(f.document, 'prompt', async () => {}),
    /draft/,
  );
  assert.equal(sends, 0);
  assert.equal(
    f.document.querySelector('textarea')!.value,
    'My unfinished message',
  );
  f.dom.window.close();
});
test('browser adapter uses the textarea input event and clicks Send exactly once', async () => {
  const f = fixture();
  let sends = 0,
    inputs = 0;
  f.document.querySelector('button')!.onclick = () => {
    sends++;
  };
  f.document.querySelector('textarea')!.oninput = () => {
    inputs++;
  };
  const before = await f.adapter.submit(
    f.document,
    'Test prompt',
    async () => {},
  );
  assert.equal(sends, 1);
  assert.equal(inputs, 1);
  assert.equal(before.has('old'), true);
  f.dom.window.close();
});
test('browser response capture excludes history, buttons, and widgets, and preserves links', () => {
  const f = fixture();
  const log = f.document.querySelector('[role="log"]')!;
  log.insertAdjacentHTML(
    'beforeend',
    '<div data-message-item data-message-id="u" data-message-role="user">You: Test prompt</div><div data-message-item data-message-id="widget" data-message-role="assistant" data-message-has-presentation="true">Private widget</div><div data-message-item data-message-id="r" data-message-role="assistant"><p>Hello</p><p>See <a href="https://example.com">example</a></p><button>Approve purchase</button></div>',
  );
  const result = f.adapter.responseAfter(
    new Set(['old']),
    'Test prompt',
    f.adapter.snapshot(f.document),
  );
  assert.match(result, /Hello\nSee example \(https:\/\/example.com\)/);
  assert.doesNotMatch(result, /private|widget|purchase/i);
  f.dom.window.close();
});
test('interleaved user messages stop capture instead of attributing an unrelated reply', () => {
  const f = fixture();
  f.document
    .querySelector('[role="log"]')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-message-item data-message-id="u" data-message-role="user">You: Different prompt</div>',
    );
  assert.throws(
    () =>
      f.adapter.responseAfter(
        new Set(['old']),
        'Test prompt',
        f.adapter.snapshot(f.document),
      ),
    /Another message/,
  );
  f.dom.window.close();
});
test('a changed page or busy Muse refuses to submit', async () => {
  const f = fixture();
  f.document.querySelector('button')!.setAttribute('aria-label', 'Stop');
  await assert.rejects(
    f.adapter.submit(f.document, 'x', async () => {}),
    /busy/,
  );
  f.document.querySelector('textarea')!.remove();
  assert.throws(() => f.adapter.snapshot(f.document), /unavailable/);
  f.dom.window.close();
});

test('reactions outside user and assistant bubbles cannot change prompt or reply text', () => {
  const f = fixture();
  f.document
    .querySelector('[role="log"]')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-message-item data-message-id="u" data-message-role="user"><div class="hatch-chat-groupable-bubble"><span class="sr-only">You:</span><p>Find a wooden storage box</p></div><div class="reactions"><span>reaction</span></div></div>' +
        '<div data-message-item data-message-id="r" data-message-role="assistant"><div class="hatch-chat-groupable-bubble"><p>I am checking the available options.</p></div><div class="reactions"><span>another reaction</span></div></div>',
    );
  assert.equal(
    f.adapter.responseAfter(
      new Set(['old']),
      'Find a wooden storage box',
      f.adapter.snapshot(f.document),
    ),
    'I am checking the available options.',
  );
  f.dom.window.close();
});
