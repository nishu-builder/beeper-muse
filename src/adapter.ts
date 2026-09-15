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
      if (
        sourceImages[index]?.closest(
          '[data-pel-impression="sandbox_file_card_impression"]',
        )
      ) {
        image.remove();
        return;
      }
      const selected = sourceImages[index]?.currentSrc;
      if (selected) image.setAttribute('src', selected);
      if (!image.getAttribute('alt')) {
        const description = sourceImages[index]
          ?.closest('button[aria-label^="Open generated image"]')
          ?.getAttribute('title');
        if (description) image.setAttribute('alt', description.slice(0, 1000));
      }
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
  // Preserve original bytes when they fit. Oversized still images get a bounded
  // WebP preview; never silently flatten GIF/WebP animations or animated PNGs.
  async function compactImage(
    bytes: Uint8Array<ArrayBuffer>,
    mime: string,
    limit: number,
  ) {
    if (!['image/png', 'image/jpeg'].includes(mime) || limit < 16384)
      throw Error('Image too large');
    if (mime === 'image/png') {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      for (let offset = 8; offset + 12 <= bytes.length;) {
        const length = view.getUint32(offset);
        const kind = String.fromCharCode(
          ...bytes.subarray(offset + 4, offset + 8),
        );
        if (kind === 'acTL') throw Error('Animated image too large');
        if (kind === 'IDAT' || length > bytes.length - offset - 12) break;
        offset += length + 12;
      }
    }
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    try {
      if (
        !bitmap.width ||
        !bitmap.height ||
        bitmap.width * bitmap.height > 64000000
      )
        throw Error('Image dimensions too large');
      const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      for (const scale of [1, 0.75, 0.5, 0.25]) {
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.round(bitmap.width * ratio * scale)),
          Math.max(1, Math.round(bitmap.height * ratio * scale)),
        );
        try {
          const context = canvas.getContext('2d');
          if (!context) throw Error('Image conversion unavailable');
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await canvas.convertToBlob({
            type: 'image/webp',
            quality: 0.9,
          });
          if (blob.size > 0 && blob.size <= limit && blob.type === 'image/webp')
            return {
              bytes: new Uint8Array(await blob.arrayBuffer()),
              mime: blob.type,
            };
        } finally {
          canvas.width = canvas.height = 1;
        }
      }
      throw Error('Image too large');
    } finally {
      bitmap.close();
    }
  }
  async function prepare(
    message: Muse.Message,
    imageLimit = 2 * 1024 * 1024,
    report: Muse.PreparationReporter = () => {},
  ): Promise<Muse.Message> {
    const images: Muse.Image[] = [];
    let remaining = 4 * 1024 * 1024;
    for (const image of message.images || []) {
      if (!safeImageURL(image.url)) continue;
      let failure: Muse.PreparationEvent = 'image-fetch-failed';
      try {
        // Ordinary page-origin fetch: no added host permissions or CORS bypass.
        const response = await fetch(image.url, {
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
        });
        let mime = (response.headers.get('content-type') || '').split(';')[0]!;
        if (!response.ok || !response.body) throw Error('Image unavailable');
        if (
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)
        ) {
          failure = 'image-format-unsupported';
          throw Error('Image unavailable');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > 20 * 1024 * 1024) {
              failure = 'image-too-large';
              throw Error('Image too large');
            }
            chunks.push(chunk.value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        let bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const limit = Math.min(remaining, imageLimit);
        if (size > limit) {
          failure = 'image-too-large';
          const compact = await compactImage(bytes, mime, limit);
          bytes = compact.bytes;
          mime = compact.mime;
          report('image-compressed');
        }
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        images.push({ ...image, data: btoa(binary), mime });
        remaining -= bytes.length;
        report('image-prepared');
      } catch {
        report(failure);
        images.push(image);
      }
    }
    return { ...message, images };
  }
  function create(
    document: Document,
    report?: Muse.PreparationReporter,
  ): Muse.Adapter {
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
      mediaReadiness: () => mediaReadiness(document),
      profile: async () => {
        const image = assistantAvatar(document);
        if (!image) return;
        const url = image.currentSrc || image.src;
        if (!safeImageURL(url)) return;
        const animated = image.tagName === 'VIDEO';
        if (
          cached?.url === url &&
          (animated || Date.now() - cached.at < 300000)
        )
          return cached.profile;
        if (animated) {
          const avatar = avatarFrame(document, image as HTMLVideoElement);
          if (!avatar) return;
          const profile = { avatar };
          cached = { url, at: Date.now(), profile };
          return profile;
        }
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
      prepare: (message) => prepare(message, undefined, report),
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
  function assistantAvatar(
    document: Document,
  ): HTMLImageElement | HTMLVideoElement | undefined {
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
    const videos = [
      ...document.querySelectorAll<HTMLVideoElement>(
        '[data-hatch-avatar-interaction="true"] video[data-hatch-avatar-layer="ready"][data-hatch-avatar-slot="current"]',
      ),
    ].filter((video) => {
      const wrapper = video.closest('[data-hatch-avatar-interaction="true"]');
      return (
        visible(video) &&
        !video.closest(
          '[role="log"],[data-message-item],nav,[role="navigation"]',
        ) &&
        wrapper?.getAttribute('aria-label')?.trim() === name
      );
    });
    const candidates = [...images, ...videos];
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  function avatarFrame(
    document: Document,
    video: HTMLVideoElement,
  ): Muse.Image | undefined {
    // Copy an already decoded frame. Never seek, pause or alter Muse's animation.
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(
      1,
      256 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      const data = url.split(',')[1];
      if (
        !url.startsWith('data:image/png;base64,') ||
        !data ||
        data.length > Math.ceil((512 * 1024) / 3) * 4
      )
        return;
      return { url, data, mime: 'image/png' };
    } catch {
      // A tainted canvas or an unavailable frame is not permission to bypass CORS.
      return;
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  function mediaReadiness(document: Document): Muse.MediaReadiness {
    const logs = [
      ...document.querySelectorAll('[role="log"][aria-label="Chat messages"]'),
    ].filter(visible);
    const tail =
      logs.length === 1
        ? [
            ...logs[0]!.querySelectorAll(
              '[data-message-item][data-message-id]',
            ),
          ].slice(-3)
        : [];
    const count = (selector: string) =>
      Math.min(
        100,
        tail.reduce((n, item) => n + item.querySelectorAll(selector).length, 0),
      );
    return {
      sourceVisible: document.visibilityState === 'visible',
      sourceFocused: document.hasFocus(),
      tailImageBusy: count(
        '[data-testid="hatch-chat-attachment-presentation-image"] [aria-busy="true"]',
      ),
      tailImageChildNodes: count(
        '[data-testid="hatch-chat-attachment-presentation-image"] *',
      ),
      tailImageNodes: count('img'),
      tailImagePresentations: count(
        '[data-testid="hatch-chat-attachment-presentation-image"]',
      ),
      tailIframes: count('iframe'),
      tailWidgetsOnscreen: tail.filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          e.hasAttribute('data-message-has-presentation') &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < (document.defaultView?.innerHeight || 0)
        );
      }).length,
      tailWidgetsSized: tail.filter(
        (e) => e.hasAttribute('data-message-has-presentation') && visible(e),
      ).length,
      tailCanvases: count('canvas'),
      tailVideos: count('video'),
      tailFileCards: count(
        '[data-pel-impression="sandbox_file_card_impression"]',
      ),
      tailGeneratedControls: count(
        'button[aria-label^="Open generated image"]',
      ),
      tailGeneratedImages: count(
        'button[aria-label^="Open generated image"] img',
      ),
      tailDeferred: count('[data-message-accessibility-surrogate="true"]'),
    };
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
        const rendered = [
          ...e.querySelectorAll('.hatch-chat-groupable-bubble'),
        ].filter(
          (node) =>
            node.closest('[data-message-item]') === e &&
            !node.parentElement?.closest('.hatch-chat-groupable-bubble'),
        );

        const surrogate = e.querySelector(
          '[data-message-accessibility-surrogate="true"]',
        );
        if (!rendered.length && surrogate) {
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
        // A captioned photo has two sibling bubbles: media, then text. Read
        // every top-level surface once instead of dropping everything after it.
        let bubble: Element = rendered[0] || e;
        if (rendered.length > 1) {
          bubble = document.createElement('div');
          for (const surface of rendered)
            bubble.append(cleanContent(surface, role));
        }
        const clean = cleanContent(bubble, role);
        // User attachments can sit beside their caption bubble. Only include
        // the observed media control owned by this message, never nearby cards.
        const siblingImages =
          role === 'user'
            ? [
                ...e.querySelectorAll<HTMLImageElement>(
                  'button[data-pel-click="chat_media_click"] img[src]',
                ),
              ].filter(
                (img) =>
                  img.closest('[data-message-item]') === e &&
                  !bubble.contains(img),
              )
            : [];
        const seenImages = new Set<string>();
        const images: Muse.Image[] = [
          ...clean.querySelectorAll<HTMLImageElement>('img[src]'),
          ...siblingImages,
        ]
          .slice(0, 4)
          .flatMap((img) => {
            const rawURL = img.currentSrc || img.getAttribute('src') || '';
            let url: string;
            try {
              url = new URL(rawURL, document.baseURI).href;
            } catch {
              return [];
            }
            if (!safeImageURL(url) || seenImages.has(url)) return [];
            seenImages.add(url);
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
  // Current Muse puts its picker beside the textarea, but previews and actions
  // elsewhere in this explicit composer. Older layouts use the bounded fallback.
  function uploadRegion(field: HTMLTextAreaElement): HTMLElement | null {
    const marked = field.closest<HTMLElement>(
      '[data-hatch-composer-chrome="true"]',
    );
    if (marked) {
      if (
        marked === field.ownerDocument.body ||
        marked === field.ownerDocument.documentElement ||
        marked.matches('[role="log"],[data-message-item]') ||
        marked.querySelector('[role="log"],[data-message-item]') ||
        marked.querySelectorAll('textarea').length !== 1
      )
        return null;
      return marked;
    }
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
  const imageNames: Record<string, string[]> = {
    'image/png': ['image.png'],
    'image/jpeg': ['image.jpg', 'image.jpeg'],
    'image/gif': ['image.gif'],
    'image/webp': ['image.webp'],
  };
  // HTML file inputs may declare MIME types, filename extensions or no filter.
  // Keep this separate from locating the composer: an unrestricted picker
  // elsewhere in the page must not become an upload target.
  function acceptsImage(input: HTMLInputElement, mime: string, name: string) {
    if (!imageNames[mime] || input.matches(':disabled')) return false;
    const accept = input.accept.trim().toLowerCase();
    if (!accept) return true;
    return accept.split(',').some((part) => {
      const token = part.trim();
      return (
        token === mime ||
        token === 'image/*' ||
        (/^\.[a-z0-9]+$/.test(token) && name.toLowerCase().endsWith(token))
      );
    });
  }
  function acceptsAnyImage(input: HTMLInputElement) {
    return Object.entries(imageNames).some(([mime, names]) =>
      names.some((name) => acceptsImage(input, mime, name)),
    );
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
      pageImageInputs: Math.min(pageInputs.filter(acceptsAnyImage).length, 100),
      fileInputs: Math.min(inputs.length, 100),
      imageInputs: Math.min(inputs.filter(acceptsAnyImage).length, 100),
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
  async function matchesLocalPreview(
    url: string,
    raw: string,
  ): Promise<boolean> {
    // A reset file picker is normal in React uploaders. Only trust its replacement
    // preview when its actual bytes match our upload; names/dimensions are not proof.
    if (!safeImageURL(url) || !/^(blob:|data:)/.test(url)) return false;
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || !response.body) return false;
      const reader = response.body.getReader();
      let offset = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) return offset === raw.length;
          if (offset + chunk.value.length > raw.length) return false;
          for (const byte of chunk.value)
            if (byte !== raw.charCodeAt(offset++)) return false;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    } catch {
      return false;
    }
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
    const allInputs = [
      ...form.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ];
    const inputs = allInputs.filter((e) =>
      acceptsImage(e, image.mime, image.name),
    );
    if (!inputs.length)
      throw uploadError(
        'image-input-missing',
        'Muse image file input unavailable.',
      );
    if (
      inputs.length !== 1 ||
      allInputs.some((input) => input.files?.length) ||
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
    const selection = () => {
      const files = [
        ...form.querySelectorAll<HTMLInputElement>('input[type="file"]'),
      ].flatMap((node) => [...(node.files || [])]);
      return files.length === 0
        ? 'cleared'
        : files.length === 1 && input.isConnected && files[0] === file
          ? 'retained'
          : 'changed';
    };
    const previewNodes = () =>
      [...form.querySelectorAll<HTMLImageElement>('img[src]')].filter(visible);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await wait(250);
      if (!active())
        throw Error(
          'Image submission interrupted. Check Muse before retrying.',
        );
      if (
        !form.isConnected ||
        selection() === 'changed' ||
        composer(document) !== field ||
        field.value.trim()
      )
        throw uploadError('image-input-changed', 'The image composer changed.');
      const send = [
        ...form.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="Send"]',
        ),
      ].filter(visible);
      const previews = previewNodes();
      if (
        previews.length === 1 &&
        previews[0]!.complete &&
        previews[0]!.naturalWidth > 0 &&
        send.length === 1 &&
        !send[0]!.disabled &&
        !form.querySelector('[aria-busy="true"],[role="progressbar"]')
      ) {
        const preview = previews[0]!;
        const previewURL = preview.currentSrc || preview.src;
        const matchedBytes =
          selection() === 'cleared' &&
          (await matchesLocalPreview(previewURL, raw));
        const unchanged = () => {
          const current = previewNodes();
          return (
            active() &&
            form.isConnected &&
            composer(document) === field &&
            current.length === 1 &&
            current[0] === preview &&
            (preview.currentSrc || preview.src) === previewURL &&
            (selection() === 'retained' ||
              (selection() === 'cleared' && matchedBytes)) &&
            preview.complete &&
            preview.naturalWidth > 0 &&
            send[0]!.isConnected &&
            !send[0]!.matches(':disabled') &&
            !form.querySelector('[aria-busy="true"],[role="progressbar"]')
          );
        };
        if (!unchanged() || field.value.trim())
          throw uploadError(
            'image-input-changed',
            'The image preview could not be verified.',
          );
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
          !unchanged() ||
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
