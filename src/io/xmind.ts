// Xmind (.xmind) import and export.
// Modern files are ZIP archives with a `content.json`; Xmind 8 and older
// use `content.xml`. Both are read; export writes the modern format.

import type { FileData, SheetData } from '../core/book.ts';
import { cleanSheetName, isBookData } from '../core/book.ts';
import type { LayoutKind, MapStyle, NodeData, NumberFormat, Numbering, RelData, Shape, TopicStyle } from '../core/model.ts';
import { MARKER_IDS } from '../core/markers.ts';
import { cleanStyle, cleanWidth, isTopicLink } from '../core/model.ts';
import type { XmlEl } from './xml.ts';
import { childOf, childrenOf, findEl, parseXml } from './xml.ts';
import { unzip, zip } from './zip.ts';

export interface XmindSheet {
  /** The title of the sheet, when it says more than a default ("Sheet 1") or the central topic does. */
  name?: string;
  root: NodeData;
  layout: LayoutKind;
  relationships?: RelData[];
  /** The sheet's own background. */
  style?: MapStyle;
}

/** The first sheet (all there is in most files), and the list of all sheets. */
export interface XmindImport extends XmindSheet {
  sheets: XmindSheet[];
}

/** Titles that Xmind (and Kozue) give a sheet when the user does not. */
const DEFAULT_TITLE = /^(sheet|map|canvas|シート|マップ|画布|工作表)\s*\d*$/i;

/** A sheet title as a sheet name: nothing for default titles and for a mere copy of the central topic. */
function sheetName(title: unknown, root: NodeData): string | undefined {
  const name = cleanSheetName(title);
  if (!name || DEFAULT_TITLE.test(name) || name === cleanSheetName(root.text.split('\n')[0])) return undefined;
  return name;
}

function importOf(sheets: XmindSheet[]): XmindImport {
  if (!sheets.length) throw new Error('The Xmind file has no sheets');
  return { ...sheets[0], sheets };
}

/** Xmind's names for markers that differ from Kozue's. (Many are the same and need no entry.) */
const IN_MARKERS: Record<string, string> = {
  'task-start': 't0',
  'task-oct': 't25',
  'task-quarter': 't25',
  'task-3oct': 't25',
  'task-half': 't50',
  'task-5oct': 't50',
  'task-3quar': 't75',
  'task-7oct': 't75',
  'task-done': 'done',
  'flag-dark-blue': 'flag-blue',
  'flag-dark-green': 'flag-green',
  'flag-dark-gray': 'flag-gray',
  'star-orange': 'star',
  'star-yellow': 'star',
  'star-dark-blue': 'star-blue',
  'star-dark-green': 'star-green',
  'star-dark-gray': 'star-gray',
  'people-yellow': 'people-orange',
  'people-dark-blue': 'people-blue',
  'people-dark-green': 'people-green',
  'people-dark-gray': 'people-gray',
  'symbol-question': 'q',
  'symbol-exclam': 'ex',
  'symbol-attention': 'warn',
  'symbol-info': 'info',
  'symbol-wrong': 'x',
  'symbol-right': 'done',
  'symbol-plus': 'plus',
  'symbol-minus': 'minus',
  'symbol-pin': 'pin',
  'symbol-idea': 'idea',
  'symbol-lightning': 'idea',
  'symbol-lock': 'lock',
  'symbol-clock': 'clock',
  'symbol-time': 'clock',
  'symbol-calendar': 'calendar',
  'symbol-money': 'money',
  'symbol-dollar': 'money',
  'smiley-smile': 'face-smile',
  'smiley-laugh': 'face-laugh',
  'smiley-boring': 'face-neutral',
  'smiley-embarrass': 'face-neutral',
  'smiley-cry': 'face-sad',
  'smiley-angry': 'face-angry',
  'smiley-surprise': 'face-surprise',
  c_symbol_heart: 'heart',
  c_symbol_like: 'like',
  c_symbol_dislike: 'dislike',
  c_symbol_money: 'money',
  c_symbol_pen: 'idea',
};

