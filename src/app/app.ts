// The application core: owns the document, selection, layout, animation and
// rendering, and implements every editing command. UI chrome and input
// handlers call into it and subscribe to its change events.

import type { Bounds, LayoutOpts } from '../core/layout.ts';
import { layoutDoc } from '../core/layout.ts';
import { toggleMarker } from '../core/markers.ts';
import type { ColorRef, LayoutKind, MapStyle, NodeData, Side, TopicStyle, Txn } from '../core/model.ts';
import {
  Doc,
  MAX_BEND,
  MAX_SIZE,
  MAX_TITLE,
  MIN_SIZE,
  MNode,
  Rel,
  cleanLabels,
  cleanStyle,
  cleanWidth,
  cloneForPaste,
  balancedSplit,
  fromData,
  inDocOrder,
  isAttached,
  isBalanced,
  isWithin,
  lighterSide,
  nextColor,
  splitIndex,
  topLevel,
  walk,
  walkVisible,
} from '../core/model.ts';
import type { Arrow } from '../core/structures.ts';
import {
  A_AXIS_H,
  A_AXIS_V,
  A_BOTH,
  A_DOWN,
  A_LEFT,
  A_RIGHT,
  A_SPINE_L,
  A_TREE_DL,
  A_TREE_DR,
  A_UP,
  BONE_COT,
  RIB_GAP,
  aboveSpine,
  childArrows,
  isAxis,
  isRibs,
  isRow,
  isSide,
  isSpine,
  isTree,
  navRule,
  opposite,
  orderKey,
  summarizes,
  treeIndent,
} from '../core/structures.ts';
import type { SearchOpts } from '../core/text.ts';
import { occurrences } from '../core/text.ts';
import type { Font, Theme } from '../core/themes.ts';
import {
  DEFAULT_THEME,
  ICON,
  ICON_STEP,
  LEVELS,
  REL_FONT,
  contrast,
  font,
  fontIn,
  mix,
  nodeStyle,
  themeById,
  themeWith,
} from '../core/themes.ts';
import { parseOutline, toOutline } from '../io/outline.ts';
import type { Painter } from '../render/painter.ts';
import { circle, roundRect } from '../render/painter.ts';
import type { SceneOpts } from '../render/scene.ts';
import {
  TOGGLE_R,
  boneAnchor,
  childAnchor,
  curvePoint,
  drawNodeAt,
  drawScene,
  edgePoint,
  outlinePath,
  relCurve,
  relLabel,
  snapPositions,
  todoBox,
  togglePos,
} from '../render/scene.ts';
import { TextEditor } from './editor.ts';
import { CanvasMeasurer, MAX_ZOOM, MIN_ZOOM, View } from './view.ts';

export type AppEvent = 'doc' | 'selection' | 'view' | 'theme' | 'edit' | 'search' | 'mode';
export type HitPart = 'body' | 'toggle' | 'note' | 'link' | 'todo' | 'width';
export type { Arrow } from '../core/structures.ts';
export type { SearchOpts } from '../core/text.ts';

/** Topics are shown in full when they carry any of these; everything else turns pale. */
export interface Filter {
  markers: Set<string>;
  labels: Set<string>;
  todo: Set<'open' | 'done'>;
}

/** Short messages the app asks the UI to show. */
export type Notice = 'noSummaryHere' | 'styleCopied';

export interface Hit {
  node: MNode;
  part: HitPart;
  /** For `width`: the left (-1) or right (1) edge of the topic. */
  edge?: -1 | 1;
}

/** Changes to a topic style: a value sets a property, `null` returns it to what the theme says. */
export type StylePatch = { [K in keyof TopicStyle]?: TopicStyle[K] | null };
/** Changes to the settings of the map, in the same way. */
export type MapStylePatch = { [K in keyof MapStyle]?: MapStyle[K] | null };

/** The quick style for topics that matter. */
const IMPORTANT: TopicStyle = { fill: '#e5484d', color: '#ffffff', bold: true };

/** A topic's width being changed by dragging one of its edges. */
interface ResizeState {
  node: MNode;
  nodes: MNode[];
  edge: -1 | 1;
  /** Width of the text block and position of the dragged edge when the drag began. */
  w0: number;
  e0: number;
  /** How far the edge moves per unit of width. */
  slope: number;
  /** Distance of the pointer from the edge. */
  offset: number;
  /** Folds all steps of the drag into one undo step. */
  key: string;
}

interface DropTarget {
  parent: MNode;
  /** Sibling the dragged nodes are inserted in front of; null appends. */
  before: MNode | null;
  side: Side | undefined;
  noop: boolean;
  /** Placeholder shown where the topics would land: x, y, width, height (world space). */
  pill: [number, number, number, number];
  /** Connector from the new parent to the placeholder. */
  link: { kind: 'curve' | 'elbow' | 'line'; x0: number; y0: number; x1: number; y1: number } | null;
}

interface DragState {
  nodes: MNode[];
  set: Set<MNode>;
  lead: MNode;
  /** Grab offset inside the lead node. */
  gx: number;
  gy: number;
  wx: number;
  wy: number;
  /** Pointer position in screen space, for edge auto-scroll. */
  sx: number;
  sy: number;
  target: DropTarget | null;
}

interface ViewAnim {
  t0: number;
  dur: number;
  cx0: number;
  cy0: number;
  z0: number;
  cx1: number;
  cy1: number;
  z1: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const COUNT_FONT = font(10, 700);
const easeOut = (k: number): number => 1 - Math.pow(1 - k, 3);
const DASH: readonly number[] = [5, 4];

/** Distance from point (x, y) to the segment a–b. */
function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

export class App {
  doc!: Doc;
  theme: Theme = themeById(DEFAULT_THEME);
  readonly view: View;
  readonly measurer = new CanvasMeasurer();
  readonly editor: TextEditor;

  sel: MNode[] = [];
  private selSet = new Set<MNode>();
  hover: MNode | null = null;
  hoverPart: HitPart = 'body';
  private hoverEdge: -1 | 1 = 1;

  bounds: Bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Number of visible topics. */
  count = 0;
  /** Canvas area covered by UI chrome; respected when fitting and revealing. */
  insets = { top: 56, right: 16, bottom: 16, left: 16 };
  /** While > 0 (menus, dialogs) the canvas ignores keyboard input. */
  blockKeys = 0;

  marquee: Bounds | null = null;
  searchQuery = '';
  searchOpts: SearchOpts = { matchCase: false, wholeWord: false };
  matches: MNode[] = [];
  matchIndex = -1;

  /** A branch shown on its own, with the rest of the map hidden; null shows the whole map. */
  focus: MNode | null = null;
  /** The selected relationship. Topics and a relationship are never selected together. */
  selRel: Rel | null = null;
  /** A relationship being drawn, from a topic to wherever the pointer is. */
  connect: { from: MNode; wx: number; wy: number } | null = null;
  filter: Filter | null = null;
  /** Number of topics that pass the filter. */
  filterCount = 0;
  /** Shows a short message to the user (provided by the UI layer). */
  notify: (what: Notice) => void = () => {};

  private epoch = 1;
  private stamp = 0;
  private anim: { t0: number; dur: number; shift: number } | null = null;
  private viewAnim: ViewAnim | null = null;
  private raf = 0;
  private drag: DragState | null = null;
  private resize: ResizeState | null = null;
  private resizeSeq = 0;
  /** The style taken by "Copy Style". */
  private styleClip: { style: TopicStyle | undefined } | null = null;
  private marks: Set<MNode> | null = null;
  private keep: Set<MNode> | null = null;
  private relIds = new WeakMap<Rel, number>();
  private relSeq = 0;
  private clip: { text: string; data: NodeData[] } | null = null;
  private listeners: ((what: AppEvent) => void)[] = [];
  private commands = new Map<string, () => void>();
  private metrics = (f: Font) => this.measurer.metrics(f);
  private textWidth = (f: Font, text: string): number => this.measurer.width(f, text);

  constructor(canvas: HTMLCanvasElement, editorEl: HTMLTextAreaElement, mirror: HTMLElement) {
    this.view = new View(canvas);
    this.editor = new TextEditor(this, editorEl, mirror);
    this.registerCommands();
    this.setDoc(new Doc(new MNode(''), DEFAULT_THEME, 'map'));

    new ResizeObserver(() => {
      const first = this.view.width <= 1;
      if (this.view.resize()) {
        if (first) this.fit(false);
        this.requestRender();
        this.emit('view');
      }
    }).observe(canvas);
    // Redraw sharply when the window moves to a display with another pixel ratio.
    const watchDpr = (): void => {
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
        'change',
        () => {
          this.requestRender();
          watchDpr();
        },
        { once: true },
      );
    };
    watchDpr();
  }

  // ------------------------------------------------------------------ events

