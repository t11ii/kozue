// Format panel: theme, structure and the properties of the selected topic.

import type { App } from '../app/app.ts';
import { rememberTheme } from '../app/files.ts';
import type { TextMeasurer } from '../core/layout.ts';
import { layoutDoc } from '../core/layout.ts';
import { MARKER_GROUPS } from '../core/markers.ts';
import type { LayoutKind, MNode, NodeData, Rel } from '../core/model.ts';
import { Doc, fromData, normalizeMains } from '../core/model.ts';
import type { Theme } from '../core/themes.ts';
import { BRANCH_KINDS, LAYOUT_KINDS } from '../core/structures.ts';
import { THEMES } from '../core/themes.ts';
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

type Tab = 'map' | 'topic';

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
  private tab: Tab = recall(TAB_KEY) === 'topic' ? 'topic' : 'map';
  private tabBtns = new Map<Tab, HTMLElement>();
  private pages = new Map<Tab, HTMLElement>();
  private themeCards = new Map<string, HTMLElement>();
  private structBtns = new Map<LayoutKind, HTMLElement>();
  private structName!: HTMLElement;
  private filterBox!: HTMLElement;
  private topic!: HTMLElement;
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
      if (what === 'theme') this.syncMap();
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
    }
    if (user && changed) {
      remember(OPEN_KEY, open ? '1' : '0');
      // Keep the map centered in the space that is left.
      this.app.shiftView(((PANEL_WIDTH + 8) / 2) * (open ? -1 : 1), 0);
    }
    this.app.emit('view');
  }

  private showTab(tab: Tab): void {
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

  /** Rebuilds everything (after a language change). */
  rebuild(): void {
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
    this.filterBox = h('div', { class: 'filter-box' });

    const tabs = h('div', { class: 'seg tabs' });
    for (const [id, label] of [
      ['map', 'tabMap'],
      ['topic', 'tabTopic'],
    ] as const) {
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
      h('section', null, h('h3', null, t('filter')), this.filterBox),
    );
    const topicPage = h('div', { class: 'page' }, this.topic);
    this.pages.set('map', mapPage);
    this.pages.set('topic', topicPage);
    this.el.append(tabs, mapPage, topicPage);
    this.showTab(this.tab);
  }

  private syncMap(): void {
    const doc = this.app.doc;
    for (const [id, card] of this.themeCards) card.classList.toggle('active', id === doc.theme);
    for (const [kind, b] of this.structBtns) b.classList.toggle('active', kind === doc.layout);
    this.structName.textContent = t(STRUCTURES[doc.layout][0]);
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
    if (node !== this.shown || rel !== this.shownRel || count !== this.shownCount || app.theme.id !== this.shownTheme) {
      this.shown = node;
      this.shownRel = rel;
      this.shownCount = count;
      this.shownTheme = app.theme.id;
      if (rel) this.buildRel(rel);
      else this.buildTopic(node, count);
    }
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
    this.topic.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => {
      const ref = b.dataset.color!;
      b.classList.toggle(
        'active',
        sel.every((n) => String(n.color ?? 'auto') === ref),
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

    // Branch color
    const isRoot = node === app.doc.root && count === 1;
    if (!isRoot) {
      const sw = h('div', { class: 'swatches' });
      const auto = h('button', { class: 'swatch auto', 'data-color': 'auto', 'data-tip': t('colorAuto') }, 'A');
      keepFocus(auto);
      auto.addEventListener('click', () => app.setColor(undefined));
      sw.append(auto);
      app.theme.palette.forEach((color, i) => {
        const b = h('button', { class: 'swatch', 'data-color': String(i), style: { background: color } });
        keepFocus(b);
        b.addEventListener('click', () => app.setColor(i));
        sw.append(b);
      });
      const custom = h('input', { type: 'color', class: 'swatch custom', title: '' });
      custom.addEventListener('input', () => app.setColor(custom.value.toLowerCase(), true));
      sw.append(custom);
      box.append(h('label', null, t('color')), sw);
    }

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
}
