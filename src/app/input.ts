// Pointer, wheel, gesture and keyboard handling for the canvas.

import type { Bounds } from '../core/layout.ts';
import type { MNode, Rel } from '../core/model.ts';
import { isAttached } from '../core/model.ts';
import { isMac } from '../platform.ts';
import type { App, Arrow, Hit } from './app.ts';

/** What the pointer is on: a part of a topic, or a relationship. */
interface Pick {
  hit: Hit | null;
  rel: Rel | null;
}

type Mode = 'idle' | 'pan' | 'blank' | 'node' | 'rel' | 'drag' | 'width' | 'marquee' | 'pinch';

/** Shortcuts that work no matter where the keyboard focus is. Key: [Shift-]key with the platform modifier. */
const GLOBAL_KEYS: Record<string, string> = {
  s: 'save',
  'S-s': 'saveAs',
  o: 'open',
  n: 'new',
  'S-n': 'newWindow',
  f: 'search',
  'S-f': 'zen',
  '=': 'zoomIn',
  '+': 'zoomIn',
  'S-+': 'zoomIn',
  'S-=': 'zoomIn',
  '-': 'zoomOut',
  '0': 'zoomReset',
  '1': 'fit',
  i: 'togglePanel',
};

const ARROWS: Record<string, Arrow> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

export class Input {
  private app: App;
  private canvas: HTMLCanvasElement;
  private mode: Mode = 'idle';
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private moved = false;
  private hit: Hit | null = null;
  /** Clicking an already selected node narrows the selection on release. */
  private narrowTo: MNode | null = null;
  private marqueeBase: MNode[] = [];
  private marqueeStart: [number, number] = [0, 0];
  /** The relationship being bent by a drag, and a number that names this drag. */
  private bending: Rel | null = null;
  private grabs = 0;
  private suppressContextMenu = false;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private gestureZoom = 1;
  /** Commands recently run from the keyboard, to ignore the native menu echo. */
  private recent = new Map<string, number>();
  /** Commands recently run by the native menu, to ignore the key press that it also answers. */
  private menuRuns = new Map<string, number>();

  /** Opens the context menu (provided by the UI layer). */
  onContextMenu: (x: number, y: number, node: MNode | null) => void = () => {};
  /** A note / link indicator on a topic was clicked. */
  onIndicator: (node: MNode, part: 'note' | 'link', x: number, y: number) => void = () => {};
  /** The text of the selected relationship is to be edited. */
  onRelEdit: () => void = () => {};
  /** Escape was pressed with nothing left for it to cancel. */
  onIdleEscape: () => void = () => {};

  constructor(app: App) {
    this.app = app;
    const c = (this.canvas = app.view.canvas);
    // Keep the keyboard focus on the hidden text field while clicking the canvas.
    c.addEventListener('mousedown', (e) => e.preventDefault());
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('pointerleave', () => {
      if (this.mode === 'idle') app.setHover(null);
    });
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('contextmenu', this.onContext);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari / WKWebView report trackpad pinches as gesture events.
    c.addEventListener('gesturestart', this.onGesture as EventListener);
    c.addEventListener('gesturechange', this.onGesture as EventListener);
    c.addEventListener('gestureend', this.onGesture as EventListener);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('focus', () => {
      const a = document.activeElement;
      if (!app.blockKeys && (!a || a === document.body)) app.editor.focus();
    });
  }

  /** True when `id` was just triggered from the keyboard (within 300 ms). */
  wasRecent(id: string): boolean {
    const t = this.recent.get(id);
    return t !== undefined && performance.now() - t < 300;
  }

  /** The native menu is about to run `id` (it may be answering the very key press the page sees too). */
  ranFromMenu(id: string): void {
    this.menuRuns.set(id, performance.now());
  }

  private run(id: string): void {
    const now = performance.now();
    const byMenu = this.menuRuns.get(id);
    if (byMenu !== undefined && now - byMenu < 300) return;
    this.recent.set(id, now);
    this.app.exec(id);
  }

  private pos(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** The text of a relationship lies on top of the topics, its line below them. */
  private pick(wx: number, wy: number): Pick {
    const app = this.app;
    const text = app.hitRel(wx, wy, true);
    if (text) return { hit: null, rel: text };
    const hit = app.hitTest(wx, wy);
    return { hit, rel: hit ? null : app.hitRel(wx, wy) };
  }

  // ----------------------------------------------------------------- pointer

  private onDown = (e: PointerEvent): void => {
    const app = this.app;
    const [sx, sy] = this.pos(e);
    if (app.editor.state) app.editor.commit();
    app.editor.focus();
    app.cancelViewAnim();

    if (app.connect && e.button === 0) {
      // Drawing a relationship: this click names its other end (or, on empty canvas, gives up).
      const hit = app.hitTest(app.view.wx(sx), app.view.wy(sy));
      app.finishConnect(hit ? hit.node : null);
      return;
    }
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: sx, y: sy });
      if (this.touches.size === 2) {
        if (this.mode === 'drag') app.endDrag(false);
        app.setMarquee(null);
        const [a, b] = [...this.touches.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.mode = 'pinch';
        return;
      }
    }
    if (this.mode !== 'idle') return;