  on(listener: (what: AppEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(what: AppEvent): void {
    for (const l of this.listeners) l(what);
  }

  // ---------------------------------------------------------------- commands

  /** Adds a command that menus, shortcuts and the toolbar can run by name. */
  register(id: string, fn: () => void): void {
    this.commands.set(id, fn);
  }

  exec(id: string): void {
    const fn = this.commands.get(id);
    if (fn) fn();
  }

  private registerCommands(): void {
    const c = (id: string, fn: () => void): void => this.register(id, fn);
    c('undo', () => this.undo());
    c('redo', () => this.redo());
    c('addChild', () => this.addChild());
    c('addSibling', () => this.addSibling(false));
    c('addSiblingBefore', () => this.addSibling(true));
    c('addParent', () => this.addParent());
    c('edit', () => {
      const n = this.primary;
      if (n) this.editor.begin(n, 'append');
    });
    c('delete', () => this.deleteSelection());
    c('duplicate', () => this.duplicate());
    c('selectAll', () => {
      if (this.editor.state) this.editor.el.select();
      else this.selectAll();
    });
    c('toggleCollapse', () => this.toggleCollapse());
    c('expandAll', () => this.setAllCollapsed(false));
    c('collapseAll', () => this.setAllCollapsed(true));
    c('copy', () => this.clipboardCommand('copy'));
    c('cut', () => this.clipboardCommand('cut'));
    c('paste', () => void this.pasteFromSystem());
    c('zoomIn', () => this.zoomBy(1.25));
    c('zoomOut', () => this.zoomBy(0.8));
    c('zoomReset', () => this.zoomTo(1));
    c('fit', () => this.fit(true));
    c('centerRoot', () => {
      this.select([this.vroot]);
      this.centerOn(this.vroot);
    });
    c('todo', () => this.cycleTodo());
    c('boundary', () => this.toggleBoundary());
    c('summary', () => this.addSummary());
    c('relationship', () => this.startRelationship());
    c('focusBranch', () => this.toggleFocus());
    c('clearFilter', () => this.setFilter(null));
    c('bold', () => this.toggleBold());
    c('italic', () => this.toggleFlag('italic'));
    c('strike', () => this.toggleFlag('strike'));
    c('important', () => this.quickStyle('important'));
    c('crossed', () => this.quickStyle('crossed'));
    c('resetStyle', () => this.resetStyle());
    c('copyStyle', () => this.copyStyle());
    c('pasteStyle', () => this.pasteStyle());
    c('styleToLevel', () => this.applyStyleToLevel());
  }

  // ---------------------------------------------------------------- document

  setDoc(doc: Doc): void {
    this.editor.abort();
    this.doc = doc;
    doc.selection = () => this.sel;
    doc.onChange = (txn, kind) => this.onDocChange(txn, kind);
    this.theme = themeWith(themeById(doc.theme), doc.style);
    this.epoch++;
    this.hover = null;
    this.drag = null;
    this.resize = null;
    this.marquee = null;
    this.anim = null;
    this.viewAnim = null;
    this.focus = null;
    this.selRel = null;
    this.connect = null;
    this.filter = null;
    this.keep = null;
    this.filterCount = 0;
    this.sel = [doc.root];
    this.selSet = new Set(this.sel);
    this.relayout(false);
    this.refreshSearch();
    this.fit(false);
    this.emit('theme');
    this.emit('doc');
    this.emit('selection');
    this.emit('mode');
  }

  /** The topic the view starts from: the central topic, or the branch shown on its own. */
  get vroot(): MNode {
    return this.focus ?? this.doc.root;
  }

  private onDocChange(txn: Txn, kind: 'do' | 'undo' | 'redo'): void {
    const root = this.doc.root;
    let themeChanged = false;
    let layoutChanged = false;
    let lookChanged = false;
    for (const op of txn.ops) {
      if (op.k === 'look') lookChanged = true;
      if (op.k !== 'meta') continue;
      if (op.key === 'theme') themeChanged = true;
      else layoutChanged = true;
    }
    if (themeChanged || layoutChanged || lookChanged) {
      this.theme = themeWith(themeById(this.doc.theme), this.doc.style);
      this.epoch++;
    }
    let modeChanged = false;
    if (this.focus && !isAttached(this.focus, root)) {
      this.focus = null;
      modeChanged = true;
    }
    if (this.connect && !isAttached(this.connect.from, root)) {
      this.connect = null;
      modeChanged = true;
    }
    const rel = this.selRel && this.doc.rels.includes(this.selRel) ? this.selRel : null;
    if (kind !== 'do') {
      const restore = (kind === 'undo' ? txn.before : txn.after).filter((n) => isAttached(n, root));
      // Undoing a change to a relationship leaves that relationship selected.
      if (restore.length || !rel) this.setSelection(restore.length ? restore : [this.vroot]);
    } else if (this.selRel && !rel) this.selectRel(null);
    this.pruneSelection();
    if (this.hover && !isAttached(this.hover, root)) this.hover = null;
    this.refreshSearch();
    this.refreshFilter();
    if (this.filter || modeChanged) this.emit('mode');
    // An edge being dragged must stay under the pointer: no animation then.
    this.relayout(!themeChanged && !this.resize);
    // The topic under the text cursor may have got another font, color or width.
    if (this.editor.state) this.editor.restyle();
    if (layoutChanged) this.fit(true);
    else if (kind !== 'do' && this.primary) this.reveal(this.primary);
    if (themeChanged || layoutChanged || lookChanged) this.emit('theme');
    this.emit('doc');
  }

  undo(): void {
    if (this.editor.state) document.execCommand('undo');
    else this.doc.undo();
  }

  redo(): void {
    if (this.editor.state) document.execCommand('redo');
    else this.doc.redo();
  }

  // --------------------------------------------------------------- selection

  get primary(): MNode | null {
    return this.sel.length ? this.sel[this.sel.length - 1] : null;
  }

  isSelected(n: MNode): boolean {
    return this.selSet.has(n);
  }

  /** A node is visible when no ancestor is collapsed (and it was laid out). */
  isVisible(n: MNode): boolean {
    return n.stamp === this.stamp;
  }

  private setSelection(nodes: readonly MNode[]): void {
    this.sel = [...new Set(nodes)];
    this.selSet = new Set(this.sel);
    this.selRel = null;
    this.editor.reset();
    this.requestRender();
    this.emit('selection');
  }

  /** Selects a relationship (deselecting any topics), or nothing. */
  selectRel(rel: Rel | null): void {
    this.editor.commit();
    this.sel = [];
    this.selSet = new Set();
    this.selRel = rel;
    this.editor.reset();
    this.requestRender();
    this.emit('selection');
  }

  select(nodes: readonly MNode[], reveal = false): void {
    this.setSelection(nodes);
    if (reveal && this.primary) this.reveal(this.primary);
  }

  toggleSelect(n: MNode): void {
    this.setSelection(this.selSet.has(n) ? this.sel.filter((m) => m !== n) : [...this.sel, n]);
  }

  addSelect(n: MNode): void {
    this.setSelection([...this.sel.filter((m) => m !== n), n]);
  }

  selectAll(): void {
    const all: MNode[] = [];
    walkVisible(this.vroot, (n) => all.push(n));
    // Keep the current primary selection primary.
    const p = this.primary;
    this.setSelection(p ? [...all.filter((n) => n !== p), p] : all);
  }

  /** Drops detached nodes and lifts nodes hidden inside a collapsed branch or outside the branch on show. */
  private pruneSelection(): void {
    const root = this.doc.root;
    const top = this.vroot;
    let changed = false;
    const next: MNode[] = [];
    for (const n of this.sel) {
      if (!isAttached(n, root)) {
        changed = true;
        continue;
      }
      let shown = n;
      for (let p = n.parent; p && shown !== top; p = p.parent) if (p.folded) shown = p;
      if (!isWithin(shown, top)) shown = top;
      if (shown !== n) changed = true;
      next.push(shown);
    }
    if (changed) this.setSelection(next);
  }

  // ------------------------------------------------------- layout & animation

  relayout(animate = true): void {
    this.stamp++;
    const o: LayoutOpts = {
      theme: this.theme,
      measurer: this.measurer,
      epoch: this.epoch,
      stamp: this.stamp,
      editing: this.editor ? this.editor.layoutEdit : null,
    };
    const res = layoutDoc(this.doc, o, this.vroot);
    this.bounds = res.bounds;
    this.count = res.count;
    this.startAnim(animate && res.count <= 6000);
    this.requestRender();
  }

  private startAnim(animate: boolean): void {
    const root = this.vroot;
    if (!animate) {
      snapPositions(root);
      this.anim = null;
      return;
    }
    const editing = this.editor.state ? this.editor.state.node : null;
    let shift = 0;
    let fading = false;
    const visit = (n: MNode): void => {
      if (n.fresh) {
        // Newly visible nodes grow out of their parent.
        const p = n === root ? null : n.parent;
        if (p) {
          n.ax = p.ax + (p.w - n.w) / 2;
          n.ay = p.ay + (p.h - n.h) / 2;
          n.aa = 0;
        } else {
          n.ax = n.x;
          n.ay = n.y;
          n.aa = 1;
        }
      }
      if (n === editing) {
        // The node under the text cursor must not lag behind its editor.
        n.ax = n.x;
        n.ay = n.y;
        n.aa = 1;
      }
      n.fx = n.ax;
      n.fy = n.ay;
      n.fa = n.aa;
      const d = Math.max(Math.abs(n.x - n.ax), Math.abs(n.y - n.ay));
      if (d > shift) shift = d;
      if (n.aa < 1) fading = true;
      if (!n.folded) for (const k of n.children) visit(k);
    };
    visit(root);
    if (shift > 0.5 || fading) this.anim = { t0: performance.now(), dur: 190, shift };
    else {
      snapPositions(root);
      this.anim = null;
    }
  }

  requestRender(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const v = this.view;
    let more = false;

    if (this.anim) {
      const k = clamp((now - this.anim.t0) / this.anim.dur, 0, 1);
      const e = easeOut(k);
      walkVisible(this.vroot, (n) => {
        n.ax = n.fx + (n.x - n.fx) * e;
        n.ay = n.fy + (n.y - n.fy) * e;
        n.aa = n.fa + (1 - n.fa) * e;
      });
      if (k >= 1) this.anim = null;
      else more = true;
    }

    const va = this.viewAnim;
    if (va) {
      const k = clamp((now - va.t0) / va.dur, 0, 1);
      const e = easeOut(k);
      const z = Math.exp(Math.log(va.z0) + (Math.log(va.z1) - Math.log(va.z0)) * e);
      v.zoom = z;
      v.panX = v.width / 2 - (va.cx0 + (va.cx1 - va.cx0) * e) * z;
      v.panY = v.height / 2 - (va.cy0 + (va.cy1 - va.cy0) * e) * z;
      if (k >= 1) this.viewAnim = null;
      else more = true;
      this.emit('view');
    }

    if (this.drag && this.autoScroll()) more = true;

    this.draw();
    this.editor.sync();
    if (more) this.requestRender();
  };

  // -------------------------------------------------------------------- view

  /** The view the current animation is heading to (or the current view). */
  private viewGoal(): { panX: number; panY: number; zoom: number } {
    const v = this.view;
    const a = this.viewAnim;
    if (!a) return { panX: v.panX, panY: v.panY, zoom: v.zoom };
    return { panX: v.width / 2 - a.cx1 * a.z1, panY: v.height / 2 - a.cy1 * a.z1, zoom: a.z1 };
  }

  private setView(panX: number, panY: number, zoom: number, animate: boolean, dur = 240): void {
    const v = this.view;
    if (!animate || v.width <= 1) {
      this.viewAnim = null;
      v.zoom = zoom;
      v.panX = panX;
      v.panY = panY;
      this.emit('view');
    } else {
      this.viewAnim = {
        t0: performance.now(),
        dur,
        cx0: v.wx(v.width / 2),
        cy0: v.wy(v.height / 2),
        z0: v.zoom,
        cx1: (v.width / 2 - panX) / zoom,
        cy1: (v.height / 2 - panY) / zoom,
        z1: zoom,
      };
    }
    this.requestRender();
  }

  /** Smoothly scrolls the view by a screen-space offset. */
  shiftView(dx: number, dy: number): void {
    const g = this.viewGoal();
    this.setView(g.panX + dx, g.panY + dy, g.zoom, true, 220);
  }

  /** Stops any view animation (the user grabbed the canvas). */
  cancelViewAnim(): void {
    this.viewAnim = null;
  }

  panBy(dx: number, dy: number): void {
    this.viewAnim = null;
    this.view.panX += dx;
    this.view.panY += dy;
    this.requestRender();
  }

  /** Immediate zoom around a screen point (wheel / pinch). */
  zoomAt(sx: number, sy: number, factor: number): void {
    this.viewAnim = null;
    this.view.zoomAt(sx, sy, factor);
    this.requestRender();
    this.emit('view');
  }

  /** Center of the canvas area that is not covered by chrome. */
  private focusPoint(): [number, number] {
    const v = this.view;
    const i = this.insets;
    return [i.left + (v.width - i.left - i.right) / 2, i.top + (v.height - i.top - i.bottom) / 2];
  }

  zoomBy(factor: number): void {
    this.zoomTo(this.viewGoal().zoom * factor);
  }

  zoomTo(zoom: number): void {
    const g = this.viewGoal();
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const [fx, fy] = this.focusPoint();
    const k = z / g.zoom;
    this.setView(fx - (fx - g.panX) * k, fy - (fy - g.panY) * k, z, true, 160);
  }

  fit(animate = true): void {
    const v = this.view;
    const b = this.bounds;
    const i = this.insets;
    const pad = 36;
    const aw = Math.max(80, v.width - i.left - i.right - pad * 2);
    const ah = Math.max(80, v.height - i.top - i.bottom - pad * 2);
    const z = clamp(Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0), 1), MIN_ZOOM, 1);
    const [fx, fy] = this.focusPoint();
    this.setView(fx - ((b.x0 + b.x1) / 2) * z, fy - ((b.y0 + b.y1) / 2) * z, z, animate, 280);
  }

  centerOn(n: MNode): void {
    const g = this.viewGoal();
    const [fx, fy] = this.focusPoint();
    this.setView(fx - (n.x + n.w / 2) * g.zoom, fy - (n.y + n.h / 2) * g.zoom, g.zoom, true);
  }

