// tmp_pngcmp.js — decode two PNGs, sample pixels and emit side-by-side crops
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0;
  const idat = [];
  const rawPalette = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  if (interlace !== 0) throw new Error('interlaced not supported');
  const chans = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : -1;
  if (chans < 0) throw new Error('unsupported color type ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * chans;
  const out = Buffer.alloc(w * h * 4, 255);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (chans === 4) { out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1]; out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3]; }
      else if (chans === 3) { out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; }
      else if (chans === 1) { out[o] = out[o + 1] = out[o + 2] = line[x]; }
      else { out[o] = out[o + 1] = out[o + 2] = line[x * 2]; }
    }
  }
  return { w, h, data: out };
}

const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function px(img, x, y) { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; }
function hex(c) { return '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join(''); }
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function regionStats(img, x0, y0, x1, y1, thresh) {
  let n = 0, ink = 0, sum = [0, 0, 0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = px(img, x, y); if (lum(c) > thresh) { n++; sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; }
    ink++;
  }
  return { above: n, total: ink, pct: (100 * n / ink).toFixed(2), meanInk: n ? hex(sum.map(v => Math.round(v / n))) : 'n/a' };
}
function cropScale(img, x, y, w, h, scale) {
  const ow = w * scale, oh = h * scale;
  const out = Buffer.alloc(ow * oh * 4);
  for (let yy = 0; yy < oh; yy++) for (let xx = 0; xx < ow; xx++) {
    const src = px(img, Math.min(img.w - 1, x + Math.floor(xx / scale)), Math.min(img.h - 1, y + Math.floor(yy / scale)));
    const o = (yy * ow + xx) * 4; out[o] = src[0]; out[o + 1] = src[1]; out[o + 2] = src[2]; out[o + 3] = 255;
  }
  return { w: ow, h: oh, data: out };
}
function stack(a, b, gap) {
  const w = Math.max(a.w, b.w); const h = a.h + gap + b.h;
  const out = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h * 4; i += 4) { out[i] = 255; out[i + 1] = 0; out[i + 2] = 255; out[i + 3] = 255; }
  const blit = (img, oy) => { for (let y = 0; y < img.h; y++) img.data.copy(out, ((oy + y) * w) * 4, y * img.w * 4, y * img.w * 4 + img.w * 4); };
  blit(a, 0); blit(b, a.h + gap);
  return { w, h, data: out };
}

const ROOT = 'C:\\Users\\juanm\\Desktop\\marketforge-local\\';
const real = decodePNG(fs.readFileSync(process.argv[2]));
const mine = decodePNG(fs.readFileSync(process.argv[3]));
console.log('real:', real.w + 'x' + real.h, ' mine:', mine.w + 'x' + mine.h);

// geometry from the user's screenshots (both ~1920 wide)
const pts = [
  ['page background', 200, 200, 200, 200],
  ['email field interior', 1150, 380, 1150, 379],
  ['password input interior', 950, 467, 950, 466],
  ['password eye area', 1185, 467, 1182, 466],
  ['continue button', 800, 567, 800, 566],
  ['icon (house) center', 958, 205, 958, 203],
];
for (const [label, rx, ry, mx, my] of pts) {
  console.log(label.padEnd(26), 'real', hex(px(real, rx, ry)), ' mine', hex(px(mine, mx, my)));
}
console.log('\n-- text coverage (bright pixels / region) --');
console.log('h1     real', JSON.stringify(regionStats(real, 760, 272, 1160, 316, 150)), '\n       mine', JSON.stringify(regionStats(mine, 760, 274, 1160, 318, 150)));
console.log('forgot real', JSON.stringify(regionStats(real, 1060, 488, 1215, 514, 120)), '\n       mine', JSON.stringify(regionStats(mine, 1060, 494, 1215, 522, 120)));
console.log('btn    real', JSON.stringify(regionStats(real, 880, 552, 1045, 584, 90)), '\n       mine', JSON.stringify(regionStats(mine, 880, 551, 1045, 583, 90)));

const crops = [
  ['h1', 700, 265, 520, 60, 700, 272],
  ['pwd', 700, 340, 520, 190, 700, 340],
  ['btn', 700, 470, 520, 130, 700, 476],
];
for (const [name, rx, ry, rw, rh, mx, my] of crops) {
  const a = cropScale(real, rx, ry, rw, rh, 2);
  const b = cropScale(mine, mx, my, rw, rh, 2);
  const s = stack(a, b, 8);
  const p = ROOT + 'shots\\cmp_' + name + '.png';
  fs.writeFileSync(p, encodePNG(s.w, s.h, s.data));
  console.log('wrote ' + p);
}
