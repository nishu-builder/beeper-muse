import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const out = new URL('.local/theme-preview/', root);
await mkdir(out, { recursive: true });
const read = (name) => readFile(new URL(name, root), 'utf8');
const save = (name, text) => writeFile(new URL(name, out), text);
for (const name of ['theme.css', 'popup.css', 'connection.css'])
  await cp(
    new URL('browser-runtime/runtime/' + name, root),
    new URL(name, out),
  );
await cp(new URL('extension/icons/', root), new URL('icons/', out), {
  recursive: true,
});
await cp(new URL('site/', root), new URL('site/', out), { recursive: true });
const version = JSON.parse(await read('package.json')).version;
const stripScripts = (html) =>
  html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const textAt = (html, tag, id, text) =>
  html.replace(
    new RegExp(`(<${tag}[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</${tag}>)`),
    `$1${text}$2`,
  );
let popup = stripScripts(await read('browser-runtime/runtime/popup.html'));
popup = textAt(popup, 'span', 'version', 'v' + version);
let connected = popup
  .replace('id="controls" hidden', 'id="controls"')
  .replace(
    'id="connect" class="primary"',
    'id="connect" class="primary" hidden',
  )
  .replace('id="disconnect" hidden', 'id="disconnect"');
for (const id of ['beeper-state', 'muse-state']) {
  connected = textAt(connected, 'dd', id, 'Connected').replace(
    `id="${id}"`,
    `id="${id}" data-ready="true"`,
  );
}
connected = textAt(connected, 'p', 'status', 'Connected to Beeper and Muse.');
await save('popup-connected.html', connected);
let setup = popup.replace('id="setup" hidden', 'id="setup"');
setup = textAt(setup, 'dd', 'beeper-state', 'Not connected');
setup = textAt(setup, 'dd', 'muse-state', 'Not connected');
setup = textAt(
  setup,
  'p',
  'status',
  'Import your Beeper registration to get started.',
);
await save('popup-setup.html', setup);
let attention = textAt(
  connected,
  'p',
  'status',
  'Sending to Muse paused. An interrupted message is holding the queue. Check it below, then dismiss it to continue.',
);
attention = textAt(
  attention,
  'p',
  'progress',
  '1 queued · 0 waiting for message keys · 1 interrupted',
);
attention = attention.replace(
  '<div id="blocked"></div>',
  '<div id="blocked"><p>This message needs attention. Check Muse before sending it again: image.png Image submission was interrupted or Muse could not confirm its preview.</p><button>Dismiss this job</button></div>',
);
await save('popup-attention.html', attention);
let connection = stripScripts(
  await read('browser-runtime/runtime/connection.html'),
);
connection = textAt(
  connection,
  'p',
  'connection-status',
  'Connected to Beeper.',
);
await save('connection-preview.html', connection);
for (const name of [
  'overview.html',
  'extension.html',
  'tile.html',
  'artwork.css',
])
  await cp(new URL('docs/store/' + name, root), new URL(name, out));
const site = await read('site/index.html');
const figure = site.match(/<figure\b[\s\S]*?<\/figure>/)?.[0];
if (!figure) throw new Error('Website diagram is missing');
await save(
  'diagram.html',
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Diagram illustration</title><link rel="stylesheet" href="site/style.css"><style>body{width:1100px;margin:0}.bridge-demo{margin:0;padding:20px 12px 0}figcaption{display:none}</style></head><body>${figure.replaceAll('src="./', 'src="site/')}</body></html>`,
);
console.log(
  'Design previews prepared in .local/theme-preview. Controls are inactive and use example state only.',
);
