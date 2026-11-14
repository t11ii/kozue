// In-place text editing. A single <textarea> is always focused: while idle it
// is invisible and parked on the selected topic, so that typing (including
// IME composition) starts an edit right there; while editing it is styled and
// transformed to sit exactly over the topic's text on the canvas.

import type { MNode } from '../core/model.ts';
import { FONT_STACK, LEVELS, styleFor } from '../core/themes.ts';
import type { App } from './app.ts';

export type EditMode = 'replace' | 'append' | 'all';

export interface EditState {
  node: MNode;
  /** The node was just created; committing it empty removes it again. */
  isNew: boolean;
  original: string;
}

export class TextEditor {
  readonly el: HTMLTextAreaElement;
  state: EditState | null = null;
  /** Text block size of the node being edited, consumed by layout. */
  layoutEdit: { node: MNode; tw: number; th: number } | null = null;

  private app: App;
  private mirror: HTMLElement;
  private lastCompositionEnd = -1000;
  private lastTransform = '';

  constructor(app: App, el: HTMLTextAreaElement, mirror: HTMLElement) {
    this.app = app;
    this.el = el;
    this.mirror = mirror;

    el.addEventListener('input', () => this.onInput());
    el.addEventListener('compositionstart', () => {
      const n = app.primary;
      if (!this.state && n && app.isVisible(n)) this.begin(n, 'replace');
    });
    el.addEventListener('compositionend', () => {
      this.lastCompositionEnd = performance.now();
    });
    el.addEventListener('blur', () => {
      // Focus moving elsewhere in the window ends the edit. Switching to another
      // application does not: the text field is still the active element then.
      setTimeout(() => {
        if (this.state && document.activeElement !== el && document.hasFocus()) this.commit();
      }, 0);
    });
    document.addEventListener('copy', (e) => this.onCopy(e, false));
    document.addEventListener('cut', (e) => this.onCopy(e, true));
    document.addEventListener('paste', (e) => this.onPaste(e));
  }

  focus(): void {
    if (document.activeElement !== this.el) this.el.focus({ preventScroll: true });
  }

  /**
   * True for key events that belong to the IME (e.g. the Enter that confirms
   * a conversion). Safari reports those with keyCode 229 but isComposing=false.
   */
  isImeKey(e: KeyboardEvent): boolean {
    return e.isComposing || e.keyCode === 229 || performance.now() - this.lastCompositionEnd < 30;
  }

  begin(node: MNode, mode: EditMode, isNew = false): void {
    if (this.state) {
      if (this.state.node === node) return;
      this.commit();
    }
    const app = this.app;
    if (!app.isVisible(node)) return;
    const m = LEVELS[node.lv];
    const st = styleFor(app.theme, node.lv, node.branch, node.box);
    const css = `${m.font.weight} ${m.font.size}px/${m.lineHeight}px ${FONT_STACK}`;
    const el = this.el;
    el.style.font = css;
    el.style.color = st.text;
    el.style.caretColor = st.text;
    this.mirror.style.font = css;
    this.mirror.style.maxWidth = m.maxWidth + 'px';
    if (mode !== 'replace') el.value = node.text;
    el.classList.remove('idle');
    this.state = { node, isNew, original: node.text };
    this.focus();
    if (mode === 'all') el.select();
    else if (mode === 'append') el.setSelectionRange(el.value.length, el.value.length);
    this.resize();
    app.relayout(true);
    app.reveal(node);
    app.emit('edit');
  }

  /** Applies the edited text. */
  commit(): void {
    const s = this.state;
    if (!s) return;
    const text = this.el.value.replace(/\r\n?/g, '\n').trim();
    this.toIdle();
    const app = this.app;
    if (s.isNew && text === '') app.discardNew(s.node);
    else if (text !== s.original) {
      app.doc.run('Edit text', () => app.doc.set(s.node, 'text', text), s.isNew ? { merge: 'new:' + s.node.id } : {});
    } else app.relayout(true);
    app.emit('edit');
  }

