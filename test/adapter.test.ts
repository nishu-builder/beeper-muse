import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { colorPNG } from '../scripts/dev/fixture.ts';
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
test('avatar discovery selects the named assistant outside navigation/history and refuses ambiguity', async () => {
  const f = fixture();
  try {
    f.document.title = 'Chat – Babar';
    f.document.body.insertAdjacentHTML(
      'afterbegin',
      '<header><img alt="Babar" src="https://muse.ai/avatar.png"></header><nav><img alt="Babar" src="/other.png"></nav>',
    );
    f.document
      .querySelector('[role="log"]')!
      .insertAdjacentHTML('beforeend', '<img alt="Babar" src="/history.png">');
    let fetches = 0;
    f.dom.window.fetch = async (input: unknown) => {
      fetches++;
      assert.equal(input, 'https://muse.ai/avatar.png');
      return new Response(new Uint8Array(colorPNG('RED')), {
        headers: { 'content-type': 'image/png' },
      }) as any;
    };
    const adapter = f.adapter.create(f.document);
    assert.equal(
      (await adapter.profile()).avatar.data,
      colorPNG('RED').toString('base64'),
    );
    await adapter.profile();
    assert.equal(fetches, 1, 'unchanged image is cached briefly');
    f.document.body.insertAdjacentHTML(
      'beforeend',
      '<img alt="Babar" src="/ambiguous.png">',
    );
    assert.equal(await adapter.profile(), undefined);
    f.document.title = 'Different page';
    assert.equal(await adapter.profile(), undefined);
    assert.equal(fetches, 1);
  } finally {
    f.dom.window.close();
  }
});
test('avatar capture enforces its smaller byte budget without affecting chat image preparation', async () => {
  const f = fixture();
  try {
    f.document.title = 'Chat – Babar';
    f.document.body.insertAdjacentHTML(
      'afterbegin',
      '<header><img alt="Babar" src="/avatar.png"></header>',
    );
    f.dom.window.fetch = async () =>
      new Response(new Uint8Array(512 * 1024 + 1), {
        headers: { 'content-type': 'image/png' },
      }) as any;
    const adapter = f.adapter.create(f.document);
    assert.equal(await adapter.profile(), undefined);
    const message = await adapter.prepare({
      id: 'image',
      role: 'assistant',
      text: '',
      images: [{ url: 'https://muse.ai/image.png' }],
    });
    assert.ok(message.images[0].data);
  } finally {
    f.dom.window.close();
  }
});
test('typing recognizes current Stop variants and scoped busy regions, excluding historical controls', async () => {
  const f = fixture();
  try {
    const adapter = f.adapter.create(f.document);
    f.document
      .querySelector('[role="log"]')!
      .insertAdjacentHTML(
        'beforeend',
        '<button aria-label="Stop generating">Old tool</button><span aria-busy="true">Old activity</span>',
      );
    assert.equal(await adapter.activity(), 'idle');
    for (const label of [
      'Stop',
      'Stop generating',
      'Stop generating response',
      'Stop response',
    ]) {
      f.document
        .querySelector('body > button')!
        .setAttribute('aria-label', label);
      assert.equal(await adapter.activity(), 'working');
    }
    f.document
      .querySelector('body > button')!
      .setAttribute('aria-label', 'Send');
    f.document.body.setAttribute('aria-busy', 'true');
    assert.equal(
      await adapter.activity(),
      'idle',
      'whole-page loading is not assistant typing',
    );
    f.document.body.removeAttribute('aria-busy');
    f.document.querySelector('textarea')!.setAttribute('aria-busy', 'true');
    assert.equal(await adapter.activity(), 'working');
    f.document.querySelector('textarea')!.removeAttribute('aria-busy');
    f.document.title = 'Chat – Babar';
    f.document.body.insertAdjacentHTML(
      'afterbegin',
      '<header aria-busy="true"><img alt="Babar" src="/avatar.png"></header>',
    );
    assert.equal(
      await adapter.activity(),
      'idle',
      'an avatar loading does not establish assistant work',
    );
    f.document.querySelector('header')!.removeAttribute('aria-busy');
    assert.equal(await adapter.activity(), 'idle');
  } finally {
    f.dom.window.close();
  }
});
test('typing follows the current assistant renderer rather than older turns or nested loading widgets', async () => {
  const f = fixture();
  try {
    const adapter = f.adapter.create(f.document);
    const log = f.document.querySelector('[role="log"]')!;
    // Structure follows the previously captured Muse message renderer. All
    // identities/content are synthetic; the private page snapshot is not bundled.
    log.innerHTML =
      '<div data-message-item data-message-role="assistant" data-message-turn-id="old"><div class="opacity-100"><div aria-busy="true"><div data-chat-bubble-surface-position="single">Old task</div></div></div></div>' +
      '<div data-message-item data-message-role="user">New prompt</div>' +
      '<div data-message-item data-message-role="assistant" data-message-turn-id="current"><div class="opacity-100"><div aria-busy="false"><div data-chat-bubble-surface-position="single"><div class="hatch-chat-groupable-bubble"><img aria-busy="true" src="/loading.png"></div></div></div></div></div>';
    assert.equal(await adapter.activity(), 'idle');
    const renderer = log.lastElementChild!.querySelector('div[aria-busy]')!;
    renderer.setAttribute('aria-busy', 'true');
    assert.equal(await adapter.activity(), 'working');
    log.insertAdjacentHTML(
      'beforeend',
      '<div data-message-item data-message-role="assistant" data-message-turn-id="current"><div><div aria-busy="false">Same turn status</div></div></div>',
    );
    assert.equal(await adapter.activity(), 'working');
    renderer.setAttribute('aria-busy', 'false');
    assert.equal(await adapter.activity(), 'idle');
    renderer.setAttribute('aria-busy', 'true');
    log.insertAdjacentHTML(
      'beforeend',
      '<div data-message-item data-message-role="user">A newer prompt</div>',
    );
    assert.equal(await adapter.activity(), 'idle');
  } finally {
    f.dom.window.close();
  }
});
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
  assert.match(result, /Hello\n\nSee example \(https:\/\/example.com\)/);
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
for (const [tag, accept, nested] of [
  ['div', '', true],
  ['form', 'image/*'],
  ['div', 'image/*'],
  ['div', '.png,.jpg,.jpeg'],
  ['div', 'IMAGE/PNG'],
  ['div', ''],
  ['div', 'application/pdf, .PNG'],
] as const)
  test(`image upload in a ${tag} with ${accept || 'no accept filter'}${nested ? ' and sibling actions' : ''} waits for a loaded preview and preserves an existing draft`, async () => {
    const f = fixture(),
      doc = f.document,
      form = doc.createElement(tag);
    const field = doc.querySelector('textarea')!,
      send = doc.querySelector('button')!;
    form.append(field, send);
    doc.body.append(form);
    const facts = f.adapter.create(doc).imageReadiness!();
    assert.equal(facts.hasForm, tag === 'form');
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    form.append(input);
    if (nested) {
      form.setAttribute('data-hatch-composer-chrome', 'true');
      const inner = doc.createElement('div');
      inner.append(input, field);
      form.prepend(inner);
    }
    assert.equal(f.adapter.create(doc).imageReadiness!().imageInputs, 1);
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

test('image readiness reports only control counts and diagnoses a missing upload region before staging a photo', async () => {
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

for (const marked of [false, true])
  test(`composer discovery refuses a shared transcript ancestor (marked=${marked})`, async () => {
    const f = fixture();
    const region = f.document.createElement('div');
    if (marked) region.setAttribute('data-hatch-composer-chrome', 'true');
    region.append(...f.document.body.childNodes);
    region.insertAdjacentHTML(
      'beforeend',
      '<input type="file" accept="image/*">',
    );
    f.document.body.append(region);
    const a = f.adapter.create(f.document);
    assert.equal(a.imageReadiness().hasUploadRegion, false);
    assert.equal(a.imageReadiness().pageImageInputs, 1);
    await assert.rejects(
      a.submitImage(
        '',
        { name: 'test.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
        async () => {},
      ),
      /composer/,
    );
    assert.equal(
      region.querySelector<HTMLInputElement>('input')!.files!.length,
      0,
    );
    f.dom.window.close();
  });

test('structured source text preserves table boundaries, continued lists and code indentation', () => {
  const f = fixture();
  f.document.querySelector('[role="log"]')!.innerHTML =
    `<div data-message-item data-message-id="format" data-message-role="assistant"><h2>Options</h2><table><tr><th>Name</th><th>Price</th></tr><tr><td>Small</td><td>$5</td></tr></table><ol start="2"><li>Second<ul><li>Nested</li></ul></li><li>Third</li></ol><pre><code class="language-ts">  const x = 1;\n    return x;\n</code></pre><p>After</p></div>`;
  const message = f.adapter.snapshot(f.document).messages[0];
  assert.match(message.html, /<ol start="2">/);
  assert.match(message.html, /<code class="language-ts">/);
  assert.match(message.text, /Options\n[\s]*Name\tPrice\nSmall\t\$5/);
  assert.match(message.text, /2\. Second\n  - Nested\n3\. Third/);
  assert.match(message.text, /```\n  const x = 1;\n    return x;\n```/);
  assert.match(message.text, /\nAfter$/);
  f.dom.window.close();
});

test('image selection respects exact file type, disabled controls and picker ambiguity', async () => {
  for (const inputMarkup of [
    '<input type="file" accept="image/jpeg">',
    '<input type="file" accept=".jpg">',
    '<input type="file" accept="application/pdf">',
    '<input type="file" accept="application/image/png">',
    '<input type="file" accept="image/svg+xml">',
    '<fieldset disabled><input type="file" accept="image/*"></fieldset>',
    '<input type="file"><input type="file" accept=".png">',
  ]) {
    const f = fixture(),
      doc = f.document,
      region = doc.createElement('div');
    region.append(doc.querySelector('textarea')!, doc.querySelector('button')!);
    region.insertAdjacentHTML('beforeend', inputMarkup);
    doc.body.append(region);
    await assert.rejects(
      f.adapter.create(doc).submitImage!(
        '',
        { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
        async () => {},
      ),
      (e: unknown) =>
        ['image-input-missing', 'image-composer-ambiguous'].includes(
          (e as { code: string }).code,
        ),
    );
    for (const input of region.querySelectorAll<HTMLInputElement>('input'))
      assert.equal(input.files!.length, 0);
    f.dom.window.close();
  }
});

test('an attachment in another composer picker blocks photo staging', async () => {
  const f = fixture(),
    doc = f.document,
    region = doc.createElement('div');
  region.append(doc.querySelector('textarea')!, doc.querySelector('button')!);
  region.insertAdjacentHTML(
    'beforeend',
    '<input type="file" accept="image/png"><input type="file" accept="application/pdf">',
  );
  doc.body.append(region);
  const inputs = region.querySelectorAll<HTMLInputElement>('input');
  Object.defineProperty(inputs[1]!, 'files', {
    value: [
      new f.dom.window.File(['synthetic'], 'existing.pdf', {
        type: 'application/pdf',
      }),
    ],
  });
  await assert.rejects(
    f.adapter.create(doc).submitImage!(
      '',
      { name: 'photo.png', mime: 'image/png', data: 'iVBORw0KGgo=' },
      async () => {},
    ),
    (e: unknown) => (e as { code: string }).code === 'image-composer-ambiguous',
  );
  assert.equal(inputs[0]!.files!.length, 0);
  assert.equal(inputs[1]!.files!.length, 1);
  f.dom.window.close();
});

test('a cleared or replaced image picker requires byte-identical preview evidence before Send', async () => {
  for (const mode of [
    'clear',
    'replace',
    'different-bytes',
    'truncated',
    'oversized',
    'remote-preview',
    'draft',
    'changed-preview',
    'new-file',
  ] as const) {
    const f = fixture(),
      doc = f.document;
    const region = doc.createElement('div');
    const field = doc.querySelector('textarea')!,
      send = doc.querySelector('button')!;
    region.append(field, send);
    doc.body.append(region);
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/png';
    region.append(input);
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
    const bytes = colorPNG('RED');
    let sends = 0,
      fetches = 0;
    send.onclick = () => {
      sends++;
    };
    const preview = doc.createElement('img');
    preview.src =
      mode === 'remote-preview'
        ? 'https://muse.ai/unknown.png'
        : 'blob:https://muse.ai/staged';
    Object.defineProperties(preview, {
      complete: { value: true },
      naturalWidth: { value: 64 },
    });
    input.onchange = () => {
      files = [];
      if (mode === 'replace') input.replaceWith(doc.createElement('input'));
      if (mode === 'new-file')
        files = [
          new f.dom.window.File(['other'], 'other.png', { type: 'image/png' }),
        ];
      region.append(preview);
    };
    f.dom.window.fetch = async (url: unknown) => {
      fetches++;
      assert.equal(url, 'blob:https://muse.ai/staged');
      if (mode === 'draft') field.value = 'User draft';
      const body =
        mode === 'different-bytes'
          ? colorPNG('BLUE')
          : mode === 'truncated'
            ? bytes.subarray(0, -1)
            : mode === 'oversized'
              ? Buffer.concat([bytes, Buffer.from([0])])
              : bytes;
      return new Response(new Uint8Array(body)) as any;
    };
    const attempt = f.adapter.create(doc).submitImage!(
      'Caption',
      {
        name: 'fixture.png',
        mime: 'image/png',
        data: bytes.toString('base64'),
      },
      async (ms: number) => {
        if (mode === 'changed-preview' && ms === 150)
          preview.src = 'blob:https://muse.ai/other';
      },
    );
    if (mode === 'clear' || mode === 'replace') {
      await attempt;
      assert.equal(sends, 1);
      assert.equal(fetches, 1);
      assert.equal(field.value, 'Caption');
    } else {
      await assert.rejects(attempt);
      assert.equal(sends, 0);
      if (mode === 'draft') assert.equal(field.value, 'User draft');
      if (mode === 'remote-preview' || mode === 'new-file')
        assert.equal(fetches, 0);
    }
    f.dom.window.close();
  }
});
