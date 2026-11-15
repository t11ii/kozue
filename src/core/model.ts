// Document model: a mutable tree of topics with transactional undo/redo.

import { MARKER_IDS } from './markers.ts';
import { LAYOUT_KINDS } from './structures.ts';
import type { Font } from './themes.ts';

export type Side = 'l' | 'r';
export type LayoutKind =
  | 'map'
  | 'logic'
  | 'logic-left'
  | 'brace'
  | 'org'
  | 'org-up'
  | 'org-tree'
  | 'tree'
  | 'timeline'
  | 'timeline-v'
  | 'fishbone'
  | 'fishbone-right';
/** A palette index (theme-relative) or an explicit `#rrggbb` color. */
export type ColorRef = number | string;

/** The outline of a topic. */
export type Shape = 'rounded' | 'rect' | 'pill' | 'ellipse' | 'diamond' | 'underline' | 'none';
export const SHAPES: readonly Shape[] = ['rounded', 'rect', 'pill', 'ellipse', 'diamond', 'underline', 'none'];

/**
 * How one topic looks where it departs from the theme. Every field is optional.
 * A style object is never changed in place: a new one replaces it.
 */
export interface TopicStyle {
  shape?: Shape;
  /** Fill of the box: `#rrggbb`, or `none` for an outline without a fill. */
  fill?: string;
  /** Color of the outline (`#rrggbb`). */
  border?: string;
  /** Color of the text (`#rrggbb`). */
  color?: string;
  /** Heavier (true) or lighter (false) than topics of this level normally are. */
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  /** Font size in px. */
  size?: number;
}

/** How the subtopics of a topic are numbered. */
export type NumberFormat = 'arabic' | 'upper' | 'lower' | 'roman' | 'roman-lower';
export const NUMBER_FORMATS: readonly NumberFormat[] = ['arabic', 'upper', 'lower', 'roman', 'roman-lower'];

/** Automatic numbers in front of the subtopics of a topic. Never changed in place. */
export interface Numbering {
  format: NumberFormat;
  /** The numbers carry the number of this topic in front: 2.1, 2.2 … */
  tiered?: boolean;
}

export type FontKind = 'sans' | 'serif' | 'round' | 'mono';
export const FONT_KINDS: readonly FontKind[] = ['sans', 'serif', 'round', 'mono'];

/** Settings of the whole map that override its theme. */
export interface MapStyle {
  /** Color of the canvas (`#rrggbb`). */
  background?: string;
  /** Thickness of the branch lines, relative to the theme's (1 = as designed). */
  line?: number;
  /** Typeface of all text on the map. */
  font?: FontKind;
}

/** Plain, serializable form of a topic. */
export interface NodeData {
  text: string;
  side?: Side;
  color?: ColorRef;
  collapsed?: boolean;
  markers?: string[];
  note?: string;
  link?: string;
  labels?: string[];
  /** A to-do item: false while open, true once done. */
  todo?: boolean;
  /** Structure of this topic's branch, when it differs from the rest of the map. */
  structure?: LayoutKind;
  /** A frame around the topic and its branch; the value is the frame's title (may be empty). */
  boundary?: string;
  /** A summary topic: the number of preceding siblings it sums up. */
  summary?: number;
  style?: TopicStyle;
  /** Width of the text block in px, when it was set by hand (the text wraps at it). */
  width?: number;
  /** Numbers the subtopics of this topic. */
  numbering?: Numbering;
  /** Stable id; only written for topics that a relationship refers to. */
  id?: string;
  children?: NodeData[];
}

/** A free connection between two topics, outside the hierarchy. */
export interface RelData {
  from: string;
  to: string;
  text?: string;
  /** How far the line bows to the left of its direction (negative: to the right); absent = automatic. */
  bend?: number;
}

export interface DocData {
  format: 'kozue';
  version: number;
  theme: string;
  layout: LayoutKind;
  style?: MapStyle;
  root: NodeData;
  relationships?: RelData[];
}

/** Position and text of one label chip inside its topic's box. */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  text: string;
}

export const FORMAT_VERSION = 1;

const NO_LINES: string[] = [];
const NO_LABELS: LabelBox[] = [];
/** Stands in until the layout has chosen a topic's font. */
const NO_FONT: Font = { size: 14, weight: 400, italic: false, family: 'sans-serif', css: '400 14px sans-serif' };
let idSeq = 0;

