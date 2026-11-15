// Themes, typography metrics and color helpers.

import type { ColorRef, FontKind, MapStyle, Shape, TopicStyle } from './model.ts';

export interface Font {
  size: number;
  weight: number;
  italic: boolean;
  /** CSS font-family list. */
  family: string;
  /** CSS shorthand, usable for both canvas and DOM. */
  css: string;
}

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Hiragino Sans", ' +
  '"Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", sans-serif';

/** The typefaces a map can be set in. Each list ends in fonts that every system has. */
export const FONT_STACKS: Record<FontKind, string> = {
  sans: FONT_STACK,
  serif: '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif JP", "Noto Serif CJK JP", "Times New Roman", serif',
  round: '"Hiragino Maru Gothic ProN", ui-rounded, "Arial Rounded MT Bold", "Yu Gothic UI", "Meiryo", "Noto Sans JP", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Osaka-Mono", "MS Gothic", "Noto Sans Mono CJK JP", monospace',
};

const fonts = new Map<string, Font>();

/** Fonts are shared: the same size, weight, slant and family always give the same object. */
export function font(size: number, weight: number, italic = false, family: string = FONT_STACK): Font {
  const css = `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  let f = fonts.get(css);
  if (!f) fonts.set(css, (f = { size, weight, italic, family, css }));
  return f;
}

/** The same font in the typeface of the map. */
export function fontIn(f: Font, kind: FontKind | undefined): Font {
  return kind === undefined || kind === 'sans' ? f : font(f.size, f.weight, f.italic, FONT_STACKS[kind]);
}

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

/** The font of a topic: that of its level, in the map's typeface, changed by the topic's own style. */
export function topicFont(lv: number, st: TopicStyle | undefined, kind: FontKind | undefined): Font {
  const base = LEVELS[lv].font;
  if (!st && (kind === undefined || kind === 'sans')) return base;
  const weight = st?.bold === undefined ? base.weight : st.bold ? 700 : 400;
  return font(st?.size ?? base.size, weight, st?.italic === true, FONT_STACKS[kind ?? 'sans']);
}

/** Line height of a topic: that of its level, scaled along with a font size of its own. */
export function lineHeightOf(lv: number, st: TopicStyle | undefined): number {
  const m = LEVELS[lv];
  return st?.size === undefined ? m.lineHeight : Math.round((st.size * m.lineHeight) / m.font.size);
}

/** Corner radius of a box whose shape was explicitly set to "rounded", per level. */
export const ROUNDED = [12, 9, 6];
/** Horizontal padding of subtopics that are drawn as boxes. */
export const SUB_BOX_PAD_X = 10;
/** Marker glyph size and spacing. */
export const MARK = 18;
export const MARK_STEP = 20;
export const MARK_GAP = 6;
/** Note / link indicator size and spacing. */
export const ICON = 14;
export const ICON_STEP = 19;
/** Gap between a topic's number and its text. */
export const NUM_GAP = 5;
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
  edge: 'curve' | 'elbow' | 'straight';
  /** Root branches taper from thick to thin. */
  taper: boolean;
  /** Outline of the central topic and of the main topics, where it is not the usual rounded box. */
  rootShape?: Shape;
  mainShape?: Shape;
  /** Radius of the corners of `elbow` connectors (default 8; 0 for square corners). */
  corner?: number;
  /** The typeface of all text; the map's own settings can choose another (see themeWith). */
  typeface?: FontKind;
  /** Set by the map's own settings: thickness of the branch lines, 1 = as designed. */
  lineScale?: number;
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
  // ---- crisp, for documents and meetings
  {
    id: 'kon',
    name: 'Kon',
    dark: false,
    bg: '#ffffff',
    text: '#1f2937',
    muted: '#9ca3af',
    accent: '#1d4ed8',
    palette: ['#1e3a8a', '#0f766e', '#b45309', '#6d28d9', '#be123c', '#475569'],
    root: { fill: '#0f172a', text: '#ffffff' },
    main: 'solid',
    sub: 'underline',
    edge: 'elbow',
    taper: false,
    rootShape: 'rounded',
    mainShape: 'rect',
    corner: 3,
  },
  {
    id: 'tetsu',
    name: 'Tetsu',
    dark: false,
    bg: '#f4f5f7',
    text: '#1f2933',
    muted: '#9aa5b1',
    accent: '#0e7490',
    palette: ['#334155', '#0e7490', '#52606d', '#0f766e', '#3e4c59', '#155e75'],
    root: { fill: '#1f2933', text: '#ffffff' },
    main: 'outline',
    sub: 'tint',
    edge: 'elbow',
    taper: false,
    rootShape: 'rect',
    mainShape: 'rect',
    corner: 0,
  },
  {
    id: 'shiro',
    name: 'Shiro',
    dark: false,
    bg: '#ffffff',
    text: '#111827',
    muted: '#9ca3af',
    accent: '#2563eb',
    palette: ['#6b7280'],
    root: { fill: '#111827', text: '#ffffff' },
    main: 'solid',
    sub: 'plain',
    edge: 'elbow',
    taper: false,
    rootShape: 'underline',
    mainShape: 'none',
    corner: 6,
  },
  // ---- color
  {
    id: 'akane',
    name: 'Akane',
    dark: false,
    bg: '#fff8f1',
    text: '#3b2a26',
    muted: '#b9a79e',
    accent: '#d9480f',
    palette: ['#d9480f', '#c2255c', '#e8890c', '#a61e4d', '#b3541e', '#862e9c'],
    root: { fill: '#7c2d12', text: '#fff8f1' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'umi',
    name: 'Umi',
    dark: false,
    bg: '#f0fafb',
    text: '#12343b',
    muted: '#8fb0b6',
    accent: '#0b7285',
    palette: ['#0b7285', '#1971c2', '#0ca678', '#1098ad', '#3b5bdb', '#099268'],
    root: { fill: '#0b3c49', text: '#ffffff' },
    main: 'tint',
    sub: 'plain',
    edge: 'curve',
    taper: false,
    mainShape: 'pill',
  },
  {
    id: 'fuji',
    name: 'Fuji',
    dark: false,
    bg: '#faf7ff',
    text: '#2e2a3b',
    muted: '#a8a1bd',
    accent: '#7048e8',
    palette: ['#7048e8', '#ae3ec9', '#4263eb', '#c2255c', '#5f3dc4', '#9c36b5'],
    root: { fill: '#3b2f63', text: '#ffffff' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'sakura',
    name: 'Sakura',
    dark: false,
    bg: '#fff7f9',
    text: '#4a3540',
    muted: '#c4a9b4',
    accent: '#e64980',
    palette: ['#e64980', '#f76707', '#d6336c', '#cc5de8', '#f06595', '#e8590c'],
    root: { fill: '#d6336c', text: '#ffffff' },
    main: 'tint',
    sub: 'plain',
    edge: 'curve',
    taper: false,
    mainShape: 'pill',
    typeface: 'round',
  },
  {
    id: 'niji',
    name: 'Niji',
    dark: false,
    bg: '#ffffff',
    text: '#242833',
    muted: '#a0a5b3',
    accent: '#4c6ef5',
    palette: ['#fa5252', '#fd7e14', '#f7a600', '#37b24d', '#15aabf', '#4c6ef5', '#be4bdb', '#e64980'],
    root: { fill: '#242833', text: '#ffffff' },
    main: 'solid',
    sub: 'tint',
    edge: 'curve',
    taper: false,
    mainShape: 'pill',
  },
  // ---- paper and ink
  {
    id: 'genko',
    name: 'Genko',
    dark: false,
    bg: '#fbf6ea',
    text: '#2b2622',
    muted: '#a39b8b',
    accent: '#b23a2f',
    palette: ['#2f4b6e', '#8c3b2e', '#4f6b3a', '#7a5a2b', '#5b4a7a', '#2d6b6b'],
    root: { fill: '#2b2622', text: '#fbf6ea' },
    main: 'solid',
    sub: 'underline',
    edge: 'curve',
    taper: true,
    mainShape: 'underline',
    typeface: 'serif',
  },
  // ---- dark
  {
    id: 'tsuki',
    name: 'Tsuki',
    dark: true,
    bg: '#0f172a',
    text: '#e2e8f0',
    muted: '#64748b',
    accent: '#fbbf24',
    palette: ['#fbbf24', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#f59e0b'],
    root: { fill: '#fbbf24', text: '#0f172a' },
    main: 'outline',
    sub: 'underline',
    edge: 'curve',
    taper: true,
  },
  {
    id: 'hotaru',
    name: 'Hotaru',
    dark: true,
    bg: '#0b0f14',
    text: '#e6edf3',
    muted: '#5c6773',
    accent: '#39ff88',
    palette: ['#39ff88', '#22d3ee', '#f472b6', '#facc15', '#a78bfa', '#fb923c'],
    root: { fill: '#39ff88', text: '#0b0f14' },
    main: 'tint',
    sub: 'plain',
    edge: 'straight',
    taper: false,
    mainShape: 'pill',
  },
  {
    id: 'kohaku',
    name: 'Kohaku',
    dark: true,
    bg: '#1a1512',
    text: '#efe6dc',
    muted: '#7d6f63',
    accent: '#f59f00',
    palette: ['#f59f00', '#e8590c', '#d9a05b', '#e9b949', '#c2410c', '#b08968'],
    root: { fill: '#f59f00', text: '#1a1512' },
    main: 'solid',
    mainText: '#1a1512',
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

/** WCAG contrast ratio of two colors, 1 (none) … 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on `fill`. */
export const inkOn = (fill: string): string => (luminance(fill) > 0.45 ? '#1b1d23' : '#ffffff');

/**
 * The theme as one map shows it: with the map's own background, line thickness
 * and typeface. Without such settings this is the theme itself.
 */
export function themeWith(base: Theme, s: MapStyle): Theme {
  if (s.background === undefined && s.line === undefined && s.font === undefined) return base;
  const t: Theme = { ...base };
  if (s.line !== undefined) t.lineScale = s.line;
  // A typeface chosen for the map wins over the one the theme comes with.
  if (s.font !== undefined) t.typeface = s.font;
  const bg = s.background;
  if (bg !== undefined && bg !== base.bg) {
    t.bg = bg;
    const dark = luminance(bg) < 0.2;
    if (dark !== base.dark) {
      // Whatever is written straight onto the canvas follows it to the other side.
      t.dark = dark;
      t.text = dark ? '#dde1ea' : '#2a2e3a';
      t.muted = dark ? '#6b7280' : '#9aa0ae';
    }
    // A central topic that would vanish into the new background trades its colors,
    // and branch colors that would, move towards the color of the text.
    if (contrast(base.root.fill, bg) < 1.6) t.root = { fill: t.text, text: bg };
    t.palette = base.palette.map((c) => (contrast(c, bg) < 1.5 ? mix(c, t.text, 0.55) : c));
  }
  return t;
}

export function resolveColor(theme: Theme, ref: ColorRef): string {
  return typeof ref === 'number' ? theme.palette[ref % theme.palette.length] : ref;
}

// ------------------------------------------------------------- node styling

export interface NodeStyle {
  fill: string | null;
  stroke: string | null;
  text: string;
  /** Marker glyphs need a light backdrop on this fill to stay readable. */
  plate: boolean;
}

/** Styles are cached per theme object, so a map with settings of its own never sees another map's colors. */
const styleCaches = new WeakMap<Theme, Map<string, NodeStyle>>();

function cacheOf(theme: Theme): Map<string, NodeStyle> {
  let c = styleCaches.get(theme);
  if (!c) styleCaches.set(theme, (c = new Map()));
  return c;
}

/**
 * How the theme draws a topic.
 * @param box the topic is drawn as a box: always at the top two levels unless its shape says
 *   otherwise; for subtopics in org charts and the like, in `tint` themes, or by their shape
 */
export function styleFor(theme: Theme, lv: number, branch: string, box: boolean): NodeStyle {
  const cache = cacheOf(theme);
  const key = `${lv}|${branch}|${box ? 1 : 0}`;
  let s = cache.get(key);
  if (s) return s;
  if (!box) {
    s = { fill: null, stroke: null, text: theme.text, plate: false };
  } else if (lv === 0) {
    s = { fill: theme.root.fill, stroke: theme.root.stroke ?? null, text: theme.root.text, plate: false };
  } else if (lv === 1) {
    if (theme.main === 'solid') {
      s = { fill: branch, stroke: null, text: theme.mainText ?? inkOn(branch), plate: true };
    } else if (theme.main === 'tint') {
      s = {
        fill: mix(branch, theme.bg, theme.dark ? 0.72 : 0.8),
        stroke: null,
        text: mix(branch, theme.dark ? '#ffffff' : '#000000', 0.52),
        plate: false,
      };
    } else {
      s = { fill: theme.bg, stroke: branch, text: theme.text, plate: false };
    }
  } else {
    s = { fill: mix(branch, theme.bg, theme.dark ? 0.8 : 0.88), stroke: null, text: theme.text, plate: false };
  }
  cache.set(key, s);
  return s;
}

/** How a topic is drawn: the theme's style for it, with the colors of its own style on top. */
export function nodeStyle(theme: Theme, lv: number, branch: string, box: boolean, st: TopicStyle | undefined): NodeStyle {
  const base = styleFor(theme, lv, branch, box);
  if (!st || (st.fill === undefined && st.border === undefined && st.color === undefined)) return base;
  const cache = cacheOf(theme);
  const key = `${lv}|${branch}|${box ? 1 : 0}|${st.fill ?? ''}|${st.border ?? ''}|${st.color ?? ''}`;
  let s = cache.get(key);
  if (s) return s;
  s = { ...base };
  if (box) {
    if (st.fill === 'none') {
      // "No fill" is the color of the canvas, so that lines running behind the topic stay hidden.
      s.fill = theme.bg;
      s.stroke = branch;
      s.text = theme.text;
      s.plate = false;
    } else if (st.fill !== undefined) {
      s.fill = st.fill;
      s.text = inkOn(st.fill);
      s.plate = true;
    }
    if (st.border !== undefined) s.stroke = st.border;
  }
  if (st.color !== undefined) s.text = st.color;
  if (cache.size > 4000) cache.clear(); // dragging through a color picker leaves many one-off entries
  cache.set(key, s);
  return s;
}
