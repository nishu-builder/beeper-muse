import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
  lstat,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { extensionFiles } from './package.mjs';

// Stage a complete package beside the existing folder. Preserve private files and
// never publish a ready marker until every asset has been copied successfully.
export async function installLocal(source, destination, registration) {
  source = resolve(source);
  destination = resolve(destination);
  await mkdir(dirname(destination), { recursive: true });
  const lock = destination + '.update-lock';
  await mkdir(lock); // Concurrent writers fail; never steal a stale lock.
  let stage,
    backup,
    moved = false;
  try {
    const info = JSON.parse(
      await readFile(join(source, 'build-info.json'), 'utf8'),
    );
    if (!/^[a-f0-9]{64}$/.test(info.build))
      throw Error('Missing build identity.');
    stage = await mkdtemp(destination + '.stage-');
    const exists = await lstat(destination).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (exists && (!exists.isDirectory() || exists.isSymbolicLink()))
      throw Error('The local installation must be a directory.');
    if (exists) await cp(destination, stage, { recursive: true });
    for (const name of extensionFiles) {
      await mkdir(dirname(join(stage, name)), { recursive: true });
      await cp(join(source, name), join(stage, name));
    }
    if (registration)
      await writeFile(
        join(stage, 'local-config.json'),
        JSON.stringify(registration),
        { mode: 0o600 },
      );
    await writeFile(
      join(stage, 'dev-update.json'),
      JSON.stringify({ ready: true, build: info.build }),
    );
    if (exists) {
      backup = await mkdtemp(destination + '.previous-');
      await rm(backup, { recursive: true });
      await rename(destination, backup);
      moved = true;
    }
    try {
      await rename(stage, destination);
      stage = undefined;
    } catch (error) {
      if (moved) {
        await rename(backup, destination);
        moved = false;
        backup = undefined;
      }
      throw error;
    }
    if (backup) {
      await rm(backup, { recursive: true });
      backup = undefined;
    }
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    // A failed rollback leaves the backup intact for recovery.
    await rm(lock, { recursive: true });
  }
}
