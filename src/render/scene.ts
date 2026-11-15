// Draws the mind map (boundaries, branches, topics, markers, relationships)
// through a Painter. Shared by the live canvas, PNG export and SVG export.

import type { Bounds, FontMetrics } from '../core/layout.ts';
import { AXIS_END, SPINE_TAIL } from '../core/layout.ts';
import type { MNode, Rel } from '../core/model.ts';
import { walkVisible } from '../core/model.ts';
import {
  A_AXIS_H,
  A_AXIS_V,
  A_DOWN,
  A_SPINE_L,
  A_TREE_DL,
  A_TREE_DR,
  A_UP,
  BONE_COT,
  aboveSpine,
  isAxis,
  isLogic,
  isRibs,
  isRow,
  isSide,
  isSpine,
  isTree,
  treeTrunk,
} from '../core/structures.ts';
import type { Font, Theme } from '../core/themes.ts';
import {
  FRAME_FONT,
  FRAME_GAP,
  ICON,
  ICON_STEP,
  LABEL_FONT,
  LABEL_H,
  LABEL_PAD,
  LOGIC_STEM,
  MARK,
  MARK_GAP,
  MARK_STEP,
  REL_FONT,
  TODO,
  TODO_STEP,
  font,
  fontIn,
  mix,
  nodeStyle,
} from '../core/themes.ts';
import { drawJumpIcon, drawLinkIcon, drawMarker, drawNoteIcon } from './markers.ts';
import type { Painter } from './painter.ts';
import { circle, diamond, ellipse, roundRect } from './painter.ts';

export interface SceneOpts {
  theme: Theme;
  metrics: (font: Font) => FontMetrics;
  textWidth: (font: Font, text: string) => number;
  /** World-space rectangle to cull against, or null to draw everything. */
  clip: Bounds | null;
  /** Screen pixels per world unit, for level-of-detail decisions. */
  zoom: number;
  /** Node whose text is currently shown by the DOM editor. */
  editing: MNode | null;
  /** Search matches to highlight. */
  marks: ReadonlySet<MNode> | null;
  markCurrent: MNode | null;
  /** Roots of subtrees drawn translucent (being dragged). */
  dim: ReadonlySet<MNode> | null;
  /** Topics that pass the filter; when set, all others are drawn pale. */
  keep: ReadonlySet<MNode> | null;
  /** Layout pass this scene belongs to: topics stamped otherwise are not on screen. */
  stamp: number;
  rels: readonly Rel[];
  selRel: Rel | null;
}

/** Distance from a node's outer edge to its collapse toggle. */
export const TOGGLE_OFFSET = 14;
export const TOGGLE_R = 8;
/** Below this on-screen font size text is drawn as a placeholder bar. */
const LOD_PX = 3.4;

const W_SPINE = 3.4;
const W_ROOT = 2.8;
const W_MAIN = 2;
const W_SUB = 1.6;
const W_REL = 1.6;
const TAPER_FROM = 5;
const TAPER_TO = 1.5;
/** Opacity of everything a filter leaves out. */
const FADE = 0.2;

const BADGE_FONT = font(9.5, 700);
const BADGE_FONT_S = font(7.5, 700);
const HILITE = '#f5b400';
const DASH: readonly number[] = [5, 4];

const L0: MNode[] = [];
const L1: MNode[] = [];
const L2: MNode[] = [];
const frames: MNode[] = [];
const spines: MNode[] = [];
const stems: MNode[] = [];
const sums: MNode[] = [];
const loose: MNode[] = [];
/** The topic the scene is drawn from: the central topic, or a branch shown on its own. */
let vroot: MNode | null = null;
/** Thickness of the branch lines in the scene being drawn, relative to the theme's. */
let ls = 1;

const alphaOf = (n: MNode): number => n.aa * (n.dim ? 0.3 : 1) * (n.fade ? FADE : 1);

function collect(n: MNode, o: SceneOpts, dim: boolean): void {
  const c = o.clip;
  if (c && (n.bx1 < c.x0 || n.bx0 > c.x1 || n.by1 < c.y0 || n.by0 > c.y1)) return;
  dim = dim || (o.dim !== null && o.dim.has(n));
  n.dim = dim;
  n.fade = o.keep !== null && !o.keep.has(n);
  (n.lv === 0 ? L0 : n.lv === 1 ? L1 : L2).push(n);
  if (n.boundary !== undefined && n.parent) frames.push(n);
  if (n.sumN > 0 && n !== vroot) sums.push(n);
  if (!n.folded && n.children.length) {
    const a = n.cdir;
    if (isAxis(a) || isSpine(a)) spines.push(n);
    else if (n.lv === 0 && isSide(a) && isLogic(n.children[0].pk)) stems.push(n);
    for (const k of n.children) collect(k, o, dim);
  }
}

/** The y at which the outline of `n` passes world x, on its lower (`below`) or upper side. */
function outlineY(n: MNode, x: number, below: boolean): number {
  const s = below ? 1 : -1;
  const hw = n.w / 2;
  const hh = n.h / 2;
  const cy = n.ay + hh;
  const dx = Math.min(hw, Math.abs(x - (n.ax + hw)));
  switch (n.shp) {
    case 'ellipse':
      return cy + s * hh * Math.sqrt(1 - (dx / hw) ** 2);
    case 'diamond':
      return cy + s * hh * (1 - dx / hw);
    case 'rounded':
    case 'pill': {
      const r = Math.min(n.rad, hw, hh);
      const inset = hw - dx; // distance from the nearer side
      return inset >= r ? cy + s * hh : cy + s * (hh - r + Math.sqrt(r * r - (r - inset) ** 2));
    }
    default:
      return cy + s * hh;
  }
}

