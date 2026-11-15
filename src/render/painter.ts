// A tiny drawing abstraction with two backends: Canvas 2D for the live view
// and PNG export, SVG markup for vector export and UI icons. Scene drawing is
// written once against this interface so both always look the same.

import type { Font } from '../core/themes.ts';
import { FONT_STACK } from '../core/themes.ts';

export interface Painter {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadTo(cx: number, cy: number, x: number, y: number): void;
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
  fill(color: string, alpha?: number): void;
  stroke(color: string, width: number, alpha?: number, dash?: readonly number[] | null): void;
  /** `y` is the alphabetic baseline. */
  text(s: string, x: number, y: number, font: Font, color: string, align?: 'left' | 'center', alpha?: number): void;
}

// ------------------------------------------------------------------- shapes

const K = 0.5522847498; // cubic approximation of a quarter circle

export function roundRect(p: Painter, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = r * (1 - K);
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.cubicTo(x + w - k, y, x + w, y + k, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.cubicTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.cubicTo(x + k, y + h, x, y + h - k, x, y + h - r);
  p.lineTo(x, y + r);
  p.cubicTo(x, y + k, x + k, y, x + r, y);
  p.closePath();
}

export function ellipse(p: Painter, cx: number, cy: number, rx: number, ry: number): void {
  const kx = rx * K;
  const ky = ry * K;
  p.moveTo(cx + rx, cy);
  p.cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
  p.cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
  p.cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
  p.cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
  p.closePath();
}

export function circle(p: Painter, cx: number, cy: number, r: number): void {
  ellipse(p, cx, cy, r, r);
}

/** A rhombus with its corners in the middle of the sides of the given box. */
export function diamond(p: Painter, cx: number, cy: number, rx: number, ry: number): void {
  p.moveTo(cx + rx, cy);
  p.lineTo(cx, cy + ry);
  p.lineTo(cx - rx, cy);
  p.lineTo(cx, cy - ry);
  p.closePath();
}

/** A circular arc from angle `a0` to `a1` (radians; larger angles are clockwise on screen), as a path of its own. */
export function arc(p: Painter, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const step = (a1 - a0) / steps;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  let a = a0;
  p.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  for (let i = 0; i < steps; i++) {
    const b = a + step;
    const ax = cx + r * Math.cos(a);
    const ay = cy + r * Math.sin(a);
    const bx = cx + r * Math.cos(b);
    const by = cy + r * Math.sin(b);
    p.cubicTo(ax - k * Math.sin(a), ay + k * Math.cos(a), bx + k * Math.sin(b), by - k * Math.cos(b), bx, by);
    a = b;
  }
}

/** Clockwise wedge starting at 12 o'clock, covering `frac` of the circle. */
export function pie(p: Painter, cx: number, cy: number, r: number, frac: number): void {
  const total = Math.max(0, Math.min(1, frac)) * Math.PI * 2;
  const steps = Math.max(1, Math.ceil(total / (Math.PI / 2)));
  const step = total / steps;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  let a = -Math.PI / 2;
  p.moveTo(cx, cy);
  p.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  for (let i = 0; i < steps; i++) {
    const b = a + step;
    const ax = cx + r * Math.cos(a);
    const ay = cy + r * Math.sin(a);
    const bx = cx + r * Math.cos(b);
    const by = cy + r * Math.sin(b);
    p.cubicTo(ax - k * Math.sin(a), ay + k * Math.cos(a), bx + k * Math.sin(b), by - k * Math.cos(b), bx, by);
    a = b;
  }
  p.closePath();
}

// ------------------------------------------------------------------- canvas

export class CanvasPainter implements Painter {
  readonly ctx: CanvasRenderingContext2D;
  private fillStyle = '';
  private strokeStyle = '';
  private lineWidth = -1;
  private font = '';
  private alpha = 1;
  private align = 'left';
  private dashed = false;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** Re-syncs cached state; call after touching the context directly. */
  reset(): void {
    const c = this.ctx;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.globalAlpha = 1;
    c.setLineDash([]);
    this.fillStyle = this.strokeStyle = this.font = '';
    this.lineWidth = -1;
    this.alpha = 1;
    this.align = 'left';
    this.dashed = false;
  }

  beginPath(): void {
    this.ctx.beginPath();
  }
  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
  }
  quadTo(cx: number, cy: number, x: number, y: number): void {
    this.ctx.quadraticCurveTo(cx, cy, x, y);
  }
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  }
  closePath(): void {
    this.ctx.closePath();
  }

  private setAlpha(a: number): void {
    if (a !== this.alpha) {
      this.ctx.globalAlpha = a;
      this.alpha = a;
    }
  }

  fill(color: string, alpha = 1): void {
    const c = this.ctx;
    if (color !== this.fillStyle) {
      c.fillStyle = color;
      this.fillStyle = color;
    }
    this.setAlpha(alpha);
    c.fill();
  }

  stroke(color: string, width: number, alpha = 1, dash: readonly number[] | null = null): void {
    const c = this.ctx;
    if (color !== this.strokeStyle) {
      c.strokeStyle = color;
      this.strokeStyle = color;
    }
    if (width !== this.lineWidth) {
      c.lineWidth = width;
      this.lineWidth = width;
    }
    if (dash) {
      c.setLineDash(dash as number[]);
      this.dashed = true;
    } else if (this.dashed) {
      c.setLineDash([]);
      this.dashed = false;
    }
    this.setAlpha(alpha);
    c.stroke();
  }

  text(s: string, x: number, y: number, font: Font, color: string, align: 'left' | 'center' = 'left', alpha = 1): void {
    const c = this.ctx;
    if (font.css !== this.font) {
      c.font = font.css;
      this.font = font.css;
    }
    if (color !== this.fillStyle) {
      c.fillStyle = color;
      this.fillStyle = color;
    }
    if (align !== this.align) {
      c.textAlign = align;
      this.align = align;
    }
    this.setAlpha(alpha);
    c.fillText(s, x, y);
  }
}