  /** Scrolls just enough to bring `n` fully into view. */
  reveal(n: MNode): void {
    if (!this.isVisible(n)) return;
    const v = this.view;
    if (v.width <= 1) return;
    const g = this.viewGoal();
    const i = this.insets;
    const m = 28;
    const L = i.left + m;
    const T = i.top + m;
    const R = v.width - i.right - m;
    const B = v.height - i.bottom - m;
    const x0 = n.x * g.zoom + g.panX;
    const y0 = n.y * g.zoom + g.panY;
    const x1 = x0 + n.w * g.zoom;
    const y1 = y0 + n.h * g.zoom;
    let dx = 0;
    let dy = 0;
    if (x0 < L || x1 - x0 > R - L) dx = L - x0;
    else if (x1 > R) dx = R - x1;
    if (y0 < T || y1 - y0 > B - T) dy = T - y0;
    else if (y1 > B) dy = B - y1;
    if (dx || dy) this.setView(g.panX + dx, g.panY + dy, g.zoom, true, 200);
  }

  // --------------------------------------------------------------- rendering

  private sceneOpts(clip: Bounds | null, zoom: number): SceneOpts {
    return {
      theme: this.theme,
      metrics: this.metrics,
      textWidth: this.textWidth,
      clip,
      zoom,
      editing: this.editor.state ? this.editor.state.node : null,
      marks: this.marks,
      markCurrent: this.matchIndex >= 0 ? (this.matches[this.matchIndex] ?? null) : null,
      dim: this.drag ? this.drag.set : null,
      keep: this.keep,
      stamp: this.stamp,
      rels: this.doc.rels,
      selRel: this.selRel,
    };
  }

  /** Scene description for exports: what is on show, with finished animation, no culling, no overlays. */
  exportScene(): { root: MNode; bounds: Bounds; opts: SceneOpts } {
    this.anim = null;
    snapPositions(this.vroot);
    this.requestRender();
    const opts: SceneOpts = {
      ...this.sceneOpts(null, 1),
      editing: null,
      marks: null,
      markCurrent: null,
      dim: null,
      keep: null,
      selRel: null,
    };
    return { root: this.vroot, bounds: this.bounds, opts };
  }

  /**
   * Runs `fn` while only the branch of `node` is laid out (null: the whole map),
   * whatever is on show at the moment. Used to export a single branch.
   */
  withBranch<T>(node: MNode | null, fn: () => T): T {
    const before = this.focus;
    const target = node && node !== this.doc.root ? node : null;
    if (target === before) return fn();
    this.editor.commit();
    this.focus = target;
    this.relayout(false);
    try {
      return fn();
    } finally {
      this.focus = before;
      this.relayout(false);
    }
  }

