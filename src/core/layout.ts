// Layout engine. Computes node box sizes (with a per-node cache) and target
// positions for every structure. Each node arranges its children according
// to its arrangement code (see structures.ts); arrangements only decide the
// children's offsets from their parent and always work with the full extents
// of each child's subtree, so structures nest freely inside one another.
// One pass is O(visible nodes); text is only re-measured for changed nodes.

import type { Doc, LabelBox, LayoutKind, MNode } from './model.ts';
import { countDescendants } from './model.ts';
import {
  A_AXIS_H,
  A_AXIS_V,
  A_BOTH,
  A_DOWN,
  A_LEFT,
  A_RIGHT,
  A_SPINE_L,
  A_SPINE_R,
  A_TREE_DL,
  A_TREE_DR,
  A_TREE_UL,
  A_TREE_UR,
  A_UP,
  BONE_COT,
  BONE_INSET,
  RIB_GAP,
  ROW_TURN,
  aboveSpine,
  childArrangement,
  isAxis,
  isRibs,
  isRow,
  isSide,
  isSpine,
  isTree,
  placementOf,
  summarizes,
  treeIndent,
} from './structures.ts';
import { wrapText } from './text.ts';
import type { Font, Theme } from './themes.ts';
import {
  FRAME_GAP,
  FRAME_PAD,
  FRAME_TITLE,
  ICON_STEP,
  LABEL_FONT,
  LABEL_GAP,
  LABEL_H,
  LABEL_PAD,
  LABEL_ROW_GAP,
  LABEL_TOP,
  LEVELS,
  MARK,
  MARK_GAP,
  MARK_STEP,
  SUB_BOX_PAD_X,
  SUM_GAP,
  TODO_STEP,
  resolveColor,
} from './themes.ts';

export interface FontMetrics {
  ascent: number;
  descent: number;
}