export class MNode {
  readonly id: string = 'n' + (++idSeq).toString(36);
  text: string;
  parent: MNode | null = null;
  children: MNode[] = [];
  collapsed = false;
  /** Which side of the root a main topic sits on (map layout). */
  side: Side | undefined = undefined;
  /** Branch color; inherited by descendants when undefined. */
  color: ColorRef | undefined = undefined;
  markers: string[] | undefined = undefined;
  note: string | undefined = undefined;
  link: string | undefined = undefined;
  labels: string[] | undefined = undefined;
  /** To-do state: undefined = not a to-do, false = open, true = done. */
  todo: boolean | undefined = undefined;
  /** Structure of this branch (its descendants); undefined follows the parent. */
  structure: LayoutKind | undefined = undefined;
  /** Title of the frame drawn around this branch; undefined = no frame. */
  boundary: string | undefined = undefined;
  /** For a summary topic: how many preceding siblings it sums up. */
  sum: number | undefined = undefined;
  /** Stable id used by relationships in saved files. */
  ref: string | undefined = undefined;
  /** The topic's own look; undefined follows the theme. */
  style: TopicStyle | undefined = undefined;
  /** Width of the text block when set by hand; undefined sizes the topic to its text. */
  width: number | undefined = undefined;
  /** How the subtopics of this topic are numbered; undefined = not at all. */
  numbering: Numbering | undefined = undefined;

  /** Bumped whenever something that affects the measured size changes. */
  ver = 0;

  // ---- measurement cache (owned by layout) ----
  mVer = -1;
  mLv = -1;
  mEpoch = -1;
  mBox = false;
  mNum = '';
  lines: string[] = NO_LINES;
  lab: LabelBox[] = NO_LABELS; // label chips, relative to the box
  w = 0; // box size
  h = 0;
  tw = 0; // text block size
  th = 0;
  tx = 0; // text block offset inside the box
  ty = 0;
  font: Font = NO_FONT; // typeface, size and weight of the text
  lh = 20; // line height
  shp: Shape = 'none'; // the outline that is drawn
  rad = 0; // corner radius of that outline
  tc = false; // the lines are centered in the text block
  nw = 0; // room the number takes in front of the text

  // ---- layout result (owned by layout) ----
  depth = 0;
  lv = 0; // style level: 0 root, 1 main topic, 2 subtopic
  dir = 0; // how the parent placed this node (an arrangement code from structures.ts; 0 for the root)
  cdir = 0; // the arrangement this node uses for its own children
  pk: LayoutKind = 'map'; // the structure that placed this node
  box = false; // drawn as a box (with a fill and / or an outline)
  ul = false; // drawn on an underline
  sumN = 0; // active summary topic: number of siblings it brackets (0 otherwise)
  cover: MNode | null = null; // the summary topic that brackets this node
  idx = 0; // position among its siblings
  num = ''; // its number among its siblings, as shown ("2." or "1.2"); empty when they are not numbered
  branch = ''; // resolved branch color
  x = 0; // target position (top-left, world space)
  y = 0;
  rx = 0; // offset of this node's center from its parent's center
  ry = 0;
  bar = 0; // rows: offset from this node's center to the crossbar its children hang from
  bax = 0; // fishbone main topic: offset from its center to where its bone ends
  bay = 0;
  xl = 0; // subtree extents to the left / right / top / bottom of this node's center
  xr = 0;
  yu = 0;
  yd = 0;
  bx0 = 0; // subtree bounds (target space)
  by0 = 0;
  bx1 = 0;
  by1 = 0;
  stamp = 0; // layout pass in which the node was last visible
  fresh = false; // became visible in the latest layout pass
  hidden = 0; // number of descendants hidden by a collapse

  // ---- animation state (owned by the view) ----
  ax = 0; // displayed position
  ay = 0;
  fx = 0; // animation start position
  fy = 0;
  aa = 1; // displayed alpha
  fa = 1;
  dim = false; // drawn translucent (being dragged)
  fade = false; // drawn pale (filtered out)

  constructor(text = '') {
    this.text = text;
  }

  get folded(): boolean {
    return this.collapsed && this.parent !== null && this.children.length > 0;
  }
}

/** A relationship: a connection between two topics that is not part of the tree. */
export class Rel {
  from: MNode;
  to: MNode;
  text: string;
  /** Bow of the line, set by dragging it; undefined lets the app choose. */
  bend: number | undefined = undefined;

  constructor(from: MNode, to: MNode, text = '') {
    this.from = from;
    this.to = to;
    this.text = text;
  }
}

export type PropKey =
  | 'text'
  | 'side'
  | 'color'
  | 'collapsed'
  | 'markers'
  | 'note'
  | 'link'
  | 'labels'
  | 'todo'
  | 'structure'
  | 'boundary'
  | 'sum'
  | 'style'
  | 'width'
  | 'numbering';