/** Appends the outline of `n`, `g` units larger all around, to the current path. */
export function outlinePath(p: Painter, n: MNode, g = 0): void {
  const x = n.ax - g;
  const y = n.ay - g;
  const w = n.w + g * 2;
  const h = n.h + g * 2;
  if (n.shp === 'ellipse') ellipse(p, x + w / 2, y + h / 2, w / 2, h / 2);
  else if (n.shp === 'diamond') {
    // Grown so that its sides stay parallel to the topic's.
    const d = g * Math.hypot(n.w, n.h);
    diamond(p, x + w / 2, y + h / 2, n.w / 2 + d / n.h, n.h / 2 + d / n.w);
  } else roundRect(p, x, y, w, h, n.rad + g);
}

/** Where the bone of a fishbone main topic meets the topic (or the branch it carries). */
export function boneAnchor(n: MNode): [number, number] {
  const x = n.ax + n.w / 2 + n.bax;
  // On the topic itself (rather than on the corner of the branch it carries) the bone ends at the outline.
  if (Math.abs(Math.abs(n.bay) - n.h / 2) < 0.5 && Math.abs(n.bax) <= n.w / 2) return [x, outlineY(n, x, n.bay > 0)];
  return [x, n.ay + n.h / 2 + n.bay];
}

/** The height at which a connector meets `n`: its underline, or the middle of its box. */
const attachY = (n: MNode): number => (n.ul ? n.ay + n.h : n.ay + n.h / 2);

/** The point on a node from which the lines to its children start. */
export function childAnchor(n: MNode): [number, number] {
  const c = n.cdir;
  if (c === A_DOWN) return [n.ax + n.w / 2, n.ay + n.h];
  if (c === A_UP) return [n.ax + n.w / 2, n.ay];
  if (isTree(c)) {
    const t = treeTrunk(n.lv, n.ul);
    const down = c === A_TREE_DR || c === A_TREE_DL;
    const x = c > 0 ? n.ax + t : n.ax + n.w - t;
    // An underlined topic's trunk always starts from the end of its underline.
    return [x, outlineY(n, x, down || n.ul)];
  }
  if (isRibs(c) && isSpine(n.dir)) return boneAnchor(n);
  return [c < 0 ? n.ax : n.ax + n.w, attachY(n)];
}

/** A folded row of a tree list: its badge goes at the end of the row, clear of the rows below. */
const foldedRow = (n: MNode): boolean => n.folded && isTree(n.cdir) && isTree(n.dir);

/** Where the short line to the toggle / badge of `n` starts. */
function toggleStem(n: MNode): [number, number] {
  if (!foldedRow(n)) return childAnchor(n);
  return [n.cdir > 0 ? n.ax + n.w : n.ax, attachY(n)];
}

/** Center of the collapse toggle / hidden-count badge of `n`. */
export function togglePos(n: MNode): [number, number] {
  const c = n.cdir;
  const [x, y] = toggleStem(n);
  if (foldedRow(n)) return [c > 0 ? x + TOGGLE_OFFSET : x - TOGGLE_OFFSET, y];
  if (c === A_DOWN) return [x, y + TOGGLE_OFFSET];
  if (c === A_UP) return [x, y - TOGGLE_OFFSET];
  if (isTree(c)) return c === A_TREE_DR || c === A_TREE_DL ? [x, n.ay + n.h + TOGGLE_OFFSET] : [x, n.ay - TOGGLE_OFFSET];
  if (isRibs(c) && isSpine(n.dir)) {
    // A little way down the bone, towards the spine.
    const s = n.dir === A_SPINE_L ? 1 : -1;
    const v = aboveSpine(n) ? 1 : -1;
    return [x + s * TOGGLE_OFFSET * BONE_COT, y + v * TOGGLE_OFFSET];
  }
  return [c < 0 ? x - TOGGLE_OFFSET : x + TOGGLE_OFFSET, y];
}

/** The square of a topic's to-do checkbox: x, y, size. */
export function todoBox(n: MNode): [number, number, number] {
  const marks = n.markers ? n.markers.length : 0;
  const mkW = marks ? marks * MARK_STEP - (MARK_STEP - MARK) + MARK_GAP : 0;
  return [n.ax + n.tx - n.nw - mkW - TODO_STEP, n.ay + n.ty + (n.lh - TODO) / 2, TODO];
}

/** Outline of a boundary frame: x, y, width, height. */
export function frameRect(n: MNode): [number, number, number, number] {
  const x0 = n.ax - (n.x - n.bx0) + FRAME_GAP;
  const y0 = n.ay - (n.y - n.by0) + FRAME_GAP;
  const x1 = n.ax + (n.bx1 - n.x) - FRAME_GAP;
  const y1 = n.ay + (n.by1 - n.y) - FRAME_GAP;
  return [x0, y0, x1 - x0, y1 - y0];
}

// -------------------------------------------------------------------- edges

function taperPath(p: Painter, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, a0: number, a1: number): void {
  let ux = cx - x0;
  let uy = cy - y0;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul;
  uy /= ul;
  let vx = x1 - cx;
  let vy = y1 - cy;
  const vl = Math.hypot(vx, vy) || 1;
  vx /= vl;
  vy /= vl;
  let mx = -uy - vy;
  let my = ux + vx;
  const ml = Math.hypot(mx, my) || 1;
  mx /= ml;
  my /= ml;
  const am = (a0 + a1) / 2;
  p.moveTo(x0 - uy * a0, y0 + ux * a0);
  p.quadTo(cx + mx * am, cy + my * am, x1 - vy * a1, y1 + vx * a1);
  p.lineTo(x1 + vy * a1, y1 - vx * a1);
  p.quadTo(cx - mx * am, cy - my * am, x0 + uy * a0, y0 - ux * a0);
  p.closePath();
}