export interface TextMeasurer {
  width(font: Font, text: string): number;
  metrics(font: Font): FontMetrics;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutOpts {
  theme: Theme;
  measurer: TextMeasurer;
  /** Bumped whenever all cached measurements become invalid (theme / structure change). */
  epoch: number;
  /** Monotonic pass counter; lets the view detect nodes that just became visible. */
  stamp: number;
  /** The node under text editing takes its text block size from the DOM editor. */
  editing: { node: MNode; tw: number; th: number } | null;
}

export interface LayoutResult {
  bounds: Bounds;
  count: number;
}

// Side-by-side branches (mind map, logic chart, brace map).
/** Horizontal gap between a node of level i and its children. */
const HGAP = [58, 40, 30];
const VGAP_MAIN = 22;
const VGAP_SUB = 7;
const VGAP_CLUSTER = 9;
// Rows (org chart).
const ORG_VGAP = 44;
const ORG_HGAP = 14;
const ORG_CLUSTER = 12;
// Tree lists.
/** Gap between a node of level i and the first child listed under it. */
const TREE_FIRST = [16, 11, 7];
const TREE_GAP = 6;
const TREE_CLUSTER = 5;
const TREE_MAIN_GAP = 14;
// Timelines.
const AXIS_START = 56;
const AXIS_GAP = 34;
const AXIS_SIDE_GAP = 22;
const AXIS_V_START = 40;
const AXIS_V_GAP = 24;
const AXIS_V_SIDE_GAP = 16;
/** Room for the arrow head at the end of the axis. */
export const AXIS_END = 44;
// Fishbone.
const SPINE_HEAD = 44;
const SPINE_GAP = 16;
const RIB_VGAP = 8;
const BONE_MAIN_GAP = 12;
const BONE_MIN = 36;
const BONE_STEP = 30;
const BONE_GROUP_GAP = 26;
export const SPINE_TAIL = 30;

interface Ctx extends LayoutOpts {
  count: number;
  /** Tallest node per depth among those laid out in rows, so that org chart rows line up. */
  levelH: number[];
}

const NO_LABELS: LabelBox[] = [];

function measureNode(n: MNode, c: Ctx): void {
  const lv = n.lv;
  const m = LEVELS[lv];
  let tw: number;
  let th: number;
  if (c.editing && c.editing.node === n) {
    tw = c.editing.tw;
    th = c.editing.th;
  } else {
    const blk = wrapText(n.text, m.maxWidth, (s) => c.measurer.width(m.font, s));
    n.lines = blk.lines;
    tw = blk.width;
    th = blk.lines.length * m.lineHeight;
    n.mVer = n.ver;
    n.mLv = lv;
    n.mEpoch = c.epoch;
  }
  n.mBox = n.box;
  const marks = n.markers ? n.markers.length : 0;
  const mkW = marks ? marks * MARK_STEP - (MARK_STEP - MARK) + MARK_GAP : 0;
  const tdW = n.todo !== undefined ? TODO_STEP : 0;
  const icons = (n.note ? 1 : 0) + (n.link ? 1 : 0);
  const padX = lv === 2 && n.box ? SUB_BOX_PAD_X : m.padX;
  tw = Math.max(Math.ceil(tw), lv === 0 ? 48 : 18);
  const rowW = tdW + mkW + tw + icons * ICON_STEP;
  const rowH = Math.max(th, marks || tdW ? MARK : 0);

  // Label chips go under the text, wrapping when they would get wider than it.
  let labW = 0;
  let labH = 0;
  if (n.labels && n.labels.length) {
    const maxW = Math.max(rowW, 150);
    const boxes: LabelBox[] = [];
    let x = 0;
    let y = 0;
    for (const text of n.labels) {
      const w = Math.ceil(c.measurer.width(LABEL_FONT, text)) + LABEL_PAD * 2;
      if (x > 0 && x + w > maxW) {
        x = 0;
        y += LABEL_H + LABEL_ROW_GAP;
      }
      boxes.push({ x: padX + x, y: m.padY + rowH + LABEL_TOP + y, w, text });
      x += w + LABEL_GAP;
      if (x - LABEL_GAP > labW) labW = x - LABEL_GAP;
    }
    labH = y + LABEL_H;
    n.lab = boxes;
  } else n.lab = NO_LABELS;

  n.tw = tw;
  n.th = th;
  n.w = padX * 2 + Math.max(rowW, labW);
  n.h = rowH + (labH ? LABEL_TOP + labH : 0) + m.padY * 2;
  n.tx = padX + tdW + mkW;
  n.ty = m.padY + (rowH - th) / 2;
}

/**
 * Pre-order pass: levels, arrangements, branch colors, measurements.
 * @param kind   the structure that places `n`
 * @param rdepth depth of `n` inside that structure (0 for the topic the structure starts at)
 */
function prepare(n: MNode, depth: number, rdepth: number, kind: LayoutKind, dir: number, index: number, branch: string, c: Ctx): void {
  const lv = depth > 2 ? 2 : depth;
  n.depth = depth;
  n.lv = lv;
  n.dir = dir;
  n.idx = index;
  n.pk = kind;
  // A branch with a structure of its own starts that structure afresh.
  let ck = kind;
  let crd = rdepth;
  if (n.structure !== undefined && n.parent) {
    ck = n.structure;
    crd = 0;
  }
  n.cdir = childArrangement(ck, crd, dir, index);
  // Subtopics in a row or on an axis need a box; elsewhere the theme decides.
  n.box = lv === 2 && (c.theme.sub === 'tint' || isRow(dir) || isAxis(dir) || isSpine(dir));
  n.ul = lv === 2 && !n.box && c.theme.sub === 'underline' && kind !== 'brace';
  n.branch = branch;
  n.fresh = n.stamp !== c.stamp - 1;
  n.stamp = c.stamp;
  const editing = c.editing !== null && c.editing.node === n;
  if (editing || n.mVer !== n.ver || n.mLv !== lv || n.mEpoch !== c.epoch || n.mBox !== n.box) measureNode(n, c);
  c.count++;
  if ((isRow(dir) || isRow(n.cdir)) && n.h > (c.levelH[depth] ?? 0)) c.levelH[depth] = n.h;
  if (n.folded) {
    n.hidden = countDescendants(n);
    return;
  }
  n.hidden = 0;
  const kids = n.children;
  const palette = c.theme.palette;
  const sums = summarizes(n.cdir);
  let run = 0; // ordinary topics since the last summary
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    let kb = branch;
    if (k.color !== undefined) kb = resolveColor(c.theme, k.color);
    else if (depth === 0) kb = palette[i % palette.length];
    let kdir = placementOf(n.cdir, k);
    k.sumN = 0;
    k.cover = null;
    if (k.sum !== undefined && sums) {
      // A summary brackets the topics right before it (on one side of a mind map).
      let m = Math.min(k.sum, run);
      if (m > 1 && n.cdir === A_BOTH) {
        const d0 = kids[i - 1].dir;
        let j = 1;
        while (j < m && kids[i - 1 - j].dir === d0) j++;
        m = j;
      }
      if (m > 0) {
        k.sumN = m;
        kdir = kids[i - 1].dir;
        for (let j = 1; j <= m; j++) kids[i - j].cover = k;
      }
      run = 0;
    } else run++;
    prepare(k, depth + 1, crd + 1, ck, kdir, i, kb, c);
  }
}

