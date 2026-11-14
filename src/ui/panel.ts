// Format panel: theme, structure and settings of the map, and the content and
// the style of the selected topics.

import type { App } from '../app/app.ts';
import { rememberTheme } from '../app/files.ts';
import type { TextMeasurer } from '../core/layout.ts';
import { layoutDoc } from '../core/layout.ts';
import { MARKER_GROUPS } from '../core/markers.ts';
import type { FontKind, LayoutKind, MNode, NodeData, Rel, Shape } from '../core/model.ts';
import { Doc, FONT_KINDS, MAX_WIDTH, MIN_WIDTH, SHAPES, fromData, normalizeMains } from '../core/model.ts';
import type { Theme } from '../core/themes.ts';
import { BRANCH_KINDS, LAYOUT_KINDS } from '../core/structures.ts';
import { FONT_STACKS, THEMES, mix, themeById } from '../core/themes.ts';
import type { MsgKey } from '../i18n.ts';
import { t } from '../i18n.ts';
import { openExternal } from '../platform.ts';
import { markerSvg } from '../render/markers.ts';
import { CanvasPainter } from '../render/painter.ts';
import { drawScene, snapPositions } from '../render/scene.ts';
import { clear, h, keepFocus } from './dom.ts';
import { icons } from './icons.ts';

const OPEN_KEY = 'kozue.panel';
const TAB_KEY = 'kozue.panelTab';
export const PANEL_WIDTH = 272;

type Tab = 'map' | 'topic' | 'style';
const TABS: readonly [Tab, MsgKey][] = [
  ['map', 'tabMap'],
  ['topic', 'tabTopic'],
  ['style', 'tabStyle'],
];

/** Thickness of the branch lines for the three settings the panel offers. */
const LINE_THIN = 0.6;
const LINE_BOLD = 1.6;

const SHAPE_LABELS: Record<Shape, MsgKey> = {
  rounded: 'shapeRounded',
  rect: 'shapeRect',
  pill: 'shapePill',
  ellipse: 'shapeEllipse',
  diamond: 'shapeDiamond',
  underline: 'shapeUnderline',
  none: 'shapeNone',
};
const SHAPE_ICONS: Record<Shape, string> = {
  rounded: icons.shapeRounded,
  rect: icons.shapeRect,
  pill: icons.shapePill,
  ellipse: icons.shapeEllipse,
  diamond: icons.shapeDiamond,
  underline: icons.shapeUnderline,
  none: icons.shapeNone,
};
const FONT_LABELS: Record<FontKind, MsgKey> = { sans: 'fontSans', serif: 'fontSerif', round: 'fontRound', mono: 'fontMono' };

/** Grays offered beside the theme's colors, from white to nearly black. */
const NEUTRALS = ['#ffffff', '#eef0f3', '#c9ced6', '#8b93a1', '#4a5160', '#1f2330'];

/** The value shared by all of `values`, or null when they differ. (`undefined` is a value: "automatic".) */
function common<T>(values: readonly T[]): T | null {
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/** A button that shows a color and opens the list of colors to choose from. */
interface Well {
  el: HTMLButtonElement;
  chip: HTMLElement;
  /** The color on show: `#rrggbb`, `none`, undefined for "automatic", null when the selected topics differ. */
  value: () => string | undefined | null;
}

interface ColorOpts {
  value: Well['value'];
  /** Offer "no fill". */
  none?: boolean;
  /** `null` returns to automatic; `live` marks one of the many steps of a color being picked. */
  pick: (color: string | null, live: boolean) => void;
}

const recall = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the panel simply starts in its default state next time */
  }
};

const THUMB_W = 114;
const THUMB_H = 70;

/** Miniature map used for theme previews. */
function sampleDoc(theme: Theme): Doc {
  const n = (text: string, ...children: NodeData[]): NodeData => ({ text, children });
  const root = fromData(
    n(
      'Aaaa',
      n('Aaaaaa', n('Aaaaaaa'), n('Aaaaa')),
      n('Aaaaa', n('Aaaaaa'), n('Aaaaaaaa')),
      n('Aaaaaa', n('Aaaaa'), n('Aaaaaaa')),
      n('Aaaaa', n('Aaaaaaa'), n('Aaaaa')),
    ),
  );
  normalizeMains(root, theme.palette.length);
  return new Doc(root, theme.id, 'map');
}

function drawThumb(canvas: HTMLCanvasElement, theme: Theme, measurer: TextMeasurer): void {
  const doc = sampleDoc(theme);
  const { bounds: b } = layoutDoc(doc, { theme, measurer, epoch: 0, stamp: 1, editing: null });
  snapPositions(doc.root);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(THUMB_W * dpr);
  canvas.height = Math.round(THUMB_H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const s = Math.min((THUMB_W - 12) / (b.x1 - b.x0), (THUMB_H - 12) / (b.y1 - b.y0));
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (THUMB_W / 2 - ((b.x0 + b.x1) / 2) * s), dpr * (THUMB_H / 2 - ((b.y0 + b.y1) / 2) * s));
  const p = new CanvasPainter(ctx);
  p.reset();
  drawScene(p, doc.root, {
    theme,
    metrics: (f) => measurer.metrics(f),
    textWidth: (f, text) => measurer.width(f, text),
    clip: null,
    zoom: s,
    editing: null,
    marks: null,
    markCurrent: null,
    dim: null,
    keep: null,
    stamp: 1,
    rels: [],
    selRel: null,
  });
}