/** Org chart: out of the parent, across, into the child — rounded where the line turns into the child. */
function rowEdge(p: Painter, q: MNode, n: MNode, s: number): void {
  const x0 = q.ax + q.w / 2;
  const y0 = s > 0 ? q.ay + q.h : q.ay;
  const x1 = n.ax + n.w / 2;
  const y1 = s > 0 ? n.ay : n.ay + n.h;
  p.moveTo(x0, y0);
  if (Math.abs(x1 - x0) < 0.5) {
    p.lineTo(x1, y1);
    return;
  }
  // All children hang from one crossbar, even those that sit lower (inside a boundary).
  const my = q.ay + q.h / 2 + q.bar;
  const sx = x1 > x0 ? 1 : -1;
  const r = Math.min(7, Math.abs(x1 - x0));
  p.lineTo(x0, my);
  p.lineTo(x1 - sx * r, my);
  p.quadTo(x1, my, x1, my + s * r);
  p.lineTo(x1, y1);
}

/** Tree list: down (or up) the parent's trunk, then across to the child. */
function treeEdge(p: Painter, q: MNode, n: MNode): void {
  const sx = n.dir > 0 ? 1 : -1;
  const [tx, ty] = childAnchor(q);
  const x1 = sx > 0 ? n.ax : n.ax + n.w;
  const y1 = attachY(n);
  const sy = y1 >= ty ? 1 : -1;
  const r = Math.min(6, Math.abs(x1 - tx), Math.abs(y1 - ty));
  // Each child only draws its own stretch of the shared trunk, from the sibling
  // before it, so differently colored branches do not paint over one another.
  let i = n.idx - 1;
  while (i >= 0 && q.children[i].sumN > 0) i--; // a summary topic is not on the trunk
  let from = ty;
  if (i >= 0) {
    const py = attachY(q.children[i]);
    if ((py - ty) * sy > 8) from = py - sy * 8;
  }
  p.moveTo(tx, from);
  p.lineTo(tx, y1 - sy * r);
  p.quadTo(tx, y1, tx + sx * r, y1);
  p.lineTo(x1, y1);
  if (n.ul) p.lineTo(sx > 0 ? n.ax + n.w : n.ax, y1);
}

/** Fishbone: the slanted bone from the spine (at height `spine`) up or down to a main topic. */
function boneLine(p: Painter, n: MNode, spine: number): void {
  const [x, y] = boneAnchor(n);
  const s = n.dir === A_SPINE_L ? 1 : -1;
  p.moveTo(x + s * Math.abs(spine - y) * BONE_COT, spine);
  p.lineTo(x, y);
}

/** Fishbone: from the bone straight out to a rib topic. */
function ribEdge(p: Painter, q: MNode, n: MNode): void {
  const [bx, by] = boneAnchor(q);
  const s = q.dir === A_SPINE_L ? 1 : -1;
  const y = attachY(n);
  const left = q.dir !== A_SPINE_L; // the rib grows to the right, so the bone is on its left
  p.moveTo(bx + s * Math.abs(by - y) * BONE_COT, y);
  p.lineTo(left ? (n.ul ? n.ax + n.w : n.ax) : n.ul ? n.ax : n.ax + n.w, y);
}

/** Radius of the corner where an elbow connector turns towards its topic. */
const elbowR = (dy: number, dx: number, max = 8): number => Math.min(max, Math.abs(dy), Math.abs(dx));

/** Mind map / logic chart: beside the parent. */
function sideEdge(p: Painter, q: MNode, n: MNode, o: SceneOpts): void {
  const d = n.dir;
  const x1 = d > 0 ? n.ax : n.ax + n.w;
  const y1 = attachY(n);
  if (q.lv === 0 && isLogic(n.pk)) {
    // Logic chart: a straight line leaves the central topic and the branches part from
    // an upright at its end. Line and upright are shared, so drawStem() draws them once;
    // each branch adds its own corner and run.
    const jx = (d > 0 ? q.ax + q.w : q.ax) + d * LOGIC_STEM;
    const y0 = attachY(q);
    const dy = y1 - y0;
    if (Math.abs(dy) < 0.5) {
      p.moveTo(jx, y0);
      p.lineTo(x1, y1);
    } else {
      const s = dy > 0 ? 1 : -1;
      const r = elbowR(dy, x1 - jx, o.theme.corner);
      p.moveTo(jx, y1 - s * r);
      p.quadTo(jx, y1, jx + d * r, y1);
      p.lineTo(x1, y1);
    }
  } else if (q.lv === 0) {
    // Root branches fan out from the center of the root topic — or from its edge,
    // when it has no box that would hide where they meet.
    const cx = q.box ? q.ax + q.w / 2 : d > 0 ? q.ax + q.w : q.ax;
    const cy = q.box ? q.ay + q.h / 2 : attachY(q);
    // Straight themes run a straight line; the others swing out and arrive level.
    const straight = o.theme.edge === 'straight';
    const kx = straight ? (cx + x1) / 2 : cx + (x1 - cx) * 0.36;
    const ky = straight ? (cy + y1) / 2 : y1;
    if (o.theme.taper && n.pk === 'map') taperPath(p, cx, cy, kx, ky, x1, y1, TAPER_FROM * ls, TAPER_TO * ls);
    else {
      p.moveTo(cx, cy);
      if (straight) p.lineTo(x1, y1);
      else p.quadTo(kx, ky, x1, y1);
    }
    return;
  } else {
    const x0 = d > 0 ? q.ax + q.w : q.ax;
    const y0 = attachY(q);
    p.moveTo(x0, y0);
    if (o.theme.edge === 'straight') p.lineTo(x1, y1);
    else if (o.theme.edge === 'elbow') {
      const jx = x0 + d * 16;
      const dy = y1 - y0;
      if (Math.abs(dy) < 0.5) p.lineTo(x1, y1);
      else {
        const s = dy > 0 ? 1 : -1;
        const r = elbowR(dy, x1 - jx, o.theme.corner);
        p.lineTo(jx, y0);
        p.lineTo(jx, y1 - s * r);
        p.quadTo(jx, y1, jx + d * r, y1);
        p.lineTo(x1, y1);
      }
    } else {
      const mx = (x0 + x1) / 2;
      p.cubicTo(mx, y0, mx, y1, x1, y1);
    }
  }
  if (n.ul) p.lineTo(d > 0 ? n.ax + n.w : n.ax, y1);
}