const hasKids = (n: MNode): boolean => n.children.length > 0 && !n.folded;
const NONE: readonly MNode[] = [];

/** How far `k`'s subtree reaches towards / away from a parent that lies in direction `-s`. */
const nearX = (k: MNode, s: number): number => (s > 0 ? k.xl : k.xr);
const farX = (k: MNode, s: number): number => (s > 0 ? k.xr : k.xl);
const nearY = (k: MNode, s: number): number => (s > 0 ? k.yu : k.yd);
const farY = (k: MNode, s: number): number => (s > 0 ? k.yd : k.yu);

/** Extends `n`'s subtree extents by those of its child `k` (placed at k.rx, k.ry). */
function grow(n: MNode, k: MNode): void {
  if (k.rx + k.xr > n.xr) n.xr = k.rx + k.xr;
  if (k.xl - k.rx > n.xl) n.xl = k.xl - k.rx;
  if (k.ry + k.yd > n.yd) n.yd = k.ry + k.yd;
  if (k.yu - k.ry > n.yu) n.yu = k.yu - k.ry;
}

/** A boundary frame takes room around the whole branch. */
function frame(n: MNode): void {
  if (n.boundary === undefined || !n.parent) return;
  const pad = FRAME_PAD + FRAME_GAP;
  n.xl += pad;
  n.xr += pad;
  n.yd += pad;
  n.yu += pad + (n.boundary ? FRAME_TITLE : 0);
}

/** The frame of a fishbone topic and its ribs stops short of the spine. */
function frameRibs(k: MNode, u: number): void {
  if (k.boundary === undefined) return;
  const pad = FRAME_PAD + FRAME_GAP;
  const away = pad + (k.boundary ? FRAME_TITLE : 0);
  k.xl += pad;
  k.xr += pad;
  if (u < 0) k.yu += away;
  else k.yd += away;
}

// ----------------------------------------------- beside the parent (map, logic)

function gapV(a: MNode, b: MNode): number {
  if (a.lv === 1) return VGAP_MAIN;
  return VGAP_SUB + (hasKids(a) || hasKids(b) ? VGAP_CLUSTER : 0);
}

/**
 * Stacks `kids` vertically on side `s` of `n`, centered on the first and last child.
 * A summary topic goes beside the topics it sums up, which make room for it if it is taller.
 */
