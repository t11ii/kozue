// Application chrome: toolbar, zoom control, search bar, hints, popovers
// and the contents of the application / context menus.

import type { App } from '../app/app.ts';
import type { ExportKind, Files } from '../app/files.ts';
import type { Sheet } from '../core/book.ts';
import { MAX_SHEET_NAME } from '../core/book.ts';
import type { MNode } from '../core/model.ts';
import { BRANCH_KINDS, LAYOUT_KINDS } from '../core/structures.ts';
import type { MsgKey } from '../i18n.ts';
import { t } from '../i18n.ts';
import { isMac, isTauri, openExternal, setFullscreen, setWindowTitle } from '../platform.ts';
import { clear, h, keepFocus } from './dom.ts';
import { icons } from './icons.ts';
import type { MenuItem } from './menu.ts';
import { Menus, SEP, keyHint } from './menu.ts';
import type { Panel } from './panel.ts';
import { STRUCTURES } from './panel.ts';

export class Chrome {
  readonly menus: Menus;
  private app: App;
  private files: Files;
  private panel: Panel;
  private toolbar: HTMLElement;
  private host: HTMLElement;

  private menuBtn!: HTMLButtonElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private panelBtn!: HTMLButtonElement;
  private nameEl!: HTMLElement;
  private dotEl!: HTMLElement;
  private zoomLabel!: HTMLElement;
  private searchEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private replaceInput!: HTMLInputElement;
  private searchCount!: HTMLElement;
  private hintEl!: HTMLElement;
  private modeEl!: HTMLElement;
  private sheetsEl!: HTMLElement;
  private zenExit!: HTMLElement;
  /** ZEN mode: nothing but the map, on the whole screen. */
  zen = false;
  private panelWasOpen = false;
  private zenTimer = 0;
  /** What the sheet tabs show, to rebuild them only when it changes. */
  private sheetsShown = '';
  private renaming = false;
  private popover: HTMLElement | null = null;
  private floating: HTMLElement[] = [];

  /** Shows a short message (provided by the dialogs). */
  notify: (message: string) => void = () => {};

  constructor(app: App, files: Files, panel: Panel, toolbar: HTMLElement, host: HTMLElement) {
    this.app = app;
    this.files = files;
    this.panel = panel;
    this.toolbar = toolbar;
    this.host = host;
    this.menus = new Menus(app, host);
    this.build();
    app.on((what) => {
      if (what === 'doc' || what === 'edit') this.syncDoc();
      if (what === 'doc' || what === 'sheets') this.syncSheets();
      if (what === 'view') this.syncView();
      if (what === 'search') this.syncSearch();
      if (what === 'mode') this.syncModes();
      if (what === 'selection' || what === 'doc') this.closePopover();
    });
    files.onChange(() => this.syncDoc());
    // A browser leaves full screen on its own (Esc): ZEN mode ends with it.
    document.addEventListener('fullscreenchange', () => {
      if (!isTauri && this.zen && !document.fullscreenElement) this.toggleZen(false);
    });
  }

  /** Rebuilds all chrome (after a language change). */
  rebuild(): void {
    const query = this.searchInput.value;
    const replacement = this.replaceInput.value;
    const searching = this.searchEl.classList.contains('open');
    const replacing = this.searchEl.classList.contains('with-replace');
    for (const el of this.floating) el.remove();
    this.floating = [];
    this.build();
    if (searching) {
      this.searchEl.classList.add('open');
      this.searchEl.classList.toggle('with-replace', replacing);
      this.searchInput.value = query;
      this.replaceInput.value = replacement;
    }
  }

  private build(): void {
    this.buildToolbar();
    this.buildZoom();
    this.buildSearch();
    this.hintEl = h('div', { class: 'hint' }, t('hint'));
    this.float(this.hintEl);
    this.modeEl = h('div', { class: 'modebar' });
    this.float(this.modeEl);
    this.sheetsEl = h('div', { class: 'sheets' });
    this.float(this.sheetsEl);
    this.zenExit = h('button', { class: 'zen-exit' }, t('zenExit'), h('span', { class: 'zen-key' }, 'Esc'));
    keepFocus(this.zenExit);
    this.zenExit.addEventListener('click', () => this.toggleZen(false));
    this.float(this.zenExit);
    this.sheetsShown = '';
    this.renaming = false;
    this.syncDoc();
    this.syncView();
    this.syncSearch();
    this.syncModes();
    this.syncSheets();
  }