/** Brace map: one curly brace from the parent around all of its children. */
function bracePath(p: Painter, q: MNode): void {
  const d = q.cdir < 0 ? -1 : 1;
  let first: MNode | null = null;
  let last: MNode | null = null;
  let edge = d > 0 ? Infinity : -Infinity;
  for (const k of q.children) {
    if (k.sumN > 0) continue;
    if (!first) first = k;
    last = k;
    edge = d > 0 ? Math.min(edge, k.ax) : Math.max(edge, k.ax + k.w);
  }
  if (!first || !last) return;
  const xa = (d > 0 ? q.ax + q.w : q.ax) + d * 7; // the point of the brace
  const xb = edge - d * 5; // the ends of its arms
  const xm = xa + (xb - xa) * 0.5;
  const y0 = first.ay + Math.min(4, first.h / 4);
  const y1 = last.ay + last.h - Math.min(4, last.h / 4);
  const yp = Math.max(y0, Math.min(y1, q.ay + q.h / 2));
  const r = Math.max(0, Math.min(9, (yp - y0) / 2, (y1 - yp) / 2, Math.abs(xb - xm), Math.abs(xm - xa)));
  p.moveTo(xb, y0);
  p.quadTo(xm, y0, xm, y0 + r);
  p.lineTo(xm, yp - r);
  p.quadTo(xm, yp, xa, yp);
  p.quadTo(xm, yp, xm, yp + r);
  p.lineTo(xm, y1 - r);
  p.quadTo(xm, y1, xb, y1);
}

/** Summary: a bracket around the summarized topics, pointing at the summary topic `s`. */
function bracketPath(p: Painter, s: MNode): void {
  const q = s.parent!;
  const a = s.idx - s.sumN;
  const z = s.idx - 1;
  // Reach of the summarized branches: along the bracket (lo…hi) and towards the summary (edge).
  let lo = Infinity;
  let hi = -Infinity;
  if (isRow(s.dir)) {
    const v = s.dir === A_DOWN ? 1 : -1;
    let edge = -Infinity;
    for (let i = a; i <= z; i++) {
      const m = q.children[i];
      lo = Math.min(lo, m.ax - (m.x - m.bx0));
      hi = Math.max(hi, m.ax + (m.bx1 - m.x));
      edge = Math.max(edge, v > 0 ? m.ay + (m.by1 - m.y) : -(m.ay - (m.y - m.by0)));
    }
    lo += 3;
    hi -= 3;
    const ya = v * (edge + 6); // the ends of the arms
    const yt = v > 0 ? s.ay - 5 : s.ay + s.h + 5; // the point
    const ym = (ya + yt) / 2;
    const xc = Math.max(lo, Math.min(hi, s.ax + s.w / 2));
    const r = Math.max(0, Math.min(8, (xc - lo) / 2, (hi - xc) / 2, Math.abs(ym - ya), Math.abs(yt - ym)));
    p.moveTo(lo, ya);
    p.quadTo(lo, ym, lo + r, ym);
    p.lineTo(xc - r, ym);
    p.quadTo(xc, ym, xc, yt);
    p.quadTo(xc, ym, xc + r, ym);
    p.lineTo(hi - r, ym);
    p.quadTo(hi, ym, hi, ya);
    return;
  }
  const h = s.dir > 0 ? 1 : -1;
  let edge = -Infinity;
  for (let i = a; i <= z; i++) {
    const m = q.children[i];
    lo = Math.min(lo, m.ay - (m.y - m.by0));
    hi = Math.max(hi, m.ay + (m.by1 - m.y));
    edge = Math.max(edge, h > 0 ? m.ax + (m.bx1 - m.x) : -(m.ax - (m.x - m.bx0)));
  }
  lo += 3;
  hi -= 3;
  const xa = h * (edge + 6);
  const xt = h > 0 ? s.ax - 5 : s.ax + s.w + 5;
  const xm = (xa + xt) / 2;
  const yc = Math.max(lo, Math.min(hi, attachY(s)));
  const r = Math.max(0, Math.min(8, (yc - lo) / 2, (hi - yc) / 2, Math.abs(xm - xa), Math.abs(xt - xm)));
  p.moveTo(xa, lo);
  p.quadTo(xm, lo, xm, lo + r);
  p.lineTo(xm, yc - r);
  p.quadTo(xm, yc, xt, yc);
  p.quadTo(xm, yc, xm, yc + r);
  p.lineTo(xm, hi - r);
  p.quadTo(xm, hi, xa, hi);
  if (s.ul) {
    // The summary topic has no connector of its own to carry its underline.
    p.moveTo(s.ax, s.ay + s.h);
    p.lineTo(s.ax + s.w, s.ay + s.h);
  }
}

