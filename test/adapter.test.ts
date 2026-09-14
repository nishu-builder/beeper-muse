import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const sync = await readFile(
  new URL('../extension/sync.js', import.meta.url),
  'utf8',
);
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
  dom.window.eval(sync);
  dom.window.eval(adapter);
  return {
    dom,
    document: dom.window.document,
    adapter: {
      ...dom.window.BeeperMuseDOM,
      responseAfter: dom.window.BeeperMuseSync.responseAfter,
    },
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

test('disconnect during composer preparation cancels Send and clears only the inserted draft', async () => {
  for (const manualEdit of [false, true]) {
    const f = fixture();
    let active = true,
      sends = 0;
    const field = f.document.querySelector('textarea')!;
    f.document.querySelector('button')!.onclick = () => {
      sends++;
    };
    await assert.rejects(
      f.adapter.submit(
        f.document,
        'Synthetic prompt',
        async () => {
          active = false;
          if (manualEdit) field.value = 'My edited draft';
        },
        () => active,
      ),
      /disconnected/,
    );
    assert.equal(sends, 0);
    assert.equal(field.value, manualEdit ? 'My edited draft' : '');
    f.dom.window.close();
  }
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
test('a real You: prompt prefix is preserved independently of the accessibility label', () => {
  const f = fixture();
  f.document
    .querySelector('[role="log"]')!
    .insertAdjacentHTML(
      'beforeend',
      '<div data-message-item data-message-id="u" data-message-role="user"><div class="hatch-chat-groupable-bubble"><span class="sr-only">You:</span><p>You: explain this</p></div></div>' +
        '<div data-message-item data-message-id="r" data-message-role="assistant"><p>Synthetic answer</p></div>',
    );
  const snapshot = f.adapter.snapshot(f.document);
  assert.equal(
    snapshot.messages.find((m: { id: string }) => m.id === 'u').text,
    'You: explain this',
  );
  assert.equal(
    f.adapter.responseAfter(new Set(['old']), 'You: explain this', snapshot),
    'Synthetic answer',
  );
  f.dom.window.close();
});

test('structured snapshots preserve formatting, resolve image URLs, and exclude status UI', () => {
  const f = fixture();
  f.document.querySelector('[role="log"]')!.innerHTML =
    `<div data-message-item data-message-id="a" data-message-role="assistant"><div class="hatch-chat-groupable-bubble"><p>See <strong>this</strong> <a href="https://example.com">item</a></p><img src="/image.png" alt="Sample"><span role="status">Delivered</span><div class="reactions">A reaction</div></div><time datetime="2026-09-01T12:30:00-07:00">12:30 PM</time></div>`;
  const m = f.adapter.snapshot(f.document).messages[0];
  assert.match(m.html, /<strong>this<\/strong>/);
  assert.equal(m.images[0].url, 'https://muse.ai/image.png');
  assert.equal(m.timestampMs, Date.parse('2026-09-01T19:30:00Z'));
  assert.doesNotMatch(m.text, /Delivered|reaction|12:30/);
  assert.equal(m.read, undefined);
  assert.equal(m.reactions, undefined);
  f.document.querySelector('time')!.setAttribute('datetime', '12:30 PM');
  assert.equal(
    f.adapter.snapshot(f.document).messages[0].timestampMs,
    undefined,
  );
  f.dom.window.close();
});

test('an image-only answer completes capture and retains the attachment', () => {
  const f = fixture();
  f.document.querySelector('[role="log"]')!.innerHTML =
    '<div data-message-item data-message-id="u" data-message-role="user">Draw a shape</div><div data-message-item data-message-id="a" data-message-role="assistant" data-message-has-presentation="true"><img src="https://example.com/shape.png" alt="Shape"></div>';
  const view = f.adapter.snapshot(f.document);
  assert.equal(
    f.adapter.responseAfter(new Set(), 'Draw a shape', view),
    '[Image]',
  );
  assert.equal(view.messages[1].images[0].url, 'https://example.com/shape.png');
  f.dom.window.close();
});

test('verified reaction labels preserve actors and removals without leaking into message text', () => {
  const f = fixture();
  const log = f.document.querySelector('[role="log"]')!;
  log.innerHTML = `<div data-message-item data-message-id="a" data-message-role="assistant"><div class="hatch-chat-groupable-bubble"><p>Answer</p></div><span role="img" aria-label="Assistant reaction: &#128077;"></span><button aria-pressed="true" data-pel-click="reaction_remove" aria-label="Remove &#128077; reaction">Remove</button></div>`;
  let m = f.adapter.snapshot(f.document).messages[0];
  assert.deepEqual(JSON.parse(JSON.stringify(m.reactions)), [
    { actor: 'assistant', key: '\u{1f44d}' },
    { actor: 'user', key: '\u{1f44d}' },
  ]);
  assert.equal(m.text, 'Answer');
  log.querySelector('button')!.remove();
  assert.equal(f.adapter.snapshot(f.document).messages[0].reactions.length, 1);
  log.querySelector('span')!.remove();
  assert.equal(f.adapter.snapshot(f.document).messages[0].reactions.length, 0);
  log.firstElementChild!.insertAdjacentHTML(
    'beforeend',
    '<span role="img" aria-label="Someone reaction: unknown"></span>',
  );
  assert.equal(f.adapter.snapshot(f.document).messages[0].reactions, undefined);
  f.dom.window.close();
});

test('virtualized history removes only its generated transcript prefix and stays incomplete', () => {
  const f = fixture();
  f.document.querySelector('[role="log"]')!.innerHTML =
    `<div data-message-item data-message-id="u" data-message-role="user" data-message-has-presentation="true"><div class="opacity-0"><div style="height:150px"></div></div><span data-message-accessibility-surrogate="true" class="sr-only">User message: User message: keep my words</span></div>`;
  const m = f.adapter.snapshot(f.document).messages[0];
  assert.equal(m.text, 'User message: keep my words');
  assert.equal(m.partial, true);
  assert.equal(m.widget, false);
  assert.equal(m.html, undefined);
  assert.equal(m.images, undefined);
  assert.equal(m.reactions, undefined);
  f.dom.window.close();
});

test('media buttons and inline product names survive while choices remain inert', () => {
  const f = fixture();
  f.document.querySelector('[role="log"]')!.innerHTML =
    `<div data-message-item data-message-id="a" data-message-role="assistant" data-message-has-presentation="true"><div class="hatch-chat-groupable-bubble"><div class="prose"><p>See <button data-pel-click="mention">Sample product</button>.</p></div><button aria-label="Open browser preview"><img src="/preview.png" alt="Preview"></button><button>Approve purchase</button></div></div>`;
  const m = f.adapter.snapshot(f.document).messages[0];
  assert.equal(m.widget, false);
  assert.match(m.text, /See Sample product/);
  assert.doesNotMatch(m.text, /Approve/);
  assert.doesNotMatch(m.html, /button|data-pel/);
  assert.equal(m.images[0].url, 'https://muse.ai/preview.png');
  f.dom.window.close();
});

test('activity survives a disabled composer and missing transcript, while sending stays blocked', async () => {
  const f = fixture();
  try {
    const field = f.document.querySelector('textarea')!;
    field.disabled = true;
    const stop = f.document.createElement('button');
    stop.setAttribute('aria-label', 'Stop');
    f.document.body.append(stop);
    const adapter = f.adapter.create(f.document);
    assert.equal(await adapter.activity!(), 'working');
    assert.equal(f.adapter.snapshot(f.document).busy, true);
    await assert.rejects(
      adapter.submit('Do not send', async () => {}),
      /busy/,
    );
    stop.remove();
    await assert.rejects(
      adapter.submit('Do not send', async () => {}),
      /composer/,
    );
    f.document.body.append(stop);
    f.document.querySelector('[role="log"]')!.remove();
    field.remove();
    assert.equal(await adapter.activity!(), 'working');
    stop.remove();
    assert.equal(await adapter.activity!(), 'idle');
  } finally {
    f.dom.window.close();
  }
});

test('image submission rejects unrelated file pickers without touching them', async () => {
  const f = fixture();
  f.document.body.insertAdjacentHTML(
    'beforeend',
    '<input type="file" accept="image/*" aria-label="Profile picture">',
  );
  await assert.rejects(
    f.adapter.create(f.document).submitImage!(
      '',
      { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
      async () => {},
    ),
    /composer/,
  );
  assert.equal(
    f.document.querySelector<HTMLInputElement>('input')!.files!.length,
    0,
  );
  f.dom.window.close();
});
test('image upload waits for a loaded preview and preserves an existing draft', async () => {
  const f = fixture(),
    doc = f.document,
    form = doc.createElement('form');
  const field = doc.querySelector('textarea')!,
    send = doc.querySelector('button')!;
  form.append(field, send);
  doc.body.append(form);
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  form.append(input);
  let files: File[] = [];
  Object.defineProperty(input, 'files', {
    get: () => files,
    set: (value: File[]) => {
      files = value;
    },
  });
  Object.defineProperty(f.dom.window, 'DataTransfer', {
    value: class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    },
  });
  let sends = 0;
  send.onclick = () => {
    sends++;
  };
  input.onchange = () => {
    const preview = doc.createElement('img');
    preview.src = 'blob:https://muse.ai/synthetic';
    Object.defineProperties(preview, {
      complete: { value: true },
      naturalWidth: { value: 10 },
    });
    form.append(preview);
  };
  field.value = 'private draft';
  await assert.rejects(
    f.adapter.create(doc).submitImage!(
      '',
      { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
      async () => {},
    ),
    /draft/,
  );
  assert.equal(files.length, 0);
  field.value = '';
  await f.adapter.create(doc).submitImage!(
    'Caption',
    { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
    async () => {},
  );
  assert.equal(sends, 1);
  assert.equal(field.value, 'Caption');
  assert.equal(files[0]!.name, 'photo.png');
  f.dom.window.close();
});
test('snapshot retains local and embedded image previews and excludes foreign blobs', () => {
  const f = fixture();
  f.document.querySelector('[data-message-id]')!.innerHTML =
    '<img src="blob:https://muse.ai/photo"><img src="data:image/png;base64,iVBORw0KGgo="><img src="blob:https://other.test/photo">';
  assert.equal(f.adapter.snapshot(f.document).messages[0]!.images!.length, 2);
  f.dom.window.close();
});

test('photo attribution requires an image echo and rejects interleaved user messages', () => {
  const f = fixture();
  const user = {
    id: 'photo',
    role: 'user',
    text: '',
    images: [{ url: 'https://muse.ai/photo.png' }],
  };
  const reply = { id: 'reply', role: 'assistant', text: 'A photo' };
  assert.equal(
    f.adapter.responseAfter(
      new Set(),
      '',
      { messages: [user, reply] },
      'photo.png',
    ),
    'A photo',
  );
  assert.throws(() =>
    f.adapter.responseAfter(
      new Set(),
      '',
      { messages: [{ ...user, images: [] }, reply] },
      'photo.png',
    ),
  );
  assert.throws(() =>
    f.adapter.responseAfter(
      new Set(),
      '',
      {
        messages: [
          user,
          { id: 'other', role: 'user', text: 'unrelated' },
          reply,
        ],
      },
      'photo.png',
    ),
  );
  f.dom.window.close();
});

test('image readiness reports only control counts and diagnoses a missing form before staging a photo', async () => {
  const f = fixture();
  f.document.querySelector('textarea')!.value = 'PRIVATE draft';
  const adapter = f.adapter.create(f.document);
  const facts = adapter.imageReadiness();
  assert.equal(facts.hasForm, false);
  assert.equal(facts.composers, 1);
  assert.ok(!JSON.stringify(facts).includes('PRIVATE'));
  f.document.querySelector('textarea')!.value = '';
  await assert.rejects(
    adapter.submitImage(
      '',
      { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
      async () => {},
    ),
    (e: unknown) => (e as { code: string }).code === 'image-composer-missing',
  );
  f.dom.window.close();
});