export type RelKey = 'from' | 'to' | 'text' | 'bend';
export type MetaKey = 'theme' | 'layout';
const MEASURED: ReadonlySet<PropKey> = new Set<PropKey>(['text', 'markers', 'note', 'link', 'labels', 'todo', 'style', 'width']);

export type Op =
  | { k: 'ins'; node: MNode; parent: MNode; index: number }
  | { k: 'del'; node: MNode; parent: MNode; index: number }
  | { k: 'set'; node: MNode; key: PropKey; from: unknown; to: unknown }
  | { k: 'meta'; key: MetaKey; from: string; to: string }
  | { k: 'look'; from: MapStyle; to: MapStyle }
  | { k: 'radd'; rel: Rel; index: number }
  | { k: 'rdel'; rel: Rel; index: number }
  | { k: 'rset'; rel: Rel; key: RelKey; from: unknown; to: unknown };

export interface Txn {
  label: string;
  ops: Op[];
  /** Selection before / after, restored by undo / redo. */
  before: MNode[];
  after: MNode[];
  merge: string | undefined;
  time: number;
}

export interface RunOpts {
  /** Transactions with the same merge key collapse into one undo step. */
  merge?: string;
  /** Only merge when the previous step is at most this many ms old. */
  within?: number;
}

const MAX_UNDO = 500;

export class Doc {
  root: MNode;
  theme: string;
  layout: LayoutKind;
  /** The map's own background, line thickness and typeface; replaced as a whole, never changed in place. */
  style: MapStyle = {};
  rels: Rel[] = [];
  undoStack: Txn[] = [];
  redoStack: Txn[] = [];
  /** Supplies the current selection so undo/redo can restore it. */
  selection: () => MNode[] = () => [];
  /** Called after every committed transaction, undo and redo. */
  onChange: (txn: Txn, kind: 'do' | 'undo' | 'redo') => void = () => {};

  private cur: Txn | null = null;
  /** Top of the undo stack at the last save; `undefined` = unreachable. */
  private saved: Txn | null | undefined = null;

  constructor(root: MNode, theme: string, layout: LayoutKind) {
    this.root = root;
    this.theme = theme;
    this.layout = layout;
  }

  // ---------------------------------------------------------------- history

  get dirty(): boolean {
    return this.saved === undefined || (this.undoStack.at(-1) ?? null) !== this.saved;
  }

  markSaved(): void {
    this.saved = this.undoStack.at(-1) ?? null;
  }