/** Appends the connector from `n.parent` to `n` (plus `n`'s underline) to the current path. */
function edgePath(p: Painter, n: MNode, o: SceneOpts): void {
  const q = n.parent!;
  if (n.pk === 'brace') {
    bracePath(p, q);
    return;
  }
  const d = n.dir;
  if (d === A_DOWN || d === A_UP) rowEdge(p, q, n, d === A_DOWN ? 1 : -1);
  else if (isTree(d)) treeEdge(p, q, n);
  else if (isSpine(d)) boneLine(p, n, q.ay + q.h / 2);
  else if (isRibs(d)) ribEdge(p, q, n);
  else if (isSide(d)) sideEdge(p, q, n, o);
}

/**
 * True when the connector of `n` runs on under its text as the underline of an
 * underlined topic. Where it does not (no connector, or one that ends at the
 * topic), drawBody() draws the underline. Must agree with the paths above.
 */
function edgeUnderlines(n: MNode): boolean {
  const q = n.parent;
  if (!q || n === vroot) return false;
  if (n.sumN > 0) return !isRow(n.dir); // bracketPath()
  if (n.pk === 'brace') return false;
  const d = n.dir;
  if (isTree(d) || isRibs(d)) return true;
  return isSide(d) && (q.lv !== 0 || isLogic(n.pk));
}

/**
 * How the connector of `n` is painted: 0 = filled taper, 1…3 = stroke of
 * decreasing width, -1 = no connector of its own.
 */
function edgeClass(n: MNode, o: SceneOpts): number {
  const q = n.parent;
  if (!q || n === vroot || isAxis(n.dir) || n.sumN > 0) return -1;
  if (q.lv === 0) return o.theme.taper && isSide(n.dir) && n.pk === 'map' ? 0 : 1;
  return n.depth === 2 ? 2 : 3;
}

const EDGE_WIDTH = [0, W_ROOT, W_MAIN, W_SUB];
const braced = new Set<MNode>();

interface Bucket {
  color: string;
  cls: number;
  fade: boolean;
  nodes: MNode[];
}
const buckets = new Map<string, Bucket>();

function drawEdges(p: Painter, o: SceneOpts): void {
  for (const b of buckets.values()) b.nodes.length = 0;
  loose.length = 0;
  braced.clear();
  for (const list of [L1, L2]) {
    for (const n of list) {
      const cls = edgeClass(n, o);
      if (cls < 0) continue;
      const brace = n.pk === 'brace';
      if (brace) {
        // One brace per parent, drawn when its first visible child comes by.
        const q = n.parent!;
        if (braced.has(q)) continue;
        braced.add(q);
      }
      if (n.aa < 1 || n.dim) {
        loose.push(n);
        continue;
      }
      const color = brace && n.depth === 1 ? o.theme.root.fill : n.branch;
      const key = color + cls + (n.fade ? 'f' : '');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { color, cls, fade: n.fade, nodes: [] }));
      b.nodes.push(n);
    }
  }
  // One path per color and width keeps the number of raster passes tiny.
  for (const b of buckets.values()) {
    if (!b.nodes.length) continue;
    p.beginPath();
    for (const n of b.nodes) edgePath(p, n, o);
    if (b.cls === 0) p.fill(b.color, b.fade ? FADE : 1);
    else p.stroke(b.color, EDGE_WIDTH[b.cls] * ls, b.fade ? FADE : 1);
  }
  for (const n of loose) {
    const cls = edgeClass(n, o);
    const color = n.pk === 'brace' && n.depth === 1 ? o.theme.root.fill : n.branch;
    p.beginPath();
    edgePath(p, n, o);
    if (cls === 0) p.fill(color, alphaOf(n));
    else p.stroke(color, EDGE_WIDTH[cls] * ls, alphaOf(n));
  }
  for (const s of sums) {
    p.beginPath();
    bracketPath(p, s);
    p.stroke(s.branch, (W_SUB + 0.2) * ls, alphaOf(s));
  }
}

/** The axis of a timeline or the spine of a fishbone that starts at `n`. */
function drawBackbone(p: Painter, n: MNode, o: SceneOpts): void {
  const kids = n.children;
  const c = n.cdir;
  const a = alphaOf(n);
  const color = n.lv === 0 ? o.theme.root.fill : n.branch;
  const cx = n.ax + n.w / 2;
  const cy = n.ay + n.h / 2;
  p.beginPath();
  if (c === A_AXIS_V) {
    let end = n.ay + n.h;
    for (const k of kids) end = Math.max(end, k.ay + k.h);
    end += AXIS_END - 14;
    p.moveTo(cx, n.ay + n.h);
    p.lineTo(cx, end);
    p.moveTo(cx - 6, end - 8);
    p.lineTo(cx, end);
    p.lineTo(cx + 6, end - 8);
  } else if (c === A_AXIS_H) {
    let end = n.ax + n.w;
    for (const k of kids) end = Math.max(end, k.ax + k.w);
    end += AXIS_END - 14;
    p.moveTo(n.ax + n.w, cy);
    p.lineTo(end, cy);
    p.moveTo(end - 8, cy - 6);
    p.lineTo(end, cy);
    p.lineTo(end - 8, cy + 6);
  } else {
    // The spine runs past the last group of bones and ends in a small tail fin.
    const s = c === A_SPINE_L ? -1 : 1;
    let end = s > 0 ? n.ax + n.w : n.ax;
    for (const k of kids) end = s > 0 ? Math.max(end, k.ax + (k.bx1 - k.x)) : Math.min(end, k.ax - (k.x - k.bx0));
    end += s * (SPINE_TAIL - 14);
    p.moveTo(s > 0 ? n.ax + n.w : n.ax, cy);
    p.lineTo(end, cy);
    p.moveTo(end + s * 9, cy - 9);
    p.lineTo(end, cy);
    p.lineTo(end + s * 9, cy + 9);
  }
  p.stroke(color, (n.lv === 0 ? W_SPINE : W_MAIN + 0.4) * ls, a);
}

