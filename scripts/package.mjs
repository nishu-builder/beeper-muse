import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
// An explicit allowlist prevents private pairing files, browser profiles, and
// development files from entering either the store upload or public download.
export const extensionFiles = [
  'manifest.json',
  'adapter.js',
  'background.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function packageExtension(source = join(root, 'extension')) {
  const manifest = JSON.parse(
    await readFile(join(source, 'manifest.json'), 'utf8'),
  );
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version)
    throw new Error('Package and manifest versions must match.');
  const tag = process.env.RELEASE_TAG;
  if (tag && tag !== 'v' + manifest.version)
    throw new Error('Release tag does not match the manifest.');
  const local = [],
    central = [];
  let offset = 0;
  for (const name of extensionFiles) {
    const path = join(source, name);
    if (!(await lstat(path)).isFile())
      throw new Error('Release files must be regular files.');
    const raw = await readFile(path),
      compressed = deflateRawSync(raw, { level: 9 });
    const filename = Buffer.from(name),
      crc = crc32(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // Fixed ZIP date: 1980-01-01.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(extensionFiles.length, 8);
  end.writeUInt16LE(extensionFiles.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archive = await packageExtension();
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/beeper-muse-extension.zip'), archive);
  await writeFile(
    join(root, 'dist/SHA256SUMS'),
    `${createHash('sha256').update(archive).digest('hex')}  beeper-muse-extension.zip\n`,
  );
  console.log(
    'Created dist/beeper-muse-extension.zip and dist/SHA256SUMS. No private pairing data is included.',
  );
}