  markDirty(): void {
    this.saved = undefined;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Runs `fn` as one undoable step. Nested calls join the outer step. */
  run(label: string, fn: () => void, opts: RunOpts = {}): boolean {
    if (this.cur) {
      fn();
      return true;
    }
    const txn: Txn = {
      label,
      ops: [],
      before: this.selection().slice(),
      after: [],
      merge: opts.merge,
      time: Date.now(),
    };
    this.cur = txn;
    try {
      fn();
      if (txn.ops.length) this.pruneRels();
    } finally {
      this.cur = null;
    }
    if (txn.ops.length === 0) return false;
    txn.after = this.selection().slice();
    this.redoStack.length = 0;

    const top = this.undoStack.at(-1);
    const mergeable =
      top !== undefined &&
      txn.merge !== undefined &&
      top.merge === txn.merge &&
      (opts.within === undefined || txn.time - top.time <= opts.within);
    if (mergeable) {
      if (this.saved === top) this.saved = undefined;
      for (const op of txn.ops) {
        const last = top.ops.at(-1);
        if (op.k === 'set' && last && last.k === 'set' && last.node === op.node && last.key === op.key) {
          last.to = op.to;
        } else if (op.k === 'rset' && last && last.k === 'rset' && last.rel === op.rel && last.key === op.key) {
          last.to = op.to;
        } else if (op.k === 'look' && last && last.k === 'look') {
          last.to = op.to;
        } else {
          top.ops.push(op);
        }
      }
      top.after = txn.after;
      top.time = txn.time;
      this.onChange(top, 'do');
    } else {
      this.undoStack.push(txn);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.onChange(txn, 'do');
    }
    return true;
  }

  undo(): Txn | null {
    const txn = this.undoStack.pop();
    if (!txn) return null;
    for (let i = txn.ops.length - 1; i >= 0; i--) this.apply(txn.ops[i], true);
    this.redoStack.push(txn);
    this.onChange(txn, 'undo');
    return txn;
  }

  redo(): Txn | null {
    const txn = this.redoStack.pop();
    if (!txn) return null;
    for (const op of txn.ops) this.apply(op, false);
    this.undoStack.push(txn);
    this.onChange(txn, 'redo');
    return txn;
  }

  private apply(op: Op, invert: boolean): void {
    switch (op.k) {
      case 'ins':
      case 'del': {
        const attach = (op.k === 'ins') !== invert;
        if (attach) {
          op.parent.children.splice(Math.min(op.index, op.parent.children.length), 0, op.node);
          op.node.parent = op.parent;
        } else {
          const i = op.parent.children.indexOf(op.node);
          if (i >= 0) op.parent.children.splice(i, 1);
          op.node.parent = null;
        }
        break;
      }
      case 'set': {
        (op.node as unknown as Record<string, unknown>)[op.key] = invert ? op.from : op.to;
        if (MEASURED.has(op.key)) op.node.ver++;
        break;
      }
      case 'meta':
        if (op.key === 'theme') this.theme = invert ? op.from : op.to;
        else this.layout = (invert ? op.from : op.to) as LayoutKind;
        break;
      case 'look':
        this.style = invert ? op.from : op.to;
        break;
      case 'radd':
      case 'rdel': {
        const attach = (op.k === 'radd') !== invert;
        const i = this.rels.indexOf(op.rel);
        if (attach && i < 0) this.rels.splice(Math.min(op.index, this.rels.length), 0, op.rel);
        else if (!attach && i >= 0) this.rels.splice(i, 1);
        break;
      }
      case 'rset':
        (op.rel as unknown as Record<string, unknown>)[op.key] = invert ? op.from : op.to;
        break;
    }
  }

  private log(op: Op): void {
    if (!this.cur) throw new Error('Doc mutated outside of run()');
    this.cur.ops.push(op);
  }

  // ------------------------------------------------------------- primitives

  insert(node: MNode, parent: MNode, index: number = parent.children.length): void {
    if (node.parent) throw new Error('node is already attached');
    const kids = parent.children;
    const i = Math.max(0, Math.min(index, kids.length));
    this.log({ k: 'ins', node, parent, index: i });
    kids.splice(i, 0, node);
    node.parent = parent;
    if (node.sum !== undefined) return;
    // A topic that lands among summarized siblings joins what their summary sums up.
    for (let p = i + 1; p < kids.length; p++) {
      const s = kids[p];
      if (s.sum === undefined) continue;
      if (i >= p - s.sum) this.set(s, 'sum', s.sum + 1);
      break;
    }
  }

  remove(node: MNode): void {
    const parent = node.parent;
    if (!parent) throw new Error('cannot remove a detached node');
    const kids = parent.children;
    const index = kids.indexOf(node);
    if (node.sum === undefined) {
      // A summarized topic leaves its summary; one that sums up nothing becomes an ordinary topic.
      for (let p = index + 1; p < kids.length; p++) {
        const s = kids[p];
        if (s.sum === undefined) continue;
        if (p - index <= s.sum) this.set(s, 'sum', s.sum > 1 ? s.sum - 1 : undefined);
        break;
      }
    }
    this.log({ k: 'del', node, parent, index });
    kids.splice(index, 1);
    node.parent = null;
  }

  set<K extends PropKey>(node: MNode, key: K, value: MNode[K]): void {
    const from = node[key];
    if (from === value) return;
    this.log({ k: 'set', node, key, from, to: value });
    node[key] = value;
    if (MEASURED.has(key)) node.ver++;
  }

  setMeta(key: MetaKey, value: string): void {
    const from = this[key];
    if (from === value) return;
    this.log({ k: 'meta', key, from, to: value });
    if (key === 'theme') this.theme = value;
    else this.layout = value as LayoutKind;
  }

  /** Replaces the map's own settings (background, line thickness, typeface). */
  setStyle(next: MapStyle): void {
    const from = this.style;
    const to = cleanMapStyle(next);
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    this.log({ k: 'look', from, to });
    this.style = to;
  }

  addRel(rel: Rel): void {
    if (this.rels.includes(rel)) return;
    this.log({ k: 'radd', rel, index: this.rels.length });
    this.rels.push(rel);
  }

  removeRel(rel: Rel): void {
    const index = this.rels.indexOf(rel);
    if (index < 0) return;
    this.log({ k: 'rdel', rel, index });
    this.rels.splice(index, 1);
  }

  setRel<K extends RelKey>(rel: Rel, key: K, value: Rel[K]): void {
    const from = rel[key];
    if (from === value) return;
    this.log({ k: 'rset', rel, key, from, to: value });
    rel[key] = value;
  }

  /** A relationship does not outlive the topics it connects (moving them keeps it). */
  private pruneRels(): void {
    for (let i = this.rels.length - 1; i >= 0; i--) {
      const r = this.rels[i];
      if (!isAttached(r.from, this.root) || !isAttached(r.to, this.root)) this.removeRel(r);
    }
  }

  // ---------------------------------------------------------- serialization

  /**
   * @param linked the ids that topic links point at, anywhere in the file. When given,
   *   a topic that no link points at is written without the id it has for that.
   */
  toData(linked?: ReadonlySet<string>): DocData {
    const rels = this.rels.filter((r) => isAttached(r.from, this.root) && isAttached(r.to, this.root));
    // A topic carries an id in the file when a relationship ends at it or a topic link points at it.
    const ends = new Set<MNode>();
    for (const r of rels) ends.add(r.from).add(r.to);
    const named = new Set<MNode>(ends);
    const used = new Set<string>();
    walk(this.root, (n) => {
      const ref = n.ref;
      if (ref === undefined) return;
      if (used.has(ref) || (REL_REF.test(ref) && !ends.has(n) && !linked?.has(ref))) {
        // A second topic with the same id, or an id that only named the end of a relationship that is gone.
        n.ref = undefined;
        return;
      }
      used.add(ref);
      // An id for links stays with its topic even while nothing points at it:
      // undo may bring such a link back. It is just not written then.
      if (linked === undefined || linked.has(ref)) named.add(n);
    });
    let seq = 1;
    for (const n of ends) {
      if (n.ref !== undefined) continue;
      while (used.has('t' + seq)) seq++;
      n.ref = 't' + seq;
      used.add(n.ref);
    }
    const data: DocData = {
      format: 'kozue',
      version: FORMAT_VERSION,
      theme: this.theme,
      layout: this.layout,
      ...(Object.keys(this.style).length ? { style: { ...this.style } } : {}),
      root: toData(this.root, named),
    };
    if (rels.length) {
      data.relationships = rels.map((r) => {
        const d: RelData = { from: r.from.ref!, to: r.to.ref! };
        if (r.text) d.text = r.text;
        if (r.bend !== undefined) d.bend = Math.round(r.bend);
        return d;
      });
    }
    return data;
  }

  static fromData(data: unknown, fallbackTheme: string, paletteSize: number): Doc {
    const d = (data ?? {}) as Partial<DocData>;
    if (typeof d !== 'object' || d.root === undefined) throw new Error('Not a Kozue document');
    const byId = new Map<string, MNode>();
    const root = fromData(d.root, byId);
    root.side = undefined;
    root.color = undefined;
    root.collapsed = false;
    root.structure = undefined;
    root.boundary = undefined;
    root.sum = undefined;
    normalizeMains(root, paletteSize);
    const layout = LAYOUT_KINDS.includes(d.layout as LayoutKind) ? (d.layout as LayoutKind) : 'map';
    const theme = typeof d.theme === 'string' && d.theme ? d.theme : fallbackTheme;
    const doc = new Doc(root, theme, layout);
    doc.style = cleanMapStyle(d.style);
    if (Array.isArray(d.relationships)) {
      for (const raw of d.relationships as unknown[]) {
        const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const from = typeof r.from === 'string' ? byId.get(r.from) : undefined;
        const to = typeof r.to === 'string' ? byId.get(r.to) : undefined;
        if (!from || !to || from === to) continue;
        if (doc.rels.some((x) => x.from === from && x.to === to)) continue;
        const rel = new Rel(from, to, typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').slice(0, MAX_TITLE) : '');
        if (typeof r.bend === 'number' && Number.isFinite(r.bend)) rel.bend = Math.max(-MAX_BEND, Math.min(MAX_BEND, r.bend));
        doc.rels.push(rel);
      }
    }
    return doc;
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Plain data of a topic and everything below it.
 * @param ids topics whose stable id is written out (the ends of relationships)
 */
export function toData(n: MNode, ids?: ReadonlySet<MNode>): NodeData {
  const d: NodeData = { text: n.text };
  if (ids && n.ref !== undefined && ids.has(n)) d.id = n.ref;
  if (n.side) d.side = n.side;
  if (n.color !== undefined) d.color = n.color;
  if (n.collapsed && n.children.length) d.collapsed = true;
  if (n.markers && n.markers.length) d.markers = n.markers.slice();
  if (n.todo !== undefined) d.todo = n.todo;
  if (n.labels && n.labels.length) d.labels = n.labels.slice();
  if (n.note) d.note = n.note;
  if (n.link) d.link = n.link;
  if (n.structure !== undefined) d.structure = n.structure;
  if (n.boundary !== undefined) d.boundary = n.boundary;
  if (n.sum !== undefined) d.summary = n.sum;
  if (n.style) d.style = { ...n.style };
  if (n.width !== undefined) d.width = n.width;
  if (n.numbering) d.numbering = { ...n.numbering };
  if (n.children.length) d.children = n.children.map((c) => toData(c, ids));
  return d;
}

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[\w-]{1,48}$/;
/** Ids that only name the ends of relationships within one map ("t1", "t2" …). */
const REL_REF = /^t\d+$/;

/** True for a link that points at another topic of the file ("#" and that topic's id) rather than at the web. */
export const isTopicLink = (link: string | undefined): link is string =>
  link !== undefined && link.charAt(0) === '#' && ID.test(link.slice(1));

/**
 * Makes `target` something a topic link can point at and returns the link.
 * Its id must hold across all sheets of a file, which the ids of relationship
 * ends do not: such a topic gets a new, random one.
 */
export function topicLinkTo(target: MNode): string {
  if (target.ref === undefined || REL_REF.test(target.ref)) {
    let id = 'k';
    for (let i = 0; i < 10; i++) id += Math.floor(Math.random() * 36).toString(36);
    target.ref = id;
  }
  return '#' + target.ref;
}

/** The topic with the given id in the tree below `root`, if any. */
export function findByRef(root: MNode, ref: string): MNode | null {
  if (root.ref === ref) return root;
  for (const k of root.children) {
    const hit = findByRef(k, ref);
    if (hit) return hit;
  }
  return null;
}
export const MAX_LABELS = 12;
export const MAX_LABEL = 40;
export const MAX_TITLE = 120;
export const MAX_BEND = 800;
export const MIN_SIZE = 8;
export const MAX_SIZE = 72;
export const MIN_WIDTH = 24;
export const MAX_WIDTH = 1200;
export const MIN_LINE = 0.4;
export const MAX_LINE = 3;

const hex = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);

/** A topic style built from untrusted data: only known fields with valid values; undefined when nothing is left. */
export function cleanStyle(raw: unknown): TopicStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const s: TopicStyle = {};
  if (SHAPES.includes(r.shape as Shape)) s.shape = r.shape as Shape;
  const fill = r.fill === 'none' ? 'none' : hex(r.fill);
  if (fill !== undefined) s.fill = fill;
  const border = hex(r.border);
  if (border !== undefined) s.border = border;
  const color = hex(r.color);
  if (color !== undefined) s.color = color;
  if (typeof r.bold === 'boolean') s.bold = r.bold;
  if (r.italic === true) s.italic = true;
  if (r.strike === true) s.strike = true;
  if (typeof r.size === 'number' && Number.isFinite(r.size)) s.size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(r.size)));
  return Object.keys(s).length ? s : undefined;
}