/** Logic chart: the straight line out of the central topic and the upright that the branches part from. */
function drawStem(p: Painter, q: MNode, o: SceneOpts): void {
  const d = q.cdir < 0 ? -1 : 1;
  const x0 = d > 0 ? q.ax + q.w : q.ax;
  const y0 = attachY(q);
  const jx = x0 + d * LOGIC_STEM;
  let top = y0;
  let bottom = y0;
  for (const k of q.children) {
    if (k.sumN > 0) continue;
    const y1 = attachY(k);
    const dy = y1 - y0;
    if (Math.abs(dy) < 0.5) continue;
    const r = elbowR(dy, (d > 0 ? k.ax : k.ax + k.w) - jx, o.theme.corner);
    if (dy < 0) top = Math.min(top, y1 + r);
    else bottom = Math.max(bottom, y1 - r);
  }
  p.beginPath();
  p.moveTo(x0, y0);
  p.lineTo(jx, y0);
  if (bottom > top) {
    p.moveTo(jx, top);
    p.lineTo(jx, bottom);
  }
  p.stroke(o.theme.root.fill, W_ROOT * ls, alphaOf(q));
}

/** What a branch shown on its own keeps of the connector that normally reaches it. */
function drawLoneRoot(p: Painter, r: MNode): void {
  // Its ribs hang on the bone, which runs to where the spine would be. (An underline is drawn by drawBody().)
  if (!r.parent || !(isRibs(r.cdir) && isSpine(r.dir))) return;
  p.beginPath();
  boneLine(p, r, r.ay + r.h / 2 - r.ry);
  p.stroke(r.branch, W_ROOT * ls, alphaOf(r));
}

// --------------------------------------------------------------- boundaries

function drawFrames(p: Painter, o: SceneOpts): void {
  const titles = o.zoom * FRAME_FONT.size >= LOD_PX;
  const titleFont = fontIn(FRAME_FONT, o.theme.typeface);
  for (const n of frames) {
    const a = alphaOf(n);
    const [x, y, w, h] = frameRect(n);
    p.beginPath();
    roundRect(p, x, y, w, h, 12);
    p.fill(n.branch, a * (o.theme.dark ? 0.16 : 0.07));
    p.stroke(n.branch, 1.3, a * 0.7, DASH);
    if (n.boundary && titles) {
      // The title sits in the top corner, or — for a fishbone topic below the spine — away from the spine.
      const low = isSpine(n.dir) && isRibs(n.cdir) && !aboveSpine(n);
      p.text(n.boundary, x + 11, low ? y + h - 7.5 : y + 15.5, titleFont, mix(n.branch, o.theme.text, 0.4), 'left', a);
    }
  }
}

// ------------------------------------------------------------ relationships

export interface Curve {
  x0: number;
  y0: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x1: number;
  y1: number;
}

/** Where the ray from the center of `n` towards (tx, ty) leaves its box, `gap` further out. */
export function edgePoint(n: MNode, tx: number, ty: number, gap: number): [number, number] {
  const cx = n.ax + n.w / 2;
  const cy = n.ay + n.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const hw = n.w / 2 + gap;
  const hh = n.h / 2 + gap;
  if (dx === 0 && dy === 0) return [cx + hw, cy];
  let k: number;
  if (n.shp === 'ellipse') k = 1 / Math.hypot(dx / hw, dy / hh);
  else if (n.shp === 'diamond') k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else k = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}

/** The curve of a relationship between two topics that are on screen. */
export function relCurve(r: Rel): Curve {
  const a = r.from;
  const b = r.to;
  const ax = a.ax + a.w / 2;
  const ay = a.ay + a.h / 2;
  const bx = b.ax + b.w / 2;
  const by = b.ay + b.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  // Unless it was bent by hand, the line bows away from the middle of the map, so
  // that it tends to run around the branches.
  const nx = -dy / dist;
  const ny = dx / dist;
  let bow = r.bend;
  if (bow === undefined) {
    const out = nx * (ax + bx) + ny * (ay + by);
    bow = (out < 0 || (out === 0 && ny > 0) ? -1 : 1) * Math.min(110, 26 + dist * 0.2);
  }
  const c1x = ax + dx * 0.22 + nx * bow;
  const c1y = ay + dy * 0.22 + ny * bow;
  const c2x = bx - dx * 0.22 + nx * bow;
  const c2y = by - dy * 0.22 + ny * bow;
  const [x0, y0] = edgePoint(a, c1x, c1y, 4);
  const [x1, y1] = edgePoint(b, c2x, c2y, 6);
  return { x0, y0, c1x, c1y, c2x, c2y, x1, y1 };
}

/** Point on a curve at parameter t (0…1). */
export function curvePoint(c: Curve, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c.x0 + b * c.c1x + d * c.c2x + e * c.x1, a * c.y0 + b * c.c1y + d * c.c2y + e * c.y1];
}

