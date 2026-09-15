import { readFile, mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { Desktop, DevError, object, type Target } from './desktop.ts';
import {
  diagnostics,
  ready,
  newRun,
  readRun,
  sendOnce,
  assess,
  type Scenario,
  type Run,
} from './runner.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const local = resolve(root, '.local');
const active = resolve(local, 'dev-loop-active.json');
const lock = resolve(local, 'dev-loop.lock');
async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temp, path);
}
let locked = false;
try {
  const command = process.argv[2] || 'doctor';
  if (!['doctor', 'run', 'observe', 'close'].includes(command))
    throw new DevError('Use doctor, run, observe or close.');
  const cfg = object(await json(resolve(local, 'dev-loop.json')));
  for (const key of [
    'chatID',
    'botID',
    'ownerID',
    'tokenFile',
    'diagnosticFile',
  ])
    if (typeof cfg[key] !== 'string' || !cfg[key])
      throw new DevError('Incomplete .local/dev-loop.json.');
  const target: Target = {
    chatID: String(cfg.chatID),
    botID: String(cfg.botID),
    ownerID: String(cfg.ownerID),
  };
  const credentials = object(await json(resolve(root, String(cfg.tokenFile))));
  const token = credentials.token || credentials.beeperToken;
  if (typeof token !== 'string' || !token)
    throw new DevError('No Desktop API token in the configured token file.');
  const desktop = new Desktop(token);
  const version = String(
    object(await json(resolve(root, 'package.json'))).version,
  );
  const build = String(
    object(await json(resolve(local, 'chrome-extension/dev-update.json')))
      .build,
  );
  const logPath = resolve(root, String(cfg.diagnosticFile));
  async function readLog() {
    try {
      if ((await stat(logPath)).size > 256 * 1024) throw Error();
      return await json(logPath);
    } catch {
      throw new DevError(
        'Diagnostic file unavailable. Choose beeper-muse-diagnostics.json once in Chrome.',
      );
    }
  }
  if (command === 'doctor') {
    const checks: Record<string, unknown> = {};
    try {
      await desktop.verify(target);
      checks.target = 'passed';
    } catch (error) {
      checks.target = error instanceof DevError ? error.message : 'Unavailable';
    }
    if (checks.target === 'passed')
      try {
        await desktop.messages(target, Date.now() - 60000);
        checks.messageSearch = 'passed';
      } catch (error) {
        checks.messageSearch =
          error instanceof DevError ? error.message : 'Unavailable';
      }
    if (checks.target === 'passed')
      try {
        await desktop.verifySendPath(target);
        checks.sendPath = 'passed';
      } catch (error) {
        checks.sendPath =
          error instanceof DevError ? error.message : 'Unavailable';
      }
    try {
      const raw = await readLog(),
        d = diagnostics(raw);
      checks.health = d.health;
      checks.logFresh = d.fresh;
      checks.collection = d.collection;
      checks.collectionFresh = d.collectionFresh;
      checks.recentEvents = d.events.slice(-12);
      ready(raw, version, build);
      checks.readyToTest =
        checks.target === 'passed' &&
        checks.messageSearch === 'passed' &&
        checks.sendPath === 'passed';
    } catch (error) {
      checks.readyToTest = false;
      checks.diagnostics =
        error instanceof DevError ? error.message : 'Unavailable';
    }
    await save(resolve(local, 'dev-doctor.json'), {
      at: Date.now(),
      version,
      checks,
    });
    console.log(JSON.stringify(checks, null, 2));
    if (
      checks.target !== 'passed' ||
      checks.messageSearch !== 'passed' ||
      !checks.readyToTest
    )
      process.exitCode = 2;
  } else {
    await mkdir(local, { recursive: true });
    try {
      await mkdir(lock);
      locked = true;
    } catch {
      throw new DevError(
        'Another development test owns the lock. Do not start a second sender.',
      );
    }
    await writeFile(
      resolve(lock, 'owner.json'),
      JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      { mode: 0o600 },
    );
    if (command === 'close') {
      const run = readRun(await json(active), target);
      await save(resolve(local, 'dev-runs', run.id + '.json'), {
        ...run,
        closedAt: Date.now(),
      });
      await rm(active);
      console.log(
        'Test record closed. No bridge job was dismissed or retried.',
      );
    } else {
      await desktop.verify(target);
      let run: Run;
      if (command === 'run') {
        try {
          await stat(active);
          throw new DevError(
            'An earlier test remains open. Use dev:observe; do not resend.',
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const scenario = process.argv[3] || 'text';
        if (!['text', 'image', 'receive-image'].includes(scenario))
          throw new DevError('Choose text, image or receive-image.');
        ready(await readLog(), version, build);
        await desktop.messages(target, Date.now() - 60000);
        run = newRun(target, scenario as Scenario);
        await save(active, run);
        await sendOnce(desktop, run, (r) => save(active, r));
        console.log('One synthetic test sent. Observing without resending.');
      } else run = readRun(await json(active), target);
      const until = Date.now() + 45000;
      let last = '';
      do {
        const messages = await desktop.messages(
          target,
          run.startedAt - 1000,
          run.scenario === 'receive-image',
        );
        const result = assess(run, messages);
        let log: ReturnType<typeof diagnostics> | undefined;
        try {
          log = diagnostics(await readLog());
        } catch {
          /* Report unavailable separately. */
        }
        const report = {
          id: run.id,
          scenario: run.scenario,
          at: Date.now(),
          version,
          ...result,
          logFresh: log?.fresh || false,
          health: log?.health,
          events:
            log?.events.filter((e) => e.time >= run.startedAt).slice(-30) || [],
        };
        await save(resolve(local, 'dev-runs', run.id + '.report.json'), report);
        const summary = JSON.stringify(result);
        if (summary !== last) {
          console.log(summary);
          last = summary;
        }
        if (result.outcome === 'passed') {
          await save(resolve(local, 'dev-runs', run.id + '.json'), run);
          await rm(active);
          break;
        }
        if (result.outcome === 'failed' || log?.health?.blocked) {
          process.exitCode = 2;
          break;
        }
        if (Date.now() >= until) {
          console.log(
            'Still unverified. Run dev:observe to continue this same test.',
          );
          process.exitCode = 2;
          break;
        }
        await wait(3000);
      } while (true);
    }
  }
} catch (error) {
  console.error(
    error instanceof DevError
      ? error.message
      : 'Development check could not finish. Check the private configuration and saved run. No automatic resend.',
  );
  process.exitCode = 2;
} finally {
  if (locked) await rm(lock, { recursive: true });
}
