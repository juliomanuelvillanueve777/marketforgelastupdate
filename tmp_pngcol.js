// tmp_pngcol.js — print vertical color transitions at a given x for 2 PNGs
const fs = require('fs'); const zlib = require('zlib');
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, colorType = 6; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
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
const px = (img, x, y) => { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const X = parseInt(process.argv[2], 10) || 900;
const imgs = process.argv.slice(3).map(p => ({ n: require('path').basename(p), img: decodePNG(fs.readFileSync(p)) }));
for (const { n, img } of imgs) {
  console.log('===== ' + n + ' (x=' + X + ')');
  let prevC = null, startY = 0;
  const flush = (y) => { if (prevC) console.log(`  y ${String(startY).padStart(4)}-${String(y - 1).padStart(4)} (${String(y - startY).padStart(3)}px) ${hex(prevC)}`); };
  for (let y = 150; y < img.h - 150; y++) {
    const c = px(img, X, y);
    if (!prevC) { prevC = c; startY = y; continue; }
    const d = Math.abs(c[0] - prevC[0]) + Math.abs(c[1] - prevC[1]) + Math.abs(c[2] - prevC[2]);
    if (d > 8) { if (y - startY >= 2) flush(y); prevC = c; startY = y; }
  }
  flush(img.h - 150);
}
