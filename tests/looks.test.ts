// The markers, the themes and the templates: each one is there, is drawn, and is saved.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { templates } from '../src/app/templates.ts';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import { MARKER_GROUPS, MARKER_IDS, toggleMarker } from '../src/core/markers.ts';
import type { NodeData } from '../src/core/model.ts';
import { Doc, MNode, walk, walkVisible } from '../src/core/model.ts';
import { LAYOUT_KINDS } from '../src/core/structures.ts';
import type { Theme } from '../src/core/themes.ts';
import { DEFAULT_THEME, THEMES, contrast, styleFor, themeById, themeWith, topicFont } from '../src/core/themes.ts';
import { getLang, setLang } from '../src/i18n.ts';
import { importFile } from '../src/io/formats.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { drawMarker, markerSvg } from '../src/render/markers.ts';
import { SvgPainter } from '../src/render/painter.ts';
import { drawScene, snapPositions } from '../src/render/scene.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

let stamp = 15000;
const opts = (theme: Theme): LayoutOpts => ({ theme, measurer: fakeMeasurer, epoch: ++stamp, stamp, editing: null });
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const find = (doc: Doc, text: string): MNode => {
  let hit: MNode | null = null;
  walk(doc.root, (n) => {
    if (!hit && n.text === text) hit = n;
  });
  if (!hit) throw new Error('no topic ' + text);
  return hit;
};
const HEX = /^#[0-9a-f]{6}$/;

/** Lays the document out in `theme` and returns what it draws, as the list of SVG elements. */
function draw(doc: Doc, theme: Theme): string[] {
  const o = opts(theme);
  const { bounds } = layoutDoc(doc, o);
  for (const v of [bounds.x0, bounds.y0, bounds.x1, bounds.y1]) assert.ok(Number.isFinite(v), `${theme.id}: bounds`);
  snapPositions(doc.root);
  const p = new SvgPainter();
  drawScene(p, doc.root, {
    theme,
    metrics: (f) => fakeMeasurer.metrics(f),
    textWidth: (f, text) => fakeMeasurer.width(f, text),
    clip: null,
    zoom: 1,
    editing: null,
    marks: null,
    markCurrent: null,
    dim: null,
    keep: null,
    stamp: o.stamp,
    rels: doc.rels,
    selRel: null,
  });
  return p.out;
}
/** The commands of all paths that are stroked, not filled: the lines between the topics among them. */
const strokes = (out: readonly string[]): string =>
  out
    .filter((el) => el.startsWith('<path') && el.includes('fill="none"'))
    .map((el) => /\sd="([^"]*)"/.exec(el)?.[1] ?? '')
    .join(' ');
const count = (s: string, ch: string): number => s.split(ch).length - 1;

const sample = (): NodeData =>
  T('Central', T('Alpha', T('a1'), T('a2', T('deep'))), T('Beta', T('b1'), T('b2'), T('b3')), T('Gamma'), T('Delta', T('d1')));

// -------------------------------------------------------------------- markers

test('the catalogue: nine groups, each marker in one of them, a topic carries one of each group', () => {
  assert.deepEqual(
    MARKER_GROUPS.map((g) => [g.id, g.items.length, g.more === true]),
    [
      ['priority', 9, false],
      ['task', 5, false],
      ['flag', 7, false],
      ['symbol', 7, false],
      ['star', 6, true],
      ['people', 6, true],
      ['arrow', 9, true],
      ['object', 9, true],
      ['face', 6, true],
    ],
  );
  const all = MARKER_GROUPS.flatMap((g) => g.items);
  assert.equal(new Set(all).size, all.length, 'no marker is listed twice');
  assert.equal(MARKER_IDS.size, 64);

  for (const g of MARKER_GROUPS) {
    let cur: string[] | undefined;
    for (const id of g.items) {
      cur = toggleMarker(cur, id);
      assert.deepEqual(cur, [id], `${id} replaces its neighbour`);
    }
    assert.equal(toggleMarker(cur, g.items.at(-1)!), undefined, 'the same marker again takes it off');
  }
  // one of every group, kept in the order of the catalogue however they were put on
  let cur: string[] | undefined;
  for (const g of [...MARKER_GROUPS].reverse()) cur = toggleMarker(cur, g.items[0]);
  assert.deepEqual(
    cur,
    MARKER_GROUPS.map((g) => g.items[0]),
  );
  assert.deepEqual(toggleMarker(['p1'], 'bogus'), ['p1'], 'an unknown marker changes nothing');
});

