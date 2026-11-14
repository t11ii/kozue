// Structures (layout kinds) are built from a small set of "arrangements":
// ways in which a topic lays out its children. Every node carries
//   cdir – the arrangement it uses for its own children, and
//   dir  – the arrangement its parent used to place it.
// Layout, drawing, keyboard navigation and drag & drop are all written
// against these codes, so a new structure is mostly a new rule below.

import type { LayoutKind, MNode } from './model.ts';

/** Children stacked vertically beside the parent. */
export const A_RIGHT = 1;
export const A_LEFT = -1;
/** Children in a row below / above the parent (org chart). */
export const A_DOWN = 2;
export const A_UP = -2;
/** Children listed below the parent, indented to the right / left (tree). */
export const A_TREE_DR = 3;
export const A_TREE_DL = -3;
/** Children listed above the parent (the upper half of a timeline). */
export const A_TREE_UR = 4;
export const A_TREE_UL = -4;
/** Mind map root: children on the right or on the left according to `side`. */
export const A_BOTH = 5;
/** Timeline root: children along a horizontal axis. */
export const A_AXIS_H = 6;
/** Fishbone root: children on bones along a spine that grows right / left. */
export const A_SPINE_R = 7;
export const A_SPINE_L = -7;
/** Fishbone main topic: children ("ribs") hang on its bone, below / above the topic. */
export const A_RIBS_D = 8;
export const A_RIBS_U = -8;
/** Vertical timeline root: children along a vertical axis. */
export const A_AXIS_V = 9;

/** Every structure, in the order the picker shows them. */
export const LAYOUT_KINDS: readonly LayoutKind[] = [
  'map',
  'logic',
  'logic-left',
  'brace',
  'org',
  'org-up',
  'org-tree',
  'tree',
  'timeline',
  'timeline-v',
  'fishbone',
  'fishbone-right',
];

/**
 * The arrangement a node uses for its children.
 * @param dir   how the node itself was placed (0 for the root)
 * @param index position of the node among its siblings
 */
export function childArrangement(kind: LayoutKind, depth: number, dir: number, index: number): number {
  switch (kind) {
    case 'map':
      return depth === 0 ? A_BOTH : dir;
    case 'logic':
    case 'brace':
      return A_RIGHT;
    case 'logic-left':
      return A_LEFT;
    case 'org':
      return A_DOWN;
    case 'org-up':
      return A_UP;
    case 'org-tree':
      return depth === 0 ? A_DOWN : A_TREE_DR;
    case 'tree':
      // A list in a branch that grows to the left is indented to the left as well.
      return dir === A_LEFT || dir === A_TREE_DL || dir === A_TREE_UL ? A_TREE_DL : A_TREE_DR;
    case 'timeline':
      // Main topics sit on the axis; their branches alternate above and below it.
      return depth === 0 ? A_AXIS_H : depth === 1 ? (index % 2 === 0 ? A_TREE_UR : A_TREE_DR) : dir;
    case 'timeline-v':
      return depth === 0 ? A_AXIS_V : depth === 1 ? (index % 2 === 0 ? A_RIGHT : A_LEFT) : dir;
    case 'fishbone':
      return depth === 0 ? A_SPINE_R : depth === 1 ? (index % 2 === 0 ? A_RIBS_D : A_RIBS_U) : A_RIGHT;
    case 'fishbone-right':
      return depth === 0 ? A_SPINE_L : depth === 1 ? (index % 2 === 0 ? A_RIBS_D : A_RIBS_U) : A_LEFT;
  }
}

/** How a child of a node with arrangement `cdir` is placed. */
export function placementOf(cdir: number, child: MNode): number {
  return cdir === A_BOTH ? (child.side === 'l' ? A_LEFT : A_RIGHT) : cdir;
}

/** Structures a single branch can take; the mind map itself only applies to a whole map. */
export const BRANCH_KINDS: readonly LayoutKind[] = LAYOUT_KINDS.filter((k) => k !== 'map');

export const isLogic = (kind: LayoutKind): boolean => kind === 'logic' || kind === 'logic-left';

export const isSide = (a: number): boolean => a === A_RIGHT || a === A_LEFT;
export const isRow = (a: number): boolean => a === A_DOWN || a === A_UP;
export const isTree = (a: number): boolean => a === A_TREE_DR || a === A_TREE_DL || a === A_TREE_UR || a === A_TREE_UL;
export const isSpine = (a: number): boolean => a === A_SPINE_R || a === A_SPINE_L;
export const isRibs = (a: number): boolean => a === A_RIBS_D || a === A_RIBS_U;
export const isAxis = (a: number): boolean => a === A_AXIS_H || a === A_AXIS_V;
/** Arrangements in which a summary topic can bracket some of the children. */
export const summarizes = (a: number): boolean => a === A_BOTH || isSide(a) || isRow(a) || isTree(a);
/** A main topic of a fishbone sits above the spine when its position among its siblings is even. */
export const aboveSpine = (n: MNode): boolean => n.idx % 2 === 0;