  /** Abandons the edit; a node that was just created disappears again. */
  cancel(): void {
    const s = this.state;
    if (!s) return;
    this.toIdle();
    if (s.isNew) this.app.discardNew(s.node);
    else this.app.relayout(true);
    this.app.emit('edit');
  }

  /** Drops any edit state without touching the document. */
  abort(): void {
    if (this.state) this.toIdle();
    this.el.value = '';
  }

  /** Clears text typed while idle (called when the selection changes). */
  reset(): void {
    if (!this.state && this.el.value) this.el.value = '';
  }

  /** Keeps the textarea glued to its node; called once per frame. */
  sync(): void {
    const app = this.app;
    const v = app.view;
    const n = this.state ? this.state.node : app.primary;
    let tf: string;
    if (!n || !app.isVisible(n)) tf = 'translate(12px, 64px)';
    else {
      const x = Math.round(v.dpr * v.panX) / v.dpr + (n.ax + n.tx) * v.zoom;
      const y = Math.round(v.dpr * v.panY) / v.dpr + (n.ay + n.ty) * v.zoom;
      if (this.state) tf = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${v.zoom.toFixed(4)})`;
      else {
        // Parked on the selection so an IME candidate window opens in the right place.
        const cx = Math.max(0, Math.min(v.width - 30, x));
        const cy = Math.max(0, Math.min(v.height - 30, y));
        tf = `translate(${cx.toFixed(0)}px, ${cy.toFixed(0)}px)`;
      }
    }
    if (tf !== this.lastTransform) {
      this.el.style.transform = tf;
      this.lastTransform = tf;
    }
  }

  private toIdle(): void {
    const s = this.state;
    this.state = null;
    this.layoutEdit = null;
    if (s) s.node.mVer = -1; // its box was sized by the editor: measure again
    const el = this.el;
    el.value = '';
    el.classList.add('idle');
    el.style.width = '';
    el.style.height = '';
  }

  /** Sizes the textarea (and the node on the canvas) to the current text. */
  private resize(): void {
    const s = this.state;
    if (!s) return;
    const m = LEVELS[s.node.lv];
    const value = this.el.value;
    this.mirror.textContent = value + '​';
    const r = this.mirror.getBoundingClientRect();
    const wrapped = r.width >= m.maxWidth - 0.5;
    let tw = wrapped ? m.maxWidth : Math.ceil(r.width) + 1;
    if (!value) tw = Math.max(tw, 40);
    const th = Math.max(m.lineHeight, Math.round(r.height));
    this.el.style.width = (wrapped ? m.maxWidth : tw + 2) + 'px';
    this.el.style.height = th + 'px';
    this.layoutEdit = { node: s.node, tw, th };
  }

  private onInput(): void {
    const app = this.app;
    if (this.state) {
      this.resize();
      app.relayout(true);
      return;
    }
    const el = this.el;
    const n = app.primary;
    if (!n || !app.isVisible(n) || el.value === '') {
      el.value = '';
      return;
    }
    if (/^\s+$/.test(el.value)) {
      // A bare space (e.g. typed through an IME) just opens the editor.
      el.value = '';
      this.begin(n, 'append');
    } else this.begin(n, 'replace');
  }

  /** Clipboard events are ours unless a text field (or an active edit) wants them. */
  private ownsClipboard(): boolean {
    if (this.state) return false;
    const a = document.activeElement;
    return a === this.el || a === document.body || a === null;
  }

  private onCopy(e: ClipboardEvent, cut: boolean): void {
    if (!this.ownsClipboard()) return;
    const text = this.app.copySelection();
    if (text === null) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', text);
    if (cut) this.app.deleteSelection();
  }

  private onPaste(e: ClipboardEvent): void {
    if (!this.ownsClipboard()) return;
    e.preventDefault();
    this.app.paste(e.clipboardData?.getData('text/plain') ?? '');
  }
}