    this.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.startX = this.lastX = sx;
    this.startY = this.lastY = sy;
    this.moved = false;
    this.narrowTo = null;
    this.suppressContextMenu = false;

    if (e.button === 1 || e.button === 2) {
      this.mode = 'pan';
      return;
    }
    if (e.button !== 0) return;

    const wx = app.view.wx(sx);
    const wy = app.view.wy(sy);
    const { hit, rel } = this.pick(wx, wy);
    this.hit = hit;
    if (hit && hit.part === 'toggle') {
      app.toggleCollapse([hit.node]);
      return;
    }
    if (hit && hit.part === 'todo') {
      app.setTodo(!hit.node.todo, [hit.node]);
      return;
    }
    if (hit && hit.part === 'width') {
      // The edge of a selected topic: dragging it changes the topic's width.
      this.mode = 'width';
      return;
    }
    if (rel) {
      app.selectRel(rel);
      this.bending = rel;
      this.grabs++;
      this.mode = 'rel';
    } else if (hit) {
      const multi = isMac ? e.metaKey : e.ctrlKey;
      if (multi) app.toggleSelect(hit.node);
      else if (e.shiftKey) app.addSelect(hit.node);
      else if (!app.isSelected(hit.node)) app.select([hit.node]);
      else this.narrowTo = hit.node;
      this.mode = 'node';
    } else if (e.shiftKey) {
      this.mode = 'marquee';
      this.marqueeBase = app.sel.slice();
      this.marqueeStart = [wx, wy];
    } else {
      this.mode = 'blank';
    }
  };

  private onMove = (e: PointerEvent): void => {
    const app = this.app;
    const [sx, sy] = this.pos(e);

    if (this.mode === 'pinch') {
      const t = this.touches.get(e.pointerId);
      if (!t || this.touches.size < 2) return;
      const before = [...this.touches.values()];
      const cx0 = (before[0].x + before[1].x) / 2;
      const cy0 = (before[0].y + before[1].y) / 2;
      t.x = sx;
      t.y = sy;
      const [a, b] = [...this.touches.values()];
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      app.panBy(cx - cx0, cy - cy0);
      if (this.pinchDist > 0 && dist > 0) app.zoomAt(cx, cy, dist / this.pinchDist);
      this.pinchDist = dist;
      return;
    }
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: sx, y: sy });

    if (this.mode === 'idle') {
      if (e.pointerType !== 'touch') this.hoverAt(sx, sy);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    if (!this.moved) {
      if (Math.hypot(sx - this.startX, sy - this.startY) < 4) return;
      this.moved = true;
    }
    switch (this.mode) {
      case 'pan':
      case 'blank':
        this.suppressContextMenu = true;
        this.canvas.style.cursor = 'grabbing';
        app.panBy(sx - this.lastX, sy - this.lastY);
        break;
      case 'node': {
        const hit = this.hit;
        if (hit && app.beginDrag(hit.node, app.view.wx(this.startX), app.view.wy(this.startY))) {
          this.mode = 'drag';
          this.canvas.style.cursor = 'grabbing';
          app.updateDrag(sx, sy);
        }
        break;
      }
      case 'drag':
        app.updateDrag(sx, sy);
        break;
      case 'width': {
        const hit = this.hit;
        if (!hit) break;
        if (!app.resizing) app.beginResize(hit.node, hit.edge ?? 1, app.view.wx(this.startX));
        this.canvas.style.cursor = 'ew-resize';
        app.updateResize(app.view.wx(sx));
        break;
      }
      case 'rel':
        if (this.bending) app.bendRel(this.bending, app.view.wx(sx), app.view.wy(sy), this.grabs);
        break;
      case 'marquee': {
        const rect: Bounds = {
          x0: this.marqueeStart[0],
          y0: this.marqueeStart[1],
          x1: app.view.wx(sx),
          y1: app.view.wy(sy),
        };
        app.setMarquee(rect, this.marqueeBase);
        break;
      }
    }
    this.lastX = sx;
    this.lastY = sy;
  };

  private onUp = (e: PointerEvent): void => {
    const app = this.app;
    this.touches.delete(e.pointerId);
    if (this.mode === 'pinch') {
      if (this.touches.size < 2) this.mode = 'idle';
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    const [sx, sy] = this.pos(e);
    switch (this.mode) {
      case 'blank':
        if (!this.moved && !cancelled) app.select([]);
        break;
      case 'node':
        if (!this.moved && !cancelled && this.hit) {
          const { node, part } = this.hit;
          if (part === 'note' || part === 'link') this.onIndicator(node, part, e.clientX, e.clientY);
          else if (this.narrowTo) app.select([this.narrowTo]);
        }
        break;
      case 'drag':
        app.endDrag(!cancelled);
        break;
      case 'width':
        app.endResize();
        break;
      case 'marquee':
        app.setMarquee(null);
        break;
    }
    this.mode = 'idle';
    this.pointerId = -1;
    this.canvas.style.cursor = '';
    if (e.pointerType !== 'touch') this.hoverAt(sx, sy);
  };

  /** Updates what is under the pointer while no button is down. */
  private hoverAt(sx: number, sy: number): void {
    const app = this.app;
    const wx = app.view.wx(sx);
    const wy = app.view.wy(sy);
    app.updateConnect(wx, wy);
    if (app.connect) app.setHover(app.hitTest(wx, wy));
    else {
      const { hit, rel } = this.pick(wx, wy);
      app.setHover(hit, rel !== null);
    }
  }

  private onDoubleClick = (e: MouseEvent): void => {
    const app = this.app;
    const [sx, sy] = this.pos(e);
    const { hit, rel } = this.pick(app.view.wx(sx), app.view.wy(sy));
    if (hit && hit.part === 'body') {
      app.select([hit.node]);
      app.editor.begin(hit.node, 'all');
    } else if (hit && hit.part === 'width') {
      // A double click on the edge returns the topic to the width of its text.
      app.setWidth(undefined);
    } else if (rel) {
      app.selectRel(rel);
      this.onRelEdit();
    }
  };

  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      return;
    }
    const app = this.app;
    // On macOS the menu opens on press: forget the pan that the press started.
    if (this.mode === 'pan') {
      this.mode = 'idle';
      if (this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
      this.pointerId = -1;
    }
    const [sx, sy] = this.pos(e);
    const { hit, rel } = this.pick(app.view.wx(sx), app.view.wy(sy));
    if (hit && !app.isSelected(hit.node)) app.select([hit.node]);
    if (rel) app.selectRel(rel);
    else if (!hit && app.selRel) app.selectRel(null);
    this.onContextMenu(e.clientX, e.clientY, hit ? hit.node : null);
  };

  // ------------------------------------------------------------ wheel / pinch

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const app = this.app;
    const [sx, sy] = this.pos(e);
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? app.view.height : 1;
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinches arrive as small ctrl+wheel deltas, mouse wheels as large steps.
      const d = Math.max(-40, Math.min(40, e.deltaY * unit));
      app.zoomAt(sx, sy, Math.exp(-d * 0.0095));
    } else {
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      app.panBy(-dx, -dy);
    }
  };

  private onGesture = (e: Event & { scale?: number; clientX?: number; clientY?: number }): void => {
    e.preventDefault();
    if (e.type === 'gesturestart') this.gestureZoom = 1;
    const scale = e.scale ?? 1;
    if (e.type === 'gesturechange' && scale > 0) {
      const [sx, sy] = this.pos({ clientX: e.clientX ?? 0, clientY: e.clientY ?? 0 });
      this.app.zoomAt(sx, sy, scale / this.gestureZoom);
      this.gestureZoom = scale;
    }
  };

  // ---------------------------------------------------------------- keyboard

  private onKey = (e: KeyboardEvent): void => {
    const app = this.app;
    if (app.blockKeys > 0) return;
    const ed = app.editor;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const inField =
      !!target && target !== ed.el && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Find and replace: ⌥⌘F on the Mac (where ⌘H hides the app), Ctrl+H elsewhere.
    if (mod && (isMac ? e.altKey && e.code === 'KeyF' : !e.altKey && !e.shiftKey && key === 'h')) {
      e.preventDefault();
      if (ed.state) ed.commit();
      this.run('replace');
      return;
    }
    // Next / previous sheet: ⇧⌘] and ⇧⌘[ on the Mac, Ctrl+PageDown and Ctrl+PageUp elsewhere.
    if (mod && !e.altKey) {
      const next = isMac ? e.shiftKey && (key === '}' || key === ']') : key === 'PageDown';
      const prev = isMac ? e.shiftKey && (key === '{' || key === '[') : key === 'PageUp';
      if (next || prev) {
        e.preventDefault();
        if (ed.state) ed.commit();
        this.run(next ? 'sheet.next' : 'sheet.prev');
        return;
      }
    }
    if (mod && !e.altKey) {
      const id = GLOBAL_KEYS[(e.shiftKey ? 'S-' : '') + key];
      if (id) {
        e.preventDefault();
        if (ed.state) ed.commit();
        this.run(id);
        return;
      }
    }
    if (inField || ed.isImeKey(e)) return;
    if (ed.state) this.editKey(e, mod, key);
    else this.navKey(e, mod, key);
  };

  /** Keys while a topic's text is being edited. */
  private editKey(e: KeyboardEvent, mod: boolean, key: string): void {
    const app = this.app;
    const ed = app.editor;
    switch (key) {
      case 'Enter':
        if (e.shiftKey) return; // line break
        e.preventDefault();
        if (e.altKey) document.execCommand('insertText', false, '\n');
        else ed.commit();
        return;
      case 'Tab': {
        e.preventDefault();
        const node = ed.state!.node;
        ed.commit();
        if (!e.shiftKey && isAttached(node, app.doc.root)) app.addChild(node);
        return;
      }
      case 'Escape':
        e.preventDefault();
        ed.cancel();
        return;
    }
    if (mod && (key === 'z' || key === 'y')) {
      // Text undo, routed through one place so a native menu cannot run it twice.
      e.preventDefault();
      this.run(key === 'y' || e.shiftKey ? 'redo' : 'undo');
      return;
    }
    // The text style of the topic can change while its text is being typed.
    const id = this.styleKey(e, mod, key, true);
    if (id) {
      e.preventDefault();
      this.run(id);
    }
  }

  /**
   * The style command a key combination stands for, if any. Digits and the
   * Alt combinations are read from the physical key: what they type differs
   * between keyboard layouts (and Alt turns letters into symbols on the Mac).
   * @param textOnly only the commands that make sense while a text is being edited
   */
  private styleKey(e: KeyboardEvent, mod: boolean, key: string, textOnly: boolean): string {
    if (!mod) return '';
    if (e.altKey) {
      // AltGr (Ctrl+Alt on Windows) types characters on many layouts: leave those alone.
      if (textOnly || e.shiftKey || (!isMac && e.getModifierState('AltGraph'))) return '';
      return e.code === 'KeyC' ? 'copyStyle' : e.code === 'KeyV' ? 'pasteStyle' : '';
    }
    if (!e.shiftKey) return key === 'b' ? 'bold' : '';
    if (key === 'i') return 'italic';
    if (key === 'x') return 'strike';
    if (textOnly) return '';
    return e.code === 'Digit1' ? 'important' : e.code === 'Digit2' ? 'crossed' : '';
  }

  /** Keys while topics are selected but no text is being edited. */
  private navKey(e: KeyboardEvent, mod: boolean, key: string): void {
    const app = this.app;
    const arrow = ARROWS[key];
    if (mod) {
      let id = this.styleKey(e, mod, key, false);
      if (id) {
        e.preventDefault();
        this.run(id);
        return;
      }
      if (key === 'z') id = e.shiftKey ? 'redo' : 'undo';
      else if (key === 'y') id = 'redo';
      else if (key === 'a') id = 'selectAll';
      else if (key === 'd') id = e.shiftKey ? 'todo' : 'duplicate';
      else if (key === 'l' && e.shiftKey) id = 'relationship';
      else if (key === 'b' && e.shiftKey) id = 'boundary';
      else if (key === ';') id = 'focusBranch';
      else if (key === '/') id = 'toggleCollapse';
      else if (key === 'Backspace' || key === 'Delete') id = 'deleteSingle';
      else if (key === 'Enter') id = 'addParent';
      else if (key === 'k') id = 'editLink';
      else if (key === 'e' && e.shiftKey) id = 'editNote';
      else if (arrow) {
        e.preventDefault();
        app.shift(arrow);
        return;
      }
      if (id) {
        e.preventDefault();
        this.run(id);
      }
      return; // copy / cut / paste arrive as clipboard events
    }
    if (app.selRel && key !== 'Escape' && key !== 'Backspace' && key !== 'Delete') {
      // A relationship is selected: the keys that edit a topic edit its text instead.
      if (key === 'Enter' || key === 'F2' || key === ' ') {
        e.preventDefault();
        this.onRelEdit();
      }
      return;
    }
    if (arrow) {
      e.preventDefault();
      if (e.altKey) app.shift(arrow);
      else app.navigate(arrow);
      return;
    }
    switch (key) {
      case 'Tab':
        e.preventDefault();
        if (!e.shiftKey) this.run('addChild');
        return;
      case 'Enter':
        e.preventDefault();
        this.run(e.shiftKey ? 'addSiblingBefore' : 'addSibling');
        return;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        this.run('delete');
        return;
      case 'F2':
      case ' ':
        e.preventDefault();
        this.run('edit');
        return;
      case 'Escape':
        if (app.connect) app.cancelConnect();
        else if (app.selRel) app.selectRel(null);
        else if (app.sel.length > 1 && app.primary) app.select([app.primary]);
        else this.onIdleEscape();
        return;
    }
  }
}