/** Kozue's names for markers that differ from Xmind's. */
const OUT_MARKERS: Record<string, string> = {
  t0: 'task-start',
  t25: 'task-quarter',
  t50: 'task-half',
  t75: 'task-3quar',
  done: 'task-done',
  star: 'star-orange',
  heart: 'c_symbol_heart',
  like: 'c_symbol_like',
  dislike: 'c_symbol_dislike',
  money: 'c_symbol_money',
  q: 'symbol-question',
  ex: 'symbol-exclam',
  warn: 'symbol-attention',
  info: 'symbol-info',
  x: 'symbol-wrong',
  plus: 'symbol-plus',
  minus: 'symbol-minus',
  pin: 'symbol-pin',
  idea: 'symbol-idea',
  lock: 'symbol-lock',
  clock: 'symbol-clock',
  calendar: 'symbol-calendar',
  'face-smile': 'smiley-smile',
  'face-laugh': 'smiley-laugh',
  'face-neutral': 'smiley-boring',
  'face-sad': 'smiley-cry',
  'face-angry': 'smiley-angry',
  'face-surprise': 'smiley-surprise',
};

/** Kozue's marker for one of Xmind's, if there is a counterpart. */
function markerFrom(raw: string): string | undefined {
  const pr = /^priority-(\d)$/.exec(raw);
  if (pr) return 'p' + Math.min(9, Math.max(1, Number(pr[1])));
  const m = IN_MARKERS[raw] ?? raw;
  return MARKER_IDS.has(m) ? m : undefined;
}

/** Xmind's marker for one of Kozue's. Flags, stars, people and arrows go by the same names in both. */
function markerTo(id: string): string {
  const pr = /^p(\d)$/.exec(id);
  return pr ? 'priority-' + pr[1] : (OUT_MARKERS[id] ?? id);
}

function mapMarkers(ids: readonly unknown[]): string[] | undefined {
  const out: string[] = [];
  for (const raw of ids) {
    const m = typeof raw === 'string' ? markerFrom(raw) : undefined;
    if (m && !out.includes(m)) out.push(m);
  }
  return out.length ? out : undefined;
}

function layoutOf(structure: unknown): LayoutKind {
  const s = typeof structure === 'string' ? structure.toLowerCase() : '';
  if (s.includes('org-chart')) return s.endsWith('.up') ? 'org-up' : 'org';
  if (s.includes('logic')) return s.endsWith('.left') ? 'logic-left' : 'logic';
  if (s.includes('brace')) return 'brace';
  if (s.includes('fishbone')) return s.includes('right') ? 'fishbone-right' : 'fishbone';
  if (s.includes('timeline')) return s.includes('vertical') ? 'timeline-v' : 'timeline';
  if (s.includes('tree')) return 'tree'; // tree chart and tree table
  return 'map';
}

/** Xmind's link to another topic of the workbook: "xmind:#" and the id of that topic. */
const TOPIC_HREF = /^xmind:#(.+)$/;

/** An id as Kozue keeps it. (One that looks like Kozue's own ids for the ends of relationships, "t1", would be taken for such.) */
const idOf = (id: string): string => (/^t\d+$/.test(id) ? 'x' + id : id);

/**
 * A link Kozue can follow: to the web, or to another topic of the file.
 * @param kept the ids that topics keep; a link to a topic that is not in the file is dropped
 */