const firstLine = (text: string): string => {
  const line = text.split('\n')[0].trim();
  return line.length > 18 ? line.slice(0, 17) + '…' : line;
};

/** Label and icon of every structure. */
export const STRUCTURES: Record<LayoutKind, [MsgKey, string]> = {
  map: ['structMap', icons.structMap],
  logic: ['structLogic', icons.structLogic],
  'logic-left': ['structLogicLeft', icons.structLogicLeft],
  brace: ['structBrace', icons.structBrace],
  org: ['structOrg', icons.structOrg],
  'org-up': ['structOrgUp', icons.structOrgUp],
  'org-tree': ['structOrgTree', icons.structOrgTree],
  tree: ['structTree', icons.structTree],
  timeline: ['structTimeline', icons.structTimeline],
  'timeline-v': ['structTimelineV', icons.structTimelineV],
  fishbone: ['structFishbone', icons.structFishbone],
  'fishbone-right': ['structFishboneRight', icons.structFishboneRight],
};

export class Panel {
  readonly el: HTMLElement;
  open = false;
  private app: App;
  private tab: Tab = TABS.find(([id]) => id === recall(TAB_KEY))?.[0] ?? 'map';
  private tabBtns = new Map<Tab, HTMLElement>();
  private pages = new Map<Tab, HTMLElement>();
  private themeCards = new Map<string, HTMLElement>();
  private structBtns = new Map<LayoutKind, HTMLElement>();
  private structName!: HTMLElement;
  private filterBox!: HTMLElement;
  private topic!: HTMLElement;
  private styleBox!: HTMLElement;
  private mapLook!: HTMLElement;
  private width: HTMLInputElement | null = null;
  private sizeValue: HTMLElement | null = null;
  /** Color wells on the map page (built once) and on the style page (rebuilt with the selection). */
  private mapWells: Well[] = [];
  private styleWells: Well[] = [];
  private colorPop: (HTMLElement & { cleanup?: () => void }) | null = null;
  /** The well whose colors are open. */
  private colorFor: Well | null = null;
  private note: HTMLTextAreaElement | null = null;
  private link: HTMLInputElement | null = null;
  private labels: HTMLInputElement | null = null;
  private frameTitle: HTMLInputElement | null = null;
  private relText: HTMLInputElement | null = null;
  /** Node (or relationship) whose properties the topic section currently shows. */
  private shown: MNode | null = null;
  private shownRel: Rel | null = null;
  private shownCount = -1;
  private shownTheme = '';
  private shownFilter = '';

  constructor(app: App, el: HTMLElement) {
    this.app = app;
    this.el = el;
    this.build();
    this.toggle(recall(OPEN_KEY) === '1', false);
    app.on((what) => {
      if (!this.open) return;
      if (what === 'theme' || what === 'doc') this.syncMap();
      if (what === 'doc' || what === 'mode' || what === 'theme') this.syncFilter();
      if (what === 'selection' || what === 'doc' || what === 'theme') this.syncTopic();
    });
  }

  /**
   * Shows / hides the panel.
   * @param user the change was asked for by the user: remember it and slide the map out of the way
   */
  toggle(force?: boolean, user = true): void {
    const open = force ?? !this.open;
    const changed = open !== this.open;
    this.open = open;
    this.el.classList.toggle('open', open);
    this.app.insets.right = open ? PANEL_WIDTH + 24 : 16;
    if (open) {
      this.syncMap();
      this.syncFilter();
      this.syncTopic();
    } else this.closeColors();
    if (user && changed) {
      remember(OPEN_KEY, open ? '1' : '0');
      // Keep the map centered in the space that is left.
      this.app.shiftView(((PANEL_WIDTH + 8) / 2) * (open ? -1 : 1), 0);
    }
    this.app.emit('view');
  }

  private showTab(tab: Tab): void {
    if (tab !== this.tab) this.closeColors();
    this.tab = tab;
    remember(TAB_KEY, tab);
    for (const [id, b] of this.tabBtns) b.classList.toggle('active', id === tab);
    for (const [id, page] of this.pages) page.hidden = id !== tab;
  }

  focusNote(): void {
    this.toggle(true);
    this.showTab('topic');
    this.syncTopic();
    this.note?.focus();
  }

  focusLink(): void {
    this.toggle(true);
    this.showTab('topic');
    this.syncTopic();
    this.link?.focus();
    this.link?.select();
  }

  focusLabels(): void {
    this.toggle(true);
    this.showTab('topic');
    this.syncTopic();
    this.labels?.focus();
    this.labels?.select();
  }

  /** Puts the cursor into the text field of the selected relationship. */
  focusRel(): void {
    this.toggle(true);
    this.showTab('topic');
    this.syncTopic();
    this.relText?.focus();
    this.relText?.select();
  }

  /** Opens the panel on the style of the selected topics. */
  showStyle(): void {
    this.toggle(true);
    this.showTab('style');
    this.syncTopic();
  }

  /** Rebuilds everything (after a language change). */
  rebuild(): void {
    this.closeColors();
    clear(this.el);
    this.tabBtns.clear();
    this.pages.clear();
    this.themeCards.clear();
    this.structBtns.clear();
    this.shown = null;
    this.shownRel = null;
    this.shownCount = -1;
    this.shownFilter = '';
    this.build();
    if (this.open) {
      this.syncMap();
      this.syncFilter();
      this.syncTopic();
    }
  }

