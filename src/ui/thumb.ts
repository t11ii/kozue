// Miniature drawings of a map, for the theme cards and the template chooser.

import type { TextMeasurer } from '../core/layout.ts';
import { layoutDoc } from '../core/layout.ts';
import type { Doc } from '../core/model.ts';
import type { Theme } from '../core/themes.ts';
import { CanvasPainter } from '../render/painter.ts';
import { drawScene, snapPositions } from '../render/scene.ts';

/** Draws `doc` in `theme`, fitted into a canvas of `w` × `h` CSS pixels. */
export function drawDocThumb(canvas: HTMLCanvasElement, doc: Doc, theme: Theme, measurer: TextMeasurer, w: number, h: number): void {
  const { bounds: b } = layoutDoc(doc, { theme, measurer, epoch: 0, stamp: 1, editing: null });
  snapPositions(doc.root);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = Math.min((w - 12) / (b.x1 - b.x0), (h - 12) / (b.y1 - b.y0), 1);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - ((b.x0 + b.x1) / 2) * s), dpr * (h / 2 - ((b.y0 + b.y1) / 2) * s));
  const p = new CanvasPainter(ctx);
  p.reset();
  drawScene(p, doc.root, {
    theme,
    metrics: (f) => measurer.metrics(f),
    textWidth: (f, text) => measurer.width(f, text),
    clip: null,
    zoom: s,
    editing: null,
    marks: null,
    markCurrent: null,
    dim: null,
    keep: null,
    stamp: 1,
    rels: [],
    selRel: null,
  });
}
