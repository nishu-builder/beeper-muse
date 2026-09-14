// One-time conversion of an existing bbctl bridgev2 config; no process remains.
import { writeFile, cp, mkdir, chmod } from 'node:fs/promises';
import { readRegistration } from './registration.mjs';
const root = new URL('../', import.meta.url);
const input = process.argv[2];
if (!input) {
  console.error(
    'Usage: npm run prepare:browser-runtime -- /path/to/bridge.yaml',
  );
  process.exit(1);
}
try {
  const registration = await readRegistration(input);
  const directory = new URL('.local/chrome-extension/', root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await cp(new URL('dist/chrome-extension/', root), directory, {
    recursive: true,
  });
  await writeFile(
    new URL('local-config.json', directory),
    JSON.stringify(registration),
    { mode: 0o600 },
  );
  console.log('Prepared private extension at ' + directory.pathname);
  console.log('Load that directory unpacked in Chrome, then refresh Muse.');
} catch {
  console.error(
    'Could not prepare the extension. Check the bridgev2 config and build. No credentials were printed.',
  );
  process.exitCode = 1;
}
