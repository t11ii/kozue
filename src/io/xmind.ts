// Xmind (.xmind) import and export.
// Modern files are ZIP archives with a `content.json`; Xmind 8 and older
// use `content.xml`. Both are read; export writes the modern format.

import type { DocData, LayoutKind, NodeData, RelData } from '../core/model.ts';
import type { XmlEl } from './xml.ts';
import { childOf, childrenOf, findEl, parseXml } from './xml.ts';
import { unzip, zip } from './zip.ts';

export interface XmindImport {
  root: NodeData;
  layout: LayoutKind;
  relationships?: RelData[];
  /** Number of sheets in the file (only the first is imported). */
  sheets: number;
}

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
  'flag-red': 'flag-red',
  'flag-orange': 'flag-orange',
  'flag-yellow': 'flag-orange',
  'flag-green': 'flag-green',
  'flag-blue': 'flag-blue',
  'flag-dark-blue': 'flag-blue',
  'flag-purple': 'flag-purple',
  'symbol-question': 'q',
  'symbol-exclam': 'ex',
  'symbol-attention': 'ex',
  'symbol-info': 'info',
  'symbol-wrong': 'x',
  'symbol-right': 'done',
  c_symbol_heart: 'heart',
};

const OUT_MARKERS: Record<string, string> = {
  p1: 'priority-1',
  p2: 'priority-2',
  p3: 'priority-3',
  p4: 'priority-4',
  p5: 'priority-5',
  t0: 'task-start',
  t25: 'task-quarter',
  t50: 'task-half',
  t75: 'task-3quar',
  done: 'task-done',
  'flag-red': 'flag-red',
  'flag-orange': 'flag-orange',
  'flag-green': 'flag-green',
  'flag-blue': 'flag-blue',
  'flag-purple': 'flag-purple',
  star: 'star-orange',
  heart: 'c_symbol_heart',
  q: 'symbol-question',
  ex: 'symbol-exclam',
  info: 'symbol-info',
  x: 'symbol-wrong',
};

