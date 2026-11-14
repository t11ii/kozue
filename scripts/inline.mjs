// Packs the production build into one self-contained HTML file that runs by
// double-clicking it — no server, no installation (standalone/Kozue.html).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const out = new URL('../standalone/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), 'utf8');

let html = read('index.html');
let inlined = 0;

html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
  const href = /href="\.?\/?([^"]+)"/.exec(tag)[1];
  inlined++;
  return `<style>${read(href)}</style>`;
});
html = html.replace(/<script\b[^>]*type="module"[^>]*src="\.?\/?([^"]+)"[^>]*><\/script>/g, (_tag, src) => {
  inlined++;
  // A literal "</script" inside the code would end the element early.
  return `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`;
});
html = html.replace(/href="\.?\/?favicon\.svg"/, () => {
  const svg = read('favicon.svg')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  return `href="data:image/svg+xml,${encodeURIComponent(svg)}"`;
});

if (inlined < 2 || /<script[^>]*\bsrc=|<link[^>]*rel="stylesheet"/.test(html)) {
  throw new Error('inline.mjs: the build output did not have the expected shape');
}

mkdirSync(out, { recursive: true });
writeFileSync(new URL('Kozue.html', out), html);
console.log(`standalone/Kozue.html  ${(Buffer.byteLength(html) / 1024).toFixed(1)} kB`);