/** Text of a relationship as it is drawn: one line, shortened when long. */
export function relLabel(r: Rel): string {
  const s = r.text.replace(/\s+/g, ' ').trim();
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

function drawRels(p: Painter, o: SceneOpts): void {
  const ink = o.theme.text;
  const relFont = fontIn(REL_FONT, o.theme.typeface);
  for (const r of o.rels) {
    const a = r.from;
    const b = r.to;
    if (a.stamp !== o.stamp || b.stamp !== o.stamp) continue; // an end is folded away or outside the view
    const alpha = Math.min(alphaOf(a), alphaOf(b));
    const c = relCurve(r);
    const sel = r === o.selRel;
    const trace = (): void => {
      p.beginPath();
      p.moveTo(c.x0, c.y0);
      p.cubicTo(c.c1x, c.c1y, c.c2x, c.c2y, c.x1, c.y1);
    };
    if (sel) {
      trace();
      p.stroke(o.theme.accent, 6, 0.28);
    }
    const color = sel ? o.theme.accent : ink;
    const strength = sel ? 1 : 0.62;
    trace();
    p.stroke(color, W_REL, alpha * strength, DASH);
    // Arrow head, along the direction in which the curve arrives.
    let ux = c.x1 - c.c2x;
    let uy = c.y1 - c.c2y;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const tipX = c.x1 + ux * 2;
    const tipY = c.y1 + uy * 2;
    const baseX = tipX - ux * 9.5;
    const baseY = tipY - uy * 9.5;
    p.beginPath();
    p.moveTo(tipX, tipY);
    p.lineTo(baseX - uy * 3.8, baseY + ux * 3.8);
    p.lineTo(baseX + uy * 3.8, baseY - ux * 3.8);
    p.closePath();
    p.fill(color, alpha * (sel ? 1 : 0.75));
    const label = relLabel(r);
    const [mx, my] = curvePoint(c, 0.5);
    if (label && o.zoom * REL_FONT.size >= LOD_PX) {
      const w = o.textWidth(relFont, label) + 14;
      p.beginPath();
      roundRect(p, mx - w / 2, my - 11, w, 22, 7);
      p.fill(o.theme.bg, alpha * 0.94);
      p.stroke(color, 1, alpha * (sel ? 0.9 : 0.28));
      p.text(label, mx, my + 4.2, relFont, color, 'center', alpha * (sel ? 1 : 0.9));
    } else if (sel) {
      // A handle in the middle shows where to drag to bend the line.
      p.beginPath();
      circle(p, mx, my, 4.5);
      p.fill(o.theme.bg);
      p.stroke(color, 1.8);
    }
  }
}

// -------------------------------------------------------------------- nodes

/** Width of the line a topic is underlined with: that of the connector that reaches it. */
const underlineWidth = (n: MNode): number => (n.lv === 0 ? W_SPINE : n.lv === 1 ? W_ROOT : n.depth === 2 ? W_MAIN : W_SUB) * ls;

function drawBody(p: Painter, n: MNode, o: SceneOpts): void {
  const a = alphaOf(n);
  const st = nodeStyle(o.theme, n.lv, n.branch, n.box, n.style);
  const x = n.ax;
  const y = n.ay;
  if (n.box && (st.fill || st.stroke)) {
    p.beginPath();
    outlinePath(p, n);
    if (st.fill) p.fill(st.fill, a);
    if (st.stroke) p.stroke(st.stroke, n.lv === 0 ? 2 : 1.6, a);
  } else {
    if (isAxis(n.dir)) {
      // The axis of a timeline runs behind this topic: keep it off the text.
      p.beginPath();
      roundRect(p, x, y, n.w, n.h, n.rad);
      p.fill(o.theme.bg, a);
    }
    if (n.ul && !edgeUnderlines(n)) {
      p.beginPath();
      p.moveTo(x, y + n.h);
      p.lineTo(x + n.w, y + n.h);
      p.stroke(n.branch, underlineWidth(n), a);
    }
  }
  if (n === o.editing) return;
  // A finished to-do steps back.
  const ta = n.todo === true ? a * 0.5 : a;
  const f = n.font;
  if (o.zoom * f.size < LOD_PX) {
    const bh = Math.max(2, n.th * 0.3);
    p.beginPath();
    roundRect(p, x + n.tx, y + n.ty + n.th / 2 - bh / 2, n.tw, bh, 1.5);
    p.fill(st.text, ta * 0.32);
    return;
  }
  const fm = o.metrics(f);
  const lh = n.lh;
  const base = y + n.ty + (lh - (fm.ascent + fm.descent)) / 2 + fm.ascent;
  const lines = n.lines;
  const mid = x + n.tx + n.tw / 2;
  const align = n.tc ? 'center' : 'left';
  const tx = n.tc ? mid : x + n.tx;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) p.text(lines[i], tx, base + i * lh, f, st.text, align, ta);
  }
  if (n.style?.strike) {
    // Struck through line by line, at the height of the middle of the small letters.
    p.beginPath();
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      const w = o.textWidth(f, lines[i]);
      const x0 = n.tc ? mid - w / 2 : x + n.tx;
      const sy = base + i * lh - f.size * 0.32;
      p.moveTo(x0, sy);
      p.lineTo(x0 + w, sy);
    }
    p.stroke(st.text, Math.max(1, f.size / 13), ta);
  }
}

const hasDecor = (n: MNode): boolean =>
  n.markers !== undefined ||
  n.note !== undefined ||
  n.link !== undefined ||
  n.todo !== undefined ||
  n.labels !== undefined ||
  n.num !== '' ||
  n.hidden > 0;

