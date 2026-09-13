(() => {
  'use strict';
  const visible = (element) =>
    !!(
      element.getBoundingClientRect().width &&
      element.getBoundingClientRect().height
    );
  function composer(document) {
    const fields = [
      ...document.querySelectorAll('textarea[aria-label="Message"]'),
    ].filter(visible);
    if (fields.length !== 1 || fields[0].disabled || fields[0].readOnly)
      throw new Error('Muse composer unavailable.');
    return fields[0];
  }
  function text(element) {
    const clone = element.cloneNode(true);
    clone
      .querySelectorAll('button,script,style,svg,[aria-hidden="true"]')
      .forEach((n) => n.remove());
    clone.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (/^https?:\/\//.test(href) && a.textContent !== href)
        a.appendChild(element.ownerDocument.createTextNode(' (' + href + ')'));
    });
    clone
      .querySelectorAll('p,li,pre,blockquote,br')
      .forEach((n) => n.after(element.ownerDocument.createTextNode('\n')));
    return (clone.textContent || '').trim();
  }
  function snapshot(document) {
    const logs = [
      ...document.querySelectorAll('[role="log"][aria-label="Chat messages"]'),
    ].filter(visible);
    if (logs.length !== 1) throw new Error('Open the main Muse chat.');
    return {
      busy: [...document.querySelectorAll('button[aria-label="Stop"]')].some(
        visible,
      ),
      draft: composer(document).value,
      messages: [
        ...logs[0].querySelectorAll('[data-message-item][data-message-id]'),
      ].map((e) => ({
        id: e.getAttribute('data-message-id'),
        role: e.getAttribute('data-message-role'),
        text: text(e),
        widget: e.getAttribute('data-message-has-presentation') === 'true',
      })),
    };
  }
  const normalize = (value) =>
    value
      .replace(/^You:\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  function responseAfter(beforeIDs, prompt, snapshot) {
    const users = snapshot.messages.filter(
      (m) => m.role === 'user' && !beforeIDs.has(m.id),
    );
    if (
      users.some((m) => normalize(m.text) !== normalize(prompt)) ||
      users.length > 1
    )
      throw new Error('Another message was entered in the Muse tab.');
    const echo = users.find((m) => normalize(m.text) === normalize(prompt));
    if (!echo) return null;
    const after = snapshot.messages.slice(snapshot.messages.indexOf(echo) + 1);
    const responses = after.filter(
      (m) =>
        m.role === 'assistant' && !beforeIDs.has(m.id) && !m.widget && m.text,
    );
    if (!responses.length) return null;
    return responses
      .map((m) => m.text)
      .join('\n\n')
      .slice(0, 23000);
  }
  async function submit(document, prompt, wait) {
    const initial = snapshot(document);
    if (initial.busy || initial.draft.trim())
      throw new Error('Muse is busy or has an existing draft.');
    const field = composer(document);
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(
      document.defaultView.HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setter.call(field, prompt);
    field.dispatchEvent(
      new document.defaultView.Event('input', { bubbles: true }),
    );
    await wait(150);
    const buttons = [
      ...document.querySelectorAll('button[aria-label="Send"]'),
    ].filter(visible);
    if (
      buttons.length !== 1 ||
      buttons[0].disabled ||
      composer(document).value !== prompt
    )
      throw new Error('Muse send control changed.');
    buttons[0].click();
    return new Set(initial.messages.map((m) => m.id));
  }
  globalThis.BeeperMuseDOM = { snapshot, responseAfter, submit };
})();
