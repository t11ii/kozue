// Image exports of a laid-out scene: SVG (vector), PNG and PDF (raster).

import type { Bounds } from '../core/layout.ts';
import type { MNode } from '../core/model.ts';
import { buildPdf, rgbaToRgb } from '../io/pdf.ts';
import { deflateZlib } from '../io/zip.ts';
import { CanvasPainter, SvgPainter } from './painter.ts';
import type { SceneOpts } from './scene.ts';
import { drawScene } from './scene.ts';

export interface Scene {
  root: MNode;
  bounds: Bounds;
  opts: SceneOpts;
}

/** Blank margin around the map, in world units. */
const PAD = 40;
const MAX_SIDE = 16000;

const frame = (b: Bounds): { x: number; y: number; w: number; h: number } => ({
  x: b.x0 - PAD,
  y: b.y0 - PAD,
  w: b.x1 - b.x0 + PAD * 2,
  h: b.y1 - b.y0 + PAD * 2,
});

export interface ImageOpts {
  /** Pixels per map unit (1 = the size on screen at 100 %). */
  scale: number;
  /** Leave the background out (PNG, SVG). */
  transparent: boolean;
}

export function sceneToSvg(s: Scene, transparent = false): string {
  const p = new SvgPainter();
  drawScene(p, s.root, s.opts);
  const f = frame(s.bounds);
  return p.toSvg(f.x, f.y, f.w, f.h, transparent ? undefined : s.opts.theme.bg);
}

interface Raster {
  canvas: HTMLCanvasElement;
  /** True when the requested scale had to be lowered to fit canvas limits. */
  reduced: boolean;
  width: number;
  height: number;
}

function rasterize(s: Scene, wantScale: number, maxPixels: number, transparent = false): Raster {
  const f = frame(s.bounds);
  const scale = Math.min(wantScale, Math.sqrt(maxPixels / (f.w * f.h)), MAX_SIDE / Math.max(f.w, f.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(f.w * scale));
  canvas.height = Math.max(1, Math.ceil(f.h * scale));
  const ctx = canvas.getContext('2d', { alpha: transparent })!;
  if (!transparent) {
    ctx.fillStyle = s.opts.theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, -f.x * scale, -f.y * scale);
  const p = new CanvasPainter(ctx);
  p.reset();
  drawScene(p, s.root, { ...s.opts, zoom: Math.max(1, scale) });
  return { canvas, reduced: scale < wantScale - 1e-6, width: f.w, height: f.h };
}

// The scene is drawn before these functions first await anything, so a caller may
// change the layout again as soon as it holds the returned promise.

export async function sceneToPng(s: Scene, o: Partial<ImageOpts> = {}): Promise<{ bytes: Uint8Array; reduced: boolean }> {
  const r = rasterize(s, o.scale ?? 2, 48e6, o.transparent ?? false);
  const blob = await new Promise<Blob | null>((resolve) => r.canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), reduced: r.reduced };
}

export async function sceneToJpeg(s: Scene, o: Partial<ImageOpts> = {}): Promise<{ bytes: Uint8Array; reduced: boolean }> {
  const r = rasterize(s, o.scale ?? 2, 48e6);
  const blob = await new Promise<Blob | null>((resolve) => r.canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('JPEG encoding failed');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), reduced: r.reduced };
}

export async function sceneToPdf(s: Scene): Promise<{ bytes: Uint8Array; reduced: boolean }> {
  const r = rasterize(s, 2, 20e6);
  const { width, height } = r.canvas;
  const rgba = r.canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const image = await deflateZlib(rgbaToRgb(rgba));
  // CSS pixels are 1/96 inch, PDF points 1/72 inch.
  return { bytes: buildPdf(image, width, height, r.width * 0.75, r.height * 0.75), reduced: r.reduced };
}