test('every marker has a drawing of its own', () => {
  const seen = new Map<string, string>();
  for (const id of MARKER_IDS) {
    const p = new SvgPainter();
    drawMarker(p, id, 0, 0, 18, '#333333');
    assert.ok(p.out.length > 0, `${id} draws something`);
    const svg = markerSvg(id, 18, '#333333');
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${id}: ${svg}`);
    assert.equal(seen.get(svg), undefined, `${id} looks like ${seen.get(svg)}`);
    seen.set(svg, id);
  }
  const none = new SvgPainter();
  drawMarker(none, 'bogus', 0, 0, 18, '#333333');
  assert.equal(none.out.length, 0);
});

test('markers take room in front of the text and are drawn with the topic', () => {
  const plain = makeDoc(T('Root', T('Topic')), 'logic');
  const marked = makeDoc(T('Root', { text: 'Topic', markers: ['p9', 'flag-yellow', 'arrow-refresh', 'face-laugh'] }), 'logic');
  const theme = themeById(DEFAULT_THEME);
  const before = draw(plain, theme).length;
  const after = draw(marked, theme).length;
  assert.ok(after > before + 4, 'four markers add their drawings');
  assert.ok(find(marked, 'Topic').w > find(plain, 'Topic').w + 4 * 18, 'and their width');
});

test('Xmind takes every marker and gives it back', async () => {
  const ids = [...MARKER_IDS];
  const root: NodeData = { text: 'R', children: ids.map((id) => ({ text: id, markers: [id] })) };
  const bytes = await toXmind({ format: 'kozue', version: 1, theme: DEFAULT_THEME, layout: 'logic', root }, 'test');
  const back = await parseXmind(bytes);
  assert.deepEqual(
    back.root.children!.map((k) => `${k.text}=${(k.markers ?? []).join()}`),
    ids.map((id) => `${id}=${id}`),
  );
});

test('FreeMind icons find their marker', async () => {
  const icons = ['idea', 'full-9', 'flag-yellow', 'ksmiletris', 'up', 'messagebox_warning', 'penguin', 'full-0'];
  const mm = `<map version="1.0.1"><node TEXT="Root">${icons.map((i) => `<node TEXT="${i}"><icon BUILTIN="${i}"/></node>`).join('')}</node></map>`;
  const imp = await importFile('icons.mm', enc(mm));
  assert.deepEqual(
    imp.root.children!.map((k) => (k.markers ?? []).join()),
    ['idea', 'p9', 'flag-yellow', 'face-smile', 'arrow-up', 'warn', '', 'p1'],
  );
});

// --------------------------------------------------------------------- themes

test('eighteen themes, each one legible', () => {
  assert.equal(THEMES.length, 18);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, 18);
  assert.equal(new Set(THEMES.map((t) => t.name)).size, 18);
  assert.equal(themeById('no such theme').id, DEFAULT_THEME);
  const boxless = (shape: string | undefined): boolean => shape === 'underline' || shape === 'none';
  for (const th of THEMES) {
    for (const c of [th.bg, th.text, th.muted, th.accent, th.root.fill, th.root.text, ...th.palette])
      assert.match(c, HEX, `${th.id}: ${c}`);
    assert.ok(th.palette.length >= 1, th.id);
    assert.equal(contrast('#ffffff', th.bg) > contrast('#000000', th.bg), th.dark, `${th.id}: dark says what the background is`);
    // the text of the map
    assert.ok(contrast(th.text, th.bg) >= 7, `${th.id}: text on the background`);
    assert.ok(contrast(th.muted, th.bg) >= 2, `${th.id}: muted text can still be seen`);
    assert.ok(contrast(th.accent, th.bg) >= 3, `${th.id}: the selection stands out`);
    const root = styleFor(th, 0, th.palette[0], !boxless(th.rootShape));
    assert.ok(contrast(root.text, root.fill ?? th.bg) >= 4.5, `${th.id}: central topic`);
    for (const c of th.palette) {
      // lines of this color on the background; main topics and boxed subtopics in it
      assert.ok(contrast(c, th.bg) >= 1.9, `${th.id}: a line in ${c}`);
      const main = styleFor(th, 1, c, !boxless(th.mainShape));
      assert.ok(contrast(main.text, main.fill ?? th.bg) >= 2.4, `${th.id}: main topic in ${c}`);
      const sub = styleFor(th, 2, c, true);
      assert.ok(contrast(sub.text, sub.fill ?? th.bg) >= 7, `${th.id}: boxed subtopic in ${c}`);
    }
  }
});

test('every theme lays out and draws every structure', () => {
  for (const th of THEMES) {
    for (const kind of LAYOUT_KINDS) {
      const doc = makeDoc(sample(), kind);
      const out = draw(doc, th);
      assert.ok(!out.some((el) => /NaN|undefined|Infinity/.test(el)), `${th.id}/${kind}`);
      const shown: MNode[] = [];
      walkVisible(doc.root, (n) => shown.push(n));
      // the text of every topic, and lines between them
      assert.equal(out.filter((el) => el.startsWith('<text')).length, shown.length, `${th.id}/${kind}`);
      assert.ok(
        out.some((el) => el.startsWith('<path')),
        `${th.id}/${kind}`,
      );
      for (const n of shown) assert.ok(n.w > 0 && n.h > 0 && Number.isFinite(n.x + n.y), `${th.id}/${kind}: ${n.text}`);
    }
  }
});

test('a theme can give the central topic and the main topics a shape; the style of a topic still wins', () => {
  const shapes = (id: string): [string, string, string] => {
    const doc = makeDoc(sample());
    layoutDoc(doc, opts(themeById(id)));
    return [doc.root.shp, find(doc, 'Alpha').shp, find(doc, 'a1').shp];
  };
  assert.deepEqual(shapes('hinata'), ['rounded', 'rounded', 'underline']);
  assert.deepEqual(shapes('kon'), ['rounded', 'rect', 'underline']);
  assert.deepEqual(shapes('tetsu'), ['rect', 'rect', 'rounded'], 'subtopics are boxes in this theme');
  assert.deepEqual(shapes('umi'), ['rounded', 'pill', 'none']);
  assert.deepEqual(shapes('shiro'), ['underline', 'none', 'none']);
  assert.deepEqual(shapes('genko'), ['rounded', 'underline', 'underline']);

  const own = makeDoc(T('Central', { text: 'Alpha', style: { shape: 'diamond' } }, T('Beta')));
  layoutDoc(own, opts(themeById('umi')));
  assert.equal(find(own, 'Alpha').shp, 'diamond');
  assert.equal(find(own, 'Beta').shp, 'pill');

  // without a box a topic is narrower (it keeps the height of its level), and it has no fill
  const boxed = makeDoc(sample());
  const bare = makeDoc(sample());
  layoutDoc(boxed, opts(themeById('hinata')));
  layoutDoc(bare, opts(themeById('shiro')));
  assert.ok(find(bare, 'Alpha').w < find(boxed, 'Alpha').w);
  assert.ok(bare.root.w < boxed.root.w);
  assert.equal(find(bare, 'Alpha').h, find(boxed, 'Alpha').h);
  assert.equal(find(bare, 'Alpha').box, false);
  assert.equal(bare.root.box, false);
  assert.equal(styleFor(themeById('shiro'), 0, '#000000', false).fill, null);
});

test('lines between topics: curved, with corners of the radius the theme asks for, or straight', () => {
  const lines = (theme: Theme, kind: 'map' | 'logic' = 'map'): string => strokes(draw(makeDoc(sample(), kind), theme));
  const base = themeById('hinata');
  const curved = lines({ ...base, edge: 'curve', taper: false });
  const straight = lines({ ...base, edge: 'straight', taper: false });
  assert.ok(count(curved, 'C') + count(curved, 'Q') > 0, 'curves in a curved theme');
  assert.ok(count(straight, 'C') + count(straight, 'Q') < count(curved, 'C') + count(curved, 'Q'), 'fewer in a straight one');
  assert.equal(themeById('hotaru').edge, 'straight');

  const round = lines({ ...base, edge: 'elbow', taper: false, corner: 8 }, 'logic');
  const square = lines({ ...base, edge: 'elbow', taper: false, corner: 0 }, 'logic');
  const usual = lines({ ...base, edge: 'elbow', taper: false }, 'logic');
  assert.equal(usual, round, 'the usual radius is 8');
  assert.notEqual(square, round);
  // a corner is a curve from the upright into the run: with no radius it has no size
  const corners = (d: string): number[] =>
    [...d.matchAll(/Q(\S+) (\S+) (\S+) (\S+?)(?=[A-Z]|$)/g)].map((m) =>
      Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])),
    );
  assert.ok(corners(round).length > 0 && corners(round).every((r) => r > 0 && r <= 8));
  assert.ok(corners(square).length > 0 && corners(square).every((r) => r === 0));
  assert.equal(themeById('tetsu').corner, 0);
});

test('a theme can come with a typeface; the map may choose another', () => {
  const sakura = themeById('sakura');
  const genko = themeById('genko');
  assert.equal(sakura.typeface, 'round');
  assert.equal(genko.typeface, 'serif');
  assert.equal(themeById('hinata').typeface, undefined);
  assert.equal(themeWith(sakura, {}), sakura, 'without settings it is the theme itself');
  assert.equal(themeWith(sakura, { font: 'sans' }).typeface, 'sans');
  assert.equal(themeWith(themeById('hinata'), { font: 'mono' }).typeface, 'mono');
  // the font of a topic follows
  assert.notEqual(topicFont(1, undefined, sakura.typeface).family, topicFont(1, undefined, undefined).family);
  assert.equal(topicFont(1, undefined, themeWith(sakura, { font: 'sans' }).typeface).family, topicFont(1, undefined, undefined).family);
  // ... and so does the width of the text, through the font that is measured
  const doc = makeDoc(sample());
  layoutDoc(doc, opts(genko));
  assert.equal(find(doc, 'Alpha').font.family, topicFont(1, undefined, 'serif').family);
});

// ------------------------------------------------------------------ templates

test('templates: a blank map first, then nine starting points that say what they are in both languages', () => {
  const was = getLang();
  try {
    const byLang = (['ja', 'en'] as const).map((lang) => {
      setLang(lang);
      return templates();
    });
    const [ja, en] = byLang;
    assert.equal(ja.length, 9);
    assert.deepEqual(
      ja.map((t) => [t.id, t.layout]),
      en.map((t) => [t.id, t.layout]),
    );
    assert.equal(new Set(ja.map((t) => t.id)).size, 9);
    assert.equal(ja[0].id, 'blank');
    assert.equal(ja[0].root.children, undefined);
    for (const list of byLang) {
      assert.equal(new Set(list.map((t) => t.name)).size, 9, 'every template has a name of its own');
      for (const tpl of list) {
        assert.ok(tpl.name.trim() && tpl.root.text.trim(), tpl.id);
        assert.ok(LAYOUT_KINDS.includes(tpl.layout), tpl.id);
      }
    }
    // no text was left in the other language
    for (const tpl of en) {
      const visit = (d: NodeData): void => {
        assert.match(d.text, /^[\x20-\x7e]+$/, `${tpl.id}: ${d.text}`);
        d.children?.forEach(visit);
      };
      visit(tpl.root);
    }
    assert.ok(
      ja.slice(1).every((t) => /[^\x20-\x7e]/.test(t.name)),
      'Japanese names',
    );
    // between them the templates show most structures
    assert.ok(new Set(ja.map((t) => t.layout)).size >= 6);
  } finally {
    setLang(was);
  }
});

test('every template opens as a map of its structure, in every theme', () => {
  const was = getLang();
  try {
    for (const lang of ['ja', 'en'] as const) {
      setLang(lang);
      for (const tpl of templates()) {
        for (const th of [themeById(DEFAULT_THEME), themeById('yoru'), themeById('shiro'), themeById('niji')]) {
          const doc = Doc.fromData({ root: tpl.root, layout: tpl.layout }, th.id, th.palette.length);
          assert.equal(doc.layout, tpl.layout);
          assert.equal(doc.theme, th.id);
          assert.equal(doc.dirty, false, 'a new map has nothing to save yet');
          const out = draw(doc, th);
          assert.ok(!out.some((el) => /NaN|undefined|Infinity/.test(el)), `${tpl.id}/${th.id}`);
          // what was written comes back when the map is saved: to-dos, numbering, sides, labels
          assert.deepEqual(strip(doc.toData().root), strip(tpl.root), `${tpl.id}/${lang}`);
        }
      }
    }
  } finally {
    setLang(was);
  }
});

/** A saved tree without what a document adds on its own (colors of the main topics, sides). */
function strip(d: NodeData): unknown {
  const { color: _color, side: _side, children, ...rest } = d;
  return children?.length ? { ...rest, children: children.map(strip) } : rest;
}

test('templates use what they are about: to-dos, numbers, a side for each half', () => {
  const was = getLang();
  try {
    setLang('en');
    const byId = new Map(templates().map((t) => [t.id, t]));
    const all = (d: NodeData): NodeData[] => [d, ...(d.children ?? []).flatMap(all)];
    assert.ok(all(byId.get('project')!.root).filter((d) => d.todo === false).length >= 8, 'a plan of things to do');
    assert.ok(all(byId.get('week')!.root).some((d) => d.todo === false));
    assert.equal(byId.get('meeting')!.root.children![1].numbering?.format, 'arabic');
    assert.equal(byId.get('proposal')!.root.numbering?.format, 'arabic');
    assert.ok(
      all(byId.get('proposal')!.root).some((d) => d.numbering?.tiered === true),
      'numbers that carry the number above',
    );
    const swot = Doc.fromData({ root: byId.get('swot')!.root, layout: 'map' }, DEFAULT_THEME, themeById(DEFAULT_THEME).palette.length);
    assert.deepEqual(
      swot.root.children.map((k) => k.side),
      ['r', 'r', 'l', 'l'],
    );
    assert.equal(byId.get('cause')!.layout, 'fishbone');
    assert.equal(byId.get('cause')!.root.children!.length, 6);
  } finally {
    setLang(was);
  }
});
