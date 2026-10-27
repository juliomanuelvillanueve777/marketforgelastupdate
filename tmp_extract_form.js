const fs = require('fs');
const T = 'C:\\Users\\juanm\\AppData\\Local\\Temp\\';
const html = fs.readFileSync(T + 'rm_dom.html', 'utf8');
const i = html.indexOf('Welcome to Rightmove Plus');
if (i < 0) { console.log('marker not found'); process.exit(1); }
let start = html.lastIndexOf('<main', i);
if (start < 0) start = html.lastIndexOf('<div', i - 800);
if (start < 0) start = i - 2000;
const seg = html.slice(start, i + 6000);
const out = seg.replace(/></g, '>\n<');
fs.writeFileSync(T + 'rm_form_pretty.txt', out);
console.log(out);