  private build(): void {
    const app = this.app;
    const themes = h('div', { class: 'theme-grid' });
    for (const theme of THEMES) {
      const canvas = h('canvas', { style: { width: THUMB_W + 'px', height: THUMB_H + 'px' } });
      const card = h('button', { class: 'theme-card', title: theme.name }, canvas, h('span', null, theme.name));
      keepFocus(card);
      card.addEventListener('click', () => {
        rememberTheme(theme.id);
        app.setTheme(theme.id);
      });
      // Thumbnails are cheap, but there is no reason to draw them before the panel is first shown.
      requestAnimationFrame(() => drawThumb(canvas, theme, app.measurer));
      this.themeCards.set(theme.id, card);
      themes.append(card);
    }
    // Structures: a grid of icons; the line below names the one under the pointer.
    const structs = h('div', { class: 'struct-grid' });
    this.structName = h('div', { class: 'struct-name' });
    const showName = (kind: LayoutKind): void => {
      this.structName.textContent = t(STRUCTURES[kind][0]);
    };
    for (const kind of LAYOUT_KINDS) {
      const [label, icon] = STRUCTURES[kind];
      const b = h('button', { class: 'struct-btn', 'aria-label': t(label), html: icon });
      keepFocus(b);
      b.addEventListener('click', () => app.setLayout(kind));
      b.addEventListener('pointerenter', () => showName(kind));
      b.addEventListener('pointerleave', () => showName(app.doc.layout));
      this.structBtns.set(kind, b);
      structs.append(b);
    }
    this.topic = h('div', { class: 'topic-props' });
    this.styleBox = h('div', { class: 'topic-props' });
    this.filterBox = h('div', { class: 'filter-box' });
    this.mapLook = this.buildMapLook();

    const tabs = h('div', { class: 'seg tabs' });
    for (const [id, label] of TABS) {
      const b = h('button', { class: 'seg-btn' }, t(label));
      keepFocus(b);
      b.addEventListener('click', () => this.showTab(id));
      this.tabBtns.set(id, b);
      tabs.append(b);
    }
    const mapPage = h(
      'div',
      { class: 'page' },
      h('section', null, h('h3', null, t('theme')), themes),
      h('section', null, h('h3', null, t('structure')), structs, this.structName),
      h('section', null, h('h3', null, t('mapStyle')), this.mapLook),
      h('section', null, h('h3', null, t('filter')), this.filterBox),
    );
    const topicPage = h('div', { class: 'page' }, this.topic);
    const stylePage = h('div', { class: 'page' }, this.styleBox);
    this.pages.set('map', mapPage);
    this.pages.set('topic', topicPage);
    this.pages.set('style', stylePage);
    this.el.append(tabs, mapPage, topicPage, stylePage);
    this.el.addEventListener('scroll', () => this.closeColors(), { passive: true });
    this.showTab(this.tab);
  }

  /** The map's own settings: canvas color, thickness of the lines, typeface. */
  private buildMapLook(): HTMLElement {
    const app = this.app;
    this.mapWells = [];
    const background = this.well(this.mapWells, {
      value: () => app.doc.style.background,
      pick: (color, live) => app.setMapStyle({ background: color }, live),
    });
    const lines = h('div', { class: 'seg' });
    for (const [id, label, value] of [
      ['thin', 'lineThin', LINE_THIN],
      ['normal', 'lineNormal', null],
      ['bold', 'lineBold', LINE_BOLD],
    ] as const) {
      const b = h('button', { class: 'seg-btn', 'data-line': id }, t(label));
      keepFocus(b);
      b.addEventListener('click', () => app.setMapStyle({ line: value }));
      lines.append(b);
    }
    const fonts = h('div', { class: 'seg two' });
    for (const kind of FONT_KINDS) {
      // Each name is written in its own typeface.
      const b = h('button', { class: 'seg-btn', 'data-font': kind, style: { fontFamily: FONT_STACKS[kind] } }, t(FONT_LABELS[kind]));
      keepFocus(b);
      b.addEventListener('click', () => app.setMapStyle({ font: kind === 'sans' ? null : kind }));
      fonts.append(b);
    }
    return h(
      'div',
      null,
      h('div', { class: 'prop-row' }, h('span', null, t('background')), background),
      h('label', null, t('lineWidth')),
      lines,
      h('label', null, t('typeface')),
      fonts,
    );
  }

  // ------------------------------------------------------------ color wells

  /** A button showing a color; a click opens the colors to choose from. */
  private well(list: Well[], o: ColorOpts): HTMLButtonElement {
    const chip = h('span', { class: 'well-chip' });
    const el = h('button', { class: 'well' }, chip, h('span', { class: 'well-arrow', html: icons.chevronDown }));
    keepFocus(el);
    const w: Well = { el, chip, value: o.value };
    el.addEventListener('click', () => {
      if (this.colorFor === w) this.closeColors();
      else this.openColors(w, o);
    });
    list.push(w);
    return el;
  }

  private syncWells(list: readonly Well[]): void {
    for (const w of list) {
      const v = w.value();
      const chip = w.chip;
      chip.className = 'well-chip' + (v === undefined ? ' auto' : v === null ? ' mixed' : v === 'none' ? ' none' : '');
      chip.style.background = typeof v === 'string' && v !== 'none' ? v : '';
      chip.textContent = v === undefined ? 'A' : v === null ? '–' : '';
    }
  }

