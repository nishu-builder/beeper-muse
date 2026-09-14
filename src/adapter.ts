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
  const safeImageURL = (raw: string) =>
    safeURL(raw) ||
    (raw.length <= 3 * 1024 * 1024 &&
      /^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(raw)) ||
    (raw.startsWith('blob:') &&
      (() => {
        try {
          return new URL(raw).origin === 'https://muse.ai';
        } catch {
          return false;
        }
      })());
  function cleanContent(element: Element, role: Muse.Role): Element {
    const clone = element.cloneNode(true) as Element;
    const sourceImages = [...element.querySelectorAll<HTMLImageElement>('img')];
    clone.querySelectorAll('img').forEach((image, index) => {
      const selected = sourceImages[index]?.currentSrc;
      if (selected) image.setAttribute('src', selected);
    });
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
    // Keep only formatting attributes. The worker sanitizes again before Matrix.
    clone.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) {
        const formatting =
          (n.tagName === 'OL' && a.name === 'start') ||
          (n.tagName === 'CODE' && a.name === 'class');
        if (!formatting && !['href', 'src', 'alt'].includes(a.name))
          n.removeAttribute(a.name);
      }
    });
    return clone;
  }
  async function prepare(
    message: Muse.Message,
    imageLimit = 2 * 1024 * 1024,
  ): Promise<Muse.Message> {
    const images: Muse.Image[] = [];
    let remaining = 4 * 1024 * 1024;
    for (const image of message.images || []) {
      if (!safeImageURL(image.url)) continue;
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
            if (size > Math.min(remaining, imageLimit))
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
    let cached: { url: string; at: number; profile: Muse.Profile } | undefined;
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
      activityReadiness: () => activityReadiness(document),
      profile: async () => {
        const image = assistantAvatar(document);
        if (!image) return;
        const url = image.currentSrc || image.src;
        if (!safeImageURL(url)) return;
        if (cached?.url === url && Date.now() - cached.at < 300000)
          return cached.profile;
        const prepared = await prepare(
          { id: 'avatar', role: 'assistant', text: '', images: [{ url }] },
          512 * 1024,
        );
        const avatar = prepared.images?.[0];
        if (!avatar?.data || !avatar.mime) return;
        const profile = { avatar };
        cached = { url, at: Date.now(), profile };
        return profile;
      },
      imageReadiness: () => imageReadiness(document),
      submitImage: (prompt, image, wait, active) =>
        submitImage(document, prompt, image, wait, active),
      submit: (prompt, wait, active) => submit(document, prompt, wait, active),
      prepare,
    };
  }
  function text(element: Element, role: Muse.Role) {
    const clone = cleanContent(element, role);
    function render(node: Node, listDepth = 0, pre = false, depth = 0): string {
      if (depth > 100) return node.textContent || '';
      if (node.nodeType === 3) {
        const value = node.textContent || '';
        return pre ? value : value.replace(/[ \t\r\n]+/g, ' ');
      }
      if (node.nodeType !== 1) return '';
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'img') return '';
      const children = (keepSpace = pre) =>
        [...el.childNodes]
          .map((n) => render(n, listDepth, keepSpace, depth + 1))
          .join('');
      if (tag === 'pre') {
        const code = children(true);
        const fence = '`'.repeat(
          (code.match(/`+/g) || []).reduce(
            (n, run) => Math.max(n, run.length + 1),
            3,
          ),
        );
        return (
          '\n' +
          fence +
          '\n' +
          code +
          (code.endsWith('\n') ? '' : '\n') +
          fence +
          '\n'
        );
      }
      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n---\n';
      if (tag === 'ol' || tag === 'ul') {
        const raw = el.getAttribute('start') || '1';
        let index =
          /^-?\d{1,10}$/.test(raw) && Math.abs(Number(raw)) <= 2147483647
            ? Number(raw)
            : 1;
        return (
          '\n' +
          [...el.children]
            .map((li) => {
              if (li.tagName !== 'LI')
                return render(li, listDepth, false, depth + 1);
              const body = [...li.childNodes]
                .map((n) => render(n, listDepth + 1, false, depth + 1))
                .join('')
                .trim();
              const marker = tag === 'ol' ? String(index++) + '. ' : '- ';
              return (
                '  '.repeat(Math.min(listDepth, 20)) + marker + body + '\n'
              );
            })
            .join('')
        );
      }
      if (tag === 'tr')
        return (
          [...el.children]
            .filter((cell) => ['TD', 'TH'].includes(cell.tagName))
            .map((cell) => render(cell, listDepth, false, depth + 1).trim())
            .join('\t') + '\n'
        );
      let body = children();
      if (tag === 'a') {
        const url = el.getAttribute('href') || '';
        if (safeURL(url) && body.trim() !== url) body += ' (' + url + ')';
      }
      if (/^(p|div|h[1-6]|blockquote|table|caption|summary|details)$/.test(tag))
        return '\n' + body.trim() + '\n';
      return body;
    }
    return render(clone).trim();
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
  function assistantAvatar(document: Document): HTMLImageElement | undefined {
    const name = /^Chat\s+[–—-]\s+(.+)$/.exec(document.title)?.[1]?.trim();
    if (!name || name.length > 100) return;
    const labels = new Set(
      [name, `${name}'s avatar`, `${name} avatar`, `Avatar of ${name}`].map(
        (s) => s.toLowerCase(),
      ),
    );
    const images = [
      ...document.querySelectorAll<HTMLImageElement>('img[alt]'),
    ].filter(
      (image) =>
        visible(image) &&
        !image.closest(
          '[role="log"],[data-message-item],nav,[role="navigation"]',
        ) &&
        labels.has(image.alt.trim().toLowerCase()),
    );
    return images.length === 1 ? images[0] : undefined;
  }
  function activityReadiness(document: Document): Muse.ActivityReadiness {
    const stopButtons = [
      ...document.querySelectorAll('button[aria-label]'),
    ].filter(
      (button) =>
        visible(button) &&
        !button.closest('[role="log"],[data-message-item]') &&
        /^stop(?: generating(?: response)?| response)?$/i.test(
          button.getAttribute('aria-label')!.trim(),
        ),
    ).length;
    const field = [
      ...document.querySelectorAll('textarea[aria-label="Message"]'),
    ].find(visible);
    const busy = field?.closest('[aria-busy="true"]');
    const logs = [
      ...document.querySelectorAll('[role="log"][aria-label="Chat messages"]'),
    ].filter(visible);
    const items =
      logs.length === 1
        ? [...logs[0]!.querySelectorAll('[data-message-item]')]
        : [];
    const latest = items.at(-1);
    // Observed Muse markup puts aria-busy on the assistant message renderer,
    // one wrapper below the item. Do not infer work from historical tool cards,
    // loading images, an assistant avatar, or older turns still in the DOM.
    const turn = latest?.getAttribute('data-message-turn-id');
    const lastUser = items
      .map((item) => item.getAttribute('data-message-role'))
      .lastIndexOf('user');
    const current =
      latest?.getAttribute('data-message-role') === 'assistant'
        ? items
            .slice(lastUser + 1)
            .filter(
              (item) =>
                item === latest ||
                (!!turn && item.getAttribute('data-message-turn-id') === turn),
            )
        : [];
    const assistantBusy = current.some(
      (item) =>
        item.getAttribute('data-message-role') === 'assistant' &&
        [
          ...item.querySelectorAll(
            ':scope > [aria-busy="true"], :scope > div > [aria-busy="true"]',
          ),
        ].some(visible),
    );
    return {
      stopButtons: Math.min(stopButtons, 100),
      composerBusy:
        !!busy && !busy.querySelector('[role="log"],[data-message-item]'),
      assistantBusy,
    };
  }
  function activity(document: Document): Muse.Activity {
    const signals = activityReadiness(document);
    return signals.stopButtons || signals.composerBusy || signals.assistantBusy
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
            if (!safeImageURL(url)) return [];
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
  // Muse's current composer is not a native form. Stay within the smallest
  // ancestor containing its own file input, never the transcript or page root.
  function uploadRegion(field: HTMLTextAreaElement): HTMLElement | null {
    for (
      let region = field.parentElement;
      region;
      region = region.parentElement
    ) {
      if (
        region === field.ownerDocument.body ||
        region === field.ownerDocument.documentElement ||
        region.matches('[role="log"],[data-message-item]') ||
        region.querySelector('[role="log"],[data-message-item]') ||
        region.querySelectorAll('textarea').length !== 1
      )
        return null;
      if (region.matches('form') || region.querySelector('input[type="file"]'))
        return region;
    }
    return null;
  }
  function imageReadiness(document: Document): Muse.UploadReadiness {
    const fields = [
      ...document.querySelectorAll<HTMLTextAreaElement>(
        'textarea[aria-label="Message"]',
      ),
    ].filter(visible);
    const field = fields.length === 1 ? fields[0]! : null;
    const form = field ? uploadRegion(field) : null;
    const pageInputs = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ];
    const inputs = [
      ...(form?.querySelectorAll<HTMLInputElement>('input[type="file"]') || []),
    ];
    return {
      composers: Math.min(fields.length, 100),
      hasForm: !!field?.closest('form'),
      hasUploadRegion: !!form,
      pageFileInputs: Math.min(pageInputs.length, 100),
      pageImageInputs: Math.min(
        pageInputs.filter((e) => /image\//i.test(e.accept)).length,
        100,
      ),
      fileInputs: Math.min(inputs.length, 100),
      imageInputs: Math.min(
        inputs.filter((e) => !e.disabled && /image\//i.test(e.accept)).length,
        100,
      ),
      existingFiles: Math.min(
        inputs.reduce((n, e) => n + (e.files?.length || 0), 0),
        100,
      ),
      previews: Math.min(form?.querySelectorAll('img[src]').length || 0, 100),
      sendButtons: Math.min(
        form?.querySelectorAll('button[aria-label="Send"]').length || 0,
        100,
      ),
    };
  }
  function uploadError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
  }
  async function submitImage(
    document: Document,
    prompt: string,
    image: Muse.Upload,
    wait: (ms: number) => Promise<void>,
    active = () => true,
  ) {
    const initial = snapshot(document),
      field = composer(document),
      form = uploadRegion(field);
    if (!active() || initial.busy || initial.draft.trim())
      throw uploadError('image-draft', 'Muse is busy or has a draft.');
    // A profile/avatar picker elsewhere in the page must never receive a photo.
    if (!form || form.querySelector('[role="log"]'))
      throw uploadError(
        'image-composer-missing',
        'Muse image composer unavailable.',
      );
    const inputs = [
      ...form.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ].filter((e) => !e.disabled && /image\//i.test(e.accept));
    if (!inputs.length)
      throw uploadError(
        'image-input-missing',
        'Muse image file input unavailable.',
      );
    if (
      inputs.length !== 1 ||
      inputs[0]!.files?.length ||
      form.querySelector('img[src]')
    )
      throw uploadError(
        'image-composer-ambiguous',
        'Muse image composer is ambiguous or already has an attachment.',
      );
    if (
      !/^image\/(png|jpeg|gif|webp)$/.test(image.mime) ||
      image.data.length > 7 * 1024 * 1024 ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(image.data)
    )
      throw uploadError('image-unavailable', 'Unsupported image.');
    const raw = atob(image.data);
    if (!raw.length || raw.length > 5 * 1024 * 1024)
      throw uploadError('image-unavailable', 'Image exceeds 5 MB.');
    const win = document.defaultView as Window & typeof globalThis;
    const file = new win.File(
      [Uint8Array.from(raw, (c) => c.charCodeAt(0))],
      image.name,
      { type: image.mime },
    );
    const transfer = new win.DataTransfer();
    transfer.items.add(file);
    const input = inputs[0]!;
    input.files = transfer.files;
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await wait(250);
      if (!active())
        throw Error(
          'Image submission interrupted. Check Muse before retrying.',
        );
      if (
        !input.isConnected ||
        input.files?.[0] !== file ||
        composer(document) !== field ||
        field.value.trim()
      )
        throw uploadError('image-input-changed', 'The image composer changed.');
      const send = [
        ...form.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Send"]',
        ),
      ].filter(visible);
      const previews = [
        ...form.querySelectorAll<HTMLImageElement>('img[src]'),
      ].filter(visible);
      if (
        previews.length === 1 &&
        previews[0]!.complete &&
        previews[0]!.naturalWidth > 0 &&
        send.length === 1 &&
        !send[0]!.disabled &&
        !form.querySelector('[aria-busy="true"],[role="progressbar"]')
      ) {
        if (prompt) {
          const setter = Object.getOwnPropertyDescriptor(
            win.HTMLTextAreaElement.prototype,
            'value',
          )!.set!;
          setter.call(field, prompt);
          field.dispatchEvent(new win.Event('input', { bubbles: true }));
          await wait(150);
        }
        if (
          !active() ||
          input.files?.[0] !== file ||
          field.value !== prompt ||
          !send[0]!.isConnected ||
          send[0]!.disabled
        )
          throw uploadError(
            'image-submit-changed',
            'Image submission changed.',
          );
        send[0]!.click();
        return new Set(initial.messages.map((m) => m.id));
      }
    }
    throw uploadError(
      'image-preview-timeout',
      'Image preview did not become ready. Check Muse before retrying.',
    );
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
