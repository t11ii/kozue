// Vector drawing of topic markers and the small note / link indicators.

import { font } from '../core/themes.ts';
import type { Painter } from './painter.ts';
import { SvgPainter, arc, circle, ellipse, pie, roundRect } from './painter.ts';

const DIGIT = font(11, 700);
const GLYPH = font(12, 800);

const RED = '#e5484d';
const ORANGE = '#f28a2e';
const YELLOW = '#e0a400';
const GREEN = '#34b37a';
const BLUE = '#3a86f5';
const PURPLE = '#8b6cf0';
const GRAY = '#8b90a0';
const GOLD = '#f5b400';
const FACE = '#f7c948';
const FACE_INK = '#4a3b12';

const PRIORITY = [RED, ORANGE, YELLOW, BLUE, GRAY, PURPLE, '#1ba8b8', '#e3569b', '#4a5160'];
/** Colors of the markers that come in several: "flag-red", "star-blue", "people-gray" … */
const TINTS: Record<string, string> = { red: RED, orange: ORANGE, yellow: YELLOW, green: GREEN, blue: BLUE, purple: PURPLE, gray: GRAY };
/** Direction of each arrow marker, in eighths of a turn clockwise from "right". */
const ARROWS: Record<string, number> = {
  'arrow-right': 0,
  'arrow-down-right': 1,
  'arrow-down': 2,
  'arrow-down-left': 3,
  'arrow-left': 4,
  'arrow-up-left': 5,
  'arrow-up': 6,
  'arrow-up-right': 7,
};

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

  /** A point of the 18-unit design grid. */
  const X = (v: number): number => x + v * u;
  const Y = (v: number): number => y + v * u;

  if (id.charAt(0) === 'p' && id.length === 2 && id >= 'p1' && id <= 'p9') {
    const n = Number(id.charAt(1));
    badge(p, cx, cy, r, PRIORITY[n - 1] ?? PRIORITY[4], String(n), a);
    return;
  }
  const dash = id.lastIndexOf('-');
  const tint = dash > 0 ? TINTS[id.slice(dash + 1)] : undefined;
  if (id === 'star' || (tint && id.startsWith('star-'))) {
    const color = tint ?? GOLD;
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
    p.fill(color, a);
    p.stroke(color, 1.2 * u, a);
    return;
  }
  if (tint && id.startsWith('people-')) {
    // Head and shoulders.
    p.beginPath();
    circle(p, X(9), Y(5.9), 3.2 * u);
    p.moveTo(X(3.2), Y(15.8));
    p.cubicTo(X(3.2), Y(12), X(5.6), Y(10.4), X(9), Y(10.4));
    p.cubicTo(X(12.4), Y(10.4), X(14.8), Y(12), X(14.8), Y(15.8));
    p.closePath();
    p.fill(tint, a);
    return;
  }
  const turn = ARROWS[id];
  if (turn !== undefined) {
    // Up is good, down is not: the usual colors of a trend.
    const color = turn >= 5 ? GREEN : turn >= 1 && turn <= 3 ? RED : BLUE;
    const ang = (turn * Math.PI) / 4;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const at = (dx: number, dy: number): [number, number] => [cx + (dx * cos - dy * sin) * u, cy + (dx * sin + dy * cos) * u];
    const len = turn % 2 ? 6.4 : 5.6;
    p.beginPath();
    p.moveTo(...at(-len, 0));
    p.lineTo(...at(len, 0));
    p.moveTo(...at(len - 4.4, -4.4));
    p.lineTo(...at(len, 0));
    p.lineTo(...at(len - 4.4, 4.4));
    p.stroke(color, 2.3 * u, a);
    return;
  }
  if (id === 'arrow-refresh') {
    // Round and round: most of a circle, with an arrow head where it ends.
    const rr = 5.4 * u;
    const end = 4.05;
    p.beginPath();
    arc(p, cx, cy, rr, -1.0, end);
    p.stroke(BLUE, 2.2 * u, a);
    const ex = cx + rr * Math.cos(end);
    const ey = cy + rr * Math.sin(end);
    const tx = -Math.sin(end);
    const ty = Math.cos(end);
    p.beginPath();
    p.moveTo(ex + tx * 3.4 * u, ey + ty * 3.4 * u);
    p.lineTo(ex - tx * 1.6 * u - ty * 3.2 * u, ey - ty * 1.6 * u + tx * 3.2 * u);
    p.lineTo(ex - tx * 1.6 * u + ty * 3.2 * u, ey - ty * 1.6 * u - tx * 3.2 * u);
    p.closePath();
    p.fill(BLUE, a);
    return;
  }
  if (id.startsWith('face-')) {
    const kind = id.slice(5);
    p.beginPath();
    circle(p, cx, cy, r);
    p.fill(kind === 'angry' ? '#f4845f' : FACE, a);
    // eyes
    p.beginPath();
    if (kind === 'laugh') {
      p.moveTo(X(4.9), Y(7.6));
      p.quadTo(X(6.4), Y(5.6), X(7.9), Y(7.6));
      p.moveTo(X(10.1), Y(7.6));
      p.quadTo(X(11.6), Y(5.6), X(13.1), Y(7.6));
      p.stroke(FACE_INK, 1.3 * u, a);
    } else {
      const er = kind === 'surprise' ? 1.35 : 1.1;
      circle(p, X(6.4), Y(7.5), er * u);
      circle(p, X(11.6), Y(7.5), er * u);
      p.fill(FACE_INK, a);
    }
    // mouth (and brows)
    p.beginPath();
    switch (kind) {
      case 'smile':
        p.moveTo(X(5.6), Y(10.8));
        p.quadTo(X(9), Y(14.6), X(12.4), Y(10.8));
        break;
      case 'laugh':
        p.moveTo(X(5.2), Y(10.2));
        p.lineTo(X(12.8), Y(10.2));
        p.cubicTo(X(12.8), Y(13.4), X(11), Y(14.8), X(9), Y(14.8));
        p.cubicTo(X(7), Y(14.8), X(5.2), Y(13.4), X(5.2), Y(10.2));
        p.closePath();
        p.fill(FACE_INK, a);
        return;
      case 'neutral':
        p.moveTo(X(6), Y(12));
        p.lineTo(X(12), Y(12));
        break;
      case 'sad':
        p.moveTo(X(5.8), Y(13.2));
        p.quadTo(X(9), Y(9.8), X(12.2), Y(13.2));
        break;
      case 'angry':
        p.moveTo(X(4.6), Y(4.6));
        p.lineTo(X(7.6), Y(5.8));
        p.moveTo(X(13.4), Y(4.6));
        p.lineTo(X(10.4), Y(5.8));
        p.moveTo(X(6), Y(13.2));
        p.quadTo(X(9), Y(10.6), X(12), Y(13.2));
        break;
      default: // surprise
        ellipse(p, X(9), Y(12.2), 1.7 * u, 2 * u);
        p.fill(FACE_INK, a);
        return;
    }
    p.stroke(FACE_INK, 1.4 * u, a);
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
      p.fill(RED, a);
      p.beginPath();
      p.moveTo(cx - 3.2 * u, cy - 3.2 * u);
      p.lineTo(cx + 3.2 * u, cy + 3.2 * u);
      p.moveTo(cx + 3.2 * u, cy - 3.2 * u);
      p.lineTo(cx - 3.2 * u, cy + 3.2 * u);
      p.stroke('#ffffff', 1.9 * u, a);
      return;
    case 'plus':
    case 'minus':
      p.beginPath();
      circle(p, cx, cy, r);
      p.fill(id === 'plus' ? GREEN : GRAY, a);
      p.beginPath();
      p.moveTo(cx - 4 * u, cy);
      p.lineTo(cx + 4 * u, cy);
      if (id === 'plus') {
        p.moveTo(cx, cy - 4 * u);
        p.lineTo(cx, cy + 4 * u);
      }
      p.stroke('#ffffff', 2 * u, a);
      return;
    case 'warn':
      // A warning triangle.
      p.beginPath();
      p.moveTo(X(9), Y(2.6));
      p.lineTo(X(16.2), Y(15));
      p.lineTo(X(1.8), Y(15));
      p.closePath();
      p.fill(YELLOW, a);
      p.stroke(YELLOW, 1.6 * u, a);
      p.beginPath();
      p.moveTo(X(9), Y(7.2));
      p.lineTo(X(9), Y(10.8));
      p.stroke('#ffffff', 1.9 * u, a);
      p.beginPath();
      circle(p, X(9), Y(13.2), 1.05 * u);
      p.fill('#ffffff', a);
      return;
    case 'idea':
      // A light bulb.
      p.beginPath();
      p.moveTo(X(6.4), Y(11.6));
      p.cubicTo(X(3.6), Y(9.8), X(3.4), Y(5.2), X(6.2), Y(3.4));
      p.cubicTo(X(9), Y(1.6), X(13.2), Y(3), X(13.9), Y(6.4));
      p.cubicTo(X(14.3), Y(8.6), X(13.2), Y(10.4), X(11.6), Y(11.6));
      p.closePath();
      p.fill(GOLD, a);
      p.beginPath();
      p.moveTo(X(6.9), Y(13.6));
      p.lineTo(X(11.1), Y(13.6));
      p.moveTo(X(7.6), Y(15.7));
      p.lineTo(X(10.4), Y(15.7));
      p.stroke(ink, 1.5 * u, a * 0.75);
      return;
    case 'pin':
      // A map pin.
      p.beginPath();
      p.moveTo(X(9), Y(16.4));
      p.cubicTo(X(5.4), Y(12.2), X(3.6), Y(9.8), X(3.6), Y(7.2));
      p.cubicTo(X(3.6), Y(4), X(6), Y(1.8), X(9), Y(1.8));
      p.cubicTo(X(12), Y(1.8), X(14.4), Y(4), X(14.4), Y(7.2));
      p.cubicTo(X(14.4), Y(9.8), X(12.6), Y(12.2), X(9), Y(16.4));
      p.closePath();
      p.fill(RED, a);
      p.beginPath();
      circle(p, X(9), Y(7.1), 2.1 * u);
      p.fill('#ffffff', a);
      return;
    case 'lock':
      p.beginPath();
      p.moveTo(X(5.8), Y(8.2));
      p.lineTo(X(5.8), Y(6));
      p.cubicTo(X(5.8), Y(1.6), X(12.2), Y(1.6), X(12.2), Y(6));
      p.lineTo(X(12.2), Y(8.2));
      p.stroke(ink, 1.7 * u, a * 0.75);
      p.beginPath();
      roundRect(p, X(3.6), Y(8), 10.8 * u, 8 * u, 1.8 * u);
      p.fill(GRAY, a);
      p.beginPath();
      circle(p, X(9), Y(12), 1.3 * u);
      p.fill('#ffffff', a);
      return;
    case 'clock':
      p.beginPath();
      circle(p, cx, cy, r);
      p.fill(BLUE, a);
      p.beginPath();
      p.moveTo(X(9), Y(4.8));
      p.lineTo(X(9), Y(9.2));
      p.lineTo(X(12.2), Y(11));
      p.stroke('#ffffff', 1.7 * u, a);
      return;
    case 'calendar':
      p.beginPath();
      roundRect(p, X(2.4), Y(3.4), 13.2 * u, 12.4 * u, 2 * u);
      p.fill('#ffffff', a);
      p.stroke(ink, 1.3 * u, a * 0.7);
      p.beginPath();
      p.moveTo(X(4.4), Y(3.4));
      p.lineTo(X(13.6), Y(3.4));
      p.quadTo(X(15.6), Y(3.4), X(15.6), Y(5.4));
      p.lineTo(X(15.6), Y(7.2));
      p.lineTo(X(2.4), Y(7.2));
      p.lineTo(X(2.4), Y(5.4));
      p.quadTo(X(2.4), Y(3.4), X(4.4), Y(3.4));
      p.closePath();
      p.fill(RED, a);
      p.beginPath();
      p.moveTo(X(5.6), Y(1.9));
      p.lineTo(X(5.6), Y(4.6));
      p.moveTo(X(12.4), Y(1.9));
      p.lineTo(X(12.4), Y(4.6));
      p.stroke(ink, 1.4 * u, a * 0.75);
      p.beginPath();
      for (const [dx, dy] of [
        [5.6, 10.2],
        [9, 10.2],
        [12.4, 10.2],
        [5.6, 13.2],
        [9, 13.2],
      ]) {
        circle(p, X(dx), Y(dy), 0.95 * u);
      }
      p.fill(ink, a * 0.6);
      return;
    case 'money':
      badge(p, cx, cy, r, '#2f9e6b', '$', a);
      return;
    case 'like':
    case 'dislike': {
      // A thumb, up or down.
      const up = id === 'like';
      const V = (v: number): number => (up ? Y(v) : Y(18 - v));
      p.beginPath();
      roundRect(p, X(2.2), up ? Y(8.2) : Y(18 - 8.2 - 7.6), 3.2 * u, 7.6 * u, 0.9 * u);
      p.moveTo(X(6.8), V(8.4));
      p.lineTo(X(9.3), V(3.2));
      p.cubicTo(X(9.7), V(2.4), X(11), V(2.6), X(11.3), V(3.5));
      p.cubicTo(X(11.7), V(4.5), X(11.2), V(6.2), X(10.9), V(7.3));
      p.lineTo(X(14.1), V(7.3));
      p.cubicTo(X(15.3), V(7.3), X(16), V(8.3), X(15.8), V(9.3));
      p.lineTo(X(14.9), V(14));
      p.cubicTo(X(14.7), V(15), X(13.9), V(15.6), X(13), V(15.6));
      p.lineTo(X(6.8), V(15.6));
      p.closePath();
      p.fill(up ? GREEN : RED, a);
      return;
    }
  }
  const flag = tint && id.startsWith('flag-') ? tint : undefined;
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

/** "Links to another topic" indicator: an arrow that turns a corner. */
export function drawJumpIcon(p: Painter, x: number, y: number, s: number, color: string, a = 1): void {
  const u = s / 14;
  p.beginPath();
  p.moveTo(x + 2.5 * u, y + 2.5 * u);
  p.lineTo(x + 2.5 * u, y + 6 * u);
  p.quadTo(x + 2.5 * u, y + 8.5 * u, x + 5 * u, y + 8.5 * u);
  p.lineTo(x + 11.5 * u, y + 8.5 * u);
  p.moveTo(x + 8.5 * u, y + 5.5 * u);
  p.lineTo(x + 11.5 * u, y + 8.5 * u);
  p.lineTo(x + 8.5 * u, y + 11.5 * u);
  p.stroke(color, 1.5 * u, a);
}

/** Inline SVG markup for a marker, for use in DOM buttons. */
export function markerSvg(id: string, size: number, ink: string): string {
  const p = new SvgPainter();
  drawMarker(p, id, 0, 0, size, ink);
  return p.toSvg(0, 0, size, size);
}