function arrangeSide(n: MNode, kids: readonly MNode[], s: number): void {
  let cur = 0;
  let prev: MNode | null = null;
  const reg: MNode[] = [];
  for (const k of kids) {
    if (k.sumN > 0) {
      const a = reg.length - k.sumN;
      const z = reg.length - 1;
      const top = reg[a].ry - reg[a].yu;
      const bottom = reg[z].ry + reg[z].yd;
      const gc = (top + bottom) / 2;
      const before = Math.max(0, k.yu - (gc - top));
      const after = Math.max(0, k.yd - (bottom - gc));
      if (before > 0) for (let i = a; i <= z; i++) reg[i].ry += before;
      k.ry = gc + before;
      cur += before + after;
      continue;
    }
    if (prev) cur += gapV(prev, k);
    k.ry = cur + k.yu;
    cur += k.yu + k.yd;
    prev = k;
    reg.push(k);
  }
  if (!reg.length) return;
  const mid = (reg[0].ry + reg[reg.length - 1].ry) / 2;
  // A tall fan out of the root needs more room to bend gracefully.
  const gap = n.lv === 0 ? HGAP[0] + Math.min(46, Math.max(0, cur - 160) * 0.07) : HGAP[n.lv];
  for (const k of reg) {
    k.ry -= mid;
    k.rx = s * (n.w / 2 + gap + nearX(k, s));
    grow(n, k);
  }
  let i = 0;
  for (const k of kids) {
    if (k.sumN === 0) {
      i++;
      continue;
    }
    let edge = 0;
    for (let j = i - k.sumN; j < i; j++) edge = Math.max(edge, s * reg[j].rx + farX(reg[j], s));
    k.ry -= mid;
    k.rx = s * (edge + SUM_GAP + nearX(k, s));
    grow(n, k);
  }
}

// ------------------------------------------------------- rows (org chart)

function gapO(a: MNode, b: MNode): number {
  return ORG_HGAP + (hasKids(a) || hasKids(b) ? ORG_CLUSTER : 0);
}

/** Puts `kids` in a row below (s = 1) or above (s = -1) `n`. */
function arrangeRow(n: MNode, kids: readonly MNode[], s: number, c: Ctx): void {
  let cur = 0;
  let prev: MNode | null = null;
  const reg: MNode[] = [];
  for (const k of kids) {
    if (k.sumN > 0) {
      const a = reg.length - k.sumN;
      const z = reg.length - 1;
      const left = reg[a].rx - reg[a].xl;
      const right = reg[z].rx + reg[z].xr;
      const gc = (left + right) / 2;
      const before = Math.max(0, k.xl - (gc - left));
      const after = Math.max(0, k.xr - (right - gc));
      if (before > 0) for (let i = a; i <= z; i++) reg[i].rx += before;
      k.rx = gc + before;
      cur += before + after;
      continue;
    }
    if (prev) cur += gapO(prev, k);
    k.rx = cur + k.xl;
    cur += k.xl + k.xr;
    prev = k;
    reg.push(k);
  }
  if (!reg.length) return;
  const mid = (reg[0].rx + reg[reg.length - 1].rx) / 2;
  // Every node of one depth starts at the same line, whatever its parent's height.
  const level = Math.max(n.h, c.levelH[n.depth] ?? 0);
  n.bar = s * (-n.h / 2 + level + ORG_VGAP - ROW_TURN);
  for (const k of reg) {
    k.rx -= mid;
    k.ry = s * (-n.h / 2 + level + ORG_VGAP + nearY(k, s));
    grow(n, k);
  }
  let i = 0;
  for (const k of kids) {
    if (k.sumN === 0) {
      i++;
      continue;
    }
    let edge = 0;
    for (let j = i - k.sumN; j < i; j++) edge = Math.max(edge, s * reg[j].ry + farY(reg[j], s));
    k.rx -= mid;
    k.ry = s * (edge + SUM_GAP + nearY(k, s));
    grow(n, k);
  }
}

// ------------------------------------------------------------- tree lists

