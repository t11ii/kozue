// Vector drawing of topic markers and the small note / link indicators.

import { font } from '../core/themes.ts';
import type { Painter } from './painter.ts';
import { SvgPainter, circle, pie } from './painter.ts';

const DIGIT = font(11, 700);
const GLYPH = font(12, 800);

const PRIORITY = ['#e5484d', '#f28a2e', '#e0a400', '#3a86f5', '#8b90a0'];
const FLAGS: Record<string, string> = {
  'flag-red': '#e5484d',
  'flag-orange': '#f28a2e',
  'flag-green': '#34b37a',
  'flag-blue': '#3a86f5',
  'flag-purple': '#8b6cf0',
};
const BLUE = '#3a86f5';
const GREEN = '#34b37a';

function badge(p: Painter, cx: number, cy: number, r: number, color: string, glyph: string, a: number): void {
  p.beginPath();
  circle(p, cx, cy, r);
  p.fill(color, a);
  p.text(glyph, cx, cy + 4, glyph.length === 1 && glyph >= '0' && glyph <= '9' ? DIGIT : GLYPH, '#ffffff', 'center', a);
}

/**
 * Draws marker `id` into the square at (x, y) with side `s`.
 * `ink` is a neutral color that reads on the current background.
 */
export function drawMarker(p: Painter, id: string, x: number, y: number, s: number, ink: string, a = 1): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s / 2 - 0.5;
  const u = s / 18; // design unit

  if (id.charAt(0) === 'p' && id.length === 2) {
    const n = Number(id.charAt(1));
    badge(p, cx, cy, r, PRIORITY[n - 1] ?? PRIORITY[4], String(n), a);
    return;
  }
  switch (id) {
    case 't0':
      p.beginPath();
      circle(p, cx, cy, r - 0.8);
      p.stroke(ink, 1.6, a * 0.55);
      return;
    case 't25':
    case 't50':
    case 't75':
      p.beginPath();
      circle(p, cx, cy, r - 0.8);
      p.stroke(BLUE, 1.6, a);
      p.beginPath();
      pie(p, cx, cy, r - 3, Number(id.slice(1)) / 100);
      p.fill(BLUE, a);
      return;
    case 'done':
      p.beginPath();
      circle(p, cx, cy, r);
      p.fill(GREEN, a);
      p.beginPath();
      p.moveTo(cx - 4 * u, cy + 0.2 * u);
      p.lineTo(cx - 1.2 * u, cy + 3 * u);
      p.lineTo(cx + 4.2 * u, cy - 3 * u);
      p.stroke('#ffffff', 1.9 * u, a);
      return;
    case 'star': {
      p.beginPath();
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r + 0.5 : r * 0.46;
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = cx + rad * Math.cos(ang);
        const py = cy + 0.6 * u + rad * Math.sin(ang);
        if (i === 0) p.moveTo(px, py);
        else p.lineTo(px, py);
      }
      p.closePath();
      p.fill('#f5b400', a);
      p.stroke('#f5b400', 1.2 * u, a);
      return;
    }
    case 'heart': {
      const t = y + 5.6 * u;
      p.beginPath();
      p.moveTo(cx, y + 15.6 * u);
      p.cubicTo(cx - 9.5 * u, y + 9.5 * u, cx - 7.6 * u, t - 4.6 * u, cx - 3.6 * u, t - 3.2 * u);
      p.cubicTo(cx - 1.8 * u, t - 2.6 * u, cx - 0.6 * u, t - 1.4 * u, cx, t);
      p.cubicTo(cx + 0.6 * u, t - 1.4 * u, cx + 1.8 * u, t - 2.6 * u, cx + 3.6 * u, t - 3.2 * u);
      p.cubicTo(cx + 7.6 * u, t - 4.6 * u, cx + 9.5 * u, y + 9.5 * u, cx, y + 15.6 * u);
      p.closePath();
      p.fill('#ef5f7a', a);
      return;
    }
    case 'q':
      badge(p, cx, cy, r, '#8b6cf0', '?', a);
      return;
    case 'ex':
      badge(p, cx, cy, r, '#f28a2e', '!', a);
      return;
    case 'info':
      badge(p, cx, cy, r, BLUE, 'i', a);
      return;
    case 'x':
      p.beginPath();
      circle(p, cx, cy, r);
      p.fill('#e5484d', a);
      p.beginPath();
      p.moveTo(cx - 3.2 * u, cy - 3.2 * u);
      p.lineTo(cx + 3.2 * u, cy + 3.2 * u);
      p.moveTo(cx + 3.2 * u, cy - 3.2 * u);
      p.lineTo(cx - 3.2 * u, cy + 3.2 * u);
      p.stroke('#ffffff', 1.9 * u, a);
      return;
  }
  const flag = FLAGS[id];
  if (flag) {
    p.beginPath();
    p.moveTo(x + 4.5 * u, y + 2.5 * u);
    p.lineTo(x + 4.5 * u, y + 16 * u);
    p.stroke(ink, 1.6 * u, a * 0.75);
    p.beginPath();
    p.moveTo(x + 5.4 * u, y + 3 * u);
    p.lineTo(x + 15.6 * u, y + 3 * u);
    p.lineTo(x + 12.6 * u, y + 6.9 * u);
    p.lineTo(x + 15.6 * u, y + 10.8 * u);
    p.lineTo(x + 5.4 * u, y + 10.8 * u);
    p.closePath();
    p.fill(flag, a);
    p.stroke(flag, 1 * u, a);
  }
}

/** "Has a note" indicator: three text lines. */
export function drawNoteIcon(p: Painter, x: number, y: number, s: number, color: string, a = 1): void {
  const u = s / 14;
  p.beginPath();
  p.moveTo(x + 2 * u, y + 3.5 * u);
  p.lineTo(x + 12 * u, y + 3.5 * u);
  p.moveTo(x + 2 * u, y + 7 * u);
  p.lineTo(x + 12 * u, y + 7 * u);
  p.moveTo(x + 2 * u, y + 10.5 * u);
  p.lineTo(x + 8 * u, y + 10.5 * u);
  p.stroke(color, 1.5 * u, a);
}

/** "Has a link" indicator: an arrow leaving a box. */
export function drawLinkIcon(p: Painter, x: number, y: number, s: number, color: string, a = 1): void {
  const u = s / 14;
  p.beginPath();
  p.moveTo(x + 6 * u, y + 3 * u);
  p.lineTo(x + 3.5 * u, y + 3 * u);
  p.quadTo(x + 2 * u, y + 3 * u, x + 2 * u, y + 4.5 * u);
  p.lineTo(x + 2 * u, y + 10.5 * u);
  p.quadTo(x + 2 * u, y + 12 * u, x + 3.5 * u, y + 12 * u);
  p.lineTo(x + 9.5 * u, y + 12 * u);
  p.quadTo(x + 11 * u, y + 12 * u, x + 11 * u, y + 10.5 * u);
  p.lineTo(x + 11 * u, y + 8 * u);
  p.moveTo(x + 8.5 * u, y + 2 * u);
  p.lineTo(x + 12 * u, y + 2 * u);
  p.lineTo(x + 12 * u, y + 5.5 * u);
  p.moveTo(x + 12 * u, y + 2 * u);
  p.lineTo(x + 6.5 * u, y + 7.5 * u);
  p.stroke(color, 1.5 * u, a);
}

/** Inline SVG markup for a marker, for use in DOM buttons. */
export function markerSvg(id: string, size: number, ink: string): string {
  const p = new SvgPainter();
  drawMarker(p, id, 0, 0, size, ink);
  return p.toSvg(0, 0, size, size);
}
