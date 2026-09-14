import { build } from 'esbuild';
import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const output = new URL('dist/chrome-extension/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  entryPoints: [
    'browser-runtime/runtime/background.ts',
    'browser-runtime/runtime/popup.ts',
  ],
  outdir: output.pathname,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome127',
  sourcemap: false,
  legalComments: 'eof',
});
for (const name of ['manifest.json', 'popup.html', 'popup.css'])
  await copyFile(
    new URL('browser-runtime/runtime/' + name, root),
    new URL(name, output),
  );
for (const name of ['adapter.js', 'sync.js', 'activity.js', 'content.js'])
  await copyFile(new URL('extension/' + name, root), new URL(name, output));
await cp(new URL('extension/icons/', root), new URL('icons/', output), {
  recursive: true,
});
await copyFile(
  new URL(
    'node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm',
    root,
  ),
  new URL('crypto.wasm', output),
);
await copyFile(
  new URL('node_modules/@matrix-org/matrix-sdk-crypto-wasm/LICENSE', root),
  new URL('MATRIX-CRYPTO-LICENSE', output),
);
await copyFile(new URL('LICENSE', root), new URL('LICENSE', output));
console.log('Built dist/chrome-extension without private registration data.');