function drawDecor(p: Painter, n: MNode, o: SceneOpts): void {
  const a = alphaOf(n);
  const lh = n.lh;
  const st = nodeStyle(o.theme, n.lv, n.branch, n.box, n.style);
  const lod = o.zoom * n.font.size < LOD_PX;
  if (!lod) {
    if (n.todo !== undefined) {
      const [bx, by, s] = todoBox(n);
      p.beginPath();
      roundRect(p, bx + 0.75, by + 0.75, s - 1.5, s - 1.5, 4);
      if (n.todo) {
        p.fill(st.text, a * 0.82);
        p.beginPath();
        p.moveTo(bx + s * 0.27, by + s * 0.52);
        p.lineTo(bx + s * 0.44, by + s * 0.69);
        p.lineTo(bx + s * 0.74, by + s * 0.33);
        p.stroke(st.fill ?? o.theme.bg, 1.8, a);
      } else p.stroke(st.text, 1.5, a * 0.6);
    }
    if (n.markers) {
      const count = n.markers.length;
      let mx = n.ax + n.tx - n.nw - (count * MARK_STEP - (MARK_STEP - MARK) + MARK_GAP);
      const my = n.ay + n.ty + (lh - MARK) / 2;
      // On a solid fill, plain glyphs need a light backdrop to stay readable.
      const plate = st.plate;
      for (const id of n.markers) {
        if (plate) {
          p.beginPath();
          circle(p, mx + MARK / 2, my + MARK / 2, MARK / 2 + 1);
          p.fill('#ffffff', a * 0.92);
        }
        drawMarker(p, id, mx, my, MARK, plate ? '#3a3f4b' : st.text, a);
        mx += MARK_STEP;
      }
    }
    if (n.num) {
      // The number is written like the text it stands in front of (and stays while that is edited).
      const fm = o.metrics(n.font);
      const base = n.ay + n.ty + (lh - (fm.ascent + fm.descent)) / 2 + fm.ascent;
      p.text(n.num, n.ax + n.tx - n.nw, base, n.font, st.text, 'left', n.todo === true ? a * 0.5 : a);
    }
    if (n.note || n.link) {
      let ix = n.ax + n.tx + n.tw + (ICON_STEP - ICON);
      const iy = n.ay + n.ty + (lh - ICON) / 2;
      if (n.note) {
        drawNoteIcon(p, ix, iy, ICON, st.text, a * 0.6);
        ix += ICON_STEP;
      }
      // A link to another topic shows another sign than one to the web.
      if (n.link) (n.link.charAt(0) === '#' ? drawJumpIcon : drawLinkIcon)(p, ix, iy, ICON, st.text, a * 0.6);
    }
    if (n.lab.length && o.zoom * LABEL_FONT.size >= LOD_PX) {
      // On a colored box the chips have to be a little stronger to show.
      const chip = st.fill && (n.lv < 2 || st.plate) ? 0.2 : 0.1;
      const labelFont = fontIn(LABEL_FONT, o.theme.typeface);
      p.beginPath();
      for (const b of n.lab) roundRect(p, n.ax + b.x, n.ay + b.y, b.w, LABEL_H, 5);
      p.fill(st.text, a * chip);
      for (const b of n.lab) p.text(b.text, n.ax + b.x + LABEL_PAD, n.ay + b.y + 12.2, labelFont, st.text, 'left', a * 0.8);
    }
  }
  if (n.hidden > 0) {
    const [tx, ty] = togglePos(n);
    const [sx, sy] = toggleStem(n);
    const len = Math.hypot(tx - sx, ty - sy);
    if (len > TOGGLE_R) {
      // A short stem from the topic to the badge.
      const k = (len - TOGGLE_R) / len;
      p.beginPath();
      p.moveTo(sx, sy);
      p.lineTo(sx + (tx - sx) * k, sy + (ty - sy) * k);
      p.stroke(n.branch, W_SUB * ls, a);
    }
    p.beginPath();
    circle(p, tx, ty, TOGGLE_R);
    p.fill(o.theme.bg, a);
    p.stroke(n.branch, 1.5, a);
    if (o.zoom * BADGE_FONT.size >= LOD_PX) {
      const label = n.hidden > 99 ? '99+' : String(n.hidden);
      p.text(label, tx, ty + (label.length > 2 ? 2.7 : 3.4), label.length > 2 ? BADGE_FONT_S : BADGE_FONT, o.theme.text, 'center', a);
    }
  }
}

function drawHighlight(p: Painter, n: MNode, o: SceneOpts): void {
  const current = n === o.markCurrent;
  p.beginPath();
  outlinePath(p, n, 3);
  p.fill(HILITE, current ? 0.5 : 0.24);
  if (current) p.stroke(HILITE, 2);
}

// -------------------------------------------------------------------- entry

/** Draws the scene below `root` (the central topic, or a branch shown on its own). */
export function drawScene(p: Painter, root: MNode, o: SceneOpts): void {
  L0.length = L1.length = L2.length = 0;
  frames.length = spines.length = stems.length = sums.length = 0;
  vroot = root;
  ls = o.theme.lineScale ?? 1;
  collect(root, o, false);

  drawFrames(p, o);
  for (const n of spines) drawBackbone(p, n, o);
  for (const n of stems) drawStem(p, n, o);
  drawLoneRoot(p, root);
  drawEdges(p, o);
  if (o.marks && o.marks.size) {
    for (const list of [L0, L1, L2]) for (const n of list) if (o.marks.has(n)) drawHighlight(p, n, o);
  }
  // Bodies level by level so the canvas font only changes a handful of times.
  for (const list of [L0, L1, L2]) for (const n of list) drawBody(p, n, o);
  for (const list of [L0, L1, L2]) for (const n of list) if (hasDecor(n)) drawDecor(p, n, o);
  if (o.rels.length) drawRels(p, o);
  vroot = null;
}

/** Draws a single node (without its connector) at an arbitrary position. */
export function drawNodeAt(p: Painter, n: MNode, o: SceneOpts, x: number, y: number, alpha: number): void {
  const saved = [n.ax, n.ay, n.aa] as const;
  const dim = n.dim;
  const fade = n.fade;
  const hidden = n.hidden;
  n.ax = x;
  n.ay = y;
  n.aa = alpha;
  n.dim = false;
  n.fade = false;
  n.hidden = 0;
  drawBody(p, n, o);
  drawDecor(p, n, o);
  [n.ax, n.ay, n.aa] = saved;
  n.dim = dim;
  n.fade = fade;
  n.hidden = hidden;
}

/** Ends any animation: every visible node below `root` is displayed at its target. */
export function snapPositions(root: MNode): void {
  walkVisible(root, (n) => {
    n.ax = n.x;
    n.ay = n.y;
    n.aa = 1;
  });
}
