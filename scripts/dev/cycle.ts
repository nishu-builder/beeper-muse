import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { DevError, object } from './desktop.ts';
import { ready, diagnostics } from './runner.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const lock = resolve(root, '.local/dev-cycle.lock');
const json = async (path: string) =>
  object(JSON.parse(await readFile(path, 'utf8')));
async function command(program: string, args: string[]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(program, args, { cwd: root, stdio: 'inherit' });
    child.once('error', () =>
      fail(new DevError('Could not start development command.')),
    );
    child.once('exit', (code) =>
      code === 0
        ? done()
        : fail(
            new DevError(
              'Cycle stopped at the check above. No test is automatically resent.',
            ),
          ),
    );
  });
}
let locked = false;
try {
  if (process.argv.slice(2).some((arg) => arg !== '--receive-image'))
    throw new DevError('Only --receive-image is supported.');
  await mkdir(resolve(root, '.local'), { recursive: true });
  try {
    await mkdir(lock);
    locked = true;
  } catch {
    throw new DevError('Another development cycle owns the build lock.');
  }
  await writeFile(
    resolve(lock, 'owner.json'),
    JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
    { mode: 0o600 },
  );
  const cfg = await json(resolve(root, '.local/dev-loop.json'));
  const logPath = resolve(root, String(cfg.diagnosticFile));
  // Fail quickly on missing one-time setup; never make a build look like a live pass.
  const before = diagnostics(await json(logPath));
  if (!before.fresh)
    throw new DevError(
      'Enable the diagnostic file once in Chrome before running a cycle.',
    );
  const h = before.health!;
  ready(await json(logPath), h.version, h.build);
  await command('npm', ['run', 'check']);
  await command('npm', ['run', 'update:local']);
  const version = String((await json(resolve(root, 'package.json'))).version);
  const build = String(
    (await json(resolve(root, '.local/chrome-extension/dev-update.json')))
      .build,
  );
  console.log(
    'Waiting for the installed extension to report this exact build.',
  );
  const deadline = Date.now() + 90000;
  while (true) {
    try {
      ready(await json(logPath), version, build);
      break;
    } catch {
      if (Date.now() >= deadline)
        throw new DevError(
          'The installed build did not become ready. Run dev:doctor; no tests sent.',
        );
      await wait(3000);
    }
  }
  for (const scenario of [
    'text',
    'image',
    'text',
    ...(process.argv.includes('--receive-image') ? ['receive-image'] : []),
  ]) {
    // Wait for the diagnostic heartbeat to reflect completion of the previous job.
    const idleDeadline = Date.now() + 30000;
    while (true) {
      try {
        ready(await json(logPath), version, build);
        break;
      } catch {
        if (Date.now() >= idleDeadline)
          throw new DevError('The previous test has not returned to idle.');
        await wait(3000);
      }
    }
    console.log('Running live ' + scenario + ' test.');
    await command(process.execPath, [
      '--import',
      'tsx',
      'scripts/dev/cli.ts',
      'run',
      scenario,
    ]);
  }
  console.log(
    'Live API checks passed. Client rendering, typing, notifications and source timestamps still require separate evidence.',
  );
} catch (error) {
  console.error(
    error instanceof DevError
      ? error.message
      : 'Cycle setup unavailable. Run dev:doctor for the missing prerequisite.',
  );
  process.exitCode = 2;
} finally {
  if (locked) await rm(lock, { recursive: true });
}