/** A numbering from untrusted data; undefined when it names no known format. */
export function cleanNumbering(raw: unknown): Numbering | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!NUMBER_FORMATS.includes(r.format as NumberFormat)) return undefined;
  return r.tiered === true ? { format: r.format as NumberFormat, tiered: true } : { format: r.format as NumberFormat };
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** The `n`th number (from 1) in a format: 3, C, c, III or iii. Letters go on as AA, AB … after Z. */
export function formatNumber(n: number, format: NumberFormat): string {
  if (format === 'arabic' || n < 1) return String(n);
  if (format === 'upper' || format === 'lower') {
    let s = '';
    for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
    return format === 'upper' ? s : s.toLowerCase();
  }
  if (n > 3999) return String(n);
  let s = '';
  let v = n;
  for (const [value, sign] of ROMAN) {
    while (v >= value) {
      s += sign;
      v -= value;
    }
  }
  return format === 'roman' ? s : s.toLowerCase();
}

/**
 * The number shown in front of the `count`th numbered subtopic of a topic
 * whose own number is `own`: "3." — or "2.3" when the numbers are tiered.
 */
export function numberLabel(count: number, numbering: Numbering, own: string): string {
  const n = formatNumber(count, numbering.format);
  return numbering.tiered && own ? own.replace(/\.$/, '') + '.' + n : n + '.';
}