/** Lists `kids` below (sy = 1) or above (sy = -1) `n`, indented towards sx. */
function arrangeTree(n: MNode, kids: readonly MNode[], sx: number, sy: number): void {
  const indent = treeIndent(n.lv, n.ul);
  // `cur` runs along the list, away from the parent.
  let cur = n.h / 2 + TREE_FIRST[n.lv];
  let prev: MNode | null = null;
  const reg: MNode[] = [];
  for (const k of kids) {
    if (k.sumN > 0) {
      const a = reg.length - k.sumN;
      const z = reg.length - 1;
      const top = sy * reg[a].ry - nearY(reg[a], sy);
      const bottom = sy * reg[z].ry + farY(reg[z], sy);
      const gc = (top + bottom) / 2;
      const before = Math.max(0, nearY(k, sy) - (gc - top));
      const after = Math.max(0, farY(k, sy) - (bottom - gc));
      if (before > 0) for (let i = a; i <= z; i++) reg[i].ry += sy * before;
      let edge = 0;
      for (let i = a; i <= z; i++) edge = Math.max(edge, sx * reg[i].rx + farX(reg[i], sx));
      k.ry = sy * (gc + before);
      k.rx = sx * (edge + SUM_GAP + nearX(k, sx));
      cur += before + after;
      continue;
    }
    if (prev) cur += (k.lv === 1 ? TREE_MAIN_GAP : TREE_GAP) + (hasKids(prev) ? TREE_CLUSTER : 0);
    k.ry = sy * (cur + nearY(k, sy));
    k.rx = sx * (-n.w / 2 + indent + nearX(k, sx));
    cur += nearY(k, sy) + farY(k, sy);
    prev = k;
    reg.push(k);
  }
  for (const k of kids) grow(n, k);
}

// --------------------------------------------------------------- timelines

/** Main topics along a horizontal axis; their branches alternate above / below. */
function arrangeAxisH(n: MNode, kids: readonly MNode[]): void {
  let boxEnd = n.w / 2 + AXIS_START - AXIS_GAP;
  const sideEnd = [-Infinity, -Infinity]; // above, below
  kids.forEach((k, i) => {
    // Boxes follow each other on the axis; whatever hangs above or below must not collide either.
    let up = k.yu > k.h / 2 + 0.5;
    let down = k.yd > k.h / 2 + 0.5;
    if (!up && !down) {
      up = i % 2 === 0; // must match childArrangement()
      down = !up;
    }
    // A branch that spreads sideways (not as a list above or below) lies on the axis itself.
    const along = hasKids(k) && !isTree(k.cdir) && !isRow(k.cdir);
    let cx = boxEnd + AXIS_GAP + (along ? k.xl : k.w / 2);
    if (up) cx = Math.max(cx, sideEnd[0] + AXIS_SIDE_GAP + k.xl);
    if (down) cx = Math.max(cx, sideEnd[1] + AXIS_SIDE_GAP + k.xl);
    k.rx = cx;
    k.ry = 0;
    boxEnd = cx + (along ? k.xr : k.w / 2);
    if (up) sideEnd[0] = cx + k.xr;
    if (down) sideEnd[1] = cx + k.xr;
    grow(n, k);
  });
  n.xr += AXIS_END;
}

/** Main topics down a vertical axis; their branches alternate right / left. */
function arrangeAxisV(n: MNode, kids: readonly MNode[]): void {
  let boxEnd = n.h / 2 + AXIS_V_START - AXIS_V_GAP;
  const sideEnd = [-Infinity, -Infinity]; // right, left
  kids.forEach((k, i) => {
    let right = k.xr > k.w / 2 + 0.5;
    let left = k.xl > k.w / 2 + 0.5;
    if (!right && !left) {
      right = i % 2 === 0;
      left = !right;
    }
    // A branch that does not simply spread to one side lies on the axis itself.
    const along = hasKids(k) && !isSide(k.cdir);
    let cy = boxEnd + AXIS_V_GAP + (along ? k.yu : k.h / 2);
    if (right) cy = Math.max(cy, sideEnd[0] + AXIS_V_SIDE_GAP + k.yu);
    if (left) cy = Math.max(cy, sideEnd[1] + AXIS_V_SIDE_GAP + k.yu);
    k.rx = 0;
    k.ry = cy;
    boxEnd = cy + (along ? k.yd : k.h / 2);
    if (right) sideEnd[0] = cy + k.yd;
    if (left) sideEnd[1] = cy + k.yd;
    grow(n, k);
  });
  n.yd += AXIS_END;
}