// ----------------------------------------------------------------- geometry

/** Tree lists: distance of the vertical trunk from the parent's near edge. */
export function treeTrunk(lv: number, underlined: boolean): number {
  // An underlined topic drops its trunk from the end of its own underline.
  return underlined ? 0 : lv === 0 ? 22 : lv === 1 ? 13 : 9;
}

/** Tree lists: how far children are indented from the parent's near edge. */
export function treeIndent(lv: number, underlined: boolean): number {
  return treeTrunk(lv, underlined) + (lv === 0 ? 18 : 15);
}

/** Rows: how far above its topic a connector turns off the crossbar. */
export const ROW_TURN = 22;

/** Fishbone: horizontal run of a bone per unit of height (cotangent of its angle). */
export const BONE_COT = 0.55;
/** Fishbone: where the bone meets its main topic, measured from the topic's head-side edge. */
export const BONE_INSET = 18;
/** Fishbone: gap between a bone and the rib topics hanging on it. */
export const RIB_GAP = 12;

// ---------------------------------------------------------------- keyboard

export type Arrow = 'left' | 'right' | 'up' | 'down';

export interface NavRule {
  /** Arrow that leads to the parent. */
  parent: Arrow | null;
  /** Arrows that lead to the previous / next sibling. */
  prev: Arrow | null;
  next: Arrow | null;
  /** Up / down walk the visible rows like a file tree instead of staying among siblings. */
  rows: boolean;
}

/** What the arrow keys mean for a node, given how it was placed. */
export function navRule(n: MNode): NavRule {
  switch (n.dir) {
    case A_RIGHT:
      return { parent: 'left', prev: 'up', next: 'down', rows: false };
    case A_LEFT:
      return { parent: 'right', prev: 'up', next: 'down', rows: false };
    case A_DOWN:
      return { parent: 'up', prev: 'left', next: 'right', rows: false };
    case A_UP:
      return { parent: 'down', prev: 'left', next: 'right', rows: false };
    case A_TREE_DR:
      return { parent: 'left', prev: 'up', next: 'down', rows: true };
    case A_TREE_DL:
      return { parent: 'right', prev: 'up', next: 'down', rows: true };
    case A_TREE_UR:
      return { parent: 'left', prev: 'down', next: 'up', rows: true };
    case A_TREE_UL:
      return { parent: 'right', prev: 'down', next: 'up', rows: true };
    case A_AXIS_H:
    case A_SPINE_R:
      return { parent: null, prev: 'left', next: 'right', rows: false };
    case A_SPINE_L:
      return { parent: null, prev: 'right', next: 'left', rows: false };
    case A_AXIS_V:
      return { parent: null, prev: 'up', next: 'down', rows: false };
    case A_RIBS_D:
    case A_RIBS_U:
      // Ribs point away from the head; the bone (and the parent) is on the other side.
      return { parent: n.parent && n.parent.dir === A_SPINE_L ? 'right' : 'left', prev: 'up', next: 'down', rows: false };
    default:
      return { parent: null, prev: null, next: null, rows: false };
  }
}

/** Arrows that lead from a node into its children. */
export function childArrows(cdir: number): Arrow[] {
  switch (cdir) {
    case A_RIGHT:
    case A_AXIS_H:
    case A_SPINE_R:
      return ['right'];
    case A_LEFT:
    case A_SPINE_L:
      return ['left'];
    case A_DOWN:
    case A_RIBS_D:
    case A_AXIS_V:
      return ['down'];
    case A_UP:
    case A_RIBS_U:
      return ['up'];
    case A_TREE_DR:
      return ['right', 'down'];
    case A_TREE_DL:
      return ['left', 'down'];
    case A_TREE_UR:
      return ['right', 'up'];
    case A_TREE_UL:
      return ['left', 'up'];
    default:
      return [];
  }
}

export const opposite = (a: Arrow): Arrow => (a === 'left' ? 'right' : a === 'right' ? 'left' : a === 'up' ? 'down' : 'up');

/**
 * Position of a child along the axis in which its siblings are ordered:
 * larger means later in the sibling order. `x`, `y` is the child's center
 * (or the pointer, to find an insertion slot).
 */
export function orderKey(arrangement: number, x: number, y: number): number {
  switch (arrangement) {
    case A_DOWN:
    case A_UP:
    case A_AXIS_H:
    case A_SPINE_R:
      return x;
    case A_SPINE_L:
      return -x;
    case A_TREE_UR:
    case A_TREE_UL:
      return -y;
    default:
      return y;
  }
}
