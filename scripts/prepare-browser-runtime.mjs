import { fileURLToPath } from 'node:url';
import { readRegistration } from './registration.mjs';
import { installLocal } from './install-local.mjs';
const root = new URL('../', import.meta.url);
try {
  const registration = process.argv[2]
    ? await readRegistration(process.argv[2])
    : undefined;
  const directory = fileURLToPath(new URL('.local/chrome-extension/', root));
  await installLocal(
    fileURLToPath(new URL('dist/chrome-extension/', root)),
    directory,
    registration,
  );
  console.log('Prepared local extension at ' + directory);
  console.log(
    'Existing installations with the update hook reload when idle. Initial setup requires loading/reloading this folder once.',
  );
} catch {
  console.error(
    'Could not update the local extension. Check the build, registration path and update lock. No credentials were printed.',
  );
  process.exitCode = 1;
}
