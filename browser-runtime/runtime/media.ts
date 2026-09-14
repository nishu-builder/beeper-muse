export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
export interface IncomingImage {
  name: string;
  mime: string;
  url: string;
  file?: Record<string, unknown>;
}
export function mediaPath(uri: string): string {
  const match =
    /^mxc:\/\/([a-zA-Z0-9.-]+(?::[0-9]{1,5})?)\/([a-zA-Z0-9_-]+)$/.exec(uri);
  if (!match) throw Error('Invalid Matrix image address.');
  return (
    '/_matrix/client/v1/media/download/' +
    encodeURIComponent(match[1]!) +
    '/' +
    encodeURIComponent(match[2]!)
  );
}
export function incomingImage(content: Record<string, unknown>): IncomingImage {
  const info = content.info as Record<string, unknown> | undefined;
  if (!info || !imageTypes.has(String(info.mimetype)))
    throw Error('Use a PNG, JPEG, GIF or WebP image.');
  if (
    info.size !== undefined &&
    (typeof info.size !== 'number' ||
      !Number.isSafeInteger(info.size) ||
      info.size <= 0 ||
      info.size > MAX_IMAGE_BYTES)
  )
    throw Error('Image exceeds the 5 MB limit.');
  const file = content.file;
  if (
    file !== undefined &&
    (!file || typeof file !== 'object' || Array.isArray(file))
  )
    throw Error('Invalid encrypted image.');
  const encrypted = file as Record<string, unknown> | undefined;
  const url = encrypted ? encrypted.url : content.url;
  if (typeof url !== 'string') throw Error('Image has no Matrix address.');
  mediaPath(url);
  if (
    encrypted &&
    (encrypted.v !== 'v2' ||
      !encrypted.key ||
      !encrypted.hashes ||
      typeof encrypted.iv !== 'string')
  )
    throw Error('Invalid encrypted image.');
  const name =
    String(content.filename || content.body || 'image')
      .replace(/[\x00-\x1f\x7f/\\]/g, '_')
      .slice(0, 180) || 'image';
  return {
    name,
    mime: String(info.mimetype),
    url,
    ...(encrypted ? { file: encrypted } : {}),
  };
}
export async function boundedBytes(
  response: Response,
  limit = MAX_IMAGE_BYTES,
): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw Error('Image download failed.');
  const advertised = Number(response.headers.get('content-length'));
  if (advertised > limit) {
    await response.body.cancel();
    throw Error('Image exceeds the 5 MB limit.');
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw Error('Image exceeds the 5 MB limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!length) throw Error('Image is empty.');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export function imageSignature(bytes: Uint8Array, mime: string) {
  const start = (...prefix: number[]) => prefix.every((b, i) => bytes[i] === b);
  return (
    (mime === 'image/png' && start(137, 80, 78, 71, 13, 10, 26, 10)) ||
    (mime === 'image/jpeg' && start(255, 216, 255)) ||
    (mime === 'image/gif' &&
      (start(71, 73, 70, 56, 55, 97) || start(71, 73, 70, 56, 57, 97))) ||
    (mime === 'image/webp' &&
      start(82, 73, 70, 70) &&
      [87, 69, 66, 80].every((b, i) => bytes[i + 8] === b))
  );
}
export function encodeImage(bytes: Uint8Array) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
