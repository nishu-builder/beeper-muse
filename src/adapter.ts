// Generated JavaScript lives in extension/adapter.js. Edit this TypeScript source.
(() => {
  'use strict';
  const visible = (element: Element) =>
    !!(
      element.getBoundingClientRect().width &&
      element.getBoundingClientRect().height
    );
  function composer(document: Document, writable = true) {
    const fields = [
      ...document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label="Message"]',
      ),
    ].filter(visible);
    if (
      fields.length !== 1 ||
      (writable && (fields[0]!.disabled || fields[0]!.readOnly))
    )
      throw new Error('Muse composer unavailable.');
    return fields[0]!;
  }
  const safeURL = (raw: string) => {
    try {
      const u = new URL(raw);
      return (
        ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  };
  function cleanContent(element: Element, role: Muse.Role): Element {
    const clone = element.cloneNode(true) as Element;
    clone.querySelectorAll('button').forEach((button) => {
      if (
        button.querySelector('img') ||
        (button.closest('.prose') && !button.hasAttribute('aria-label'))
      )
        button.replaceWith(...button.childNodes);
    });
    clone
      .querySelectorAll(
        'button,[data-message-accessibility-surrogate],[aria-label^="Assistant reaction:"],script,style,svg,iframe,object,form,input,textarea,[aria-hidden="true"],[role="status"],[role="toolbar"],[role="progressbar"],.reactions,[data-reaction],[data-message-status]',
      )
      .forEach((n) => n.remove());
    if (role === 'user')
      clone.querySelectorAll('.sr-only').forEach((n) => {
        if (n.textContent?.trim() === 'You:') n.remove();
      });
    // Keep only formatting attributes. The daemon sanitizes again before Matrix.
    clone.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        if (!['href', 'src', 'alt'].includes(a.name)) n.removeAttribute(a.name);
      }
    });
    return clone;
  }
  async function prepare(message: Muse.Message): Promise<Muse.Message> {
    const images: Muse.Image[] = [];
    let remaining = 4 * 1024 * 1024;
    for (const image of message.images || []) {
      if (!safeURL(image.url)) continue;
      try {
        // Ordinary page-origin fetch: no added host permissions or CORS bypass.
        const response = await fetch(image.url, {
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        });
        const mime = (response.headers.get('content-type') || '').split(
          ';',
        )[0]!;
        if (
          !response.ok ||
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
            mime,
          ) ||
          !response.body
        )
          throw Error('Image unavailable');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > Math.min(remaining, 2 * 1024 * 1024))
              throw Error('Image too large');
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        images.push({ ...image, data: btoa(binary), mime });
        remaining -= size;
      } catch {
        images.push(image);
      }
    }
    return { ...message, images };
  }
  function create(document: Document): Muse.Adapter {
    return {
      capabilities: {
        activity: true,
        images: true,
        formatting: true,
        timestamps: true,
        reactions: true,
        readReceipts: false,
      },
      snapshot: () => snapshot(document),
      activity: () => activity(document),
      submit: (prompt, wait, active) => submit(document, prompt, wait, active),
      prepare,
    };
  }
  function text(element: Element, role: Muse.Role) {
    const clone = cleanContent(element, role);
    clone.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^https?:\/\//.test(href || '') && a.textContent !== href)
        a.appendChild(element.ownerDocument.createTextNode(' (' + href + ')'));
    });
    clone
      .querySelectorAll('p,li,pre,blockquote,br')
      .forEach((n) => n.after(element.ownerDocument.createTextNode('\n')));
    return (clone.textContent || '').trim();
  }
  function reactions(element: Element): Muse.Reaction[] | undefined {
    const result: Muse.Reaction[] = [];
    if (element.querySelector('.reactions,[data-reaction]')) return undefined;
    for (const node of element.querySelectorAll('[aria-label]')) {
      const label = node.getAttribute('aria-label') || '';
      const assistant =
        node.getAttribute('role') === 'img' &&
        label.match(/^Assistant reaction: (.+)$/u);
      const self =
        node.tagName === 'BUTTON' &&
        node.getAttribute('aria-pressed') === 'true' &&
        node.getAttribute('data-pel-click') === 'reaction_remove' &&
        label.match(/^Remove (.+) reaction$/u);
      const match = assistant || self;
      const key = match ? match[1]?.trim() : undefined;
      if (key && Array.from(key).length <= 64) {
        const actor = assistant ? 'assistant' : 'user';
        if (!result.some((r) => r.actor === actor && r.key === key))
          result.push({ actor, key });
      } else if (/reaction:|^Remove .+ reaction$/i.test(label)) {
        // Unknown markup is not an authoritative empty reaction set.
        return undefined;
      }
    }
    return result.sort((a, b) =>
      (a.actor + a.key).localeCompare(b.actor + b.key),
    );
  }
  function activity(document: Document): Muse.Activity {
    return [...document.querySelectorAll('button[aria-label="Stop"]')].some(
      visible,
    )
      ? 'working'
      : 'idle';
  }
  function snapshot(document: Document): Muse.Snapshot {
    const logs = [
      ...document.querySelectorAll('[role="log"][aria-label="Chat messages"]'),
    ].filter(visible);
    if (logs.length !== 1) throw new Error('Open the main Muse chat.');
    const busy = activity(document) === 'working';
    return {
      activity: busy ? 'working' : 'idle',
      busy,
      draft: composer(document, false).value,
      messages: [
        ...logs[0]!.querySelectorAll('[data-message-item][data-message-id]'),
      ].flatMap((e): Muse.Observation[] => {
        const id = e.getAttribute('data-message-id');
        const role = e.getAttribute('data-message-role');
        if (!id || (role !== 'user' && role !== 'assistant')) return [];
        const rendered = e.querySelector('.hatch-chat-groupable-bubble');
        const surrogate = e.querySelector(
          '[data-message-accessibility-surrogate="true"]',
        );
        if (!rendered && surrogate) {
          const prefix =
            role === 'user' ? 'User message: ' : 'Assistant message: ';
          const raw = surrogate.textContent || '';
          return [
            {
              id,
              role,
              text: raw.startsWith(prefix) ? raw.slice(prefix.length) : raw,
              partial: true,
              widget: false,
            },
          ];
        }
        const bubble = rendered || e;
        const clean = cleanContent(bubble, role);
        const images: Muse.Image[] = [...clean.querySelectorAll('img[src]')]
          .slice(0, 4)
          .flatMap((img) => {
            const rawURL = img.getAttribute('src') || '';
            let url: string;
            try {
              url = new URL(rawURL, document.baseURI).href;
            } catch {
              return [];
            }
            if (!safeURL(url)) return [];
            return [
              { url, alt: (img.getAttribute('alt') || '').slice(0, 1000) },
            ];
          });
        // Only absolute machine-readable DOM times are authoritative. Relative
        // labels such as "Today" or "3:04 PM" cannot determine a date/time zone.
        const raw = e.querySelector('time[datetime]')?.getAttribute('datetime');
        const timestampMs =
          raw && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)
            ? Date.parse(raw)
            : NaN;
        clean.querySelectorAll('img').forEach((n) => n.remove());
        const widget =
          e.getAttribute('data-message-has-presentation') === 'true' &&
          !bubble.querySelector('.prose');
        return [
          {
            id,
            role,
            text: text(bubble, role),
            html: clean.innerHTML.slice(0, 128000),
            images,
            reactions: reactions(e),
            ...(Number.isFinite(timestampMs) &&
            timestampMs >= 946684800000 &&
            timestampMs <= Date.now() + 300000
              ? { timestampMs }
              : {}),
            widget,
          },
        ];
      }),
    };
  }
  async function submit(
    document: Document,
    prompt: string,
    wait: (ms: number) => Promise<void>,
    active = () => true,
  ) {
    if (!active()) throw new Error('Tab disconnected.');
    const initial = snapshot(document);
    if (initial.busy || initial.draft.trim())
      throw new Error('Muse is busy or has an existing draft.');
    const field = composer(document);
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(
      (document.defaultView as Window & typeof globalThis).HTMLTextAreaElement
        .prototype,
      'value',
    )!.set!;
    setter.call(field, prompt);
    field.dispatchEvent(
      new (document.defaultView as Window & typeof globalThis).Event('input', {
        bubbles: true,
      }),
    );
    await wait(150);
    if (!active()) {
      // Only remove the draft inserted by this submission, never a user's edit.
      if (field.isConnected && field.value === prompt) {
        setter.call(field, '');
        field.dispatchEvent(
          new (document.defaultView as Window & typeof globalThis).Event(
            'input',
            { bubbles: true },
          ),
        );
      }
      throw new Error('Tab disconnected.');
    }
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Send"]',
      ),
    ].filter(visible);
    if (
      buttons.length !== 1 ||
      buttons[0]!.disabled ||
      composer(document).value !== prompt
    )
      throw new Error('Muse send control changed.');
    buttons[0]!.click();
    return new Set(initial.messages.map((m) => m.id));
  }
  globalThis.BeeperMuseDOM = { create, snapshot, submit };
})();
