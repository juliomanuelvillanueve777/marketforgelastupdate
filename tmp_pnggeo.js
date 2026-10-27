// tmp_pnggeo.js — locate teal button + field borders + text row bands in two PNGs
const fs = require('fs');
const zlib = require('zlib');
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    off += 12 + len;
  }
  const chans = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * chans;
  const out = Buffer.alloc(w * h * 4, 255); let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++]; const line = raw.slice(pos, pos + stride); pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? line[i - chans] : 0, b = prev[i], c = i >= chans ? prev[i - chans] : 0; let v = line[i];
      if (ft === 1) v = (v + a) & 255; else if (ft === 2) v = (v + b) & 255; else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = line[x * chans]; out[o + 1] = line[x * chans + 1] || line[x * chans]; out[o + 2] = line[x * chans + 2] || line[x * chans]; out[o + 3] = 255; }
  }
  return { w, h, data: out };
}
function px(img, x, y) { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; }
function bbox(img, test) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { if (test(px(img, x, y))) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return n ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, n } : null;
}
function runs(img, test, minCount) {
  const rows = [];
  for (let y = 0; y < img.h; y++) { let c = 0; for (let x = 0; x < img.w; x++) if (test(px(img, x, y))) c++; rows.push(c); }
  const out = []; let s = -1;
  for (let y = 0; y <= img.h; y++) { const active = y < img.h && rows[y] >= minCount; if (active && s < 0) s = y; if (!active && s >= 0) { out.push({ y0: s, y1: y - 1, h: y - s, maxCount: Math.max.apply(null, rows.slice(s, y)) }); s = -1; } }
  return out;
}
const isTeal = c => c[1] > 170 && c[2] > 150 && c[0] < 150;
const isBright = c => (c[0] + c[1] + c[2]) / 3 > 230;
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const isFieldBorder = c => { const l = lum(c); return l > 60 && l < 130 && Math.abs(c[0] - c[2]) < 60 && c[2] >= c[0]; };
const imgs = process.argv.slice(2).map(p => ({ p, img: decodePNG(fs.readFileSync(p)) }));
for (const { p, img } of imgs) {
  console.log('===== ' + require('path').basename(p) + '  ' + img.w + 'x' + img.h);
  const b = bbox(img, isTeal);
  console.log(' teal(button)  ', b ? `x ${b.x0}-${b.x1} (w ${b.w})  y ${b.y0}-${b.y1} (h ${b.h})  px ${b.n}` : 'none');
  console.log(' bright text row bands (>=25 bright px/row):');
  for (const r of runs(img, isBright, 25)) console.log(`   y ${r.y0}-${r.y1} (h ${r.h}) maxCount ${r.maxCount}`);
  console.log(' field border row bands (>=300 px/row):');
  for (const r of runs(img, isFieldBorder, 300)) console.log(`   y ${r.y0}-${r.y1} (h ${r.h}) maxCount ${r.maxCount}`);
}
