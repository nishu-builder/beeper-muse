import { deflateSync } from 'node:zlib';
// Synthetic solid-color PNG, generated locally; never use a personal photo.
export function colorPNG(color: 'RED' | 'BLUE'): Buffer {
  function chunk(name: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      check = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, check]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64);
  header.writeUInt32BE(64, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      pixels[y * 193 + 1 + x * 3 + (color === 'RED' ? 0 : 2)] = 255;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