  /** The colors on offer: the theme's own, paler versions of them, and a row of grays. */
  private openColors(w: Well, o: ColorOpts): void {
    this.closeColors();
    const theme = themeById(this.app.doc.theme);
    const current = o.value();
    const pop: HTMLElement & { cleanup?: () => void } = h('div', { class: 'color-pop' });
    const row = (): HTMLElement => h('div', { class: 'swatches' });
    const swatch = (color: string): HTMLElement => {
      const b = h('button', { class: 'swatch' + (color === current ? ' active' : ''), title: color, style: { background: color } });
      keepFocus(b);
      b.addEventListener('click', () => {
        o.pick(color, false);
        this.closeColors();
      });
      return b;
    };
    const top = row();
    const auto = h('button', { class: 'swatch auto' + (current === undefined ? ' active' : ''), 'data-tip': t('colorAuto') }, 'A');
    keepFocus(auto);
    auto.addEventListener('click', () => {
      o.pick(null, false);
      this.closeColors();
    });
    top.append(auto);
    if (o.none) {
      const none = h('button', { class: 'swatch none' + (current === 'none' ? ' active' : ''), 'data-tip': t('colorNone') });
      keepFocus(none);
      none.addEventListener('click', () => {
        o.pick('none', false);
        this.closeColors();
      });
      top.append(none);
    }
    const custom = h('input', { type: 'color', class: 'swatch custom', title: t('colorCustom') });
    if (typeof current === 'string' && current !== 'none') custom.value = current;
    custom.addEventListener('input', () => o.pick(custom.value.toLowerCase(), true));
    top.append(custom);
    const strong = row();
    const pale = row();
    for (const c of theme.palette) {
      strong.append(swatch(c));
      pale.append(swatch(mix(c, '#ffffff', 0.72)));
    }
    const grays = row();
    for (const c of NEUTRALS) grays.append(swatch(c));
    pop.append(top, strong);
    if (theme.palette.length > 1) pop.append(pale);
    pop.append(grays);
    document.body.append(pop);

    // Below the well where there is room, above it otherwise; never off the window.
    const r = w.el.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.right - pw, innerWidth - pw - 8)) + 'px';
    pop.style.top = (r.bottom + 6 + ph > innerHeight - 8 ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + 'px';
    w.el.classList.add('open');

    const dismiss = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
      } else if (pop.contains(e.target as Node) || w.el.contains(e.target as Node)) return;
      this.closeColors();
    };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', dismiss);
    pop.cleanup = () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('resize', dismiss);
      w.el.classList.remove('open');
    };
    this.colorPop = pop;
    this.colorFor = w;
  }

  private closeColors(): void {
    const pop = this.colorPop;
    if (!pop) return;
    this.colorPop = null;
    this.colorFor = null;
    pop.cleanup?.();
    pop.remove();
  }

  private syncMap(): void {
    const doc = this.app.doc;
    for (const [id, card] of this.themeCards) card.classList.toggle('active', id === doc.theme);
    for (const [kind, b] of this.structBtns) b.classList.toggle('active', kind === doc.layout);
    this.structName.textContent = t(STRUCTURES[doc.layout][0]);
    const line = doc.style.line;
    const lineId = line === undefined ? 'normal' : line < 1 ? 'thin' : 'bold';
    this.mapLook.querySelectorAll<HTMLElement>('[data-line]').forEach((b) => b.classList.toggle('active', b.dataset.line === lineId));
    const font = doc.style.font ?? 'sans';
    this.mapLook.querySelectorAll<HTMLElement>('[data-font]').forEach((b) => b.classList.toggle('active', b.dataset.font === font));
    this.syncWells(this.mapWells);
  }

  /** The filter chips: one for every marker, label and to-do state the map uses. */
  private syncFilter(): void {
    const app = this.app;
    const f = app.filter;
    const facets = app.facets();
    // Criteria that no topic meets any more stay visible while they are switched on.
    const markers = [
      ...new Set([...MARKER_GROUPS.flatMap((g) => g.items).filter((m) => facets.markers.includes(m)), ...(f?.markers ?? [])]),
    ];
    const labels = [...new Set([...facets.labels, ...(f?.labels ?? [])])];
    const todo: ('open' | 'done')[] = [];
    if (facets.open || f?.todo.has('open')) todo.push('open');
    if (facets.done || f?.todo.has('done')) todo.push('done');
    const key = [
      app.theme.id,
      markers.join(' '),
      labels.join('\n'),
      todo.join(' '),
      [...(f?.markers ?? [])],
      [...(f?.labels ?? [])],
      [...(f?.todo ?? [])],
    ].join('|');
    if (key === this.shownFilter) return;
    this.shownFilter = key;
    const box = this.filterBox;
    clear(box);
    if (!markers.length && !labels.length && !todo.length) {
      box.append(h('p', { class: 'muted hint-text' }, t('filterHint')));
      return;
    }
    const ink = app.theme.dark ? '#e6e8ee' : '#3a3f4b';
    const chips = h('div', { class: 'chips' });
    const chip = (kind: 'markers' | 'labels' | 'todo', value: string, active: boolean, ...content: (Node | string)[]): void => {
      const b = h('button', { class: 'chip' + (active ? ' active' : '') }, ...content);
      keepFocus(b);
      b.addEventListener('click', () => app.toggleFilter(kind, value));
      chips.append(b);
    };
    for (const id of todo) {
      chip(
        'todo',
        id,
        f?.todo.has(id) ?? false,
        h('span', { class: 'chip-icon', html: icons.todo }),
        t(id === 'open' ? 'todoOpen' : 'todoDone'),
      );
    }
    for (const id of markers)
      chip('markers', id, f?.markers.has(id) ?? false, h('span', { class: 'chip-icon', html: markerSvg(id, 16, ink) }));
    for (const label of labels) chip('labels', label, f?.labels.has(label) ?? false, label);
    box.append(chips);
    if (f) {
      const clearBtn = h('button', { class: 'btn small ghost' }, t('clearFilter'));
      keepFocus(clearBtn);
      clearBtn.addEventListener('click', () => app.setFilter(null));
      box.append(clearBtn);
    }
  }

  private syncTopic(): void {
    const app = this.app;
    const node = app.primary;
    const rel = app.selRel;
    const count = app.sel.length;
    // Rebuild only when the subject changes, so typing in a field is never interrupted.
    const look = app.theme.id + (app.theme.dark ? '/dark' : '/light');
    if (node !== this.shown || rel !== this.shownRel || count !== this.shownCount || look !== this.shownTheme) {
      this.shown = node;
      this.shownRel = rel;
      this.shownCount = count;
      this.shownTheme = look;
      if (rel) this.buildRel(rel);
      else this.buildTopic(node, count);
      this.buildStyle(rel ? null : node, count);
    }
    this.syncStyle();
    if (rel) {
      if (this.relText && document.activeElement !== this.relText && this.relText.value !== rel.text) this.relText.value = rel.text;
      const ends = this.topic.querySelector('.rel-ends');
      if (ends) ends.textContent = `${firstLine(rel.from.text) || '…'}  →  ${firstLine(rel.to.text) || '…'}`;
      return;
    }
    if (!node) return;
    const sel = app.sel;
    this.topic.querySelectorAll<HTMLElement>('[data-todo]').forEach((b) => {
      const want = b.dataset.todo === 'none' ? undefined : b.dataset.todo === 'done';
      b.classList.toggle(
        'active',
        sel.every((n) => n.todo === want),
      );
    });
    const labels = (node.labels ?? []).join(', ');
    if (this.labels && document.activeElement !== this.labels && this.labels.value !== labels) this.labels.value = labels;
    // Numbers belong to the parent: they show for a topic when its siblings are numbered.
    const parents = sel.map((n) => n.parent).filter((p): p is MNode => p !== null);
    this.topic.querySelectorAll<HTMLElement>('[data-num]').forEach((b) => {
      const want = b.dataset.num === 'none' ? undefined : b.dataset.num;
      b.classList.toggle('active', parents.length > 0 && parents.every((p) => p.numbering?.format === want));
    });
    const tiered = this.topic.querySelector<HTMLButtonElement>('[data-tiered]');
    if (tiered) {
      const numbered = parents.filter((p) => p.numbering !== undefined);
      tiered.disabled = numbered.length === 0;
      tiered.classList.toggle('active', numbered.length > 0 && numbered.every((p) => p.numbering?.tiered === true));
    }
    const frame = this.topic.querySelector<HTMLElement>('[data-frame]');
    if (frame) {
      frame.classList.toggle(
        'active',
        sel.every((n) => n.boundary !== undefined),
      );
    }
    if (this.frameTitle) {
      this.frameTitle.hidden = node.boundary === undefined;
      if (document.activeElement !== this.frameTitle && this.frameTitle.value !== (node.boundary ?? ''))
        this.frameTitle.value = node.boundary ?? '';
    }
    this.topic.querySelectorAll<HTMLElement>('[data-struct]').forEach((b) => {
      const want = b.dataset.struct === 'auto' ? undefined : b.dataset.struct;
      b.classList.toggle(
        'active',
        sel.every((n) => n.structure === want),
      );
    });
    this.topic.querySelectorAll<HTMLElement>('[data-marker]').forEach((b) => {
      const id = b.dataset.marker!;
      b.classList.toggle(
        'active',
        sel.every((n) => n.markers?.includes(id)),
      );
    });
    if (this.note && document.activeElement !== this.note && this.note.value !== (node.note ?? '')) this.note.value = node.note ?? '';
    if (this.link && document.activeElement !== this.link && this.link.value !== (node.link ?? '')) this.link.value = node.link ?? '';
  }

  /** Properties of a relationship: its text, its direction, and a way to remove it. */
  private buildRel(rel: Rel): void {
    const app = this.app;
    const box = this.topic;
    clear(box);
    this.note = this.link = this.labels = this.frameTitle = null;
    const text = (this.relText = h('input', { class: 'field', type: 'text', placeholder: t('relTextPlaceholder'), spellcheck: 'false' }));
    text.value = rel.text;
    text.addEventListener('input', () => app.setRelText(rel, text.value));
    text.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        app.editor.focus();
      }
    });
    const reverse = h('button', { class: 'btn small' }, h('span', { class: 'btn-icon', html: icons.swap }), t('reverse'));
    keepFocus(reverse);
    reverse.addEventListener('click', () => app.reverseRel(rel));
    const remove = h('button', { class: 'btn small' }, h('span', { class: 'btn-icon', html: icons.trash }), t('deleteRel'));
    keepFocus(remove);
    remove.addEventListener('click', () => app.exec('delete'));
    box.append(
      h('label', null, t('relationship')),
      h('p', { class: 'rel-ends' }),
      h('label', null, t('relText')),
      text,
      h('div', { class: 'btn-row' }, reverse, remove),
    );
  }

  private buildTopic(node: MNode | null, count: number): void {
    const app = this.app;
    const box = this.topic;
    clear(box);
    this.note = null;
    this.link = null;
    this.labels = null;
    this.frameTitle = null;
    this.relText = null;
    if (!node) {
      box.append(h('p', { class: 'muted hint-text' }, t('selectHint')));
      return;
    }
    if (count > 1) box.append(h('p', { class: 'muted hint-text' }, t('nTopics', { n: count })));
    const isRoot = node === app.doc.root && count === 1;

    // Markers
    const ink = app.theme.dark ? '#e6e8ee' : '#3a3f4b';
    const grid = h('div', { class: 'marker-grid' });
    for (const g of MARKER_GROUPS) {
      const row = h('div', { class: 'marker-row' });
      for (const id of g.items) {
        const b = h('button', { class: 'marker-btn', 'data-marker': id, html: markerSvg(id, 18, ink) });
        keepFocus(b);
        b.addEventListener('click', () => app.toggleMarker(id));
        row.append(b);
      }
      grid.append(row);
    }
    box.append(h('label', null, t('markers')), grid);

    // To-do
    const todo = h('div', { class: 'seg' });
    for (const [id, label] of [
      ['none', 'todoNone'],
      ['open', 'todoOpen'],
      ['done', 'todoDone'],
    ] as const) {
      const b = h('button', { class: 'seg-btn', 'data-todo': id }, t(label));
      keepFocus(b);
      b.addEventListener('click', () => app.setTodo(id === 'none' ? undefined : id === 'done'));
      todo.append(b);
    }
    box.append(h('label', null, t('todo')), todo);

    // Labels
    const labels = (this.labels = h('input', { class: 'field', type: 'text', placeholder: t('labelsPlaceholder'), spellcheck: 'false' }));
    labels.value = (node.labels ?? []).join(', ');
    const commitLabels = (): void => {
      app.setLabels(labels.value);
      labels.value = (app.primary?.labels ?? []).join(', ');
    };
    labels.addEventListener('change', commitLabels);
    labels.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') labels.value = (node.labels ?? []).join(', ');
        app.editor.focus();
      }
    });
    box.append(h('label', null, t('labels')), labels);

    // Numbers in front of the topic and its siblings
    if (!isRoot) {
      const nums = h('div', { class: 'seg six' });
      for (const [id, label] of [
        ['none', t('todoNone')],
        ['arabic', '1.'],
        ['upper', 'A.'],
        ['lower', 'a.'],
        ['roman', 'I.'],
        ['roman-lower', 'i.'],
      ] as const) {
        const b = h('button', { class: 'seg-btn', 'data-num': id }, label);
        keepFocus(b);
        b.addEventListener('click', () => app.setNumbering(id === 'none' ? null : id));
        nums.append(b);
      }
      const tiered = h('button', { class: 'btn small toggle', 'data-tiered': true }, t('numberingTiered'));
      keepFocus(tiered);
      tiered.addEventListener('click', () => app.setNumberingTiered(!tiered.classList.contains('active')));
      box.append(h('label', { title: t('numberingHint') }, t('numbering')), nums, h('div', { class: 'btn-row after-seg' }, tiered));
    }

    // The properties of the whole branch come last.
    const branchProps = (): void => {
      if (isRoot) return;
      // Boundary: a frame around the branch, with an optional title
      const frame = h(
        'button',
        { class: 'btn small toggle', 'data-frame': true },
        h('span', { class: 'btn-icon', html: icons.boundary }),
        t('boundaryOn'),
      );
      keepFocus(frame);
      frame.addEventListener('click', () => app.toggleBoundary());
      const row = h('div', { class: 'btn-row' }, frame);
      if (count === 1) {
        const title = (this.frameTitle = h('input', {
          class: 'field',
          type: 'text',
          placeholder: t('boundaryTitle'),
          spellcheck: 'false',
        }));
        title.value = node.boundary ?? '';
        title.hidden = node.boundary === undefined;
        title.addEventListener('input', () => app.setBoundaryTitle(node, title.value));
        title.addEventListener('keydown', (e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            app.editor.focus();
          }
        });
        row.append(title);
      }
      box.append(h('label', null, t('boundary')), row);

      // Structure of this branch
      const grid2 = h('div', { class: 'struct-grid small' });
      const auto = h('button', { class: 'struct-btn auto', 'data-struct': 'auto', 'data-tip': t('structInherit') }, 'A');
      keepFocus(auto);
      auto.addEventListener('click', () => app.setBranchStructure(undefined));
      grid2.append(auto);
      for (const kind of BRANCH_KINDS) {
        const [label, icon] = STRUCTURES[kind];
        const b = h('button', { class: 'struct-btn', 'data-struct': kind, 'data-tip': t(label), 'aria-label': t(label), html: icon });
        keepFocus(b);
        b.addEventListener('click', () => app.setBranchStructure(kind));
        grid2.append(b);
      }
      box.append(h('label', null, t('branchStructure')), grid2);
    };

    if (count !== 1) {
      branchProps();
      return;
    }

    // Note
    const note = (this.note = h('textarea', { class: 'field', rows: '4', placeholder: t('notePlaceholder'), spellcheck: 'false' }));
    note.value = node.note ?? '';
    note.addEventListener('input', () => app.setNote(node, note.value));
    note.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        app.editor.focus();
      }
    });
    box.append(h('label', null, t('note')), note);

    // Link
    const link = (this.link = h('input', {
      class: 'field',
      type: 'text',
      inputmode: 'url',
      placeholder: t('linkPlaceholder'),
      spellcheck: 'false',
    }));
    link.value = node.link ?? '';
    const commit = (): void => {
      if (link.value.trim() !== (node.link ?? '')) app.setLink(node, link.value);
      link.value = node.link ?? '';
    };
    link.addEventListener('change', commit);
    link.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') link.value = node.link ?? '';
        app.editor.focus();
      }
    });
    const go = h('button', { class: 'icon-btn', 'data-tip': t('openLink'), html: icons.external });
    go.addEventListener('click', () => {
      commit();
      if (node.link) openExternal(node.link);
    });
    box.append(h('label', null, t('link')), h('div', { class: 'link-row' }, link, go));
    branchProps();
  }

  // -------------------------------------------------------------- style page

  /** How the selected topics look: quick styles, shape, colors, text, width. */
  private buildStyle(node: MNode | null, count: number): void {
    const app = this.app;
    const box = this.styleBox;
    this.closeColors();
    clear(box);
    this.styleWells = [];
    this.width = null;
    this.sizeValue = null;
    if (!node) {
      box.append(h('p', { class: 'muted hint-text' }, t('styleHint')));
      return;
    }
    if (count > 1) box.append(h('p', { class: 'muted hint-text' }, t('nTopics', { n: count })));
    const sel = (): readonly MNode[] => app.sel;
    const button = (
      cls: string,
      attrs: Record<string, unknown> | null,
      run: () => void,
      ...content: (Node | string)[]
    ): HTMLButtonElement => {
      const b = h('button', { class: cls, ...attrs }, ...content);
      keepFocus(b);
      b.addEventListener('click', run);
      return b;
    };
    const icon = (svg: string): HTMLElement => h('span', { class: 'btn-icon', html: svg });

    // Quick styles, with the way back to the theme's look beside the heading
    box.append(
      h(
        'div',
        { class: 'label-row' },
        h('label', null, t('quickStyle')),
        button(
          'icon-btn tip-end',
          { 'data-quick': 'reset', 'data-tip': t('resetStyle'), 'aria-label': t('resetStyle'), html: icons.reset },
          () => app.resetStyle(),
        ),
      ),
      h(
        'div',
        { class: 'btn-row wrap' },
        button('btn small toggle', { 'data-quick': 'important' }, () => app.quickStyle('important'), icon(icons.star), t('important')),
        button('btn small toggle', { 'data-quick': 'crossed' }, () => app.quickStyle('crossed'), icon(icons.strike), t('crossed')),
      ),
    );

    // Shape
    const shapes = h('div', { class: 'struct-grid small shapes' });
    shapes.append(
      button('struct-btn auto', { 'data-shape': 'auto', 'data-tip': t('shapeAuto') }, () => app.patchStyle({ shape: null }), 'A'),
    );
    SHAPES.forEach((shape, i) => {
      const label = t(SHAPE_LABELS[shape]);
      // The tips of the last buttons open towards the middle of the panel.
      const cls = 'struct-btn' + (i >= SHAPES.length - 2 ? ' tip-end' : '');
      shapes.append(
        button(cls, { 'data-shape': shape, 'data-tip': label, 'aria-label': label, html: SHAPE_ICONS[shape] }, () =>
          app.patchStyle({ shape }),
        ),
      );
    });
    box.append(h('label', null, t('shape')), shapes);

    // Colors
    const row = (label: MsgKey, control: HTMLElement): HTMLElement => h('div', { class: 'prop-row' }, h('span', null, t(label)), control);
    box.append(
      row(
        'fill',
        this.well(this.styleWells, {
          value: () => common(sel().map((n) => n.style?.fill)),
          none: true,
          pick: (color, live) => app.patchStyle({ fill: color }, live),
        }),
      ),
      row(
        'border',
        this.well(this.styleWells, {
          value: () => common(sel().map((n) => n.style?.border)),
          pick: (color, live) => app.patchStyle({ border: color }, live),
        }),
      ),
      row(
        'textColor',
        this.well(this.styleWells, {
          value: () => common(sel().map((n) => n.style?.color)),
          pick: (color, live) => app.patchStyle({ color }, live),
        }),
      ),
    );

    // Text: weight, slant, strikethrough and size
    const size = (this.sizeValue = h('button', { class: 'size-value', 'data-tip': t('reset'), 'aria-label': t('fontSize') }));
    keepFocus(size);
    size.addEventListener('click', () => app.stepFontSize(null));
    box.append(
      h('label', null, t('textStyle')),
      h(
        'div',
        { class: 'btn-row' },
        button(
          'btn small toggle glyph bold',
          { 'data-text': 'bold', 'data-tip': t('bold'), 'aria-label': t('bold') },
          () => app.toggleBold(),
          'B',
        ),
        button(
          'btn small toggle glyph italic',
          { 'data-text': 'italic', 'data-tip': t('italic'), 'aria-label': t('italic') },
          () => app.toggleFlag('italic'),
          'I',
        ),
        button(
          'btn small toggle glyph strike',
          { 'data-text': 'strike', 'data-tip': t('strike'), 'aria-label': t('strike') },
          () => app.toggleFlag('strike'),
          'S',
        ),
        h('span', { class: 'spacer' }),
        button('btn small step', { 'data-tip': t('smaller'), 'aria-label': t('smaller'), html: icons.minus }, () => app.stepFontSize(-1)),
        size,
        button('btn small step tip-end', { 'data-tip': t('larger'), 'aria-label': t('larger'), html: icons.plus }, () =>
          app.stepFontSize(1),
        ),
      ),
    );

    // Width of the text block
    const width = (this.width = h('input', {
      class: 'field',
      type: 'number',
      inputmode: 'numeric',
      min: String(MIN_WIDTH),
      max: String(MAX_WIDTH),
      step: '10',
      placeholder: t('widthAuto'),
    }));
    const commitWidth = (): void => {
      const v = width.value.trim() === '' ? NaN : Number(width.value);
      app.setWidth(Number.isFinite(v) ? v : undefined);
      this.syncStyle();
    };
    width.addEventListener('change', commitWidth);
    width.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') width.value = '';
        app.editor.focus();
      }
    });
    box.append(
      h('label', null, t('width')),
      h(
        'div',
        { class: 'btn-row' },
        width,
        button('icon-btn tip-end', { 'data-tip': t('widthReset'), 'aria-label': t('widthReset'), html: icons.reset }, () =>
          app.setWidth(undefined),
        ),
      ),
    );

    // Branch color
    if (!(node === app.doc.root && count === 1)) {
      const sw = h('div', { class: 'swatches' });
      sw.append(button('swatch auto', { 'data-color': 'auto', 'data-tip': t('colorAuto') }, () => app.setColor(undefined), 'A'));
      app.theme.palette.forEach((color, i) => {
        sw.append(button('swatch', { 'data-color': String(i), style: { background: color } }, () => app.setColor(i)));
      });
      const custom = h('input', { type: 'color', class: 'swatch custom', title: t('colorCustom') });
      custom.addEventListener('input', () => app.setColor(custom.value.toLowerCase(), true));
      sw.append(custom);
      box.append(h('label', null, t('color')), sw);
    }

    // Passing a style on
    box.append(
      h(
        'div',
        { class: 'btn-row last' },
        button('btn small', { 'data-copy': true }, () => app.copyStyle(), icon(icons.copyStyle), t('copyStyle')),
        button(
          'btn small',
          { 'data-paste': true, 'data-tip': t('pasteStyle'), 'aria-label': t('pasteStyle') },
          () => app.pasteStyle(),
          t('paste'),
        ),
      ),
      h(
        'div',
        { class: 'btn-row' },
        button('btn small', { 'data-level': true }, () => app.applyStyleToLevel(), icon(icons.levels), t('styleToLevel')),
      ),
    );
  }

  /** Shows the current values on the style page. */
  private syncStyle(): void {
    const app = this.app;
    const sel = app.sel;
    const box = this.styleBox;
    this.syncWells(this.styleWells);
    if (!sel.length) return;
    box.querySelectorAll<HTMLElement>('[data-quick]').forEach((b) => {
      const kind = b.dataset.quick;
      if (kind === 'reset') (b as HTMLButtonElement).disabled = sel.every((n) => n.style === undefined);
      else b.classList.toggle('active', app.hasQuickStyle(kind === 'important' ? 'important' : 'crossed'));
    });
    box.querySelectorAll<HTMLElement>('[data-shape]').forEach((b) => {
      const want = b.dataset.shape === 'auto' ? undefined : b.dataset.shape;
      b.classList.toggle(
        'active',
        sel.every((n) => n.style?.shape === want),
      );
    });
    box.querySelectorAll<HTMLElement>('[data-text]').forEach((b) => {
      const key = b.dataset.text as 'bold' | 'italic' | 'strike';
      b.classList.toggle(
        'active',
        sel.every((n) => (key === 'bold' ? app.isBold(n) : n.style?.[key] === true)),
      );
    });
    if (this.sizeValue) {
      const size = common(sel.map((n) => app.fontSize(n)));
      this.sizeValue.textContent = size === null ? '–' : String(size);
      this.sizeValue.classList.toggle(
        'set',
        sel.some((n) => n.style?.size !== undefined),
      );
    }
    if (this.width && document.activeElement !== this.width) {
      const w = common(sel.map((n) => n.width));
      const text = w === null || w === undefined ? '' : String(w);
      if (this.width.value !== text) this.width.value = text;
    }
    box.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => {
      const ref = b.dataset.color!;
      b.classList.toggle(
        'active',
        sel.every((n) => String(n.color ?? 'auto') === ref),
      );
    });
    const paste = box.querySelector<HTMLButtonElement>('[data-paste]');
    if (paste) paste.disabled = !app.canPasteStyle;
    const single = sel.length === 1;
    const copy = box.querySelector<HTMLButtonElement>('[data-copy]');
    if (copy) copy.disabled = !single;
    const level = box.querySelector<HTMLButtonElement>('[data-level]');
    if (level) level.disabled = !single;
  }
}