function linkFrom(href: unknown, kept: ReadonlySet<string>): string | undefined {
  if (typeof href !== 'string') return undefined;
  const topic = TOPIC_HREF.exec(href);
  if (topic) {
    const link = '#' + idOf(topic[1]);
    return kept.has(topic[1]) && isTopicLink(link) ? link : undefined;
  }
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

/** The ids that topic links point at, as far as those topics are in the file. */
const targetsOf = (ids: ReadonlySet<string>, hrefs: ReadonlySet<string>): Set<string> => new Set([...hrefs].filter((id) => ids.has(id)));

const cleanTitle = (s: unknown): string => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n') : '');

/** Xmind marks a to-do with an extension of this provider. (Read and written on a best-effort basis.) */
const TASK = 'org.xmind.ui.task';

/** "(2,4)" → [2, 4]; "master" (the topic itself) and anything else → null. */
function parseRange(range: unknown): [number, number] | null {
  const m = typeof range === 'string' ? /^\((\d+),(\d+)\)$/.exec(range.trim()) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

interface Extras {
  /** Structure class of the topic itself. */
  structure?: unknown;
  /** Boundaries around ranges of children: range and title. */
  boundaries: [unknown, string][];
  /** Summaries of ranges of children: range and the summary topic. */
  summaries: [unknown, NodeData | undefined][];
}

/** Applies what Xmind keeps beside the tree (branch structure, boundaries, summaries) to an imported topic. */
function applyExtras(n: NodeData, x: Extras, isRoot: boolean): void {
  const kids = n.children ?? [];
  if (!isRoot) {
    const kind = x.structure === undefined ? 'map' : layoutOf(x.structure);
    if (kind !== 'map') n.structure = kind;
  }
  for (const [range, title] of x.boundaries) {
    const r = parseRange(range);
    if (r) {
      // Kozue frames single branches: a boundary around several topics becomes one frame each.
      for (let i = r[0]; i <= Math.min(r[1], kids.length - 1); i++) kids[i].boundary = i === r[0] ? title : '';
    } else if (range === 'master' && !isRoot) n.boundary = title;
  }
  // A summary topic goes right behind the topics it sums up. Later ranges first,
  // so that the positions of the earlier ones stay valid while inserting.
  const sums = x.summaries
    .map(([range, topic]) => ({ r: parseRange(range), topic }))
    .filter(
      (s): s is { r: [number, number]; topic: NodeData } =>
        s.r !== null && s.topic !== undefined && s.r[0] <= s.r[1] && s.r[1] < kids.length,
    )
    .sort((a, b) => b.r[1] - a.r[1]);
  let limit = Infinity; // ranges may not overlap: each one ends before the next begins
  for (const { r, topic } of sums) {
    if (r[1] >= limit) continue;
    topic.summary = r[1] - r[0] + 1;
    kids.splice(r[1] + 1, 0, topic);
    limit = r[0];
  }
  if (kids.length && !n.children) n.children = kids;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ------------------------------------------------------------------ styles
// Xmind describes the look of a topic with a list of properties. Kozue reads and
// writes the ones it has a counterpart for (on a best-effort basis: what a theme
// gives a topic without saying so in the file is not carried over).

const SHAPE_CLASSES: Record<Shape, string> = {
  rounded: 'org.xmind.topicShape.roundedRect',
  rect: 'org.xmind.topicShape.rect',
  pill: 'org.xmind.topicShape.ellipserect',
  ellipse: 'org.xmind.topicShape.ellipse',
  diamond: 'org.xmind.topicShape.diamond',
  underline: 'org.xmind.topicShape.underline',
  none: 'org.xmind.topicShape.noBorder',
};

function shapeOf(v: unknown): Shape | undefined {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (!s.includes('topicshape')) return undefined;
  if (s.includes('underline')) return 'underline';
  if (s.includes('noborder')) return 'none';
  if (s.includes('diamond')) return 'diamond';
  if (s.includes('ellipserect') || s.includes('ellipticrect')) return 'pill';
  if (s.includes('ellipse') || s.includes('circle')) return 'ellipse';
  if (s.includes('roundedrect')) return 'rounded';
  if (s.endsWith('.rect') || s.includes('rectangle')) return 'rect';
  return undefined; // one of the many shapes Kozue does not have: the theme decides
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` → `#rrggbb`; `none` for "none" or a fully transparent color. */
function colorOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const raw = v.trim().toLowerCase();
  if (raw === 'none') return 'none';
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(raw);
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  if (h.length === 8) {
    if (h.endsWith('00')) return 'none';
    h = h.slice(0, 6);
  }
  return '#' + h;
}

function styleFrom(props: Json): TopicStyle | undefined {
  const s: Record<string, unknown> = {};
  const shape = shapeOf(props['shape-class']);
  if (shape) s.shape = shape;
  const fill = colorOf(props['svg:fill']);
  if (fill !== undefined) s.fill = fill;
  const border = colorOf(props['border-line-color']);
  if (border !== undefined && border !== 'none' && parseFloat(String(props['border-line-width'] ?? '1')) !== 0) s.border = border;
  const color = colorOf(props['fo:color']);
  if (color !== undefined && color !== 'none') s.color = color;
  const weight = String(props['fo:font-weight'] ?? '').toLowerCase();
  if (weight === 'bold' || Number(weight) >= 600) s.bold = true;
  else if (weight === 'normal' || (weight !== '' && Number(weight) <= 500)) s.bold = false;
  if (String(props['fo:font-style'] ?? '').toLowerCase() === 'italic') s.italic = true;
  if (
    String(props['fo:text-decoration'] ?? '')
      .toLowerCase()
      .includes('line-through')
  )
    s.strike = true;
  const size = parseFloat(String(props['fo:font-size'] ?? ''));
  if (Number.isFinite(size) && size > 0) s.size = size;
  return cleanStyle(s);
}

function styleTo(st: TopicStyle): Json {
  const p: Json = {};
  if (st.shape) p['shape-class'] = SHAPE_CLASSES[st.shape];
  if (st.fill) p['svg:fill'] = st.fill;
  if (st.border) {
    p['border-line-color'] = st.border;
    p['border-line-width'] = '2pt';
  }
  if (st.color) p['fo:color'] = st.color;
  if (st.bold !== undefined) p['fo:font-weight'] = st.bold ? 'bold' : 'normal';
  if (st.italic) p['fo:font-style'] = 'italic';
  if (st.strike) p['fo:text-decoration'] = 'line-through';
  if (st.size !== undefined) p['fo:font-size'] = st.size + 'pt';
  return p;
}

/** Xmind's names for the ways of numbering subtopics. (It has a single kind of Roman numerals.) */
const NUMBER_CLASSES: Record<NumberFormat, string> = {
  arabic: 'org.xmind.numbering.arabic',
  upper: 'org.xmind.numbering.uppercase',
  lower: 'org.xmind.numbering.lowercase',
  roman: 'org.xmind.numbering.roman',
  'roman-lower': 'org.xmind.numbering.roman',
};

/** The numbering a topic gives its subtopics: `format` and `tiered` as Xmind writes them in either file form. */
function numberingFrom(format: unknown, tiered: unknown): Numbering | undefined {
  const f = typeof format === 'string' ? format.toLowerCase() : '';
  const kind: NumberFormat | undefined = f.endsWith('.arabic')
    ? 'arabic'
    : f.endsWith('.uppercase')
      ? 'upper'
      : f.endsWith('.lowercase')
        ? 'lower'
        : f.endsWith('.roman')
          ? 'roman'
          : undefined;
  if (!kind) return undefined;
  return tiered === true || tiered === 'true' ? { format: kind, tiered: true } : { format: kind };
}

/** The background a sheet was given, if it is a plain color. */
function mapStyleFrom(props: Json): MapStyle | undefined {
  const bg = colorOf(props['svg:fill']);
  return bg !== undefined && bg !== 'none' ? { background: bg } : undefined;
}

// ------------------------------------------------------------ content.json

/** Collects the ids of a topic and of all below it, and the ids that their topic links point at. */
function scanJson(raw: unknown, ids: Set<string>, hrefs: Set<string>): void {
  const t = obj(raw);
  if (typeof t.id === 'string') ids.add(t.id);
  const topic = typeof t.href === 'string' ? TOPIC_HREF.exec(t.href) : null;
  if (topic) hrefs.add(topic[1]);
  for (const group of Object.values(obj(t.children))) for (const k of arr(group)) scanJson(k, ids, hrefs);
}

/**
 * @param ends ids of the topics that relationships connect or links point at; those keep their id
 * @param isRoot the central topic (which has no structure, boundary or to-do of its own)
 */
function fromJsonTopic(raw: unknown, ends: ReadonlySet<string>, isRoot = false): NodeData {
  const t = obj(raw);
  const n: NodeData = { text: cleanTitle(t.title) };
  if (typeof t.id === 'string' && ends.has(t.id)) n.id = idOf(t.id);
  const note = obj(obj(t.notes).plain).content;
  if (typeof note === 'string' && note.trim()) n.note = note.replace(/\r\n?/g, '\n').trim();
  const link = linkFrom(t.href, ends);
  if (link) n.link = link;
  const markers = mapMarkers(arr(t.markers).map((m) => obj(m).markerId));
  if (markers) n.markers = markers;
  const labels = arr(t.labels).filter((l): l is string => typeof l === 'string' && l.trim() !== '');
  if (labels.length) n.labels = labels;
  for (const ext of arr(t.extensions)) {
    const status = obj(ext).provider === TASK ? obj(obj(ext).content).status : undefined;
    if (status === 'done' || status === 'todo') n.todo = status === 'done';
  }
  const style = styleFrom(obj(obj(t.style).properties));
  if (style) n.style = style;
  const width = cleanWidth(t.customWidth);
  if (width !== undefined) n.width = width;
  const numbering = numberingFrom(obj(t.numbering).numberFormat, obj(t.numbering).prependingNumbers);
  if (numbering) n.numbering = numbering;
  const children = obj(t.children);
  const kids = arr(children.attached);
  if (kids.length) {
    n.children = kids.map((k) => fromJsonTopic(k, ends));
    if (t.branch === 'folded') n.collapsed = true;
  }
  const summaryTopics = new Map<unknown, NodeData>();
  for (const st of arr(children.summary)) summaryTopics.set(obj(st).id, fromJsonTopic(st, ends));
  applyExtras(
    n,
    {
      structure: t.structureClass,
      boundaries: arr(t.boundaries).map((b) => [obj(b).range, cleanTitle(obj(b).title).replace(/\s+/g, ' ').trim()]),
      summaries: arr(t.summaries).map((sm) => [obj(sm).range, summaryTopics.get(obj(sm).topicId)]),
    },
    isRoot,
  );
  return n;
}

/** @param targets ids that topic links point at, anywhere in the workbook */
function sheetFromJson(raw: unknown, targets: ReadonlySet<string>): XmindSheet | null {
  const sheet = obj(raw);
  const rt = obj(sheet.rootTopic);
  if (!sheet.rootTopic) return null;
  const relationships: RelData[] = [];
  for (const rawRel of arr(sheet.relationships)) {
    const r = obj(rawRel);
    if (typeof r.end1Id !== 'string' || typeof r.end2Id !== 'string') continue;
    const title = cleanTitle(r.title).replace(/\s+/g, ' ').trim();
    relationships.push(title ? { from: r.end1Id, to: r.end2Id, text: title } : { from: r.end1Id, to: r.end2Id });
  }
  const ends = new Set([...relationships.flatMap((r) => [r.from, r.to]), ...targets]);
  for (const r of relationships) [r.from, r.to] = [idOf(r.from), idOf(r.to)];
  const root = fromJsonTopic(rt, ends, true);
  // Floating topics would otherwise be lost: keep them as main topics.
  const detached = arr(obj(rt.children).detached).map((k) => fromJsonTopic(k, ends));
  if (detached.length) root.children = [...(root.children ?? []), ...detached];
  delete root.collapsed;

  const layout = layoutOf(rt.structureClass);
  if (layout === 'map' && root.children) {
    // "right-number" says how many leading main topics sit on the right side.
    let right = -1;
    for (const ext of arr(rt.extensions)) {
      for (const c of arr(obj(ext).content)) {
        const item = obj(c);
        if (item.name === 'right-number') right = Number(item.content);
      }
    }
    // Summary topics were inserted among the main topics: count the ordinary ones only.
    let seen = 0;
    let side: 'l' | 'r' = 'r';
    if (Number.isInteger(right) && right >= 0) {
      for (const k of root.children) {
        if (k.summary === undefined) side = seen++ < right ? 'r' : 'l';
        k.side = side;
      }
    }
  }
  const style = mapStyleFrom(obj(obj(sheet.style).properties));
  const name = sheetName(sheet.title, root);
  return { ...(name ? { name } : {}), root, layout, ...(relationships.length ? { relationships } : {}), ...(style ? { style } : {}) };
}

function fromJson(text: string): XmindImport {
  const sheets: XmindSheet[] = [];
  const raws = arr(JSON.parse(text));
  // A link may point at a topic of another sheet: look at all of them first.
  const ids = new Set<string>();
  const hrefs = new Set<string>();
  for (const raw of raws) scanJson(obj(raw).rootTopic, ids, hrefs);
  const targets = targetsOf(ids, hrefs);
  for (const raw of raws) {
    const sheet = sheetFromJson(raw, targets);
    if (sheet) sheets.push(sheet);
  }
  return importOf(sheets);
}

// ------------------------------------------------------------- content.xml

/** Styles of an Xmind 8 file by id: they live in a file of their own (styles.xml). */
type XmlStyles = ReadonlyMap<string, Json>;

function readXmlStyles(text: string | undefined): XmlStyles {
  const styles = new Map<string, Json>();
  if (!text) return styles;
  const visit = (el: XmlEl): void => {
    if (el.name === 'style' && el.attrs.id) {
      const props = el.children.find((c) => c.name.endsWith('-properties'));
      if (props) styles.set(el.attrs.id, props.attrs);
    }
    for (const c of el.children) visit(c);
  };
  try {
    visit(parseXml(text));
  } catch {
    /* a map without its styles is still a map */
  }
  return styles;
}

/** Collects the ids of a topic and of all below it, and the ids that their topic links point at. */
function scanXml(el: XmlEl, ids: Set<string>, hrefs: Set<string>): void {
  if (el.attrs.id) ids.add(el.attrs.id);
  const topic = TOPIC_HREF.exec(el.attrs['xlink:href'] ?? '');
  if (topic) hrefs.add(topic[1]);
  for (const group of childrenOf(childOf(el, 'children'), 'topics')) for (const t of childrenOf(group, 'topic')) scanXml(t, ids, hrefs);
}

function fromXmlTopic(el: XmlEl, ends: ReadonlySet<string>, styles: XmlStyles, isRoot = false): NodeData {
  const n: NodeData = { text: cleanTitle(childOf(el, 'title')?.text) };
  if (el.attrs.id && ends.has(el.attrs.id)) n.id = idOf(el.attrs.id);
  const props = el.attrs['style-id'] ? styles.get(el.attrs['style-id']) : undefined;
  const style = props ? styleFrom(props) : undefined;
  if (style) n.style = style;
  const width = el.attrs['svg:width'] ? cleanWidth(parseFloat(el.attrs['svg:width'])) : undefined;
  if (width !== undefined) n.width = width;
  const numberingEl = childOf(el, 'numbering');
  const numbering = numberingEl ? numberingFrom(numberingEl.attrs['number-format'], numberingEl.attrs['prepending-numbers']) : undefined;
  if (numbering) n.numbering = numbering;
  const note = childOf(childOf(el, 'notes'), 'plain')?.text.trim();
  if (note) n.note = note.replace(/\r\n?/g, '\n');
  const link = linkFrom(el.attrs['xlink:href'], ends);
  if (link) n.link = link;
  const markers = mapMarkers(childrenOf(childOf(el, 'marker-refs'), 'marker-ref').map((m) => m.attrs['marker-id']));
  if (markers) n.markers = markers;
  const labels = childrenOf(childOf(el, 'labels'), 'label')
    .map((l) => l.text.trim())
    .filter(Boolean);
  if (labels.length) n.labels = labels;
  const kids: NodeData[] = [];
  const summaryTopics = new Map<unknown, NodeData>();
  for (const group of childrenOf(childOf(el, 'children'), 'topics')) {
    // Floating topics (only the central topic has them) are kept as ordinary children.
    if (group.attrs.type === 'attached' || group.attrs.type === 'detached') {
      for (const t of childrenOf(group, 'topic')) kids.push(fromXmlTopic(t, ends, styles));
    } else if (group.attrs.type === 'summary') {
      for (const t of childrenOf(group, 'topic')) summaryTopics.set(t.attrs.id, fromXmlTopic(t, ends, styles));
    }
  }
  if (kids.length) {
    n.children = kids;
    if (el.attrs.branch === 'folded') n.collapsed = true;
  }
  const attached = childrenOf(childOf(el, 'children'), 'topics')
    .filter((g) => g.attrs.type === 'attached')
    .reduce((sum, g) => sum + childrenOf(g, 'topic').length, 0);
  // Ranges count attached topics only; floating ones were appended after them.
  const inRange = ([range]: [unknown, unknown]): boolean => {
    const r = parseRange(range);
    return !r || r[1] < attached;
  };
  applyExtras(
    n,
    {
      structure: el.attrs['structure-class'],
      boundaries: childrenOf(childOf(el, 'boundaries'), 'boundary')
        .map((b): [unknown, string] => [b.attrs.range, cleanTitle(childOf(b, 'title')?.text).replace(/\s+/g, ' ').trim()])
        .filter(inRange),
      summaries: childrenOf(childOf(el, 'summaries'), 'summary')
        .map((sm): [unknown, NodeData | undefined] => [sm.attrs.range, summaryTopics.get(sm.attrs['topic-id'])])
        .filter(inRange),
    },
    isRoot,
  );
  return n;
}

function fromXml(text: string, stylesText?: string): XmindImport {
  const styles = readXmlStyles(stylesText);
  const content = findEl(parseXml(text), 'xmap-content');
  const sheets: XmindSheet[] = [];
  const ids = new Set<string>();
  const hrefs = new Set<string>();
  for (const sheet of childrenOf(content, 'sheet')) {
    const topic = childOf(sheet, 'topic');
    if (topic) scanXml(topic, ids, hrefs);
  }
  const targets = targetsOf(ids, hrefs);
  for (const sheet of childrenOf(content, 'sheet')) {
    const topic = childOf(sheet, 'topic');
    if (!topic) continue;
    const relationships: RelData[] = [];
    for (const r of childrenOf(childOf(sheet, 'relationships'), 'relationship')) {
      if (!r.attrs.end1 || !r.attrs.end2) continue;
      const title = cleanTitle(childOf(r, 'title')?.text).replace(/\s+/g, ' ').trim();
      relationships.push(title ? { from: r.attrs.end1, to: r.attrs.end2, text: title } : { from: r.attrs.end1, to: r.attrs.end2 });
    }
    const ends = new Set([...relationships.flatMap((r) => [r.from, r.to]), ...targets]);
    for (const r of relationships) [r.from, r.to] = [idOf(r.from), idOf(r.to)];
    const root = fromXmlTopic(topic, ends, styles, true);
    delete root.collapsed;
    const sheetProps = sheet.attrs['style-id'] ? styles.get(sheet.attrs['style-id']) : undefined;
    const style = sheetProps ? mapStyleFrom(sheetProps) : undefined;
    const name = sheetName(childOf(sheet, 'title')?.text, root);
    sheets.push({
      ...(name ? { name } : {}),
      root,
      layout: layoutOf(topic.attrs['structure-class']),
      ...(relationships.length ? { relationships } : {}),
      ...(style ? { style } : {}),
    });
  }
  return importOf(sheets);
}

export async function parseXmind(bytes: Uint8Array): Promise<XmindImport> {
  const files = await unzip(bytes, (name) => name === 'content.json' || name === 'content.xml' || name === 'styles.xml');
  const dec = new TextDecoder();
  const json = files.get('content.json');
  if (json) return fromJson(dec.decode(json));
  const xml = files.get('content.xml');
  const styles = files.get('styles.xml');
  if (xml) return fromXml(dec.decode(xml), styles ? dec.decode(styles) : undefined);
  throw new Error('Not an Xmind file');
}

// ------------------------------------------------------------------- export

function newId(): string {
  const b = new Uint8Array(13);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Gives every topic with a Kozue id (something points at it) its Xmind id. */
function assignIds(n: NodeData, ids: Map<string, string>): Map<string, string> {
  if (n.id !== undefined && !ids.has(n.id)) ids.set(n.id, newId());
  for (const k of n.children ?? []) assignIds(k, ids);
  return ids;
}

/**
 * @param ids which Xmind id each topic with a Kozue id has in this sheet
 * @param target the Xmind id of the topic that a topic link points at (by its Kozue id), in this sheet or another
 */
function toJsonTopic(n: NodeData, ids: ReadonlyMap<string, string>, target: (ref: string) => string | undefined): Json {
  const id = (n.id !== undefined ? ids.get(n.id) : undefined) ?? newId();
  const t: Json = { id, title: n.text };
  if (n.note) t.notes = { plain: { content: n.note } };
  if (isTopicLink(n.link)) {
    const to = target(n.link.slice(1));
    if (to) t.href = 'xmind:#' + to;
  } else if (n.link) t.href = n.link;
  const markers = (n.markers ?? []).map(markerTo);
  if (markers.length) t.markers = markers.map((markerId) => ({ markerId }));
  if (n.labels?.length) t.labels = n.labels.slice();
  if (n.todo !== undefined) t.extensions = [{ provider: TASK, content: { status: n.todo ? 'done' : 'todo' } }];
  if (n.structure !== undefined) t.structureClass = STRUCTURES[n.structure];
  if (n.style) t.style = { id: newId(), properties: styleTo(n.style) };
  if (n.width !== undefined) t.customWidth = n.width;
  if (n.numbering) t.numbering = { numberFormat: NUMBER_CLASSES[n.numbering.format], prependingNumbers: n.numbering.tiered === true };
  if (n.children?.length) {
    // Xmind keeps summary topics apart from the ordinary children and frames by ranges of those.
    const attached: Json[] = [];
    const summary: Json[] = [];
    const summaries: Json[] = [];
    const boundaries: Json[] = [];
    let run = 0; // ordinary topics since the last summary
    for (const k of n.children) {
      const kt = toJsonTopic(k, ids, target);
      const covers = k.summary !== undefined ? Math.min(k.summary, run) : 0;
      if (covers > 0) {
        summary.push(kt);
        summaries.push({ id: newId(), range: `(${attached.length - covers},${attached.length - 1})`, topicId: kt.id });
        run = 0;
        continue;
      }
      if (k.boundary !== undefined) {
        const b: Json = { id: newId(), range: `(${attached.length},${attached.length})` };
        if (k.boundary) b.title = k.boundary;
        boundaries.push(b);
      }
      attached.push(kt);
      run = k.summary !== undefined ? 0 : run + 1;
    }
    t.children = summary.length ? { attached, summary } : { attached };
    if (summaries.length) t.summaries = summaries;
    if (boundaries.length) t.boundaries = boundaries;
    if (n.collapsed) t.branch = 'folded';
  }
  return t;
}

const STRUCTURES: Record<LayoutKind, string> = {
  map: 'org.xmind.ui.map.unbalanced',
  logic: 'org.xmind.ui.logic.right',
  'logic-left': 'org.xmind.ui.logic.left',
  brace: 'org.xmind.ui.brace.right',
  org: 'org.xmind.ui.org-chart.down',
  'org-up': 'org.xmind.ui.org-chart.up',
  'org-tree': 'org.xmind.ui.org-chart.down', // no direct counterpart
  tree: 'org.xmind.ui.tree.right',
  timeline: 'org.xmind.ui.timeline.horizontal',
  'timeline-v': 'org.xmind.ui.timeline.vertical',
  fishbone: 'org.xmind.ui.fishbone.leftHeaded',
  'fishbone-right': 'org.xmind.ui.fishbone.rightHeaded',
};

/** One sheet in Xmind's form. `fallback` titles a sheet that has neither a name nor a central topic text. */
function toJsonSheet(
  doc: SheetData,
  fallback: string,
  ids: ReadonlyMap<string, string>,
  target: (ref: string) => string | undefined,
): Json {
  let root = doc.root;
  let rightCount = 0;
  if (doc.layout === 'map' && root.children) {
    // Xmind expects the right-hand topics first. (Summary topics are not counted: they are kept apart.)
    const right = root.children.filter((k) => k.side !== 'l');
    const left = root.children.filter((k) => k.side === 'l');
    let run = 0;
    for (const k of right) {
      const sums = k.summary !== undefined && run > 0;
      if (!sums) rightCount++;
      run = k.summary !== undefined ? 0 : run + 1;
    }
    root = { ...root, children: [...right, ...left] };
  }
  const rootTopic = toJsonTopic(root, ids, target);
  rootTopic.class = 'topic';
  rootTopic.structureClass = STRUCTURES[doc.layout];
  delete rootTopic.branch;
  if (doc.layout === 'map') {
    rootTopic.extensions = [{ provider: 'org.xmind.ui.map.unbalanced', content: [{ name: 'right-number', content: String(rightCount) }] }];
  }
  const title = doc.name || root.text.split('\n')[0] || fallback;
  const sheet: Json = { id: newId(), class: 'sheet', title, rootTopic, topicPositioning: 'fixed' };
  const relationships: Json[] = [];
  for (const r of doc.relationships ?? []) {
    const end1Id = ids.get(r.from);
    const end2Id = ids.get(r.to);
    if (!end1Id || !end2Id) continue;
    relationships.push(r.text ? { id: newId(), end1Id, end2Id, title: r.text } : { id: newId(), end1Id, end2Id });
  }
  if (relationships.length) sheet.relationships = relationships;
  if (doc.style?.background) sheet.style = { id: newId(), properties: { 'svg:fill': doc.style.background } };
  return sheet;
}

/** Writes a document, or all sheets of a file, as an Xmind workbook. */
export async function toXmind(data: FileData, appVersion: string): Promise<Uint8Array> {
  const sheets: SheetData[] = isBookData(data) ? data.sheets : [data];
  // What relationships and links point at gets its id first: a link may point ahead, or into another sheet.
  const ids = sheets.map((sheet) => assignIds(sheet.root, new Map<string, string>()));
  const content = sheets.map((sheet, i) =>
    toJsonSheet(sheet, `Sheet ${i + 1}`, ids[i], (ref) => ids[i].get(ref) ?? ids.find((m) => m.has(ref))?.get(ref)),
  );
  const enc = new TextEncoder();
  return zip([
    { name: 'content.json', data: enc.encode(JSON.stringify(content)) },
    { name: 'metadata.json', data: enc.encode(JSON.stringify({ creator: { name: 'Kozue', version: appVersion } })) },
    {
      name: 'manifest.json',
      data: enc.encode(JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } })),
    },
  ]);
}
