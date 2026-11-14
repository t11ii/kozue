// Canvas viewport (pan / zoom / device pixel ratio) and text measurement.

import type { Bounds, FontMetrics, TextMeasurer } from '../core/layout.ts';
import type { Font } from '../core/themes.ts';
import { CanvasPainter } from '../render/painter.ts';

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 4;

export class View {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly painter: CanvasPainter;
  zoom = 1;
  panX = 0;
  panY = 0;
  /** Size in CSS pixels. */
  width = 1;
  height = 1;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // An opaque canvas composites faster and lets the browser use LCD text antialiasing.
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.painter = new CanvasPainter(this.ctx);
  }

  /** Syncs the backing store with the element size. Returns true when it changed. */
  resize(): boolean {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (w === this.width && h === this.height && dpr === this.dpr && this.canvas.width === bw) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = bw;
    this.canvas.height = bh;
    return true;
  }

  wx(sx: number): number {
    return (sx - this.panX) / this.zoom;
  }
  wy(sy: number): number {
    return (sy - this.panY) / this.zoom;
  }
  sx(wx: number): number {
    return wx * this.zoom + this.panX;
  }
  sy(wy: number): number {
    return wy * this.zoom + this.panY;
  }

  /** Visible world rectangle, grown by `pad` world units. */
  worldRect(pad = 0): Bounds {
    return {
      x0: this.wx(0) - pad,
      y0: this.wy(0) - pad,
      x1: this.wx(this.width) + pad,
      y1: this.wy(this.height) + pad,
    };
  }

  /** Zooms by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const k = z / this.zoom;
    this.panX = sx - (sx - this.panX) * k;
    this.panY = sy - (sy - this.panY) * k;
    this.zoom = z;
  }

  /** Maps world units to device pixels; translation is snapped so text stays crisp. */
  applyTransform(): void {
    const s = this.dpr * this.zoom;
    this.ctx.setTransform(s, 0, 0, s, Math.round(this.dpr * this.panX), Math.round(this.dpr * this.panY));
  }
}

const CACHE_LIMIT = 30_000;

/** Canvas-backed text measurement with a per-font width cache. */
export class CanvasMeasurer implements TextMeasurer {
  private ctx: CanvasRenderingContext2D;
  private current = '';
  private widths = new Map<string, Map<string, number>>();
  private fm = new Map<string, FontMetrics>();

  constructor() {
    this.ctx = document.createElement('canvas').getContext('2d')!;
  }

  private use(font: Font): void {
    if (this.current !== font.css) {
      this.ctx.font = font.css;
      this.current = font.css;
    }
  }

  width(font: Font, text: string): number {
    let cache = this.widths.get(font.css);
    if (!cache) this.widths.set(font.css, (cache = new Map()));
    let w = cache.get(text);
    if (w === undefined) {
      this.use(font);
      w = this.ctx.measureText(text).width;
      if (cache.size > CACHE_LIMIT) cache.clear();
      cache.set(text, w);
    }
    return w;
  }

  metrics(font: Font): FontMetrics {
    let m = this.fm.get(font.css);
    if (!m) {
      this.use(font);
      const tm = this.ctx.measureText('Mgあ');
      const ascent = tm.fontBoundingBoxAscent;
      const descent = tm.fontBoundingBoxDescent;
      m =
        Number.isFinite(ascent) && Number.isFinite(descent) && ascent + descent > 0
          ? { ascent, descent }
          : { ascent: font.size * 0.93, descent: font.size * 0.25 };
      this.fm.set(font.css, m);
    }
    return m;
  }
}