// ---------------------------------------------------------------- fishbone

/**
 * Hangs the ribs of main topic `k` on its bone. Works in a frame where the
 * bone leaves the spine at X = 0 and X grows away from the head; V is the
 * distance from the spine. `u` is -1 for a topic above the spine, 1 below.
 * Returns the X of the topic's center (its distance from the bone's root).
 */
function arrangeRibs(k: MNode, ribs: readonly MNode[], u: number, sx: number): number {
  // Ribs read top to bottom on both sides; stack them starting at the spine.
  const order = u < 0 ? ribs.slice().reverse() : ribs;
  const centers: number[] = [];
  let v = SPINE_GAP;
  order.forEach((r, i) => {
    if (i) v += RIB_VGAP;
    const near = u < 0 ? r.yd : r.yu;
    const far = u < 0 ? r.yu : r.yd;
    centers.push(v + near);
    v += near + far;
  });
  // The bone ends at the topic — or, when the topic arranges its branch some other
  // way, at the near corner of that whole branch, so that the bone does not cut through it.
  const ownV = u < 0 ? k.yd : k.yu;
  const ownX = sx > 0 ? k.xl : k.xr;
  const anchorV = ribs.length ? v + BONE_MAIN_GAP : BONE_MIN;
  const mainV = anchorV + ownV;
  const mainX = anchorV * BONE_COT - BONE_INSET + ownX;
  k.bax = -sx * (ownX - BONE_INSET);
  k.bay = -u * ownV;
  order.forEach((r, i) => {
    const cv = centers[i];
    // An underlined rib meets the bone at its underline, a boxed one at its middle.
    const attachV = cv + (r.ul ? (u * r.h) / 2 : 0);
    const x = attachV * BONE_COT + RIB_GAP + nearX(r, sx);
    r.rx = sx * (x - mainX);
    r.ry = u * (cv - mainV);
    grow(k, r);
  });
  k.ry = u * mainV;
  // The subtree reaches down to the spine and back to the root of the bone.
  if (u < 0) k.yd = Math.max(k.yd, mainV);
  else k.yu = Math.max(k.yu, mainV);
  if (sx > 0) k.xl = Math.max(k.xl, mainX);
  else k.xr = Math.max(k.xr, mainX);
  return mainX;
}

/** Main topics on bones along a spine, alternating above and below it. */
function arrangeSpine(n: MNode, kids: readonly MNode[], sx: number): void {
  const start = n.w / 2 + SPINE_HEAD;
  const cursor = [start, start];
  let lastRoot = -Infinity;
  kids.forEach((k, i) => {
    const side = i % 2; // must match aboveSpine(): even topics sit above the spine
    const ribbed = isRibs(k.cdir) && hasKids(k);
    const u = side === 0 ? -1 : 1;
    const mainX = arrangeRibs(k, ribbed ? k.children : NONE, u, sx);
    if (isRibs(k.cdir)) frameRibs(k, u);
    const head = sx > 0 ? k.xl : k.xr;
    const tail = sx > 0 ? k.xr : k.xl;
    // Bones keep their order along the spine; groups on the same side must not collide.
    const root = Math.max(cursor[side] + head - mainX, lastRoot + BONE_STEP);
    const x = root + mainX;
    k.rx = sx * x;
    cursor[side] = x + tail + BONE_GROUP_GAP;
    lastRoot = root;
    grow(n, k);
  });
  if (sx > 0) n.xr += SPINE_TAIL;
  else n.xl += SPINE_TAIL;
}

// ------------------------------------------------------------------- passes

