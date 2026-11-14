import type { FontMetrics, TextMeasurer } from '../src/core/layout.ts';
import type { LayoutKind, NodeData } from '../src/core/model.ts';
import { Doc, fromData, normalizeMains } from '../src/core/model.ts';
import type { Font } from '../src/core/themes.ts';
import { DEFAULT_THEME, themeById } from '../src/core/themes.ts';

/** Deterministic stand-in for canvas text measurement: wide chars are 1em, others 0.5em. */
export const fakeMeasurer: TextMeasurer = {
  width(font: Font, text: string): number {
    let w = 0;
    for (const ch of text) w += ch.codePointAt(0)! > 0x2e7f ? font.size : font.size / 2;
    return w;
  },
  metrics(font: Font): FontMetrics {
    return { ascent: font.size * 0.9, descent: font.size * 0.25 };
  },
};

export function makeDoc(root: NodeData, layout: LayoutKind = 'map'): Doc {
  const r = fromData(root);
  normalizeMains(r, themeById(DEFAULT_THEME).palette.length);
  return new Doc(r, DEFAULT_THEME, layout);
}

export const T = (text: string, ...children: NodeData[]): NodeData => ({ text, children });