function mapMarkers(ids: readonly unknown[]): string[] | undefined {
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const pr = /^priority-(\d)$/.exec(raw);
    const m = pr ? 'p' + Math.min(5, Math.max(1, Number(pr[1]))) : raw.startsWith('star-') ? 'star' : IN_MARKERS[raw];
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

const webLink = (href: unknown): string | undefined => (typeof href === 'string' && /^(https?:|mailto:)/i.test(href) ? href : undefined);

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

// ------------------------------------------------------------ content.json

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * @param ends ids of the topics that relationships connect; those keep their id
 * @param isRoot the central topic (which has no structure, boundary or to-do of its own)
 */
function fromJsonTopic(raw: unknown, ends: ReadonlySet<string>, isRoot = false): NodeData {
  const t = obj(raw);
  const n: NodeData = { text: cleanTitle(t.title) };
  if (typeof t.id === 'string' && ends.has(t.id)) n.id = t.id;
  const note = obj(obj(t.notes).plain).content;
  if (typeof note === 'string' && note.trim()) n.note = note.replace(/\r\n?/g, '\n').trim();
  const link = webLink(t.href);
  if (link) n.link = link;
  const markers = mapMarkers(arr(t.markers).map((m) => obj(m).markerId));
  if (markers) n.markers = markers;
  const labels = arr(t.labels).filter((l): l is string => typeof l === 'string' && l.trim() !== '');
  if (labels.length) n.labels = labels;
  for (const ext of arr(t.extensions)) {
    const status = obj(ext).provider === TASK ? obj(obj(ext).content).status : undefined;
    if (status === 'done' || status === 'todo') n.todo = status === 'done';
  }
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

function fromJson(text: string): XmindImport {
  const sheets = arr(JSON.parse(text));
  const sheet = obj(sheets[0]);
  const rt = obj(sheet.rootTopic);
  if (!sheets.length || !sheet.rootTopic) throw new Error('The Xmind file has no sheets');
  const relationships: RelData[] = [];
  for (const raw of arr(sheet.relationships)) {
    const r = obj(raw);
    if (typeof r.end1Id !== 'string' || typeof r.end2Id !== 'string') continue;
    const title = cleanTitle(r.title).replace(/\s+/g, ' ').trim();
    relationships.push(title ? { from: r.end1Id, to: r.end2Id, text: title } : { from: r.end1Id, to: r.end2Id });
  }
  const ends = new Set(relationships.flatMap((r) => [r.from, r.to]));
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
  return { root, layout, sheets: sheets.length, ...(relationships.length ? { relationships } : {}) };
}

// ------------------------------------------------------------- content.xml

function fromXmlTopic(el: XmlEl, ends: ReadonlySet<string>, isRoot = false): NodeData {
  const n: NodeData = { text: cleanTitle(childOf(el, 'title')?.text) };
  if (el.attrs.id && ends.has(el.attrs.id)) n.id = el.attrs.id;
  const note = childOf(childOf(el, 'notes'), 'plain')?.text.trim();
  if (note) n.note = note.replace(/\r\n?/g, '\n');
  const link = webLink(el.attrs['xlink:href']);
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
      for (const t of childrenOf(group, 'topic')) kids.push(fromXmlTopic(t, ends));
    } else if (group.attrs.type === 'summary') {
      for (const t of childrenOf(group, 'topic')) summaryTopics.set(t.attrs.id, fromXmlTopic(t, ends));
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

function fromXml(text: string): XmindImport {
  const doc = parseXml(text);
  const content = findEl(doc, 'xmap-content');
  const sheets = childrenOf(content, 'sheet');
  const topic = childOf(sheets[0], 'topic');
  if (!topic) throw new Error('The Xmind file has no sheets');
  const relationships: RelData[] = [];
  for (const r of childrenOf(childOf(sheets[0], 'relationships'), 'relationship')) {
    if (!r.attrs.end1 || !r.attrs.end2) continue;
    const title = cleanTitle(childOf(r, 'title')?.text).replace(/\s+/g, ' ').trim();
    relationships.push(title ? { from: r.attrs.end1, to: r.attrs.end2, text: title } : { from: r.attrs.end1, to: r.attrs.end2 });
  }
  const ends = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const root = fromXmlTopic(topic, ends, true);
  delete root.collapsed;
  return {
    root,
    layout: layoutOf(topic.attrs['structure-class']),
    sheets: sheets.length,
    ...(relationships.length ? { relationships } : {}),
  };
}

export async function parseXmind(bytes: Uint8Array): Promise<XmindImport> {
  const files = await unzip(bytes, (name) => name === 'content.json' || name === 'content.xml');
  const dec = new TextDecoder();
  const json = files.get('content.json');
  if (json) return fromJson(dec.decode(json));
  const xml = files.get('content.xml');
  if (xml) return fromXml(dec.decode(xml));
  throw new Error('Not an Xmind file');
}

// ------------------------------------------------------------------- export

function newId(): string {
  const b = new Uint8Array(13);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * @param ids fills in which Xmind id each topic with a Kozue id received, for the relationships
 */
function toJsonTopic(n: NodeData, ids: Map<string, string>): Json {
  const id = newId();
  if (n.id !== undefined) ids.set(n.id, id);
  const t: Json = { id, title: n.text };
  if (n.note) t.notes = { plain: { content: n.note } };
  if (n.link) t.href = n.link;
  const markers = (n.markers ?? []).map((m) => OUT_MARKERS[m]).filter(Boolean);
  if (markers.length) t.markers = markers.map((markerId) => ({ markerId }));
  if (n.labels?.length) t.labels = n.labels.slice();
  if (n.todo !== undefined) t.extensions = [{ provider: TASK, content: { status: n.todo ? 'done' : 'todo' } }];
  if (n.structure !== undefined) t.structureClass = STRUCTURES[n.structure];
  if (n.children?.length) {
    // Xmind keeps summary topics apart from the ordinary children and frames by ranges of those.
    const attached: Json[] = [];
    const summary: Json[] = [];
    const summaries: Json[] = [];
    const boundaries: Json[] = [];
    let run = 0; // ordinary topics since the last summary
    for (const k of n.children) {
      const kt = toJsonTopic(k, ids);
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

export async function toXmind(doc: DocData, appVersion: string): Promise<Uint8Array> {
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
  const ids = new Map<string, string>();
  const rootTopic = toJsonTopic(root, ids);
  rootTopic.class = 'topic';
  rootTopic.structureClass = STRUCTURES[doc.layout];
  delete rootTopic.branch;
  if (doc.layout === 'map') {
    rootTopic.extensions = [{ provider: 'org.xmind.ui.map.unbalanced', content: [{ name: 'right-number', content: String(rightCount) }] }];
  }
  const title = root.text.split('\n')[0] || 'Sheet 1';
  const sheet: Json = { id: newId(), class: 'sheet', title, rootTopic, topicPositioning: 'fixed' };
  const relationships: Json[] = [];
  for (const r of doc.relationships ?? []) {
    const end1Id = ids.get(r.from);
    const end2Id = ids.get(r.to);
    if (!end1Id || !end2Id) continue;
    relationships.push(r.text ? { id: newId(), end1Id, end2Id, title: r.text } : { id: newId(), end1Id, end2Id });
  }
  if (relationships.length) sheet.relationships = relationships;
  const content = [sheet];
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
