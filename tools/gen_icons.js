/**
 * 生成基础 PNG 图标（无第三方依赖）
 * node tools/gen_icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(size) {
  const width = size;
  const height = size;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const rOuter = size * 0.42;
  const rDot = size * 0.09;

  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let r = 11;
      let g = 18;
      let b = 32;
      let a = 0;

      if (dist <= rOuter) {
        const t = dist / rOuter;
        r = Math.round(37 + (96 - 37) * (1 - t));
        g = Math.round(99 + (165 - 99) * (1 - t));
        b = 235;
        a = 255;
        if (dist > rOuter - 1.2) a = Math.round((255 * (rOuter - dist)) / 1.2);
      }

      // progress arc feel
      if (dist <= rOuter * 0.78 && dist >= rOuter * 0.58) {
        const ang = Math.atan2(dy, dx);
        // highlight upper-right arc
        if (ang > -2.2 && ang < 0.6) {
          r = 96;
          g = 165;
          b = 250;
        } else {
          r = Math.round(r * 0.35 + 15 * 0.65);
          g = Math.round(g * 0.35 + 23 * 0.65);
          b = Math.round(b * 0.35 + 42 * 0.65);
        }
      }

      // green seed
      const d2 = Math.sqrt((dx - size * 0.1) ** 2 + (dy - size * 0.05) ** 2);
      if (d2 <= rDot) {
        r = 52;
        g = 211;
        b = 153;
        a = 255;
      }

      // center core
      if (dist <= size * 0.09) {
        r = 241;
        g = 245;
        b = 249;
        a = 255;
      }

      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon-${size}.png`);
  const buf = createPNG(size);
  fs.writeFileSync(file, buf);
  console.log('wrote', file, buf.length);
}