/** The hand-set width of a topic's text block, from untrusted data. */
export function cleanWidth(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(raw)));
}

/** Map settings built from untrusted data; a line thickness of 1 says nothing new and is dropped. */
export function cleanMapStyle(raw: unknown): MapStyle {
  const s: MapStyle = {};
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const background = hex(r.background);
  if (background !== undefined) s.background = background;
  if (typeof r.line === 'number' && Number.isFinite(r.line)) {
    const line = Math.round(Math.max(MIN_LINE, Math.min(MAX_LINE, r.line)) * 100) / 100;
    if (line !== 1) s.line = line;
  }
  // "sans" is worth keeping: a theme may come with another typeface.
  if (FONT_KINDS.includes(r.font as FontKind)) s.font = r.font as FontKind;
  return s;
}

/** Trims, de-duplicates and bounds a list of labels; undefined when nothing is left. */
export function cleanLabels(list: readonly unknown[]): string[] | undefined {
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const s = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
    if (s && !out.includes(s) && out.length < MAX_LABELS) out.push(s);
  }
  return out.length ? out : undefined;
}

/**
 * Builds a node tree from untrusted data, dropping anything malformed.
 * @param byId collects the topics that carry an id, for resolving relationships
 */
export function fromData(data: unknown, byId?: Map<string, MNode>): MNode {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const n = new MNode(typeof d.text === 'string' ? d.text.replace(/\r\n?/g, '\n') : '');
  if (byId && typeof d.id === 'string' && ID.test(d.id) && !byId.has(d.id)) {
    n.ref = d.id;
    byId.set(d.id, n);
  }
  if (d.side === 'l' || d.side === 'r') n.side = d.side;
  if (typeof d.color === 'number' && Number.isInteger(d.color) && d.color >= 0) n.color = d.color;
  else if (typeof d.color === 'string' && HEX.test(d.color)) n.color = d.color.toLowerCase();
  if (d.collapsed === true) n.collapsed = true;
  if (Array.isArray(d.markers)) {
    const ms = d.markers.filter((m): m is string => typeof m === 'string' && MARKER_IDS.has(m));
    if (ms.length) n.markers = [...new Set(ms)];
  }
  if (typeof d.todo === 'boolean') n.todo = d.todo;
  if (Array.isArray(d.labels)) n.labels = cleanLabels(d.labels);
  if (typeof d.note === 'string' && d.note) n.note = d.note;
  if (typeof d.link === 'string' && d.link) n.link = d.link;
  // The mind map itself is the structure of a whole map, never of a single branch.
  if (d.structure !== 'map' && LAYOUT_KINDS.includes(d.structure as LayoutKind)) n.structure = d.structure as LayoutKind;
  if (typeof d.boundary === 'string') n.boundary = d.boundary.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (typeof d.summary === 'number' && Number.isInteger(d.summary) && d.summary >= 1) n.sum = d.summary;
  n.style = cleanStyle(d.style);
  n.width = cleanWidth(d.width);
  n.numbering = cleanNumbering(d.numbering);
  if (Array.isArray(d.children)) {
    for (const c of d.children) {
      const k = fromData(c, byId);
      k.parent = n;
      n.children.push(k);
    }
  }
  if (!n.children.length) n.collapsed = false;
  return n;
}