  private float(el: HTMLElement): void {
    this.host.append(el);
    this.floating.push(el);
  }

  private button(icon: string, tip: string, run: string | (() => void), cls = ''): HTMLButtonElement {
    const b = h('button', { class: 'tb-btn ' + cls, 'data-tip': tip, 'aria-label': tip, html: icon });
    keepFocus(b);
    b.addEventListener('click', () => (typeof run === 'string' ? this.app.exec(run) : run()));
    return b;
  }

  // ----------------------------------------------------------------- toolbar

  private buildToolbar(): void {
    const tb = this.toolbar;
    clear(tb);
    const tip = (key: MsgKey, combo: string): string => `${t(key)}  ${keyHint(combo)}`;
    this.menuBtn = this.button(icons.menu, t('menu'), () => this.menus.show(this.appMenu(), this.menuBtn), 'tip-start');
    this.undoBtn = this.button(icons.undo, tip('undo', 'mod+z'), 'undo');
    this.redoBtn = this.button(icons.redo, tip('redo', 'mod+shift+z'), 'redo');
    const topic = this.button(icons.topic, tip('addSiblingTip', 'enter'), 'addSibling', 'wide');
    topic.append(h('span', null, t('topic')));
    const sub = this.button(icons.subtopic, tip('addChildTip', 'tab'), 'addChild', 'wide');
    sub.append(h('span', null, t('subtopic')));
    const rel = this.button(icons.relationship, tip('relationship', 'mod+shift+l'), 'relationship');
    const boundary = this.button(icons.boundary, tip('boundary', 'mod+shift+b'), 'boundary');
    const summary = this.button(icons.summary, t('summary'), 'summary');
    const search = this.button(icons.search, tip('search', 'mod+f'), 'search');
    this.panelBtn = this.button(icons.format, tip('format', 'mod+i'), 'togglePanel', 'tip-end');

    this.nameEl = h('span', { class: 'tb-name', 'data-tauri-drag-region': true });
    this.dotEl = h('span', { class: 'tb-dot', title: t('edited') });
    const sep = (): HTMLElement => h('div', { class: 'tb-sep' });
    tb.append(
      h(
        'div',
        { class: 'tb-group', 'data-tauri-drag-region': true },
        this.menuBtn,
        sep(),
        this.undoBtn,
        this.redoBtn,
        sep(),
        topic,
        sub,
        sep(),
        rel,
        boundary,
        summary,
      ),
      h('div', { class: 'tb-title', 'data-tauri-drag-region': true }, this.nameEl, this.dotEl),
      h('div', { class: 'tb-group right', 'data-tauri-drag-region': true }, search, this.panelBtn),
    );
  }

  private buildZoom(): void {
    const out = this.button(icons.minus, `${t('zoomOut')}  ${keyHint('mod+-')}`, 'zoomOut', 'tip-up');
    const inn = this.button(icons.plus, `${t('zoomIn')}  ${keyHint('mod+=')}`, 'zoomIn', 'tip-up');
    const fit = this.button(icons.fit, `${t('fit')}  ${keyHint('mod+1')}`, 'fit', 'tip-up tip-end');
    this.zoomLabel = h('button', { class: 'tb-btn zoom-label tip-up', 'data-tip': `${t('zoomReset')}  ${keyHint('mod+0')}` });
    keepFocus(this.zoomLabel);
    this.zoomLabel.addEventListener('click', () => this.app.exec('zoomReset'));
    this.float(h('div', { class: 'zoom' }, out, this.zoomLabel, inn, h('div', { class: 'tb-sep' }), fit));
  }

  // ------------------------------------------------------------------ search

