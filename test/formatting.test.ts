import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { validateSourceHTML } from '../browser-runtime/runtime/formatting.ts';

test('Matrix formatting preserves headings, tables, continued lists and code language', () => {
  const result = validateSourceHTML(
    '<h2>Options</h2><table><caption>Sizes</caption><tr><th>Name</th><th>Price</th></tr><tr><td>Small</td><td>$5</td></tr></table><ol start="2" onclick="run()"><li>Second</li><li>Third</li></ol><pre><code class="hljs language-ts other">  let x = &lt;tag&gt;;\n</code></pre>',
  );
  const f = JSDOM.fragment(result);
  assert.equal(f.querySelector('h2')?.textContent, 'Options');
  assert.equal(f.querySelectorAll('tr').length, 2);
  assert.equal(f.querySelectorAll('td')[1]?.textContent, '$5');
  assert.equal(f.querySelector('ol')?.getAttribute('start'), '2');
  assert.equal(f.querySelector('code')?.getAttribute('class'), 'language-ts');
  assert.equal(f.querySelector('code')?.textContent, '  let x = <tag>;\n');
  assert.equal(f.querySelector('[onclick]'), null);
  assert.equal(validateSourceHTML(result), result);
});

test('malformed markup and decoded attributes cannot introduce active content', () => {
  const fixtures = [
    '<p title="broken >"><b>safe</p><script>alert(1)</script><style>bad</style>',
    '<a href="java&#x73;cript:alert(1)">label</a><a href="https://user:secret@example.com">credential link</a>',
    '<svg><foreignObject><p onclick="bad()">hidden</p></foreignObject></svg><math><mtext><img src=x onerror=bad()></mtext></math><p>visible</p>',
    '<template><img src=x onerror=bad()></template><iframe>hidden</iframe><button>Confirm payment</button><mx-reply>old quoted fallback</mx-reply>',
    '<p>&lt;img src=x onerror=bad()&gt; &amp; text</p><a href="https://example.org/?x=1&amp;y=&quot;z&quot;">link</a>',
    '<table><tr><td>one<td>two</table><h3>Heading',
  ];
  for (const raw of fixtures) {
    const safe = validateSourceHTML(raw);
    const f = JSDOM.fragment(safe);
    assert.equal(
      f.querySelector(
        'script,style,svg,math,template,iframe,button,img,mx-reply',
      ),
      null,
    );
    for (const el of f.querySelectorAll('*'))
      for (const attr of el.attributes)
        assert.ok(['href', 'start', 'class'].includes(attr.name));
    for (const a of f.querySelectorAll('a[href]')) {
      const url = new URL(a.getAttribute('href')!);
      assert.ok(['https:', 'http:'].includes(url.protocol));
      assert.equal(url.username, '');
      assert.equal(url.password, '');
    }
    assert.equal(validateSourceHTML(safe), safe);
  }
});

test('oversized and excessively nested formatting cannot partially hide the plain fallback', () => {
  assert.throws(() => validateSourceHTML('a'.repeat(200001)), /too large/);
  assert.equal(
    validateSourceHTML('<div>'.repeat(101) + 'Text' + '</div>'.repeat(101)),
    '',
  );
  assert.equal(validateSourceHTML('<br>'.repeat(10001)), '');
  assert.equal(validateSourceHTML('&'.repeat(50000)), '');
  assert.equal(validateSourceHTML('<script>hidden</script>'), '');
  assert.equal(validateSourceHTML('<div> \n<span></span></div>'), '');
});

test('unsupported styling and table footer roles degrade to safe supported structure', () => {
  const result = validateSourceHTML(
    '<table><tfoot><tr><td style="color:red">Total</td></tr></tfoot></table><ol start="9999999999999999999"><li>Entry</li></ol><code class="language-x&quot;onclick=bad">x</code>',
  );
  const f = JSDOM.fragment(result);
  assert.equal(f.querySelector('tfoot'), null);
  assert.equal(f.querySelector('tbody td')?.textContent, 'Total');
  assert.equal(f.querySelector('ol')?.hasAttribute('start'), false);
  assert.equal(f.querySelector('[style],[class],[onclick]'), null);
});