  private draw(): void {
    const v = this.view;
    const ctx = v.ctx;
    const p = v.painter;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, v.canvas.width, v.canvas.height);
    v.applyTransform();
    p.reset();
    const o = this.sceneOpts(v.worldRect(40 + (this.anim ? this.anim.shift : 0)), v.zoom);
    drawScene(p, this.vroot, o);
    this.drawOverlays(p, o);
  }

  private outline(p: Painter, n: MNode, color: string, width: number, alpha: number, fill: number): void {
    p.beginPath();
    outlinePath(p, n, 3 / Math.min(1, this.view.zoom));
    if (fill > 0) p.fill(color, fill);
    p.stroke(color, width, alpha);
  }

  private drawToggle(p: Painter, n: MNode, hot: boolean): void {
    const [tx, ty] = togglePos(n);
    p.beginPath();
    circle(p, tx, ty, TOGGLE_R - 1);
    p.fill(this.theme.bg);
    if (hot) p.fill(n.branch, 0.18);
    p.stroke(n.branch, 1.5);
    p.beginPath();
    p.moveTo(tx - 3.2, ty);
    p.lineTo(tx + 3.2, ty);
    p.stroke(n.branch, 1.6);
  }

  private drawOverlays(p: Painter, o: SceneOpts): void {
    const z = this.view.zoom;
    const accent = this.theme.accent;
    const w = 2 / Math.min(1, z);
    const drag = this.drag;
    const top = this.vroot;

    const h = this.hover;
    if (h && !drag && this.isVisible(h) && !this.selSet.has(h)) this.outline(p, h, accent, w * 0.75, 0.45, 0);
    for (const n of this.sel) {
      if (!this.isVisible(n)) continue;
      this.outline(p, n, accent, w, 1, n.lv === 2 ? 0.08 : 0);
    }
    if (!drag) {
      const canToggle = (n: MNode | null): n is MNode => !!n && this.isVisible(n) && n !== top && n.children.length > 0 && !n.collapsed;
      if (canToggle(h)) this.drawToggle(p, h, this.hoverPart === 'toggle');
      const pr = this.primary;
      if (pr !== h && canToggle(pr)) this.drawToggle(p, pr, false);
      // The edge of a topic that changes its width, while the pointer is on it or drags it.
      const rs = this.resize;
      const grip = rs ? rs.node : h && this.hoverPart === 'width' ? h : null;
      if (grip && this.isVisible(grip)) {
        const g = 3 / Math.min(1, z);
        const edge = rs ? rs.edge : this.hoverEdge;
        const len = Math.max(8, Math.min(26, grip.h - 6));
        const t = 4 / Math.min(1, z);
        p.beginPath();
        roundRect(p, (edge > 0 ? grip.ax + grip.w + g : grip.ax - g) - t / 2, grip.ay + grip.h / 2 - len / 2, t, len, t / 2);
        p.fill(accent);
      }
    }

    const cn = this.connect;
    if (cn && this.isVisible(cn.from)) {
      // A relationship in the making: from its topic to the pointer (or the topic under it).
      const a = cn.from;
      const b = h && h !== a ? h : null;
      const [x0, y0] = edgePoint(a, cn.wx, cn.wy, 3);
      const [x1, y1] = b ? edgePoint(b, a.ax + a.w / 2, a.ay + a.h / 2, 5) : [cn.wx, cn.wy];
      this.outline(p, a, accent, w, 1, 0);
      if (b) this.outline(p, b, accent, w, 1, 0.1);
      p.beginPath();
      p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      p.stroke(accent, 1.8 / Math.min(1, z), 0.95, DASH);
    }

    if (drag) {
      const t = drag.target;
      if (t && !t.noop) {
        const l = t.link;
        if (l) {
          p.beginPath();
          p.moveTo(l.x0, l.y0);
          if (l.kind === 'curve') {
            const mx = (l.x0 + l.x1) / 2;
            p.cubicTo(mx, l.y0, mx, l.y1, l.x1, l.y1);
          } else {
            if (l.kind === 'elbow') p.lineTo(l.x0, l.y1);
            p.lineTo(l.x1, l.y1);
          }
          p.stroke(accent, 2, 0.9);
        }
        const [x, y, w, h] = t.pill;
        p.beginPath();
        roundRect(p, x, y, w, h, Math.min(w, h) / 2);
        p.fill(accent, 0.9);
      }
      // A translucent copy of the grabbed node trails the pointer, clear of the drop marker.
      const n = drag.lead;
      const gx = drag.wx + 14 / z;
      const gy = drag.wy + 16 / z;
      p.beginPath();
      roundRect(p, gx - 4, gy - 3, n.w + 8, n.h + 6, Math.min(n.rad, 14) + 3);
      p.fill(this.theme.bg, 0.72);
      p.stroke(accent, 1.25 / Math.min(1, z), 0.55);
      drawNodeAt(p, n, o, gx, gy, 0.7);
      if (drag.nodes.length > 1) {
        // How many topics travel together.
        const bx = gx + n.w + 6;
        p.beginPath();
        circle(p, bx, gy - 1, 9);
        p.fill(accent);
        p.text(String(drag.nodes.length), bx, gy + 2.6, COUNT_FONT, this.theme.dark ? '#14161b' : '#ffffff', 'center');
      }
    }

    const mq = this.marquee;
    if (mq) {
      p.beginPath();
      roundRect(p, Math.min(mq.x0, mq.x1), Math.min(mq.y0, mq.y1), Math.abs(mq.x1 - mq.x0), Math.abs(mq.y1 - mq.y0), 2 / z);
      p.fill(accent, 0.1);
      p.stroke(accent, 1 / z, 0.8);
    }
  }

  // ------------------------------------------------------------- hit testing

  hitTest(wx: number, wy: number): Hit | null {
    const top = this.vroot;
    const pad = 28 + (this.anim ? this.anim.shift : 0);
    // The edges of a selected topic are handles that change its width.
    const grip = this.connect ? 0 : 5 / this.view.zoom;
    const visit = (n: MNode): Hit | null => {
      if (wx < n.bx0 - pad || wx > n.bx1 + pad || wy < n.by0 - pad || wy > n.by1 + pad) return null;
      const inBox = wx >= n.ax - 2 && wx <= n.ax + n.w + 2 && wy >= n.ay - 2 && wy <= n.ay + n.h + 2;
      if (!inBox && n !== top && n.children.length) {
        const [tx, ty] = togglePos(n);
        if (Math.abs(wx - tx) <= TOGGLE_R + 3 && Math.abs(wy - ty) <= TOGGLE_R + 3) return { node: n, part: 'toggle' };
      }
      if (grip > 0 && this.selSet.has(n) && wy >= n.ay && wy <= n.ay + n.h) {
        // Inside the topic the handles stay narrow, so that most of it still grabs the topic itself.
        const inner = Math.min(grip, n.w / 4);
        if (wx >= n.ax - grip && wx <= n.ax + inner) return { node: n, part: 'width', edge: -1 };
        if (wx >= n.ax + n.w - inner && wx <= n.ax + n.w + grip) return { node: n, part: 'width', edge: 1 };
      }
      if (inBox) {
        if (n.todo !== undefined) {
          const [bx, by, bs] = todoBox(n);
          if (wx >= bx - 3 && wx <= bx + bs + 3 && wy >= by - 3 && wy <= by + bs + 3) return { node: n, part: 'todo' };
        }
        if (n.note || n.link) {
          let ix = n.ax + n.tx + n.tw + (ICON_STEP - ICON) - 2;
          if (wy >= n.ay + n.ty - 2 && wy <= n.ay + n.ty + n.lh + 2) {
            if (n.note) {
              if (wx >= ix && wx < ix + ICON_STEP) return { node: n, part: 'note' };
              ix += ICON_STEP;
            }
            if (n.link && wx >= ix && wx < ix + ICON_STEP) return { node: n, part: 'link' };
          }
        }
        return { node: n, part: 'body' };
      }
      if (!n.folded) {
        for (const k of n.children) {
          const hit = visit(k);
          if (hit) return hit;
        }
      }
      return null;
    };
    return visit(top);
  }

  /**
   * The relationship whose line or text is under the point, if any.
   * @param textOnly only look at the texts, which lie on top of the topics (the lines lie below them)
   */
  hitRel(wx: number, wy: number, textOnly = false): Rel | null {
    let best: Rel | null = null;
    let bd = 7 / Math.min(1, this.view.zoom);
    const relFont = fontIn(REL_FONT, this.theme.typeface);
    for (const r of this.doc.rels) {
      if (!this.isVisible(r.from) || !this.isVisible(r.to)) continue;
      const c = relCurve(r);
      const label = relLabel(r);
      if (label) {
        const [mx, my] = curvePoint(c, 0.5);
        if (Math.abs(wx - mx) <= this.measurer.width(relFont, label) / 2 + 7 && Math.abs(wy - my) <= 11) return r;
      }
      if (textOnly) continue;
      let px = c.x0;
      let py = c.y0;
      for (let i = 1; i <= 24; i++) {
        const [qx, qy] = curvePoint(c, i / 24);
        const d = segDist(wx, wy, px, py, qx, qy);
        if (d < bd) {
          bd = d;
          best = r;
        }
        px = qx;
        py = qy;
      }
    }
    return best;
  }

  /** @param overRel the pointer is on a relationship rather than on a topic */
  setHover(hit: Hit | null, overRel = false): void {
    const node = hit ? hit.node : null;
    const part = hit ? hit.part : 'body';
    const edge = hit?.edge ?? 1;
    this.view.canvas.style.cursor = this.connect
      ? 'crosshair'
      : part === 'width'
        ? 'ew-resize'
        : overRel || (hit && hit.part !== 'body')
          ? 'pointer'
          : '';
    if (node === this.hover && part === this.hoverPart && edge === this.hoverEdge) return;
    this.hover = node;
    this.hoverPart = part;
    this.hoverEdge = edge;
    this.requestRender();
  }

  // ------------------------------------------------------------ tree editing

  /**
   * Chooses the side of a newly created main topic. As long as the map is
   * still balanced automatically (nobody arranged the sides by hand), the
   * split between right and left is recomputed, which may move a neighbour
   * across; otherwise the topic simply goes to the preferred / lighter side.
   */
  private placeMain(node: MNode, prefer: Side | undefined): void {
    const doc = this.doc;
    const root = doc.root;
    const kids = root.children;
    const others = kids.filter((k) => k !== node);
    if (!isBalanced(others)) {
      doc.set(node, 'side', prefer ?? lighterSide(root, node));
      return;
    }
    const right = splitIndex(others);
    const i = kids.indexOf(node);
    // The split that leaves every existing topic where it is.
    const keep = i < right ? right + 1 : i > right ? right : prefer === 'l' ? right : prefer === 'r' ? right + 1 : -1;
    const k = balancedSplit(kids, keep);
    kids.forEach((c, j) => doc.set(c, 'side', j < k ? 'r' : 'l'));
  }

  /**
   * After inserting `node` under `parent`: fix side / color for its new place.
   * @param create the node is new (as opposed to moved), so the map may rebalance
   */
  private settle(node: MNode, parent: MNode, side: Side | undefined, prev: MNode | null, wasMain: boolean, create = false): void {
    const doc = this.doc;
    const root = doc.root;
    if (parent === root) {
      if (create) this.placeMain(node, side);
      else doc.set(node, 'side', side ?? node.side ?? lighterSide(root, node));
      if (node.color === undefined) doc.set(node, 'color', nextColor(root, this.theme.palette.length, prev, node));
    } else {
      if (node.side !== undefined) doc.set(node, 'side', undefined);
      // An automatic main-topic color does not follow the node into another branch.
      if (wasMain && typeof node.color === 'number') doc.set(node, 'color', undefined);
    }
    if (parent.collapsed) doc.set(parent, 'collapsed', false);
  }

  /** Moves `node` under `parent`, in front of `before` (or to the end). Call inside a transaction. */
  private moveInto(node: MNode, parent: MNode, before: MNode | null, side?: Side): void {
    const doc = this.doc;
    const wasMain = node.parent === doc.root;
    // Away from the topics it summed up, a summary topic is an ordinary topic.
    if (node.sum !== undefined) doc.set(node, 'sum', undefined);
    doc.remove(node);
    const idx = before && before.parent === parent ? parent.children.indexOf(before) : parent.children.length;
    doc.insert(node, parent, idx);
    this.settle(node, parent, side, parent.children[idx - 1] ?? null, wasMain);
  }

  /** Siblings that share a column / row with `n` (one side of the root in a map). */
  private group(n: MNode): MNode[] {
    const parent = n.parent;
    if (!parent) return [n];
    const kids = parent.cdir === A_BOTH ? parent.children.filter((k) => k.dir === n.dir) : parent.children;
    // A summary topic stands beside its siblings, not among them.
    return n.sumN > 0 ? kids : kids.filter((k) => k.sumN === 0);
  }

  addChild(target: MNode | null = this.primary): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    const parent = target && isAttached(target, root) ? target : this.vroot;
    const node = new MNode('');
    doc.run(
      'Add subtopic',
      () => {
        doc.insert(node, parent);
        this.settle(node, parent, undefined, parent.children[parent.children.length - 2] ?? null, false, true);
        this.setSelection([node]);
      },
      { merge: 'new:' + node.id },
    );
    this.editor.begin(node, 'all', true);
  }

  addSibling(before: boolean, target: MNode | null = this.primary): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    const ref = target && isAttached(target, root) ? target : null;
    if (!ref || ref === this.vroot) {
      this.addChild(this.vroot);
      return;
    }
    const parent = ref.parent!;
    const node = new MNode('');
    doc.run(
      'Add topic',
      () => {
        const idx = parent.children.indexOf(ref) + (before ? 0 : 1);
        doc.insert(node, parent, idx);
        this.settle(node, parent, ref.side, parent.children[idx - 1] ?? null, false, true);
        this.setSelection([node]);
      },
      { merge: 'new:' + node.id },
    );
    this.editor.begin(node, 'all', true);
  }

  addParent(target: MNode | null = this.primary): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    if (!target || target === this.vroot || !isAttached(target, root)) return;
    const parent = target.parent!;
    const node = new MNode('');
    doc.run(
      'Insert parent',
      () => {
        const idx = parent.children.indexOf(target);
        doc.remove(target);
        if (target.sum !== undefined) {
          // The new topic takes over as the summary.
          node.sum = target.sum;
          doc.set(target, 'sum', undefined);
        }
        doc.insert(node, parent, idx);
        if (parent === root) {
          // The new topic takes over the main topic's place, side and color.
          doc.set(node, 'side', target.side);
          doc.set(node, 'color', target.color);
          doc.set(target, 'side', undefined);
          if (typeof target.color === 'number') doc.set(target, 'color', undefined);
        }
        doc.insert(target, node, 0);
        this.setSelection([node]);
      },
      { merge: 'new:' + node.id },
    );
    this.editor.begin(node, 'all', true);
  }

  /** Removes a just-created node as if it had never been added. */
  discardNew(node: MNode): void {
    const doc = this.doc;
    const top = doc.undoStack.at(-1);
    if (top && top.merge === 'new:' + node.id) {
      doc.undo();
      doc.redoStack.pop();
      this.emit('doc');
    } else if (node.parent) {
      const parent = node.parent;
      doc.run('Delete', () => {
        doc.remove(node);
        this.setSelection([parent]);
      });
    }
  }

  deleteSelection(): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    const rel = this.selRel;
    if (rel) {
      doc.run('Delete relationship', () => doc.removeRel(rel));
      return;
    }
    const nodes = inDocOrder(root, topLevel(this.sel)).filter((n) => n !== root);
    if (!nodes.length) return;
    const gone = new Set(nodes);
    const last = nodes[nodes.length - 1];
    const sibs = this.group(last);
    const i = sibs.indexOf(last);
    let next: MNode | null = null;
    for (let j = i + 1; j < sibs.length && !next; j++) if (!gone.has(sibs[j])) next = sibs[j];
    for (let j = i - 1; j >= 0 && !next; j--) if (!gone.has(sibs[j])) next = sibs[j];
    const after = next ?? last.parent ?? root;
    doc.run('Delete', () => {
      for (const n of nodes) doc.remove(n);
      this.setSelection([after]);
    });
    this.reveal(after);
  }

  duplicate(): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    const nodes = inDocOrder(root, topLevel(this.sel)).filter((n) => n !== this.vroot);
    if (!nodes.length) return;
    const copies: MNode[] = [];
    doc.run('Duplicate', () => {
      for (const n of nodes) {
        const parent = n.parent!;
        const copy = fromData(cloneForPaste(n));
        doc.insert(copy, parent, parent.children.indexOf(n) + 1);
        this.settle(copy, parent, n.side, n, false, true);
        copies.push(copy);
      }
      this.setSelection(copies);
    });
    if (copies.length) this.reveal(copies[copies.length - 1]);
  }

  /** Alt+arrows: reorder among siblings, or move one level up / down. */
  shift(arrow: Arrow): void {
    const n = this.primary;
    // A summary topic stays with the topics it sums up.
    if (!n || n === this.vroot || n.sumN > 0) return;
    const rule = navRule(n);
    if (arrow === rule.prev) this.reorder(-1);
    else if (arrow === rule.next) this.reorder(1);
    else if (arrow === rule.parent) this.promote();
    else if (rule.parent && arrow === opposite(rule.parent)) this.demote();
  }

  private reorder(delta: -1 | 1): void {
    const doc = this.doc;
    const nodes = inDocOrder(doc.root, topLevel(this.sel)).filter((n) => n.parent);
    if (!nodes.length) return;
    const parent = nodes[0].parent!;
    if (nodes.some((n) => n.parent !== parent)) return;
    const group = this.group(nodes[0]).filter((k) => !nodes.includes(k) || k === nodes[0] || k === nodes[nodes.length - 1]);
    let before: MNode | null;
    if (delta < 0) {
      const target = group[group.indexOf(nodes[0]) - 1];
      if (!target || nodes.includes(target)) return;
      before = target;
    } else {
      const target = group[group.indexOf(nodes[nodes.length - 1]) + 1];
      if (!target || nodes.includes(target)) return;
      before = parent.children[parent.children.indexOf(target) + 1] ?? null;
      while (before && nodes.includes(before)) before = parent.children[parent.children.indexOf(before) + 1] ?? null;
    }
    doc.run('Move', () => {
      for (const n of nodes) this.moveInto(n, parent, before, n.side);
    });
    if (this.primary) this.reveal(this.primary);
  }

  private promote(): void {
    const doc = this.doc;
    const n = this.primary;
    if (!n || !n.parent || !n.parent.parent || n.parent === this.vroot) return;
    const parent = n.parent;
    const grand = parent.parent!;
    const before = grand.children[grand.children.indexOf(parent) + 1] ?? null;
    doc.run('Promote', () => this.moveInto(n, grand, before, parent.side));
    this.reveal(n);
  }

  private demote(): void {
    const doc = this.doc;
    const n = this.primary;
    if (!n || !n.parent) return;
    const group = this.group(n);
    const prev = group[group.indexOf(n) - 1];
    if (!prev) return;
    doc.run('Demote', () => this.moveInto(n, prev, null));
    this.reveal(n);
  }

  toggleCollapse(nodes: readonly MNode[] = this.sel): void {
    this.editor.commit();
    const doc = this.doc;
    const targets = nodes.filter((n) => n !== this.vroot && n.children.length);
    if (!targets.length) return;
    const collapse = targets.some((n) => !n.collapsed);
    doc.run(collapse ? 'Collapse' : 'Expand', () => {
      for (const n of targets) doc.set(n, 'collapsed', collapse);
    });
  }

  private setAllCollapsed(collapsed: boolean): void {
    this.editor.commit();
    const doc = this.doc;
    const top = this.vroot;
    doc.run(collapsed ? 'Collapse all' : 'Expand all', () => {
      walk(top, (n) => {
        if (n !== top && n.children.length) doc.set(n, 'collapsed', collapsed);
      });
    });
    this.fit(true);
  }

  // --------------------------------------------------------- node properties

  toggleMarker(id: string): void {
    const doc = this.doc;
    const nodes = this.sel;
    if (!nodes.length) return;
    const all = nodes.every((n) => n.markers?.includes(id));
    doc.run('Marker', () => {
      for (const n of nodes) {
        const has = n.markers?.includes(id) ?? false;
        if (all || !has) doc.set(n, 'markers', toggleMarker(n.markers, id));
      }
    });
  }

  /**
   * Sets the branch color of the selection; `undefined` returns to automatic.
   * @param live the value comes from a picker being dragged: fold the changes into one undo step
   */
  setColor(ref: ColorRef | undefined, live = false): void {
    const doc = this.doc;
    const root = doc.root;
    const nodes = this.sel.filter((n) => n !== root);
    if (!nodes.length) return;
    const opts = live ? { merge: 'color:' + nodes.map((n) => n.id).join(','), within: 2500 } : {};
    doc.run(
      'Color',
      () => {
        for (const n of nodes) {
          if (ref !== undefined) doc.set(n, 'color', ref);
          else if (n.parent === root) {
            const sibs = root.children;
            doc.set(n, 'color', nextColor(root, this.theme.palette.length, sibs[sibs.indexOf(n) - 1] ?? null, n));
          } else doc.set(n, 'color', undefined);
        }
      },
      opts,
    );
  }

  setNote(node: MNode, note: string): void {
    const doc = this.doc;
    doc.run('Note', () => doc.set(node, 'note', note || undefined), { merge: 'note:' + node.id, within: 4000 });
  }

  setLink(node: MNode, link: string): void {
    const doc = this.doc;
    let url = link.trim();
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    doc.run('Link', () => doc.set(node, 'link', url || undefined));
  }

  setTheme(id: string): void {
    this.editor.commit();
    const doc = this.doc;
    doc.run('Theme', () => {
      doc.setMeta('theme', id);
      // A theme comes with its own canvas color; the line thickness and the typeface stay.
      if (doc.style.background !== undefined) {
        const rest = { ...doc.style };
        delete rest.background;
        doc.setStyle(rest);
      }
    });
  }

  /** Changes the map's own background, line thickness or typeface. */
  setMapStyle(patch: MapStylePatch, live = false): void {
    this.editor.commit();
    const doc = this.doc;
    const next: Record<string, unknown> = { ...doc.style };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    doc.run('Map style', () => doc.setStyle(next as MapStyle), live ? { merge: 'look:' + Object.keys(patch).join(), within: 2500 } : {});
  }

  setLayout(kind: LayoutKind): void {
    this.editor.commit();
    this.doc.run('Structure', () => this.doc.setMeta('layout', kind));
  }

  /** Gives the selected branches a structure of their own; `undefined` follows the rest of the map again. */
  setBranchStructure(kind: LayoutKind | undefined): void {
    this.editor.commit();
    const doc = this.doc;
    const nodes = this.sel.filter((n) => n !== doc.root);
    if (!nodes.length || kind === 'map') return;
    doc.run('Branch structure', () => {
      for (const n of nodes) doc.set(n, 'structure', kind);
    });
    if (this.primary) this.reveal(this.primary);
  }

  /** Turns the selection into to-dos; once they all are, ticks them (or unticks them when all are done). */
  cycleTodo(): void {
    const doc = this.doc;
    const nodes = this.sel;
    if (!nodes.length) return;
    const plain = nodes.some((n) => n.todo === undefined);
    const done = !nodes.every((n) => n.todo === true);
    doc.run('To-do', () => {
      for (const n of nodes) {
        if (!plain) doc.set(n, 'todo', done);
        else if (n.todo === undefined) doc.set(n, 'todo', false);
      }
    });
  }

  /** Sets the to-do state of topics: open, done, or `undefined` for "not a to-do". */
  setTodo(state: boolean | undefined, nodes: readonly MNode[] = this.sel): void {
    const doc = this.doc;
    if (!nodes.length) return;
    doc.run('To-do', () => {
      for (const n of nodes) doc.set(n, 'todo', state);
    });
  }

  /** Sets the labels of the selection from a comma-separated list. */
  setLabels(text: string): void {
    const doc = this.doc;
    const nodes = this.sel;
    if (!nodes.length) return;
    const labels = cleanLabels(text.split(/[,、，\n]/));
    const same = (a: string[] | undefined): boolean => (a ?? []).join('\n') === (labels ?? []).join('\n');
    if (nodes.every((n) => same(n.labels))) return;
    doc.run('Labels', () => {
      for (const n of nodes) if (!same(n.labels)) doc.set(n, 'labels', labels ? labels.slice() : undefined);
    });
  }

  /** Puts a frame around the selected branches, or removes it when they all have one. */
  toggleBoundary(): void {
    this.editor.commit();
    const doc = this.doc;
    const nodes = topLevel(this.sel).filter((n) => n !== doc.root);
    if (!nodes.length) return;
    const all = nodes.every((n) => n.boundary !== undefined);
    doc.run('Boundary', () => {
      for (const n of nodes) {
        if (all) doc.set(n, 'boundary', undefined);
        else if (n.boundary === undefined) doc.set(n, 'boundary', '');
      }
    });
    if (this.primary) this.reveal(this.primary);
  }

  setBoundaryTitle(node: MNode, title: string): void {
    const doc = this.doc;
    if (node.boundary === undefined) return;
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    doc.run('Boundary title', () => doc.set(node, 'boundary', clean), { merge: 'frame:' + node.id, within: 4000 });
  }

  /**
   * Adds a summary topic for the selected topics: neighbours under one parent
   * (and, in a mind map, on one side of the central topic).
   */
  addSummary(): void {
    this.editor.commit();
    const doc = this.doc;
    const root = doc.root;
    const picked = inDocOrder(root, topLevel(this.sel)).filter((n) => n !== this.vroot && this.isVisible(n));
    if (!picked.length) return;
    // Already summed up: go to that summary rather than stacking another one.
    const covered = picked.find((n) => n.cover !== null);
    if (covered && covered.cover) {
      this.select([covered.cover], true);
      return;
    }
    const parent = picked[0].parent!;
    const kids = parent.children;
    const a = kids.indexOf(picked[0]);
    const z = kids.indexOf(picked[picked.length - 1]);
    let ok = picked.every((n) => n.parent === parent) && summarizes(parent.cdir);
    // Everything from the first to the last selected topic is summed up.
    for (let i = a; ok && i <= z; i++) ok = kids[i].sum === undefined && kids[i].cover === null && kids[i].dir === kids[a].dir;
    if (!ok) {
      this.notify('noSummaryHere');
      return;
    }
    const last = kids[z];
    const node = new MNode('');
    node.sum = z - a + 1;
    doc.run(
      'Summary',
      () => {
        doc.insert(node, parent, z + 1);
        if (parent === root) {
          doc.set(node, 'side', last.side);
          doc.set(node, 'color', nextColor(root, this.theme.palette.length, last, node));
        }
        this.setSelection([node]);
      },
      { merge: 'new:' + node.id },
    );
    this.editor.begin(node, 'all', true);
  }

  // ------------------------------------------------------------ relationships

  /**
   * Connects two selected topics, or — with one selected — starts drawing a
   * relationship that the next click on a topic completes.
   */
  startRelationship(): void {
    this.editor.commit();
    if (this.connect) {
      this.cancelConnect();
      return;
    }
    const picked = this.sel.filter((n) => this.isVisible(n));
    if (picked.length === 2) {
      this.addRelationship(picked[0], picked[1]);
      return;
    }
    const from = this.primary;
    if (!from || !this.isVisible(from)) return;
    this.connect = { from, wx: from.ax + from.w / 2, wy: from.ay + from.h / 2 };
    this.view.canvas.style.cursor = 'crosshair';
    this.requestRender();
    this.emit('mode');
  }

  updateConnect(wx: number, wy: number): void {
    if (!this.connect) return;
    this.connect.wx = wx;
    this.connect.wy = wy;
    this.requestRender();
  }

  /** Ends drawing a relationship; `to` is the topic that was clicked, if any. */
  finishConnect(to: MNode | null): void {
    const c = this.connect;
    if (!c) return;
    this.connect = null;
    this.view.canvas.style.cursor = '';
    this.requestRender();
    this.emit('mode');
    if (to && to !== c.from) this.addRelationship(c.from, to);
  }

  cancelConnect(): void {
    this.finishConnect(null);
  }

  /** Adds (or finds) the relationship from one topic to another and selects it. */
  addRelationship(from: MNode, to: MNode): Rel | null {
    if (from === to) return null;
    const doc = this.doc;
    let rel = doc.rels.find((r) => r.from === from && r.to === to) ?? null;
    if (!rel) {
      const created = new Rel(from, to);
      doc.run('Relationship', () => doc.addRel(created));
      rel = created;
    }
    this.selectRel(rel);
    return rel;
  }

  setRelText(rel: Rel, text: string): void {
    const doc = this.doc;
    let id = this.relIds.get(rel);
    if (id === undefined) this.relIds.set(rel, (id = ++this.relSeq));
    const clean = text.replace(/\s+/g, ' ').slice(0, MAX_TITLE);
    doc.run('Relationship text', () => doc.setRel(rel, 'text', clean), { merge: 'rel:' + id, within: 4000 });
    this.requestRender();
  }

  reverseRel(rel: Rel): void {
    const doc = this.doc;
    const { from, to } = rel;
    if (doc.rels.some((r) => r !== rel && r.from === to && r.to === from)) return;
    doc.run('Reverse relationship', () => {
      doc.setRel(rel, 'from', to);
      doc.setRel(rel, 'to', from);
      // The bend is measured to the left of the direction, which has just turned around.
      if (rel.bend !== undefined) doc.setRel(rel, 'bend', -rel.bend);
    });
  }

  /**
   * Bends a relationship so that its middle runs through the point (dragging the line).
   * @param grab identifies one drag, so that all of its steps make a single undo step
   */
  bendRel(rel: Rel, wx: number, wy: number, grab: number): void {
    const a = rel.from;
    const b = rel.to;
    if (!this.isVisible(a) || !this.isVisible(b)) return;
    const ax = a.ax + a.w / 2;
    const ay = a.ay + a.h / 2;
    const dx = b.ax + b.w / 2 - ax;
    const dy = b.ay + b.h / 2 - ay;
    const dist = Math.hypot(dx, dy) || 1;
    // Distance of the point from the straight line between the two topics; the
    // middle of the curve lies at three quarters of the control points' offset.
    const off = ((wx - ax) * -dy + (wy - ay) * dx) / dist;
    const bend = clamp(Math.round(off / 0.75), -MAX_BEND, MAX_BEND);
    const doc = this.doc;
    doc.run('Bend relationship', () => doc.setRel(rel, 'bend', Math.abs(bend) < 5 ? 0 : bend), { merge: 'bend:' + grab });
    this.requestRender();
  }

  // -------------------------------------------------------------- topic style

  /**
   * Gives every selected topic the style that `change` makes of its current one.
   * @param merge names a change that arrives in many steps (a color being picked): they fold into one undo step
   */
  private restyle(label: string, change: (st: TopicStyle, n: MNode) => TopicStyle | undefined, merge?: string): void {
    const doc = this.doc;
    const nodes = this.sel;
    if (!nodes.length) return;
    const opts = merge ? { merge: merge + ':' + nodes.map((n) => n.id).join(','), within: 2500 } : {};
    doc.run(
      label,
      () => {
        for (const n of nodes) {
          const next = cleanStyle(change({ ...n.style }, n));
          if (JSON.stringify(next) !== JSON.stringify(n.style)) doc.set(n, 'style', next);
        }
      },
      opts,
    );
  }

  /** Sets (or, with `null`, clears) properties of the selected topics' style. */
  patchStyle(patch: StylePatch, live = false): void {
    this.restyle(
      'Style',
      (st) => {
        const next: Record<string, unknown> = { ...st };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === undefined) delete next[k];
          else next[k] = v;
        }
        return next as TopicStyle;
      },
      live ? 'style:' + Object.keys(patch).join() : undefined,
    );
  }

  /** Whether a topic's text is heavy, by its own style or by its level. */
  isBold(n: MNode): boolean {
    return n.style?.bold ?? LEVELS[n.lv].font.weight >= 600;
  }

  toggleBold(): void {
    const want = !this.sel.every((n) => this.isBold(n));
    this.restyle('Bold', (st, n) => {
      // Only a weight that differs from the level's is worth recording.
      if (want === LEVELS[n.lv].font.weight >= 600) delete st.bold;
      else st.bold = want;
      return st;
    });
  }

  toggleFlag(key: 'italic' | 'strike'): void {
    const on = this.sel.every((n) => n.style?.[key] === true);
    this.restyle(key === 'italic' ? 'Italic' : 'Strikethrough', (st) => {
      if (on) delete st[key];
      else st[key] = true;
      return st;
    });
  }

  /** Font size of a topic, by its own style or by its level. */
  fontSize(n: MNode): number {
    return n.style?.size ?? LEVELS[n.lv].font.size;
  }

  /** Makes the text of the selected topics larger or smaller (`null`: the size of their level again). */
  stepFontSize(delta: number | null): void {
    this.restyle(
      'Font size',
      (st, n) => {
        const base = LEVELS[n.lv].font.size;
        const size = delta === null ? base : clamp(Math.round((st.size ?? base) + delta), MIN_SIZE, MAX_SIZE);
        if (size === base) delete st.size;
        else st.size = size;
        return st;
      },
      delta === null ? undefined : 'size',
    );
  }

  /** True when every selected topic carries the quick style. */
  hasQuickStyle(kind: 'important' | 'crossed'): boolean {
    const nodes = this.sel;
    if (!nodes.length) return false;
    if (kind === 'crossed') return nodes.every((n) => n.style?.strike === true);
    return nodes.every((n) => n.style?.fill === IMPORTANT.fill && n.style?.bold === true);
  }

  /**
   * Quick styles, switched on and off like a marker: "important" is a red box with
   * heavy white text, "crossed" strikes the text through and lets the topic step back.
   */
  quickStyle(kind: 'important' | 'crossed'): void {
    const nodes = this.sel;
    if (!nodes.length) return;
    const theme = this.theme;
    const on = this.hasQuickStyle(kind);
    if (kind === 'important') {
      this.restyle('Quick style', (st) => {
        if (!on) return { ...st, ...IMPORTANT };
        delete st.fill;
        delete st.color;
        delete st.bold;
        return st;
      });
      return;
    }
    const pale = mix(theme.bg, theme.text, 0.1);
    this.restyle('Quick style', (st, n) => {
      if (on) {
        delete st.strike;
        delete st.color;
        if (st.fill === pale) delete st.fill;
        return st;
      }
      // Gray text would not read on a strongly colored box: that turns pale as well.
      const fill = nodeStyle(theme, n.lv, n.branch, n.box, st).fill;
      if (fill !== null && contrast(fill, theme.muted) < 2.2) st.fill = pale;
      st.strike = true;
      st.color = theme.muted;
      return st;
    });
  }

  /** Back to what the theme says (the width of the topics stays). */
  resetStyle(): void {
    this.restyle('Reset style', () => undefined);
  }

  copyStyle(): void {
    const n = this.primary;
    if (!n) return;
    this.styleClip = { style: n.style ? { ...n.style } : undefined };
    this.notify('styleCopied');
  }

  get canPasteStyle(): boolean {
    return this.styleClip !== null;
  }

  pasteStyle(): void {
    const clip = this.styleClip;
    if (clip) this.restyle('Paste style', () => (clip.style ? { ...clip.style } : undefined));
  }

  /** Gives every topic of the same level in the map the style of the selected one. */
  applyStyleToLevel(): void {
    const src = this.primary;
    if (!src) return;
    const doc = this.doc;
    let level = 0;
    for (let p = src.parent; p; p = p.parent) level++;
    const style = JSON.stringify(src.style);
    const visit = (n: MNode, depth: number): void => {
      if (depth < level) for (const k of n.children) visit(k, depth + 1);
      else if (n !== src && JSON.stringify(n.style) !== style) doc.set(n, 'style', src.style ? { ...src.style } : undefined);
    };
    doc.run('Style of the level', () => visit(doc.root, 0));
  }

  // ------------------------------------------------------------- topic width

  /** Sets the width of the selected topics' text; `undefined` sizes them to their text again. */
  setWidth(width: number | undefined): void {
    const doc = this.doc;
    const nodes = this.sel;
    if (!nodes.length) return;
    const w = width === undefined ? undefined : cleanWidth(width);
    doc.run('Width', () => {
      for (const n of nodes) doc.set(n, 'width', w);
    });
  }

  get resizing(): boolean {
    return this.resize !== null;
  }

  /**
   * Starts changing the width of `node` (and of everything selected with it) by
   * dragging its left (-1) or right (1) edge; `wx` is where the pointer went down.
   */
  beginResize(node: MNode, edge: -1 | 1, wx: number): void {
    this.editor.commit();
    if (!this.isVisible(node)) return;
    const edgeX = (): number => (edge > 0 ? node.x + node.w : node.x);
    const w0 = node.tw;
    const e0 = edgeX();
    // How far the edge moves per unit of width depends on the structure (a centered
    // topic grows to both sides) and on the shape. Find out by trying.
    const saved = node.width;
    const probe = 48;
    node.width = w0 + probe;
    node.ver++;
    this.relayout(false);
    let slope = (edgeX() - e0) / probe;
    node.width = saved;
    node.ver++;
    this.relayout(false);
    // The edge that stays where it is (its connector arrives there) widens the topic like the other one.
    if (Math.abs(slope) < 0.05) slope = edge;
    const nodes = this.selSet.has(node) ? this.sel.slice() : [node];
    this.resize = { node, nodes, edge, w0, e0, slope, offset: wx - e0, key: 'width:' + ++this.resizeSeq };
    this.requestRender();
  }

  updateResize(wx: number): void {
    const r = this.resize;
    if (!r) return;
    const width = cleanWidth(r.w0 + (wx - r.offset - r.e0) / r.slope);
    const doc = this.doc;
    doc.run(
      'Width',
      () => {
        for (const n of r.nodes) doc.set(n, 'width', width);
      },
      { merge: r.key },
    );
  }

  endResize(): void {
    if (!this.resize) return;
    this.resize = null;
    this.requestRender();
  }

  // ------------------------------------------------------- branch only / filter

  /** Shows only the branch of `node` (null: the whole map again). */
  setFocus(node: MNode | null): void {
    this.editor.commit();
    const root = this.doc.root;
    const target = node && node !== root && isAttached(node, root) ? node : null;
    const was = this.focus;
    if (target === was) return;
    this.focus = target;
    this.connect = null;
    this.hover = null;
    this.relayout(false);
    this.setSelection([target ?? was ?? root]);
    this.pruneSelection();
    this.fit(false);
    this.emit('mode');
  }

  toggleFocus(): void {
    if (this.focus) this.setFocus(null);
    else if (this.primary) this.setFocus(this.primary);
  }

  setFilter(f: Filter | null): void {
    this.filter = f && (f.markers.size || f.labels.size || f.todo.size) ? f : null;
    this.refreshFilter();
    this.requestRender();
    this.emit('mode');
  }

  /** Adds or removes one criterion of the filter. */
  toggleFilter(kind: keyof Filter, value: string): void {
    const cur = this.filter;
    const next: Filter = {
      markers: new Set(cur?.markers),
      labels: new Set(cur?.labels),
      todo: new Set(cur?.todo),
    };
    const set = next[kind] as Set<string>;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.setFilter(next);
  }

  private refreshFilter(): void {
    const f = this.filter;
    if (!f) {
      this.keep = null;
      this.filterCount = 0;
      return;
    }
    const keep = new Set<MNode>();
    let count = 0;
    walk(this.doc.root, (n) => {
      const hit =
        (n.markers !== undefined && n.markers.some((m) => f.markers.has(m))) ||
        (n.labels !== undefined && n.labels.some((l) => f.labels.has(l))) ||
        (n.todo !== undefined && f.todo.has(n.todo ? 'done' : 'open'));
      if (!hit) return;
      count++;
      keep.add(n);
      // A match inside a folded branch keeps the folded topic lit, so that it can be found.
      for (let p = n.parent; p; p = p.parent) if (p.folded) keep.add(p);
    });
    this.keep = keep;
    this.filterCount = count;
  }

  /** Everything the map could be filtered by: the markers, labels and to-do states in use. */
  facets(): { markers: string[]; labels: string[]; open: number; done: number } {
    const markers = new Set<string>();
    const labels = new Set<string>();
    let open = 0;
    let done = 0;
    walk(this.doc.root, (n) => {
      if (n.markers) for (const m of n.markers) markers.add(m);
      if (n.labels) for (const l of n.labels) labels.add(l);
      if (n.todo === true) done++;
      else if (n.todo === false) open++;
    });
    return { markers: [...markers], labels: [...labels].sort((a, b) => a.localeCompare(b)), open, done };
  }

  // --------------------------------------------------------------- clipboard

  /** Remembers the selection as rich data and returns its plain-text form. */
  copySelection(): string | null {
    const root = this.doc.root;
    const nodes = inDocOrder(root, topLevel(this.sel));
    if (!nodes.length) return null;
    const data = nodes.map(cloneForPaste);
    const text = toOutline(data);
    this.clip = { text, data };
    return text;
  }

  /** Pastes clipboard text; our own copies keep their notes, markers etc. */
  paste(text: string): void {
    const norm = text.replace(/\r\n?/g, '\n');
    if (this.clip && this.clip.text.trim() === norm.trim()) this.pasteData(this.clip.data);
    else if (norm.trim()) this.pasteData(parseOutline(norm));
  }

  pasteData(data: readonly NodeData[]): void {
    this.editor.commit();
    if (!data.length) return;
    const doc = this.doc;
    const root = doc.root;
    const parent = this.primary ?? root;
    const added: MNode[] = [];
    doc.run('Paste', () => {
      for (const d of data) {
        const node = fromData(d);
        doc.insert(node, parent);
        this.settle(node, parent, undefined, parent.children[parent.children.length - 2] ?? null, false, true);
        added.push(node);
      }
      this.setSelection(added);
    });
    if (added.length) this.reveal(added[added.length - 1]);
  }

  private clipboardCommand(kind: 'copy' | 'cut'): void {
    this.editor.commit();
    this.editor.focus();
    // Fires our own copy / cut handlers, which fill the system clipboard.
    if (!document.execCommand(kind)) {
      const text = this.copySelection();
      if (text !== null) {
        void navigator.clipboard?.writeText(text).catch(() => {});
        if (kind === 'cut') this.deleteSelection();
      }
    }
  }

  private async pasteFromSystem(): Promise<void> {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null; // no permission: fall back to what was copied inside the app
    }
    if (text !== null && text.trim()) this.paste(text);
    else if (this.clip) this.pasteData(this.clip.data);
  }

  // --------------------------------------------------------------- navigation

  navigate(arrow: Arrow): void {
    const root = this.vroot;
    const n = this.primary;
    if (!n || !this.isVisible(n)) {
      this.select([root], true);
      return;
    }
    const vertical = arrow === 'up' || arrow === 'down';
    const rule = navRule(n);
    const intoKids = childArrows(n.cdir).includes(arrow);
    let next: MNode | null = null;

    if (n === root) {
      if (root.cdir === A_BOTH) {
        const side = arrow === 'left' ? A_LEFT : A_RIGHT;
        if (!vertical)
          next = this.nearestChild(
            root,
            root.children.filter((k) => k.dir === side && k.sumN === 0),
          );
      } else if (intoKids)
        next = this.nearestChild(
          root,
          root.children.filter((k) => k.sumN === 0),
        );
    } else if (n.sumN > 0) {
      // A summary topic: back to the topics it sums up, on past them, or into its own branch.
      const q = n.parent!;
      const members = q.children.slice(n.idx - n.sumN, n.idx);
      if (arrow === rule.parent) {
        const across = isRow(n.dir)
          ? (k: MNode): number => k.x + k.w / 2 - (n.x + n.w / 2)
          : (k: MNode): number => k.y + k.h / 2 - (n.y + n.h / 2);
        next = members.reduce((best, k) => (Math.abs(across(k)) < Math.abs(across(best)) ? k : best));
      } else if (arrow === rule.prev || arrow === rule.next) {
        const g = this.group(members[0]);
        next = (arrow === rule.prev ? g[g.indexOf(members[0]) - 1] : g[g.indexOf(members[members.length - 1]) + 1]) ?? null;
      } else if (intoKids && n.children.length) {
        if (n.folded) {
          this.toggleCollapse([n]);
          return;
        }
        next = this.nearestChild(n, n.children);
      }
    } else if (arrow === rule.parent) next = n.parent;
    else if (rule.rows && vertical) next = this.spatial(n, arrow, false);
    else if (arrow === rule.prev || arrow === rule.next) {
      const g = this.group(n);
      next = g[g.indexOf(n) + (arrow === rule.prev ? -1 : 1)] ?? null;
      if (!next) {
        // Past the last sibling: on to the parent if it lies that way, else to the neighbouring branch.
        const q = n.parent!;
        const along = vertical ? q.y + q.h / 2 - (n.y + n.h / 2) : q.x + q.w / 2 - (n.x + n.w / 2);
        const towards = (arrow === 'right' || arrow === 'down' ? along : -along) > (vertical ? n.h : n.w) / 2;
        next = towards ? q : this.spatial(n, arrow, true);
      }
    } else if (intoKids && n.children.length) {
      if (n.folded) {
        this.toggleCollapse([n]);
        return;
      }
      next = this.nearestChild(
        n,
        n.children.filter((k) => k.sumN === 0),
      );
    }
    if (!next && n !== root && n.sumN === 0 && (n.folded || !n.children.length)) {
      // At the tip of a branch that is summed up, the summary topic is what lies ahead.
      for (let a: MNode = n; a !== root && a.parent; a = a.parent) {
        const r = navRule(a);
        if (a.cover && r.parent && arrow === opposite(r.parent)) {
          next = a.cover;
          break;
        }
      }
    }
    if (next) this.select([next], true);
  }

  /** The child a parent's "into the children" arrow lands on. */
  private nearestChild(n: MNode, kids: readonly MNode[]): MNode | null {
    const c = n.cdir;
    // Along an axis, a spine or a list the first topic is the natural entry point.
    if (isSpine(c) || isTree(c) || c === A_AXIS_H || c === A_AXIS_V) return kids[0] ?? null;
    // Otherwise the one straight ahead: closest across the direction of travel.
    const across = isRow(c) ? (k: MNode): number => k.x + k.w / 2 - (n.x + n.w / 2) : (k: MNode): number => k.y + k.h / 2 - (n.y + n.h / 2);
    let best: MNode | null = null;
    let bd = Infinity;
    for (const k of kids) {
      const d = Math.abs(across(k));
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /**
   * The closest visible topic in the direction of `arrow`.
   * @param peer only consider topics placed the same way as `n` (a neighbouring branch), preferring its level
   */
  private spatial(n: MNode, arrow: Arrow, peer: boolean): MNode | null {
    const horizontal = arrow === 'left' || arrow === 'right';
    const sign = arrow === 'right' || arrow === 'down' ? 1 : -1;
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    let best: MNode | null = null;
    let bd = Infinity;
    const top = this.vroot;
    walkVisible(top, (m) => {
      if (m === n || (peer && (m.dir !== n.dir || m === top))) return;
      const mx = m.x + m.w / 2;
      const my = m.y + m.h / 2;
      const along = (horizontal ? mx - cx : my - cy) * sign;
      if (along <= 0.5) return;
      // Boxes that overlap across the direction of travel count as perfectly aligned.
      const gap = horizontal
        ? Math.max(0, Math.max(n.y, m.y) - Math.min(n.y + n.h, m.y + m.h))
        : Math.max(0, Math.max(n.x, m.x) - Math.min(n.x + n.w, m.x + m.w));
      const off = horizontal ? Math.abs(my - cy) : Math.abs(mx - cx);
      const score = along + gap * 3 + off * 0.3 + (peer && m.depth !== n.depth ? 40 : 0);
      if (score < bd) {
        bd = score;
        best = m;
      }
    });
    return best;
  }

  // ------------------------------------------------------------ drag and drop

  get dragging(): boolean {
    return this.drag !== null;
  }

  beginDrag(lead: MNode, wx: number, wy: number): boolean {
    const root = this.doc.root;
    const top = this.vroot;
    if (lead === top || !this.selSet.has(lead)) return false;
    const nodes = inDocOrder(root, topLevel(this.sel)).filter((n) => n !== top);
    if (!nodes.length) return false;
    this.editor.commit();
    this.drag = { nodes, set: new Set(nodes), lead, gx: wx - lead.ax, gy: wy - lead.ay, wx, wy, sx: 0, sy: 0, target: null };
    this.hover = null;
    return true;
  }

  updateDrag(sx: number, sy: number): void {
    const d = this.drag;
    if (!d) return;
    d.sx = sx;
    d.sy = sy;
    d.wx = this.view.wx(sx);
    d.wy = this.view.wy(sy);
    d.target = this.computeDrop(d.wx, d.wy);
    this.requestRender();
  }

  endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const t = d.target;
    if (commit && t && !t.noop) {
      this.doc.run('Move', () => {
        for (const n of d.nodes) this.moveInto(n, t.parent, t.before, t.side);
      });
      if (this.primary) this.reveal(this.primary);
    }
    this.requestRender();
  }

  /** Scrolls while a drag hovers near the edge of the canvas. */
  private autoScroll(): boolean {
    const d = this.drag!;
    const v = this.view;
    const zone = 44;
    const speed = (dist: number): number => Math.round(Math.min(1, (zone - dist) / zone) * 16);
    let dx = 0;
    let dy = 0;
    if (d.sx < zone) dx = speed(d.sx);
    else if (d.sx > v.width - zone) dx = -speed(v.width - d.sx);
    if (d.sy < zone + this.insets.top) dy = speed(d.sy - this.insets.top);
    else if (d.sy > v.height - zone) dy = -speed(v.height - d.sy);
    if (!dx && !dy) return false;
    v.panX += dx;
    v.panY += dy;
    d.wx = v.wx(d.sx);
    d.wy = v.wy(d.sy);
    d.target = this.computeDrop(d.wx, d.wy);
    return true;
  }

  /** True when the pointer is where the children of `t` are (or would be) laid out. */
  private inChildZone(t: MNode, wx: number, wy: number, dx: number, dy: number): boolean {
    const c = t.cdir;
    switch (c) {
      case A_RIGHT:
        return wx > t.ax + t.w && dx >= dy;
      case A_LEFT:
        return wx < t.ax && dx >= dy;
      case A_DOWN:
        return wy > t.ay + t.h && dy >= dx;
      case A_UP:
        return wy < t.ay && dy >= dx;
    }
    // The ribs of a fishbone topic hang between the topic and the spine.
    if (isRibs(c) && isSpine(t.dir)) return (aboveSpine(t) ? wy > t.ay + t.h : wy < t.ay) && dy >= dx * 0.6;
    if (isTree(c) && !isTree(t.dir)) {
      // A topic that heads a list (but is not a row of one): under it and past its trunk.
      const indent = treeIndent(t.lv, t.ul) * 0.6;
      const past = c > 0 ? wx > t.ax + indent : wx < t.ax + t.w - indent;
      return past && dy > 0 && (c === A_TREE_DR || c === A_TREE_DL ? wy > t.ay + t.h : wy < t.ay);
    }
    return false;
  }

  private computeDrop(wx: number, wy: number): DropTarget | null {
    const d = this.drag!;
    const root = this.vroot;
    /** Height of the spine that the main topics of fishbone `owner` hang on. */
    const spineOf = (owner: MNode): number => owner.ay + owner.h / 2;

    const boxDist = (n: MNode): [number, number] => [
      wx < n.ax ? n.ax - wx : wx > n.ax + n.w ? wx - n.ax - n.w : 0,
      wy < n.ay ? n.ay - wy : wy > n.ay + n.h ? wy - n.ay - n.h : 0,
    ];
    if (d.nodes.length === 1 && d.lead.sumN > 0) {
      // A summary topic only stops being one when it is clearly dragged away.
      const [lx, ly] = boxDist(d.lead);
      if (Math.max(lx, ly) < 16) return null;
    }
    let t: MNode | null = null;
    let best = Infinity;
    const visit = (n: MNode): void => {
      if (d.set.has(n)) return; // a node cannot be dropped into itself
      const [dx, dy] = boxDist(n);
      // Topics laid out side by side claim the gaps between them, even when a list
      // hanging under one of them happens to be closer.
      const flat = isRow(n.dir) || n.dir === A_AXIS_H || isSpine(n.dir);
      const dist = !flat ? Math.hypot(dx, dy) : dy === 0 ? dx * 0.3 : Math.hypot(dx * 0.6, dy * 1.5);
      if (dist < best) {
        best = dist;
        t = n;
      }
      if (!n.folded) for (const k of n.children) visit(k);
    };
    visit(root);
    const nearest = t as MNode | null;
    if (!nearest || best > 900) return null;
    let target: MNode = nearest;

    // Sibling order along an arrangement, for a point and for a topic. Bones are
    // ordered by where they leave the spine of `owner`, so points are projected along them.
    const keyAt = (a: number, x: number, y: number, owner: MNode): number => {
      if (!isSpine(a)) return orderKey(a, x, y);
      const s = a > 0 ? 1 : -1;
      return s * (x - s * Math.abs(y - spineOf(owner)) * BONE_COT);
    };
    const keyOf = (a: number, n: MNode): number => {
      if (isSpine(a)) {
        const [bx, by] = boneAnchor(n);
        return keyAt(a, bx, by, n.parent!);
      }
      return keyAt(a, n.ax + n.w / 2, n.ay + n.h / 2, n.parent!);
    };

    const [dx, dy] = boxDist(target);
    const inside = best === 0;
    // Next to a summary topic there is no place among its siblings: it takes the drop itself.
    let asChild = target === root || inside || target.sumN > 0 || this.inChildZone(target, wx, wy, dx, dy);
    if (!inside && (isSpine(root.cdir) || isAxis(root.cdir)) && root.children.length && !root.folded) {
      // Dropped on the axis of a timeline or the spine of a fishbone: a main topic at that spot.
      const off = root.cdir === A_AXIS_V ? wx - (root.ax + root.w / 2) : wy - spineOf(root);
      if (Math.abs(off) <= 12) {
        target = root;
        asChild = true;
      }
    }
    if (inside && target !== root && isTree(target.dir)) {
      // Rows of a list sit close together: the middle of a row means "into it", its edges "next to it".
      const rel = (wy - target.ay) / target.h;
      if (rel < 0.25 || rel > 0.75) asChild = false;
    }
    if (!asChild && isTree(target.dir) && !target.folded && target.children.some((k) => !d.set.has(k))) {
      // The gap after a row with a list under it is the top of that list.
      if (keyAt(target.dir, wx, wy, target.parent!) > keyOf(target.dir, target)) asChild = true;
    }
    if (!asChild) {
      // Tree lists: pulling the pointer back out of the indentation drops at a shallower level.
      while (target.parent && target.parent !== root && isTree(target.dir)) {
        const sibs: MNode[] = target.parent.children.filter((k) => !d.set.has(k) && k.sumN === 0);
        const after = keyAt(target.dir, wx, wy, target.parent) > keyOf(target.dir, target);
        const outdented = target.dir > 0 ? wx < target.ax - 4 : wx > target.ax + target.w + 4;
        if (!(after && outdented && sibs[sibs.length - 1] === target)) break;
        target = target.parent;
      }
    }

    let parent: MNode;
    let side: Side | undefined;
    const twoSided = root.cdir === A_BOTH;
    if (asChild) {
      parent = target;
      if (parent === root && twoSided) side = wx < root.ax + root.w / 2 ? 'l' : 'r';
    } else {
      parent = target.parent!;
      if (parent === root && twoSided) side = target.dir === A_LEFT ? 'l' : 'r';
    }
    // Candidate siblings: same parent, same side, not being dragged. A summary topic
    // stands beside its siblings, so it is never a place in their order.
    const onSide = (k: MNode): boolean => side === undefined || (k.dir === A_LEFT) === (side === 'l');
    const kids = parent.folded ? [] : parent.children.filter((k) => !d.set.has(k) && k.sumN === 0 && onSide(k));
    // The arrangement that orders them.
    const arr = parent.cdir === A_BOTH ? (side === 'l' ? A_LEFT : A_RIGHT) : parent.cdir;
    const cursor = keyAt(arr, wx, wy, parent);

    let pos: number; // insertion index within `kids`
    if (asChild) {
      if (inside && target !== root) pos = kids.length;
      else {
        pos = kids.findIndex((k) => cursor < keyOf(arr, k));
        if (pos < 0) pos = kids.length;
      }
    } else pos = kids.indexOf(target) + (cursor > keyOf(arr, target) ? 1 : 0);

    let before: MNode | null = kids[pos] ?? null;
    if (!before && kids.length) {
      // Append after the last kid of this side (and after the summary that may follow it),
      // which is not necessarily the end of the array.
      const all = parent.children;
      before = all[all.indexOf(kids[kids.length - 1]) + 1] ?? null;
      while (before && (d.set.has(before) || before.sumN > 0)) before = all[all.indexOf(before) + 1] ?? null;
    } else if (!before && side === 'r') {
      // First topic on the right: it goes in front of the left-hand ones.
      before = parent.children.find((k) => !d.set.has(k)) ?? null;
    }

    // Dropping a node where it already is changes nothing.
    let noop = false;
    if (d.nodes.every((n) => n.parent === parent)) {
      const group = parent.children.filter((k) => k.sumN === 0 && onSide(k));
      const moved = d.nodes.filter((n) => group.includes(n));
      if (moved.length === d.nodes.length) {
        const result = [...kids.slice(0, pos), ...moved, ...kids.slice(pos)];
        noop = result.length === group.length && result.every((k, i) => k === group[i]);
      }
    }

    // Where to show the placeholder, and how to tie it to its new parent.
    const prev = kids[pos - 1];
    const next = kids[pos];
    const PW = 46;
    const PH = 14;
    let pill: DropTarget['pill'];
    let link: DropTarget['link'] = null;
    if (isSide(arr)) {
      const ref = next ?? prev;
      const gap = parent === root ? 58 : 36;
      const px = ref ? (arr > 0 ? ref.ax : ref.ax + ref.w) : arr > 0 ? parent.ax + parent.w + gap : parent.ax - gap;
      const py =
        prev && next ? (prev.ay + prev.h + next.ay) / 2 : prev ? prev.ay + prev.h + 14 : next ? next.ay - 14 : parent.ay + parent.h / 2;
      pill = [arr > 0 ? px : px - PW, py - PH / 2, PW, PH];
      const y0 = parent.ul ? parent.ay + parent.h : parent.ay + parent.h / 2;
      link = { kind: 'curve', x0: arr > 0 ? parent.ax + parent.w : parent.ax, y0, x1: px, y1: py };
    } else if (isRow(arr)) {
      const s = arr === A_DOWN ? 1 : -1;
      const ref = next ?? prev;
      const py = ref ? (s > 0 ? ref.ay : ref.ay + ref.h) : s > 0 ? parent.ay + parent.h + 44 : parent.ay - 44;
      const px =
        prev && next ? (prev.ax + prev.w + next.ax) / 2 : prev ? prev.ax + prev.w + 34 : next ? next.ax - 34 : parent.ax + parent.w / 2;
      pill = [px - PW / 2, s > 0 ? py : py - PH, PW, PH];
      link = { kind: 'line', x0: parent.ax + parent.w / 2, y0: s > 0 ? parent.ay + parent.h : parent.ay, x1: px, y1: py };
    } else if (isTree(arr)) {
      const sx = arr > 0 ? 1 : -1;
      const sy = arr === A_TREE_DR || arr === A_TREE_DL ? 1 : -1;
      const col = (sx > 0 ? parent.ax : parent.ax + parent.w) + sx * treeIndent(parent.lv, parent.ul);
      // A row and everything listed under it.
      const end = (k: MNode): number => (sy > 0 ? k.ay + (k.by1 - k.y) : k.ay - (k.y - k.by0));
      const start = (k: MNode): number => (sy > 0 ? k.ay : k.ay + k.h);
      const first = (sy > 0 ? parent.ay + parent.h : parent.ay) + sy * 16;
      const py = prev && next ? (end(prev) + start(next)) / 2 : prev ? end(prev) + sy * 11 : next ? start(next) - sy * 11 : first;
      pill = [sx > 0 ? col : col - PW, py - PH / 2, PW, PH];
      const [tx, ty] = childAnchor(parent);
      link = { kind: 'elbow', x0: tx, y0: ty, x1: col, y1: py };
    } else if (arr === A_AXIS_H) {
      const px =
        prev && next ? (prev.ax + prev.w + next.ax) / 2 : prev ? prev.ax + prev.w + 26 : next ? next.ax - 26 : parent.ax + parent.w + 40;
      pill = [px - PW / 2, spineOf(parent) - PH / 2, PW, PH];
    } else if (arr === A_AXIS_V) {
      const py =
        prev && next ? (prev.ay + prev.h + next.ay) / 2 : prev ? prev.ay + prev.h + 18 : next ? next.ay - 18 : parent.ay + parent.h + 30;
      pill = [parent.ax + parent.w / 2 - PW / 2, py - PH / 2, PW, PH];
    } else if (isSpine(arr)) {
      // On the spine, between the roots of the neighbouring bones.
      const s = arr > 0 ? 1 : -1;
      const rootX = (k: MNode): number => s * keyOf(arr, k);
      const head = s > 0 ? parent.ax + parent.w : parent.ax;
      const px = prev && next ? (rootX(prev) + rootX(next)) / 2 : prev ? rootX(prev) + s * 30 : next ? rootX(next) - s * 30 : head + s * 44;
      pill = [px - PW / 2, spineOf(parent) - PH / 2, PW, PH];
    } else {
      // Ribs of a fishbone topic: next to its bone, on the side of the spine.
      const s = parent.dir === A_SPINE_L ? -1 : 1;
      const [bx, by] = boneAnchor(parent);
      const py =
        prev && next
          ? (prev.ay + prev.h + next.ay) / 2
          : prev
            ? prev.ay + prev.h + 12
            : next
              ? next.ay - 12
              : by + (aboveSpine(parent) ? 18 : -18);
      const x = bx - s * Math.abs(by - py) * BONE_COT + s * RIB_GAP;
      pill = [s > 0 ? x : x - PW, py - PH / 2, PW, PH];
    }
    return { parent, before, side, noop, pill, link };
  }

  /** Selects every visible topic that intersects the marquee (world space). */
  setMarquee(rect: Bounds | null, base: readonly MNode[] = []): void {
    this.marquee = rect;
    if (rect) {
      const x0 = Math.min(rect.x0, rect.x1);
      const x1 = Math.max(rect.x0, rect.x1);
      const y0 = Math.min(rect.y0, rect.y1);
      const y1 = Math.max(rect.y0, rect.y1);
      const hits: MNode[] = [];
      walkVisible(this.vroot, (n) => {
        if (n.ax < x1 && n.ax + n.w > x0 && n.ay < y1 && n.ay + n.h > y0) hits.push(n);
      });
      this.setSelection([...base, ...hits]);
    }
    this.requestRender();
  }

  // ------------------------------------------------------------------ search

  setSearch(query: string): void {
    this.searchQuery = query;
    this.refreshSearch();
    this.goNearMatch();
  }

  setSearchOpts(o: Partial<SearchOpts>): void {
    Object.assign(this.searchOpts, o);
    this.setSearch(this.searchQuery);
  }

  /** Goes to the match at or after the current selection. */
  private goNearMatch(): void {
    if (this.matches.length) {
      const order = new Map<MNode, number>();
      let i = 0;
      walk(this.doc.root, (n) => order.set(n, i++));
      const from = this.primary ? (order.get(this.primary) ?? 0) : 0;
      const idx = this.matches.findIndex((m) => (order.get(m) ?? 0) >= from);
      this.goToMatch(idx < 0 ? 0 : idx);
    } else {
      this.matchIndex = -1;
      this.requestRender();
      this.emit('search');
    }
  }

  private refreshSearch(): void {
    const q = this.searchQuery.trim() ? this.searchQuery : '';
    const o = this.searchOpts;
    const has = (text: string | undefined): boolean => text !== undefined && occurrences(text, q, o).length > 0;
    const current = this.matchIndex >= 0 ? this.matches[this.matchIndex] : null;
    this.matches = [];
    if (q) {
      walk(this.doc.root, (n) => {
        if (has(n.text) || has(n.note) || (n.labels !== undefined && n.labels.some(has))) this.matches.push(n);
      });
    }
    this.marks = this.matches.length ? new Set(this.matches) : null;
    this.matchIndex = current ? this.matches.indexOf(current) : -1;
    this.emit('search');
  }

  /**
   * Replaces the search text in the current match (its text, note and labels), or in
   * every match. Returns the number of occurrences replaced.
   */
  replace(replacement: string, all: boolean): number {
    this.editor.commit();
    const q = this.searchQuery.trim() ? this.searchQuery : '';
    const targets = all ? this.matches.slice() : this.matchIndex >= 0 ? [this.matches[this.matchIndex]] : [];
    if (!q || !targets.length) return 0;
    const o = this.searchOpts;
    let count = 0;
    const sub = (text: string): string => {
      const occ = occurrences(text, q, o);
      if (!occ.length) return text;
      count += occ.length;
      let out = '';
      let at = 0;
      for (const [i, end] of occ) {
        out += text.slice(at, i) + replacement;
        at = end;
      }
      return out + text.slice(at);
    };
    const doc = this.doc;
    doc.run(all ? 'Replace all' : 'Replace', () => {
      for (const n of targets) {
        doc.set(n, 'text', sub(n.text));
        if (n.note !== undefined) doc.set(n, 'note', sub(n.note) || undefined);
        if (n.labels) {
          const next = cleanLabels(n.labels.map(sub));
          if ((next ?? []).join('\n') !== n.labels.join('\n')) doc.set(n, 'labels', next);
        }
      }
    });
    // On to the next place where there is still something to replace.
    if (!all) this.goNearMatch();
    return count;
  }

  stepSearch(delta: 1 | -1): void {
    const n = this.matches.length;
    if (!n) return;
    this.goToMatch((this.matchIndex + delta + n) % n);
  }

  private goToMatch(index: number): void {
    const node = this.matches[index];
    if (!node) return;
    this.matchIndex = index;
    const doc = this.doc;
    // A match outside the branch on show brings the whole map back.
    if (this.focus && !isWithin(node, this.focus)) this.setFocus(null);
    const folded: MNode[] = [];
    for (let p = node.parent; p; p = p.parent) if (p.folded) folded.push(p);
    if (folded.length) {
      doc.run('Expand', () => {
        for (const p of folded) doc.set(p, 'collapsed', false);
      });
    }
    this.setSelection([node]);
    this.reveal(node);
    this.emit('search');
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.matches = [];
    this.marks = null;
    this.matchIndex = -1;
    this.requestRender();
    this.emit('search');
  }
}