  private buildSearch(): void {
    const app = this.app;
    const input = (this.searchInput = h('input', { type: 'text', placeholder: t('searchPlaceholder'), spellcheck: 'false' }));
    input.addEventListener('input', () => app.setSearch(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        app.stepSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSearch();
      }
    });
    this.searchCount = h('span', { class: 'count' });
    /** A small on/off button for one search option. */
    const option = (label: string, cls: string, tip: MsgKey, key: 'matchCase' | 'wholeWord'): HTMLButtonElement => {
      const b = h('button', { class: 'tb-btn opt-btn ' + cls, 'data-tip': t(tip), 'aria-label': t(tip) }, h('span', null, label));
      keepFocus(b);
      b.classList.toggle('on', app.searchOpts[key]);
      b.addEventListener('click', () => {
        app.setSearchOpts({ [key]: !app.searchOpts[key] });
        b.classList.toggle('on', app.searchOpts[key]);
      });
      return b;
    };
    const prev = this.button(icons.chevronUp, t('prev'), () => app.stepSearch(-1));
    const next = this.button(icons.chevronDown, t('next'), () => app.stepSearch(1));
    const more = this.button(icons.swap, t('toggleReplace'), () => {
      const on = this.searchEl.classList.toggle('with-replace');
      (on ? this.replaceInput : this.searchInput).focus();
    });
    const close = this.button(icons.close, t('close'), () => this.closeSearch(), 'tip-end');

