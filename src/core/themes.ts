// Themes, typography metrics and color helpers.

import type { ColorRef } from './model.ts';

export interface Font {
  size: number;
  weight: number;
  /** CSS shorthand, usable for both canvas and DOM. */
  css: string;
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Hiragino Sans", ' +
  '"Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

export const font = (size: number, weight: number): Font => ({
  size,
  weight,
  css: `${weight} ${size}px ${FONT_STACK}`,
});

export interface LevelMetrics {
  font: Font;
  lineHeight: number;
  padX: number;
  padY: number;
  maxWidth: number;
  radius: number;
}

/** Typography and box metrics per style level: root, main topic, subtopic. */
export const LEVELS: readonly LevelMetrics[] = [
  { font: font(21, 700), lineHeight: 28, padX: 28, padY: 15, maxWidth: 340, radius: 22 },
  { font: font(15, 600), lineHeight: 21, padX: 15, padY: 8, maxWidth: 320, radius: 9 },
  { font: font(14, 400), lineHeight: 20, padX: 6, padY: 5, maxWidth: 360, radius: 6 },
];

/** Horizontal padding of subtopics that are drawn as boxes. */
export const SUB_BOX_PAD_X = 10;
/** Marker glyph size and spacing. */
export const MARK = 18;
export const MARK_STEP = 20;
export const MARK_GAP = 6;
/** Note / link indicator size and spacing. */
export const ICON = 14;
export const ICON_STEP = 19;
/** To-do checkbox size and the room it takes in front of the text. */
export const TODO = 15;
export const TODO_STEP = 21;
/** Label chips under a topic's text. */
export const LABEL_FONT = font(11, 500);
export const LABEL_H = 17;
export const LABEL_PAD = 6;
export const LABEL_GAP = 4;
export const LABEL_TOP = 4;
export const LABEL_ROW_GAP = 3;
/** Boundary frames: room between the content and the frame, and between the frame and its surroundings. */
export const FRAME_PAD = 9;
export const FRAME_GAP = 5;
export const FRAME_TITLE = 17;
export const FRAME_FONT = font(11.5, 600);
/** Room between summarized topics and their summary topic (holds the bracket). */
export const SUM_GAP = 30;
/** Logic chart: length of the straight line that leaves the central topic before the branches part. */
export const LOGIC_STEM = 24;
/** Relationship lines. */
export const REL_FONT = font(12, 500);

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  bg: string;
  /** Subtopic text. */
  text: string;
  muted: string;
  /** Selection and interactive highlights. */
  accent: string;
  /** Branch colors, assigned to main topics in rotation. */
  palette: string[];
  root: { fill: string; text: string; stroke?: string };
  main: 'solid' | 'tint' | 'outline';
  /** Overrides the automatic black/white choice on solid main topics. */
  mainText?: string;
  sub: 'underline' | 'plain' | 'tint';
  edge: 'curve' | 'elbow';
  /** Root branches taper from thick to thin. */
  taper: boolean;
}

export const THEMES: readonly Theme[] = [
  {
    id: 'hinata',
    name: 'Hinata',
    dark: false,
    bg: '#ffffff',
    text: '#2a2e3a',
    muted: '#9aa0ae',
    accent: '#3b82f6',
    palette: ['#ef5f5c', '#f28a2e', '#34b37a', '#1ba8b8', '#3a86f5', '#7a68f0', '#e3569b'],
    root: { fill: '#232838', text: '#ffffff' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'mochi',
    name: 'Mochi',
    dark: false,
    bg: '#fffcf7',
    text: '#4a4553',
    muted: '#b0a9b8',
    accent: '#8b7cf6',
    palette: ['#f2788f', '#f5a45c', '#e0b030', '#62c493', '#52b6e8', '#9b8cf2', '#e07cc4'],
    root: { fill: '#4b4458', text: '#ffffff' },
    main: 'tint',
    sub: 'plain',
    edge: 'elbow',
    taper: false,
  },
  {
    id: 'sora',
    name: 'Sora',
    dark: false,
    bg: '#f3f7fc',
    text: '#22324d',
    muted: '#8fa0ba',
    accent: '#2563eb',
    palette: ['#2f6df0', '#1b9ad6', '#14b3a6', '#5566ee', '#8758ec', '#2389c9'],
    root: { fill: '#1e49c8', text: '#ffffff' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'matcha',
    name: 'Matcha',
    dark: false,
    bg: '#f6f2e7',
    text: '#3b3a30',
    muted: '#a39e8c',
    accent: '#5c8a3a',
    palette: ['#6a8f45', '#b8862f', '#a85b43', '#4a7f7b', '#86659a', '#8c8a3a'],
    root: { fill: '#354a2c', text: '#f6f2e7' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'sumi',
    name: 'Sumi',
    dark: false,
    bg: '#ffffff',
    text: '#1b1b1f',
    muted: '#a0a0a8',
    accent: '#e5484d',
    palette: ['#26262b'],
    root: { fill: '#16161a', text: '#ffffff' },
    main: 'outline',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'yoru',
    name: 'Yoru',
    dark: true,
    bg: '#15171c',
    text: '#dde1ea',
    muted: '#6b7280',
    accent: '#7aa2ff',
    palette: ['#ff7a7a', '#ffa85c', '#f5d060', '#5fd99a', '#4cc9f0', '#8ea2ff', '#d58cff'],
    root: { fill: '#f1f3f7', text: '#15171c' },
    main: 'solid',
    mainText: '#15171c',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
];

export const DEFAULT_THEME = 'hinata';

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// ------------------------------------------------------------------- colors

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const v = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Linear blend: `t = 0` gives `a`, `t = 1` gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveColor(theme: Theme, ref: ColorRef): string {
  return typeof ref === 'number' ? theme.palette[ref % theme.palette.length] : ref;
}

// ------------------------------------------------------------- node styling

export interface NodeStyle {
  fill: string | null;
  stroke: string | null;
  text: string;
}

const styleCache = new Map<string, NodeStyle>();

/**
 * Visual style of a node box.
 * @param boxedSub subtopics are drawn as boxes (org chart, or `tint` themes)
 */
export function styleFor(theme: Theme, lv: number, branch: string, boxedSub: boolean): NodeStyle {
  const key = `${theme.id}|${lv}|${branch}|${boxedSub ? 1 : 0}`;
  let s = styleCache.get(key);
  if (s) return s;
  if (lv === 0) {
    s = { fill: theme.root.fill, stroke: theme.root.stroke ?? null, text: theme.root.text };
  } else if (lv === 1) {
    if (theme.main === 'solid') {
      s = { fill: branch, stroke: null, text: theme.mainText ?? (luminance(branch) > 0.45 ? '#1b1d23' : '#ffffff') };
    } else if (theme.main === 'tint') {
      s = {
        fill: mix(branch, theme.bg, theme.dark ? 0.72 : 0.8),
        stroke: null,
        text: mix(branch, theme.dark ? '#ffffff' : '#000000', 0.52),
      };
    } else {
      s = { fill: theme.bg, stroke: branch, text: theme.text };
    }
  } else if (boxedSub) {
    s = { fill: mix(branch, theme.bg, theme.dark ? 0.8 : 0.88), stroke: null, text: theme.text };
  } else {
    s = { fill: null, stroke: null, text: theme.text };
  }
  styleCache.set(key, s);
  return s;
}
