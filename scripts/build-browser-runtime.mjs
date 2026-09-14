import { build } from 'esbuild';
import {
  mkdir,
  copyFile,
  cp,
  rm,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const output = new URL('dist/chrome-extension/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Stable across machines: hash source bytes and paths, never timestamps/private files.
const hash = createHash('sha256');
async function fingerprint(directory) {
  for (const entry of (
    await readdir(new URL(directory, root), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = directory + entry.name;
    if (entry.isDirectory()) await fingerprint(path + '/');
    else if (entry.isFile()) {
      hash.update(path + '\0');
      hash.update(await readFile(new URL(path, root)));
    }
  }
}
for (const directory of [
  'src/',
  'browser-runtime/runtime/',
  'extension/icons/',
])
  await fingerprint(directory);
for (const path of [
  'extension/content.js',
  'package-lock.json',
  'scripts/build-browser-runtime.mjs',
]) {
  hash.update(path + '\0');
  hash.update(await readFile(new URL(path, root)));
}
const buildID = hash.digest('hex');
await build({
  define: { __BEEPER_MUSE_BUILD_ID__: JSON.stringify(buildID) },
  entryPoints: [
    'browser-runtime/runtime/background.ts',
    'browser-runtime/runtime/popup.ts',
    'browser-runtime/runtime/connection.ts',
  ],
  outdir: output.pathname,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'chrome127',
  sourcemap: false,
  legalComments: 'eof',
});
for (const name of [
  'manifest.json',
  'popup.html',
  'popup.css',
  'connection.html',
  'connection.css',
])
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
for (const [dependency, file] of [
  ['parse5', 'PARSE5-LICENSE'],
  ['entities', 'ENTITIES-LICENSE'],
])
  await copyFile(
    new URL('node_modules/' + dependency + '/LICENSE', root),
    new URL(file, output),
  );
for (const name of ['LICENSE', 'NOTICES.md'])
  await copyFile(new URL(name, root), new URL(name, output));
console.log('Built dist/chrome-extension without private registration data.');

await writeFile(
  new URL('build-info.json', output),
  JSON.stringify({ build: buildID }),
);
