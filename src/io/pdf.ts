// Single-page PDF writer that embeds one losslessly compressed RGB image.

import { concat } from './zip.ts';

const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * @param image  zlib-compressed RGB rows (8 bits per channel, no predictor)
 * @param w,h    image size in pixels
 * @param wPt,hPt page size in PDF points (1/72 inch)
 */
export function buildPdf(image: Uint8Array, w: number, h: number, wPt: number, hPt: number): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (d: Uint8Array | string): void => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    parts.push(b);
    pos += b.length;
  };
  const obj = (id: number, body: string): void => {
    offsets[id] = pos;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // marks the file as binary
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(wPt)} ${n2(hPt)}] ` + '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  offsets[4] = pos;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`,
  );
  push(image);
  push('\nendstream\nendobj\n');
  const content = `q ${n2(wPt)} 0 0 ${n2(hPt)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

  const xref = pos;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let id = 1; id <= 5; id++) table += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  push(table);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(parts);
}

/** Drops the alpha channel of canvas pixel data. */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) {
    rgb[j++] = rgba[i];
    rgb[j++] = rgba[i + 1];
    rgb[j++] = rgba[i + 2];
  }
  return rgb;
}