// ---------------------------------------------------------------------- svg

const num = (n: number): string => String(Math.round(n * 100) / 100);

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class SvgPainter implements Painter {
  private d = '';
  readonly out: string[] = [];

  beginPath(): void {
    this.d = '';
  }
  moveTo(x: number, y: number): void {
    this.d += `M${num(x)} ${num(y)}`;
  }
  lineTo(x: number, y: number): void {
    this.d += `L${num(x)} ${num(y)}`;
  }
  quadTo(cx: number, cy: number, x: number, y: number): void {
    this.d += `Q${num(cx)} ${num(cy)} ${num(x)} ${num(y)}`;
  }
  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.d += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(x)} ${num(y)}`;
  }
  closePath(): void {
    this.d += 'Z';
  }

  fill(color: string, alpha = 1): void {
    this.out.push(`<path d="${this.d}" fill="${color}"${alpha < 1 ? ` fill-opacity="${num(alpha)}"` : ''}/>`);
  }

  stroke(color: string, width: number, alpha = 1, dash: readonly number[] | null = null): void {
    this.out.push(
      `<path d="${this.d}" fill="none" stroke="${color}" stroke-width="${num(width)}" stroke-linecap="round" stroke-linejoin="round"` +
        (alpha < 1 ? ` stroke-opacity="${num(alpha)}"` : '') +
        (dash ? ` stroke-dasharray="${dash.join(' ')}"` : '') +
        '/>',
    );
  }

  text(s: string, x: number, y: number, font: Font, color: string, align: 'left' | 'center' = 'left', alpha = 1): void {
    if (!s) return;
    this.out.push(
      `<text x="${num(x)}" y="${num(y)}" font-size="${font.size}" font-weight="${font.weight}" fill="${color}"` +
        (font.italic ? ' font-style="italic"' : '') +
        (font.family !== FONT_STACK ? ` font-family="${escapeXml(font.family)}"` : '') +
        (align === 'center' ? ' text-anchor="middle"' : '') +
        (alpha < 1 ? ` fill-opacity="${num(alpha)}"` : '') +
        ` xml:space="preserve">${escapeXml(s)}</text>`,
    );
  }

  /** Wraps the recorded drawing into a standalone SVG document. */
  toSvg(x: number, y: number, w: number, h: number, background?: string): string {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" ` +
      `font-family="${escapeXml(FONT_STACK)}">` +
      (background ? `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${background}"/>` : '') +
      this.out.join('') +
      '</svg>'
    );
  }
}