export function walk(n: MNode, fn: (n: MNode) => void): void {
  fn(n);
  for (const c of n.children) walk(c, fn);
}

/** Pre-order walk over nodes that are not hidden by a collapsed ancestor. */
export function walkVisible(n: MNode, fn: (n: MNode) => void): void {
  fn(n);
  if (!n.folded) for (const c of n.children) walkVisible(c, fn);
}

export function countDescendants(n: MNode): number {
  let c = n.children.length;
  for (const k of n.children) c += countDescendants(k);
  return c;
}

export function countLeaves(n: MNode): number {
  if (!n.children.length) return 1;
  let c = 0;
  for (const k of n.children) c += countLeaves(k);
  return c;
}

export function isAttached(n: MNode, root: MNode): boolean {
  let p: MNode = n;
  while (p.parent) p = p.parent;
  return p === root;
}

/** True when `anc` is `n` itself or one of its ancestors. */
export function isWithin(n: MNode, anc: MNode): boolean {
  for (let p: MNode | null = n; p; p = p.parent) if (p === anc) return true;
  return false;
}

/** Drops nodes that have an ancestor in the same set. */
export function topLevel(nodes: readonly MNode[]): MNode[] {
  const set = new Set(nodes);
  return nodes.filter((n) => {
    for (let p = n.parent; p; p = p.parent) if (set.has(p)) return false;
    return true;
  });
}

/** Sorts nodes into document (pre-order) order. */
export function inDocOrder(root: MNode, nodes: readonly MNode[]): MNode[] {
  const set = new Set(nodes);
  const out: MNode[] = [];
  walk(root, (n) => {
    if (set.has(n)) out.push(n);
  });
  return out;
}

/** The main topic (child of the root) that `n` belongs to, if any. */
export function mainOf(n: MNode): MNode | null {
  let p: MNode = n;
  while (p.parent && p.parent.parent) p = p.parent;
  return p.parent ? p : null;
}