    const replacement = (this.replaceInput = h('input', { type: 'text', placeholder: t('replacePlaceholder'), spellcheck: 'false' }));
    const doReplace = (all: boolean): void => {
      const n = app.replace(replacement.value, all);
      if (all && n > 0) this.notify(t('replaced', { n }));
    };
    replacement.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        doReplace(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSearch();
      }
    });
    const one = h('button', { class: 'btn small' }, t('replace'));
    one.addEventListener('click', () => doReplace(false));
    const all = h('button', { class: 'btn small' }, t('replaceAll'));
    all.addEventListener('click', () => doReplace(true));
    for (const b of [one, all]) keepFocus(b);

    this.searchEl = h(
      'div',
      { class: 'search' },
      h(
        'div',
        { class: 'search-row' },
        h('span', { class: 'search-icon', html: icons.search }),
        input,
        this.searchCount,
        option('Aa', 'case', 'matchCase', 'matchCase'),
        option('ab', 'word', 'wholeWord', 'wholeWord'),
        prev,
        next,
        more,
        close,
      ),
      h('div', { class: 'search-row replace-row' }, h('span', { class: 'search-icon', html: icons.swap }), replacement, one, all),
    );
    this.float(this.searchEl);
  }

  /** @param replace also show the row for replacing what was found */
  openSearch(replace = false): void {
    this.searchEl.classList.add('open');
    if (replace) this.searchEl.classList.add('with-replace');
    this.searchInput.focus();
    this.searchInput.select();
    if (this.searchInput.value) this.app.setSearch(this.searchInput.value);
  }

  closeSearch(): void {
    this.searchEl.classList.remove('open');
    this.app.clearSearch();
    this.app.editor.focus();
  }

  // -------------------------------------------------------------------- sync

  private syncDoc(): void {
    const app = this.app;
    const editing = app.editor.state !== null;
    this.undoBtn.disabled = !editing && !app.canUndo;
    this.redoBtn.disabled = !editing && !app.canRedo;
    const name = this.files.displayName;
    const dirty = app.book.dirty;
    if (this.nameEl.textContent !== name) this.nameEl.textContent = name;
    this.dotEl.classList.toggle('on', dirty);
    const title = (dirty ? '• ' : '') + name + (isTauri ? '' : ' — Kozue');
    if (document.title !== title) setWindowTitle(title);
    this.hintEl.classList.toggle('show', app.doc.root.children.length === 0);
  }

  private syncView(): void {
    const label = Math.round(this.app.view.zoom * 100) + '%';
    if (this.zoomLabel.textContent !== label) this.zoomLabel.textContent = label;
    this.panelBtn.classList.toggle('active', this.panel.open);
    document.documentElement.classList.toggle('panel-open', this.panel.open);
  }

  private syncSearch(): void {
    const app = this.app;
    const n = app.matches.length;
    this.searchCount.textContent = app.searchQuery.trim() ? (n ? `${Math.max(1, app.matchIndex + 1)} / ${n}` : '0') : '';
    this.searchEl.classList.toggle('empty', !!app.searchQuery.trim() && n === 0);
  }

  /** Pills that say which special state the canvas is in, each with a way out. */
  private syncModes(): void {
    const app = this.app;
    const bar = this.modeEl;
    clear(bar);
    const pill = (icon: string, text: string, exit: MsgKey, run: () => void): void => {
      const x = h('button', { class: 'mode-exit', 'aria-label': t(exit), title: t(exit), html: icons.close });
      keepFocus(x);
      x.addEventListener('click', run);
      bar.append(h('div', { class: 'mode-pill' }, h('span', { class: 'mode-icon', html: icon }), h('span', null, text), x));
    };
    if (app.connect) pill(icons.relationship, t('connectHint'), 'cancel', () => app.cancelConnect());
    if (app.focus) pill(icons.focus, t('focusOn'), 'showAll', () => app.setFocus(null));
    if (app.filter) pill(icons.filter, t('filterOn', { n: app.filterCount }), 'clearFilter', () => app.setFilter(null));
  }

  // --------------------------------------------------------------------- zen

  /** Hides everything but the map and lets the window fill the screen — or brings it all back. */
  toggleZen(on: boolean = !this.zen): void {
    if (on === this.zen) return;
    this.zen = on;
    const app = this.app;
    this.closePopover();
    document.documentElement.classList.toggle('zen', on);
    if (on) {
      if (this.searchEl.classList.contains('open')) this.closeSearch();
      this.panelWasOpen = this.panel.open;
      if (this.panel.open) this.panel.toggle(false, false);
      app.insets.top = 16;
      // The way out shows for a moment, and whenever the pointer finds it.
      this.zenExit.classList.add('show');
      clearTimeout(this.zenTimer);
      this.zenTimer = window.setTimeout(() => this.zenExit.classList.remove('show'), 2600);
    } else {
      clearTimeout(this.zenTimer);
      this.zenExit.classList.remove('show');
      app.insets.top = 56;
      if (this.panelWasOpen) this.panel.toggle(true, false);
    }
    void setFullscreen(on);
    app.emit('view');
    app.requestRender();
    app.editor.focus();
  }

  // ------------------------------------------------------------------ sheets

  /** What a sheet without a name of its own goes by: its central topic, else its number. */
  private autoLabel(sheet: Sheet, index: number): string {
    const title = sheet.doc.root.text.split('\n')[0].trim();
    return title ? (title.length > 22 ? title.slice(0, 21) + '…' : title) : t('sheetN', { n: index + 1 });
  }

  /** What a sheet goes by: the name it was given, else its automatic one. */
  sheetLabel(sheet: Sheet, index: number = this.app.book.indexOf(sheet)): string {
    return sheet.name || this.autoLabel(sheet, index);
  }

  /** The tabs at the bottom: one for each sheet, and a button that adds one. */
  private syncSheets(): void {
    const app = this.app;
    const book = app.book;
    const bar = this.sheetsEl;
    if (this.renaming) return; // a name is being typed into one of the tabs
    const labels = book.sheets.map((s, i) => this.sheetLabel(s, i));
    const shown = JSON.stringify([labels, book.indexOf(), book.sheets.map((s) => s.doc.root.id)]);
    if (shown === this.sheetsShown) return;
    this.sheetsShown = shown;
    clear(bar);
    const list = h('div', { class: 'sheet-list' });
    book.sheets.forEach((sheet, i) => {
      const tab = h('button', { class: 'sheet-tab' + (sheet === book.active ? ' active' : ''), title: labels[i] }, labels[i]);
      keepFocus(tab);
      tab.addEventListener('click', () => app.showSheet(sheet));
      tab.addEventListener('dblclick', () => this.renameSheet(sheet));
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.sheetMenu(sheet, e.clientX, e.clientY);
      });
      tab.addEventListener('pointerdown', (e) => {
        if (e.button === 0 && book.sheets.length > 1) this.dragSheet(sheet, tab, list, e);
      });
      list.append(tab);
    });
    bar.append(list, this.button(icons.plus, t('newSheet'), 'sheet.new', 'tip-up tip-start sheet-add'));
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Lets the name of a sheet be typed into its tab. */
  renameSheet(sheet: Sheet = this.app.book.active): void {
    const app = this.app;
    const index = app.book.indexOf(sheet);
    const tab = this.sheetsEl.querySelectorAll<HTMLElement>('.sheet-tab')[index];
    if (!tab || this.renaming) return;
    app.editor.commit();
    // Typing exactly the automatic name keeps the sheet without a name of its own.
    const auto = this.autoLabel(sheet, index);
    const input = h('input', {
      class: 'sheet-input',
      type: 'text',
      maxlength: String(MAX_SHEET_NAME),
      spellcheck: 'false',
      title: t('sheetNameHint'),
      placeholder: auto,
    });
    input.value = sheet.name || auto;
    input.style.width = Math.max(64, tab.offsetWidth + 14) + 'px';
    tab.replaceWith(input);
    this.renaming = true;
    input.focus();
    input.select();
    let over = false;
    const finish = (commit: boolean): void => {
      if (over) return;
      over = true;
      this.renaming = false;
      this.sheetsShown = '';
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (commit) app.renameSheet(sheet, name === auto ? '' : name);
      this.syncSheets();
      app.editor.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        finish(e.key === 'Enter');
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  private sheetMenu(sheet: Sheet, x: number, y: number): void {
    const app = this.app;
    const book = app.book;
    const i = book.indexOf(sheet);
    this.menus.show(
      [
        { label: t('renameSheet'), action: () => this.renameSheet(sheet) },
        { label: t('duplicateSheet'), action: () => app.duplicateSheet(sheet) },
        SEP,
        { label: t('moveSheetLeft'), disabled: i === 0, action: () => app.moveSheet(sheet, i - 1) },
        { label: t('moveSheetRight'), disabled: i === book.sheets.length - 1, action: () => app.moveSheet(sheet, i + 1) },
        SEP,
        { label: t('deleteSheet'), disabled: book.sheets.length < 2, danger: true, action: () => app.deleteSheet(sheet) },
      ],
      { x, y },
    );
  }

  /** Dragging a tab along the bar moves its sheet; a line shows where it would land. */
  private dragSheet(sheet: Sheet, tab: HTMLElement, list: HTMLElement, down: PointerEvent): void {
    const app = this.app;
    const tabs = [...list.querySelectorAll<HTMLElement>('.sheet-tab')];
    const others = tabs.filter((el) => el !== tab);
    let target = -1;
    const mark = (): void => {
      for (const el of tabs) el.classList.remove('drop-before', 'drop-after');
      if (target < 0) return;
      if (target < others.length) others[target].classList.add('drop-before');
      else others[others.length - 1].classList.add('drop-after');
    };
    const move = (e: PointerEvent): void => {
      if (target < 0 && Math.abs(e.clientX - down.clientX) < 6) return;
      tab.classList.add('dragging');
      // It lands in front of the first other tab whose middle lies to the right of the pointer.
      target = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 < e.clientX;
      }).length;
      mark();
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const to = target;
      target = -1;
      mark();
      tab.classList.remove('dragging');
      if (to >= 0) app.moveSheet(sheet, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- popovers

  /** Shows a topic's note next to its indicator. */
  showNote(node: MNode, x: number, y: number): void {
    this.closePopover();
    if (!node.note) return;
    const edit = h('button', { class: 'btn small' }, t('editNoteBtn'));
    edit.addEventListener('click', () => {
      this.closePopover();
      this.app.select([node]);
      this.panel.focusNote();
    });
    const pop = (this.popover = h(
      'div',
      { class: 'popover' },
      h('div', { class: 'popover-text' }, node.note),
      h('div', { class: 'popover-actions' }, edit),
    ));
    this.host.append(pop);
    const w = pop.offsetWidth;
    const hgt = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(x - 20, innerWidth - w - 8)) + 'px';
    pop.style.top = (y + 14 + hgt > innerHeight - 8 ? Math.max(8, y - hgt - 14) : y + 14) + 'px';
    const dismiss = (e: Event): void => {
      if (e instanceof KeyboardEvent ? e.key !== 'Escape' : pop.contains(e.target as Node)) return;
      this.closePopover();
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    (pop as HTMLElement & { cleanup?: () => void }).cleanup = () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('wheel', dismiss, true);
    };
  }

  private closePopover(): void {
    const pop = this.popover as (HTMLElement & { cleanup?: () => void }) | null;
    if (!pop) return;
    pop.cleanup?.();
    pop.remove();
    this.popover = null;
  }

  /** A note / link indicator on the canvas was clicked. */
  indicator(node: MNode, part: 'note' | 'link', x: number, y: number): void {
    if (part === 'link' && node.link) openExternal(node.link);
    else if (part === 'note') this.showNote(node, x, y);
  }

  // ------------------------------------------------------------------- menus

  private item(label: MsgKey, cmd: string, combo?: string, extra: Partial<MenuItem> = {}): MenuItem {
    return { label: t(label), hint: combo ? keyHint(combo) : undefined, action: () => this.app.exec(cmd), ...extra };
  }

  private appMenu(): MenuItem[] {
    const files = this.files;
    const exp = (label: MsgKey, kind: ExportKind): MenuItem => ({ label: t(label), action: () => void files.exportAs(kind) });
    const recent = files.recent;
    const items: (MenuItem | false)[] = [
      this.item('new', 'new', 'mod+n'),
      isTauri && this.item('newWindow', 'newWindow', 'mod+shift+n'),
      this.item('open', 'open', 'mod+o'),
      isTauri && {
        label: t('openRecent'),
        submenu: recent.length
          ? [
              ...recent.map((path): MenuItem => ({ label: path.replace(/^.*[/\\]/, ''), action: () => void files.openPath(path) })),
              SEP,
              { label: t('clearRecent'), action: () => files.clearRecent() },
            ]
          : [{ label: t('noRecent'), disabled: true }],
      },
      SEP,
      this.item('save', 'save', 'mod+s'),
      this.item('saveAs', 'saveAs', 'mod+shift+s'),
      {
        label: t('export'),
        submenu: [
          exp('exportPng', 'png'),
          exp('exportJpeg', 'jpeg'),
          exp('exportSvg', 'svg'),
          exp('exportPdf', 'pdf'),
          SEP,
          exp('exportMd', 'md'),
          exp('exportTxt', 'txt'),
          exp('exportOpml', 'opml'),
          exp('exportXmind', 'xmind'),
        ],
      },
      SEP,
      {
        label: t('structure'),
        submenu: LAYOUT_KINDS.map((kind): MenuItem => ({
          label: t(STRUCTURES[kind][0]),
          checked: kind === this.app.doc.layout,
          action: () => this.app.setLayout(kind),
        })),
      },
      {
        label: t('sheet'),
        submenu: [
          this.item('newSheet', 'sheet.new'),
          this.item('sheetFromTopic', 'sheet.fromTopic', undefined, {
            disabled: !this.app.primary || this.app.primary === this.app.doc.root,
          }),
          this.item('renameSheet', 'sheet.rename'),
          this.item('duplicateSheet', 'sheet.duplicate'),
          this.item('deleteSheet', 'sheet.delete', undefined, { disabled: this.app.book.sheets.length < 2, danger: true }),
          SEP,
          this.item('nextSheet', 'sheet.next', isMac ? 'mod+shift+]' : 'mod+pagedown', { disabled: this.app.book.sheets.length < 2 }),
          this.item('prevSheet', 'sheet.prev', isMac ? 'mod+shift+[' : 'mod+pageup', { disabled: this.app.book.sheets.length < 2 }),
        ],
      },
      this.item(this.app.focus ? 'showAll' : 'focusBranch', 'focusBranch', 'mod+;', {
        disabled: !this.app.focus && (!this.app.primary || this.app.primary === this.app.doc.root),
      }),
      this.item('expandAll', 'expandAll'),
      this.item('collapseAll', 'collapseAll'),
      this.item('zen', 'zen', 'mod+shift+f'),
      SEP,
      this.item('findReplace', 'replace', isMac ? 'mod+alt+f' : 'mod+h'),
      this.item('shortcuts', 'shortcuts'),
      this.item('welcome', 'welcome'),
      this.item('language', 'language'),
      this.item('about', 'about'),
    ];
    return items.filter((i): i is MenuItem => i !== false);
  }

  /** Context menu for a topic, or for the empty canvas when `node` is null. */
  contextMenu(x: number, y: number, node: MNode | null): void {
    const app = this.app;
    let items: MenuItem[];
    const rel = app.selRel;
    if (!node && rel) {
      // A relationship was right-clicked.
      items = [
        this.item('edit', 'editRel', 'enter'),
        { label: t('reverse'), action: () => app.reverseRel(rel) },
        SEP,
        this.item('delete', 'delete', 'delete', { danger: true }),
      ];
    } else if (!node) {
      items = [
        this.item('paste', 'paste', 'mod+v'),
        this.item('selectAll', 'selectAll', 'mod+a'),
        SEP,
        this.item('fit', 'fit', 'mod+1'),
        this.item('centerRoot', 'centerRoot'),
        SEP,
        this.item('expandAll', 'expandAll'),
        this.item('collapseAll', 'collapseAll'),
      ];
      if (app.focus) items.push(SEP, this.item('showAll', 'focusBranch', 'mod+;'));
      if (app.filter) items.push(SEP, this.item('clearFilter', 'clearFilter'));
    } else {
      const isRoot = app.sel.every((n) => n === app.doc.root);
      const foldable = app.sel.some((n) => n.parent && n.children.length > 0);
      const single = app.sel.length === 1;
      const structure = single ? node.structure : undefined;
      items = [
        this.item('addChild', 'addChild', 'tab'),
        this.item('addSibling', 'addSibling', 'enter', { disabled: isRoot }),
        this.item('addSiblingBefore', 'addSiblingBefore', 'shift+enter', { disabled: isRoot }),
        this.item('addParent', 'addParent', 'mod+enter', { disabled: isRoot }),
        {
          label: t('insert'),
          submenu: [
            this.item('relationship', 'relationship', 'mod+shift+l'),
            this.item('boundary', 'boundary', 'mod+shift+b', { disabled: isRoot, checked: app.sel.every((n) => n.boundary !== undefined) }),
            this.item('summary', 'summary', undefined, { disabled: isRoot, checked: false }),
            this.item('todo', 'todo', 'mod+shift+d', { checked: app.sel.every((n) => n.todo !== undefined) }),
            this.item('editLabels', 'editLabels', undefined, { checked: false }),
          ],
        },
        SEP,
        this.item('edit', 'edit', 'space', { disabled: !single }),
        this.item('editNote', 'editNote', undefined, { disabled: !single }),
        this.item('editLink', 'editLink', 'mod+k', { disabled: !single }),
        this.item(node.collapsed ? 'expand' : 'collapse', 'toggleCollapse', 'mod+/', { disabled: !foldable }),
        this.item(app.focus === node ? 'showAll' : 'focusBranch', 'focusBranch', 'mod+;', { disabled: isRoot || !single }),
        this.item('sheetFromTopic', 'sheet.fromTopic', undefined, { disabled: isRoot || !single }),
        {
          label: t('style'),
          submenu: [
            this.item('important', 'important', 'mod+shift+1', { checked: app.hasQuickStyle('important') }),
            this.item('crossed', 'crossed', 'mod+shift+2', { checked: app.hasQuickStyle('crossed') }),
            SEP,
            this.item('bold', 'bold', 'mod+b', { checked: app.sel.every((n) => app.isBold(n)) }),
            this.item('italic', 'italic', 'mod+shift+i', { checked: app.sel.every((n) => n.style?.italic === true) }),
            this.item('strike', 'strike', 'mod+shift+x', { checked: app.sel.every((n) => n.style?.strike === true) }),
            SEP,
            this.item('copyStyle', 'copyStyle', 'mod+alt+c', { disabled: !single, checked: false }),
            this.item('pasteStyle', 'pasteStyle', 'mod+alt+v', { disabled: !app.canPasteStyle, checked: false }),
            this.item('styleToLevel', 'styleToLevel', undefined, { disabled: !single, checked: false }),
            SEP,
            this.item('resetStyle', 'resetStyle', undefined, { disabled: app.sel.every((n) => n.style === undefined), checked: false }),
            this.item('styleMore', 'editStyle', undefined, { checked: false }),
          ],
        },
        {
          label: t('branchStructure'),
          disabled: isRoot,
          submenu: [
            { label: t('structInherit'), checked: single && structure === undefined, action: () => app.setBranchStructure(undefined) },
            SEP,
            ...BRANCH_KINDS.map((kind): MenuItem => ({
              label: t(STRUCTURES[kind][0]),
              checked: single && structure === kind,
              action: () => app.setBranchStructure(kind),
            })),
          ],
        },
        SEP,
        this.item('cut', 'cut', 'mod+x', { disabled: isRoot }),
        this.item('copy', 'copy', 'mod+c'),
        this.item('paste', 'paste', 'mod+v'),
        this.item('duplicate', 'duplicate', 'mod+d', { disabled: isRoot }),
        SEP,
        this.item('delete', 'delete', 'delete', { disabled: isRoot, danger: true }),
        this.item('deleteSingle', 'deleteSingle', 'mod+delete', {
          disabled: isRoot || !app.sel.some((n) => n.parent && n.children.length > 0),
          danger: true,
        }),
      ];
    }
    this.menus.show(items, { x, y });
  }
}
