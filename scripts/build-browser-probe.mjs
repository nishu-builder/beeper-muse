import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/browser-probe/', root), { recursive: true });
for (const file of ['manifest.json', 'popup.html', 'popup.css'])
  await cp(
    new URL('browser-runtime/probe/' + file, root),
    new URL('dist/browser-probe/' + file, root),
  );
console.log(
  'Built dist/browser-probe. A separate private registration is required.',
);