/** Post-order pass: positions every child relative to its parent. */
function arrange(n: MNode, c: Ctx): void {
  n.xl = n.xr = n.w / 2;
  n.yu = n.yd = n.h / 2;
  // The ribs of a fishbone topic are hung (and framed) by arrangeSpine(), which knows the side of the spine.
  const ribbed = isRibs(n.cdir) && isSpine(n.dir);
  if (hasKids(n)) {
    const kids = n.children;
    for (const k of kids) arrange(k, c);
    switch (n.cdir) {
      case A_RIGHT:
      case A_LEFT:
        arrangeSide(n, kids, n.cdir);
        break;
      case A_BOTH:
        arrangeSide(
          n,
          kids.filter((k) => k.dir !== A_LEFT),
          1,
        );
        arrangeSide(
          n,
          kids.filter((k) => k.dir === A_LEFT),
          -1,
        );
        break;
      case A_DOWN:
      case A_UP:
        arrangeRow(n, kids, n.cdir === A_DOWN ? 1 : -1, c);
        break;
      case A_TREE_DR:
      case A_TREE_DL:
        arrangeTree(n, kids, n.cdir > 0 ? 1 : -1, 1);
        break;
      case A_TREE_UR:
      case A_TREE_UL:
        arrangeTree(n, kids, n.cdir > 0 ? 1 : -1, -1);
        break;
      case A_AXIS_H:
        arrangeAxisH(n, kids);
        break;
      case A_AXIS_V:
        arrangeAxisV(n, kids);
        break;
      case A_SPINE_R:
      case A_SPINE_L:
        arrangeSpine(n, kids, n.cdir > 0 ? 1 : -1);
        break;
    }
  }
  if (!ribbed) frame(n);
}

/** Pre-order pass: turns relative offsets into positions and subtree bounds. */
function place(n: MNode, cx: number, cy: number): void {
  n.x = cx - n.w / 2;
  n.y = cy - n.h / 2;
  n.bx0 = cx - n.xl;
  n.bx1 = cx + n.xr;
  n.by0 = cy - n.yu;
  n.by1 = cy + n.yd;
  if (hasKids(n)) for (const k of n.children) place(k, cx + k.rx, cy + k.ry);
}

/**
 * Lays out the map, or only the branch below `from`. A branch on its own
 * keeps the level, direction, color and structure it has in the whole map.
 */
export function layoutDoc(doc: Doc, o: LayoutOpts, from: MNode = doc.root): LayoutResult {
  const c: Ctx = { ...o, count: 0, levelH: [] };
  const path: MNode[] = [];
  for (let p: MNode | null = from; p; p = p.parent) path.push(p);
  path.reverse();
  let kind = doc.layout;
  let rdepth = 0;
  let dir = 0;
  let index = 0;
  let branch = o.theme.root.fill;
  for (let i = 1; i < path.length; i++) {
    const q = path[i - 1];
    const n = path[i];
    if (q.structure !== undefined && q.parent) {
      kind = q.structure;
      rdepth = 0;
    }
    const cdir = childArrangement(kind, rdepth, dir, index);
    index = q.children.indexOf(n);
    dir = placementOf(cdir, n);
    if (n.color !== undefined) branch = resolveColor(o.theme, n.color);
    else if (i === 1) branch = o.theme.palette[index % o.theme.palette.length];
    rdepth++;
  }
  from.sumN = 0;
  from.cover = null;
  prepare(from, path.length - 1, rdepth, kind, dir, index, branch, c);
  arrange(from, c);
  if (isRibs(from.cdir) && isSpine(from.dir)) {
    // A fishbone branch shown on its own still hangs its ribs on its bone.
    const u = aboveSpine(from) ? -1 : 1;
    arrangeRibs(from, hasKids(from) ? from.children : NONE, u, from.dir === A_SPINE_L ? -1 : 1);
    frameRibs(from, u);
  }
  place(from, 0, 0);
  return { bounds: { x0: from.bx0, y0: from.by0, x1: from.bx1, y1: from.by1 }, count: c.count };
}
