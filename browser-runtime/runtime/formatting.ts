import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

type Node = DefaultTreeAdapterTypes.ChildNode;
const allowed = new Set(
  'del h1 h2 h3 h4 h5 h6 blockquote p a ul ol sup sub li b i u strong em s code hr br div table thead tbody tr th td caption pre span details summary'.split(
    ' ',
  ),
);
const discard = new Set(
  'script style template iframe object embed svg math textarea input select button form noscript mx-reply'.split(
    ' ',
  ),
);
const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (value: string) =>
  escapeText(value).replace(/"/g, '&quot;');
function href(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      value.length <= 4096 &&
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Relative and unsafe links are rendered as text. */
  }
}

/** Emit a bounded subset of Matrix HTML; empty output means use the plain body. */
export function validateSourceHTML(html: string): string {
  if (html.length > 200000) throw Error('Muse formatting is too large.');
  const fragment = parseFragment(html);
  let nodes = 0;
  let size = 0;
  let visibleContent = false;
  const output: string[] = [];
  const emit = (value: string) => {
    size += value.length;
    if (size > 200000) return false;
    output.push(value);
    return true;
  };
  function visit(node: Node, depth: number): boolean {
    if (++nodes > 10000 || depth > 100) return false;
    if ('value' in node) {
      if (node.value.trim()) visibleContent = true;
      return emit(escapeText(node.value));
    }
    if (!('tagName' in node)) return true;
    const tag = node.tagName === 'tfoot' ? 'tbody' : node.tagName;
    if (
      node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
      discard.has(tag)
    )
      return true;
    const keep = allowed.has(tag);
    if (keep) {
      if (tag === 'hr') visibleContent = true;
      let attrs = '';
      const attr = (name: string) =>
        node.attrs.find((a) => a.name === name)?.value || '';
      if (tag === 'a') {
        const url = href(attr('href'));
        if (url) attrs = ' href="' + escapeAttribute(url) + '"';
      } else if (tag === 'ol') {
        const start = attr('start');
        if (/^-?\d{1,10}$/.test(start) && Math.abs(Number(start)) <= 2147483647)
          attrs = ' start="' + Number(start) + '"';
      } else if (tag === 'code') {
        const language = attr('class')
          .split(/\s+/)
          .find((c) => /^language-[a-zA-Z0-9_+.#-]{1,40}$/.test(c));
        if (language) attrs = ' class="' + language + '"';
      }
      if (!emit('<' + tag + attrs + '>')) return false;
    }
    for (const child of node.childNodes)
      if (!visit(child, depth + 1)) return false;
    return !keep || tag === 'br' || tag === 'hr' || emit('</' + tag + '>');
  }
  for (const node of fragment.childNodes) if (!visit(node, 1)) return '';
  return visibleContent ? output.join('') : '';
}