// ---------------------------------------------------- main-topic bookkeeping

/** Picks the side with less content, so the map stays balanced. */
export function lighterSide(root: MNode, ignore?: MNode): Side {
  let l = 0;
  let r = 0;
  for (const k of root.children) {
    if (k === ignore) continue;
    if (k.side === 'l') l += countLeaves(k);
    else r += countLeaves(k);
  }
  return l < r ? 'l' : 'r';
}

/** Picks the least used palette slot, continuing the rotation after `after`. */
export function nextColor(root: MNode, paletteSize: number, after?: MNode | null, ignore?: MNode): number {
  const n = Math.max(1, paletteSize);
  const used = new Array<number>(n).fill(0);
  let last = -1;
  for (const k of root.children) {
    if (k === ignore || typeof k.color !== 'number') continue;
    used[k.color % n]++;
    last = k.color;
  }
  const ref = after && typeof after.color === 'number' ? after.color : last;
  const min = Math.min(...used);
  for (let i = 1; i <= n; i++) {
    const c = (ref + i + n) % n;
    if (used[c] === min) return c;
  }
  return 0;
}

/** Imbalance (in leaves) for every way of putting the first k topics on the right. */
function splitDiffs(kids: readonly MNode[]): number[] {
  const w = kids.map(countLeaves);
  const total = w.reduce((a, b) => a + b, 0);
  const diffs: number[] = [Infinity]; // k = 0 (nothing on the right) is never chosen
  let acc = 0;
  for (let k = 1; k <= kids.length; k++) {
    acc += w[k - 1];
    diffs.push(Math.abs(2 * acc - total));
  }
  // A summary stays on the side of the topics it sums up.
  kids.forEach((s, p) => {
    if (s.sum === undefined) return;
    for (let k = Math.max(1, p - s.sum + 1); k <= p; k++) diffs[k] = Infinity;
  });
  return diffs;
}

/**
 * How many leading main topics go on the right so both sides carry similar
 * weight. Among equally good splits the one closest to `keep` wins (so that
 * as few topics as possible change sides), otherwise the larger one.
 */
export function balancedSplit(kids: readonly MNode[], keep = -1): number {
  const diffs = splitDiffs(kids);
  let best = 0;
  for (let k = 1; k < diffs.length; k++) {
    const better = diffs[k] < diffs[best];
    const tie = diffs[k] === diffs[best] && (keep < 0 || Math.abs(k - keep) <= Math.abs(best - keep));
    if (best === 0 || better || tie) best = k;
  }
  return best;
}

/** Number of right-hand topics if the sides are a right run followed by a left run, else -1. */
export function splitIndex(kids: readonly MNode[]): number {
  let k = 0;
  let left = false;
  for (const c of kids) {
    if (c.side === 'l') left = true;
    else if (left) return -1;
    else k++;
  }
  return k;
}

/** True when the current sides are (one of) the best balanced splits — i.e. not hand-arranged. */
export function isBalanced(kids: readonly MNode[]): boolean {
  if (!kids.length) return true;
  const k = splitIndex(kids);
  if (k < 1) return false;
  const diffs = splitDiffs(kids);
  return diffs[k] === Math.min(...diffs);
}

/** Makes sure every main topic has a side and a color (used after loading). */
export function normalizeMains(root: MNode, paletteSize: number): void {
  const kids = root.children;
  if (!kids.length) return;
  if (!kids.some((k) => k.side)) {
    const best = balancedSplit(kids);
    kids.forEach((k, i) => (k.side = i < best ? 'r' : 'l'));
  } else {
    for (const k of kids) if (!k.side) k.side = lighterSide(root, k);
  }
  let prev: MNode | null = null;
  for (const k of kids) {
    if (k.color === undefined) k.color = nextColor(root, paletteSize, prev, k);
    prev = k;
  }
}

/**
 * Deep copy as plain data, without the per-position attributes of the top node.
 * @param withIds keeps the ids that topic links point at: a topic that is cut and pasted takes its links along
 */
export function cloneForPaste(n: MNode, withIds = false): NodeData {
  let ids: Set<MNode> | undefined;
  if (withIds) {
    const set = (ids = new Set<MNode>());
    walk(n, (k) => {
      if (k.ref !== undefined && !REL_REF.test(k.ref)) set.add(k);
    });
  }
  const d = toData(n, ids);
  delete d.side;
  delete d.summary; // away from its siblings it is an ordinary topic
  if (n.parent && !n.parent.parent && typeof d.color === 'number') delete d.color;
  return d;
}
