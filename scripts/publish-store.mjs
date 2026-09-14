import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// Run only in the protected release environment, after packaging and checks.
// Do not print response bodies: OAuth errors can contain credential details.
async function jsonRequest(label, url, options) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new Error(
      `${label} did not return a response. Inspect the dashboard before retrying.`,
    );
  }
  if (!response.ok)
    throw new Error(`${label} failed (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an invalid response.`);
  }
}
export async function publish(
  env = process.env,
  request = jsonRequest,
  sleep = wait,
) {
  for (const key of [
    'CWS_CLIENT_ID',
    'CWS_CLIENT_SECRET',
    'CWS_REFRESH_TOKEN',
    'CWS_PUBLISHER_ID',
    'CWS_EXTENSION_ID',
  ]) {
    if (!env[key])
      throw new Error(
        `Missing ${key}; configure the chrome-web-store environment.`,
      );
  }
  if (
    !/^[a-p]{32}$/.test(env.CWS_EXTENSION_ID) ||
    !/^[a-zA-Z0-9-]+$/.test(env.CWS_PUBLISHER_ID)
  )
    throw new Error('Invalid store item identifiers.');
  const manifest = JSON.parse(
    await readFile(
      new URL('../browser-runtime/runtime/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  if (env.RELEASE_TAG !== `v${manifest.version}`)
    throw new Error('Release tag and manifest must match.');
  const archive = await readFile(
    new URL('../dist/beeper-muse-extension.zip', import.meta.url),
  );
  const auth = await request(
    'Google authorization',
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.CWS_CLIENT_ID,
        client_secret: env.CWS_CLIENT_SECRET,
        refresh_token: env.CWS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    },
  );
  if (typeof auth.access_token !== 'string' || !auth.access_token)
    throw new Error('Google returned no access token.');
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const name = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
  const base = `https://chromewebstore.googleapis.com/v2/${name}`;
  const upload = await request(
    'Store upload',
    `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: archive,
    },
  );
  let uploadState = upload.uploadState;
  if (upload.crxVersion && upload.crxVersion !== manifest.version)
    throw new Error('The uploaded store version does not match this release.');
  for (
    let attempt = 0;
    uploadState === 'IN_PROGRESS' && attempt < 30;
    attempt++
  ) {
    await sleep(10000);
    const status = await request('Store upload status', `${base}:fetchStatus`, {
      headers,
    });
    uploadState = status.lastAsyncUploadState;
  }
  if (uploadState !== 'SUCCEEDED')
    throw new Error(
      'Upload was not confirmed successful. Inspect the Package page before retrying.',
    );
  const result = await request('Store submission', `${base}:publish`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publishType: 'DEFAULT_PUBLISH',
      blockOnWarnings: true,
    }),
  });
  if (
    result.itemId !== env.CWS_EXTENSION_ID ||
    typeof result.state !== 'string'
  )
    throw new Error('Submission response was unexpected. Check the dashboard.');
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  publish()
    .then(() => {
      console.log(
        'Store accepted the submission. Check the dashboard for review and publication status.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
