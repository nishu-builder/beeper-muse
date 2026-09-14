import { execFileSync } from 'node:child_process';
const gh = (args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
try {
  const secrets = JSON.parse(
    gh(['secret', 'list', '--env', 'chrome-web-store', '--json', 'name']),
  );
  const variables = JSON.parse(
    gh([
      'variable',
      'list',
      '--env',
      'chrome-web-store',
      '--json',
      'name,value',
    ]),
  );
  const required = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
  const missing = required.filter(
    (name) => !secrets.some((s) => s.name === name),
  );
  for (const name of ['CWS_EXTENSION_ID', 'CWS_PUBLISHER_ID'])
    if (!variables.some((v) => v.name === name && v.value)) missing.push(name);
  if (missing.length)
    throw Error(
      'Missing in the chrome-web-store environment: ' +
        missing.join(', ') +
        '. See docs/RELEASING.md.',
    );
  if (process.argv.includes('--enable')) {
    gh(['variable', 'set', 'CWS_PUBLISH', '--body', 'true']);
    console.log(
      'Automatic store submission enabled for future release tags. Google review still applies.',
    );
  } else
    console.log(
      'Required secret names and publishing IDs are configured. Use npm run store:check -- --enable to enable future tag submissions.',
    );
} catch (error) {
  console.error(
    error instanceof Error && !('status' in error)
      ? error.message
      : 'Could not inspect GitHub publishing settings. Check gh authentication and repository access.',
  );
  process.exitCode = 1;
}
