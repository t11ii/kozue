// Topic styles (shape, colors, text), hand-set widths and the settings of the map.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import type { DocData, MapStyle, NodeData, Shape, TopicStyle } from '../src/core/model.ts';
import { Doc, MNode, SHAPES, cleanMapStyle, cleanStyle, cleanWidth, cloneForPaste, walkVisible } from '../src/core/model.ts';
import { LAYOUT_KINDS } from '../src/core/structures.ts';
import type { Theme } from '../src/core/themes.ts';
import {
  DEFAULT_THEME,
  FONT_STACKS,
  LEVELS,
  THEMES,
  contrast,
  font,
  nodeStyle,
  styleFor,
  themeById,
  themeWith,
} from '../src/core/themes.ts';
import { importFile, serializeNative } from '../src/io/formats.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { unzip, zip } from '../src/io/zip.ts';
import { SvgPainter } from '../src/render/painter.ts';
import type { SceneOpts } from '../src/render/scene.ts';
import { childAnchor, drawScene, edgePoint, snapPositions } from '../src/render/scene.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

let stamp = 9000;
const opts = (theme: Theme = themeById(DEFAULT_THEME)): LayoutOpts => ({
  theme,
  measurer: fakeMeasurer,
  epoch: ++stamp,
  stamp,
  editing: null,
});

const find = (doc: Doc, text: string): MNode => {
  let hit: MNode | null = null;
  const visit = (n: MNode): void => {
    if (!hit && n.text === text) hit = n;
    n.children.forEach(visit);
  };
  visit(doc.root);
  if (!hit) throw new Error('no topic ' + text);
  return hit;
};
const visible = (root: MNode): MNode[] => {
  const out: MNode[] = [];
  walkVisible(root, (n) => out.push(n));
  return out;
};
const S = (text: string, style: TopicStyle, ...children: NodeData[]): NodeData => ({ text, style, children });

/** Lays the document out and returns the SVG it draws. */
function svgOf(doc: Doc, theme: Theme = themeWith(themeById(doc.theme), doc.style)): string {
  const o = opts(theme);
  layoutDoc(doc, o);
  snapPositions(doc.root);
  const p = new SvgPainter();
  const scene: SceneOpts = {
    theme,
    metrics: (f) => fakeMeasurer.metrics(f),
    textWidth: (f, s) => fakeMeasurer.width(f, s),
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
  };
  drawScene(p, doc.root, scene);
  return p.out.join('\n');
}

// ---------------------------------------------------------------------- model

test('a style keeps only what is valid, in a fixed order', () => {
  assert.deepEqual(
    cleanStyle({ size: 17.6, strike: true, bold: false, color: '#ABCDEF', border: '#123456', fill: 'none', shape: 'pill', junk: 1 }),
    { shape: 'pill', fill: 'none', border: '#123456', color: '#abcdef', bold: false, strike: true, size: 18 },
  );
  assert.equal(JSON.stringify(cleanStyle({ size: 12, shape: 'rect' })), '{"shape":"rect","size":12}');
  assert.equal(cleanStyle({ shape: 'star', fill: 'red', border: 12, color: '#12', italic: 'yes', size: 'big' }), undefined);
  assert.equal(cleanStyle(null), undefined);
  assert.equal(cleanStyle('bold'), undefined);
  assert.equal(cleanStyle({ size: 500 })?.size, 72);
  assert.equal(cleanStyle({ size: 1 })?.size, 8);
  // "false" only means something for the weight
  assert.deepEqual(cleanStyle({ italic: false, strike: false, bold: false }), { bold: false });
  assert.equal(cleanWidth(10), 24);
  assert.equal(cleanWidth(5000), 1200);
  assert.equal(cleanWidth(180.4), 180);
  assert.equal(cleanWidth('180'), undefined);
  assert.equal(cleanWidth(NaN), undefined);
});

test('map settings drop what says nothing new', () => {
  assert.deepEqual(cleanMapStyle({ background: '#FFEEDD', line: 1.613, font: 'serif' }), {
    background: '#ffeedd',
    line: 1.61,
    font: 'serif',
  });
  assert.deepEqual(
    cleanMapStyle({ background: 'white', line: 1, font: 'sans' }),
    { font: 'sans' },
    'a theme may come with another typeface',
  );
  assert.deepEqual(cleanMapStyle({ line: 99, font: 'comic' }), { line: 3 });
  assert.deepEqual(cleanMapStyle({ line: 0 }), { line: 0.4 });
  assert.deepEqual(cleanMapStyle(undefined), {});
});

test('styles, widths and map settings are saved and loaded', () => {
  const data: DocData = {
    format: 'kozue',
    version: 1,
    theme: DEFAULT_THEME,
    layout: 'map',
    style: { background: '#fdf6e3', line: 1.6, font: 'serif' },
    root: {
      text: 'Root',
      style: { shape: 'rect', fill: '#102030' },
      children: [
        { text: 'A', side: 'r', color: 0, style: { shape: 'diamond', bold: false, size: 18 }, width: 140 },
        { text: 'B', side: 'l', color: 1, style: { italic: true, strike: true, color: '#aa0000', border: '#00aa00' } },
      ],
    },
  };
  const doc = Doc.fromData(data, DEFAULT_THEME, 7);
  assert.deepEqual(doc.toData(), data);
  // through the file format as well
  const text = serializeNative(doc.toData());
  assert.deepEqual(Doc.fromData(JSON.parse(text), DEFAULT_THEME, 7).toData(), data);
  // a copied topic keeps its look
  assert.deepEqual(cloneForPaste(find(doc, 'A')).style, { shape: 'diamond', bold: false, size: 18 });
  assert.equal(cloneForPaste(find(doc, 'A')).width, 140);
  // a map without settings has no "style" entry at all
  assert.equal('style' in makeDoc(T('Root', T('A'))).toData(), false);
  // rubbish is dropped on the way in
  const odd = Doc.fromData(
    { ...data, style: { background: 7, line: 'thick' }, root: { text: 'R', style: { shape: 'blob' }, width: 'wide' } },
    DEFAULT_THEME,
    7,
  );
  assert.deepEqual(odd.style, {});
  assert.equal(odd.root.style, undefined);
  assert.equal(odd.root.width, undefined);
});

test('changing a style, a width or the map settings can be undone; a color being picked is one step', () => {
  const doc = makeDoc(T('Root', T('A'), T('B')));
  const a = find(doc, 'A');
  const v0 = a.ver;
  doc.run('Style', () => doc.set(a, 'style', { shape: 'ellipse' }));
  doc.run('Width', () => doc.set(a, 'width', 200));
  assert.ok(a.ver > v0, 'a style change asks for a new measurement');
  assert.deepEqual(a.style, { shape: 'ellipse' });
  doc.undo();
  doc.undo();
  assert.equal(a.style, undefined);
  assert.equal(a.width, undefined);
  doc.redo();
  doc.redo();
  assert.deepEqual([a.style, a.width], [{ shape: 'ellipse' }, 200]);

  const before = doc.undoStack.length;
  for (const bg of ['#111111', '#222222', '#333333'])
    doc.run('Map style', () => doc.setStyle({ background: bg }), { merge: 'look:background' });
  assert.equal(doc.undoStack.length, before + 1);
  assert.deepEqual(doc.style, { background: '#333333' });
  doc.undo();
  assert.deepEqual(doc.style, {});
  doc.redo();
  assert.deepEqual(doc.style, { background: '#333333' });
  // setting the same thing again records nothing
  assert.equal(
    doc.run('Map style', () => doc.setStyle({ background: '#333333' })),
    false,
  );
  // the settings are replaced as a whole and cleaned on the way
  doc.run('Map style', () => doc.setStyle({ line: 1, font: 'mono' } as MapStyle));
  assert.deepEqual(doc.style, { font: 'mono' });
});

// --------------------------------------------------------------------- themes

test('fonts are shared objects; a topic font follows the level, the map typeface and the style', () => {
  assert.equal(font(14, 400), font(14, 400));
  assert.notEqual(font(14, 400), font(14, 400, true));
  assert.equal(font(14, 400, true).css.startsWith('italic 400 14px '), true);
  const doc = makeDoc(T('Root', T('Main', S('Sub', { bold: true, italic: true, size: 20 })), S('Light', { bold: false })));
  layoutDoc(doc, opts(themeWith(themeById(DEFAULT_THEME), { font: 'serif' })));
  const sub = find(doc, 'Sub');
  assert.deepEqual([sub.font.size, sub.font.weight, sub.font.italic, sub.font.family], [20, 700, true, FONT_STACKS.serif]);
  assert.equal(sub.lh, Math.round((20 * LEVELS[2].lineHeight) / LEVELS[2].font.size));
  assert.equal(find(doc, 'Light').font.weight, 400);
  assert.equal(find(doc, 'Main').font.weight, LEVELS[1].font.weight);
  assert.equal(doc.root.font.family, FONT_STACKS.serif);
  // without a typeface or a style, the level's own font object is used
  layoutDoc(doc, opts());
  assert.equal(find(doc, 'Main').font, LEVELS[1].font);
});

test('the settings of a map change its theme: background, text that sits on it, the central topic', () => {
  const hinata = themeById('hinata');
  assert.equal(themeWith(hinata, {}), hinata);
  const lined = themeWith(hinata, { line: 1.6, font: 'round' });
  assert.deepEqual([lined.lineScale, lined.typeface, lined.bg, lined.dark], [1.6, 'round', hinata.bg, false]);
  assert.equal(hinata.lineScale, undefined, 'the theme itself is never changed');

  const dark = themeWith(hinata, { background: '#101418' });
  assert.equal(dark.bg, '#101418');
  assert.equal(dark.dark, true);
  assert.ok(contrast(dark.text, dark.bg) > 7, 'text on the canvas stays readable');
  assert.ok(contrast(dark.root.fill, dark.bg) > 4, 'the central topic stands out');
  assert.ok(contrast(dark.root.text, dark.root.fill) > 4);

  const pale = themeWith(themeById('yoru'), { background: '#fafafa' });
  assert.equal(pale.dark, false);
  assert.ok(contrast(pale.text, pale.bg) > 7);
  assert.ok(contrast(pale.root.fill, pale.bg) > 4);

  // branch colors that would vanish into the new background move towards the color of the text
  assert.deepEqual(dark.palette, hinata.palette, 'bright colors read on a dark canvas as they are');
  const sumi = themeWith(themeById('sumi'), { background: '#101418' });
  assert.ok(contrast(themeById('sumi').palette[0], '#101418') < 1.5);
  assert.ok(sumi.palette.every((c) => contrast(c, sumi.bg) >= 1.5));
  assert.equal(themeById('sumi').palette[0], '#26262b', 'the theme itself keeps its colors');

  // a background of the same lightness leaves the rest alone
  const cream = themeWith(hinata, { background: '#fdf6e3' });
  assert.deepEqual([cream.dark, cream.text, cream.root], [false, hinata.text, hinata.root]);
  for (const t of THEMES) assert.equal(themeWith(t, { background: t.bg }).root, t.root);
});

test('a topic is drawn as its theme says, with the colors of its own style on top', () => {
  const theme = themeById('hinata');
  const branch = theme.palette[0];
  const sub = styleFor(theme, 2, branch, false);
  assert.deepEqual([sub.fill, sub.stroke, sub.text], [null, null, theme.text]);
  assert.equal(nodeStyle(theme, 2, branch, false, undefined), sub);
  assert.equal(nodeStyle(theme, 2, branch, false, { bold: true, shape: 'underline' }), sub, 'no colors: the cached theme style');

  const filled = nodeStyle(theme, 2, branch, true, { fill: '#102030' });
  assert.deepEqual([filled.fill, filled.text, filled.plate], ['#102030', '#ffffff', true]);
  assert.equal(nodeStyle(theme, 2, branch, true, { fill: '#ffe08a' }).text, '#1b1d23');
  assert.equal(nodeStyle(theme, 2, branch, true, { fill: '#ffe08a', color: '#ff0000' }).text, '#ff0000');

  const hollow = nodeStyle(theme, 1, branch, true, { fill: 'none' });
  assert.deepEqual([hollow.fill, hollow.stroke, hollow.text, hollow.plate], [theme.bg, branch, theme.text, false]);
  assert.equal(nodeStyle(theme, 1, branch, true, { fill: 'none', border: '#00ff00' }).stroke, '#00ff00');

  // without a box only the text color applies
  const plain = nodeStyle(theme, 1, branch, false, { fill: '#102030', border: '#00ff00', color: '#0000ff' });
  assert.deepEqual([plain.fill, plain.stroke, plain.text], [null, null, '#0000ff']);
  // a map with settings of its own never sees another map's colors
  const other = themeWith(theme, { background: '#101418' });
  assert.notEqual(nodeStyle(other, 1, branch, true, { fill: 'none' }).fill, hollow.fill);
});

// --------------------------------------------------------------------- layout

test('a shape decides whether a topic is a box, an underlined text or plain text', () => {
  const doc = makeDoc(
    T(
      'Root',
      T(
        'Main',
        T('auto'),
        S('rounded', { shape: 'rounded' }),
        S('rect', { shape: 'rect' }),
        S('pill', { shape: 'pill' }),
        S('ellipse', { shape: 'ellipse' }),
        S('diamond', { shape: 'diamond' }),
        S('underline', { shape: 'underline' }),
        S('none', { shape: 'none' }),
        S('filled', { fill: '#ffe08a' }),
        S('hollow', { fill: 'none' }),
        S('bordered', { border: '#102030' }),
      ),
      S('MainLine', { shape: 'underline' }, T('k')),
      S('MainPlain', { shape: 'none' }),
    ),
  );
  layoutDoc(doc, opts());
  const state = (text: string): string => {
    const n = find(doc, text);
    return `${n.shp} ${n.box ? 'box' : n.ul ? 'ul' : 'plain'}`;
  };
  assert.equal(state('Root'), 'rounded box');
  assert.equal(state('Main'), 'rounded box');
  assert.equal(state('auto'), 'underline ul'); // Hinata underlines its subtopics
  for (const shape of ['rounded', 'rect', 'pill', 'ellipse', 'diamond'] as Shape[]) assert.equal(state(shape), `${shape} box`);
  assert.equal(state('underline'), 'underline ul');
  assert.equal(state('none'), 'none plain');
  assert.equal(state('filled'), 'rounded box', 'a fill needs a box to show');
  assert.equal(state('bordered'), 'rounded box', 'so does an outline');
  assert.equal(state('hollow'), 'underline ul', '"no fill" alone changes nothing');
  assert.equal(state('MainLine'), 'underline ul');
  assert.equal(state('MainPlain'), 'none plain');
  assert.equal(find(doc, 'rect').rad, 0);
  assert.equal(find(doc, 'pill').rad, find(doc, 'pill').h / 2);
  assert.ok(find(doc, 'MainPlain').w < find(doc, 'Main').w + 40, 'no box, little padding');

  // Mochi writes its subtopics as plain text: there, too, the shape of a topic has the last word.
  assert.equal(themeById('mochi').sub, 'plain');
  layoutDoc(doc, opts(themeById('mochi')));
  assert.equal(state('auto'), 'none plain');
  assert.equal(state('underline'), 'underline ul');
  assert.equal(state('ellipse'), 'ellipse box');
  assert.equal(state('hollow'), 'none plain');
  // In an org chart every subtopic is a box unless its shape says otherwise.
  const org = makeDoc(T('Root', T('Main', T('auto'), S('line', { shape: 'underline' }), S('free', { shape: 'none' }))), 'org');
  layoutDoc(org, opts());
  assert.deepEqual(
    ['auto', 'line', 'free'].map((t) => find(org, t).shp),
    ['rounded', 'underline', 'none'],
  );
});

test('round shapes hold their text; every shape keeps the text inside its box', () => {
  for (const text of ['a', 'Decision', 'A rather long line of text that will wrap around\nand a second paragraph']) {
    for (const lv of [0, 1, 2]) {
      for (const shape of SHAPES) {
        const node = S(text, { shape });
        const doc = makeDoc(lv === 0 ? node : lv === 1 ? T('Root', node) : T('Root', T('Main', node)));
        layoutDoc(doc, opts());
        const n = find(doc, text);
        const where = `${shape} at level ${lv}: "${text.slice(0, 12)}"`;
        assert.equal(n.lv, lv);
        assert.ok(n.tx >= 0 && n.ty >= 0 && n.tx + n.tw <= n.w + 0.01 && n.ty + n.th <= n.h + 0.01, `${where}: text inside the box`);
        // The corners of the text block, relative to the center and scaled to the half axes.
        const u = Math.max(Math.abs(n.tx - n.w / 2), Math.abs(n.tx + n.tw - n.w / 2)) / (n.w / 2);
        const v = Math.max(Math.abs(n.ty - n.h / 2), Math.abs(n.ty + n.th - n.h / 2)) / (n.h / 2);
        if (shape === 'ellipse') assert.ok(u * u + v * v <= 1.0001, `${where}: corners inside the ellipse (${u * u + v * v})`);
        if (shape === 'diamond') assert.ok(u + v <= 1.0001, `${where}: corners inside the diamond (${u + v})`);
        if (shape === 'pill' && n.box) {
          // the corner of the text clears the round end
          const r = n.rad;
          const dx = r - n.tx;
          const dy = r - n.ty;
          if (dx > 0 && dy > 0) assert.ok(Math.hypot(dx, dy) <= r + 0.01, `${where}: corners inside the round end`);
        }
        if (shape === 'ellipse' || shape === 'diamond') assert.equal(n.tc, true, `${where}: centered lines`);
      }
    }
  }
});

test('a width set by hand is the width of the text block: the text wraps at it and the box keeps it', () => {
  const long = 'one two three four five six seven eight nine ten';
  const doc = makeDoc(
    T(
      'Root',
      T('Main', { text: long, width: 80 }, { text: 'ab', width: 200 }, { text: 'boxed', width: 150, style: { shape: 'rect' } }, T(long)),
    ),
  );
  layoutDoc(doc, opts());
  const [narrow, wide, boxed, auto] = find(doc, 'Main').children;
  assert.equal(narrow.tw, 80);
  assert.ok(narrow.lines.length > auto.lines.length, 'wraps earlier than a topic sized to its text');
  for (const line of narrow.lines) assert.ok(fakeMeasurer.width(narrow.font, line) <= 80);
  assert.equal(wide.tw, 200);
  assert.equal(wide.lines.length, 1);
  assert.ok(wide.w >= 200);
  assert.equal(wide.tc, false, 'underlined text stays left-aligned');
  assert.equal(boxed.tc, true, 'in a box wider than its text the lines are centered');
  assert.equal(boxed.w, 150 + 2 * boxed.tx);
  // a longer word than the width is broken rather than sticking out
  const tight = makeDoc(T('Root', { text: 'incomprehensibilities', width: 40 }));
  layoutDoc(tight, opts());
  const t = tight.root.children[0];
  assert.ok(t.lines.length > 1);
  for (const line of t.lines) assert.ok(fakeMeasurer.width(t.font, line) <= 40.01);
  // the width of the text does not change when the topic gets markers or a to-do box
  const marked = makeDoc(T('Root', { text: 'ab', width: 100, markers: ['p1', 'star'], todo: false, note: 'n' }));
  layoutDoc(marked, opts());
  const m = marked.root.children[0];
  assert.equal(m.tw, 100);
  assert.ok(m.w > 100 + 2 * LEVELS[1].padX + 40);
});

test('a larger font makes a taller, wider topic; the level sizes stay untouched', () => {
  const doc = makeDoc(T('Root', T('Main', T('plain text'), S('big text.', { size: 28 }), S('tiny text', { size: 9 }))));
  layoutDoc(doc, opts());
  const [plain, big, tiny] = find(doc, 'Main').children;
  assert.ok(big.h > plain.h && plain.h > tiny.h);
  assert.ok(big.w > plain.w && plain.w > tiny.w);
  assert.equal(big.th, big.lh);
  assert.equal(plain.font, LEVELS[2].font);
});

test('styled topics never overlap, in any structure', () => {
  const tree = (): NodeData =>
    T(
      'Root',
      S('Diamond', { shape: 'diamond' }, T('d1'), S('d2', { shape: 'ellipse', size: 20 }), T('d3')),
      S('Ellipse', { shape: 'ellipse', fill: '#ffe08a' }, { text: 'wide one', width: 260, style: { shape: 'rect' } }, T('e2')),
      S('Line', { shape: 'underline', size: 22 }, S('l1', { shape: 'pill' }), S('l2', { shape: 'none' }), T('l3')),
      S('Plain', { shape: 'none' }, T('p1'), S('p2', { shape: 'diamond', bold: true })),
      { text: 'Narrow main with a long title', width: 60, children: [T('n1'), T('n2')] },
      T('Auto', S('a1', { size: 30 }), S('a2', { border: '#102030' })),
    );
  for (const kind of LAYOUT_KINDS) {
    const doc = makeDoc(tree(), kind);
    const res = layoutDoc(doc, opts());
    const nodes = visible(doc.root);
    for (const n of nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && n.w > 0 && n.h > 0, `${kind}: "${n.text}" has a finite box`);
      assert.ok(n.x >= res.bounds.x0 - 0.5 && n.x + n.w <= res.bounds.x1 + 0.5, `${kind}: "${n.text}" inside the bounds`);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
        assert.ok(apart, `${kind}: "${a.text}" overlaps "${b.text}"`);
      }
    }
    assert.equal(
      Math.abs(doc.root.x + doc.root.w / 2) < 1e-6 && Math.abs(doc.root.y + doc.root.h / 2) < 1e-6,
      true,
      `${kind}: root at the origin`,
    );
  }
});

// -------------------------------------------------------------------- drawing

test('relationship ends and tree trunks meet round shapes on their outline', () => {
  const doc = makeDoc(
    T('Root', S('Ellipse', { shape: 'ellipse' }, T('e1'), T('e2')), S('Diamond', { shape: 'diamond' }, T('d1')), T('Box')),
    'tree',
  );
  layoutDoc(doc, opts());
  snapPositions(doc.root);
  const onOutline = (n: MNode, x: number, y: number): number => {
    const u = (x - (n.ax + n.w / 2)) / (n.w / 2);
    const v = (y - (n.ay + n.h / 2)) / (n.h / 2);
    return n.shp === 'ellipse' ? u * u + v * v : Math.abs(u) + Math.abs(v);
  };
  for (const text of ['Ellipse', 'Diamond']) {
    const n = find(doc, text);
    for (const [tx, ty] of [
      [n.ax + 500, n.ay - 300],
      [n.ax - 400, n.ay + 90],
      [n.ax + n.w / 2, n.ay + 800],
      [n.ax - 10, n.ay - 10],
    ]) {
      const [x, y] = edgePoint(n, tx, ty, 0);
      assert.ok(Math.abs(onOutline(n, x, y) - 1) < 1e-6, `${text}: the line to (${tx}, ${ty}) ends on the outline`);
      // towards the target, not away from it
      assert.ok((x - (n.ax + n.w / 2)) * (tx - (n.ax + n.w / 2)) >= 0 && (y - (n.ay + n.h / 2)) * (ty - (n.ay + n.h / 2)) >= 0);
    }
    // the trunk its children hang from starts where the outline is, not at the corner of the box
    const [ax, ay] = childAnchor(n);
    assert.ok(Math.abs(onOutline(n, ax, ay) - 1) < 1e-6, `${text}: trunk starts on the outline`);
    assert.ok(ay > n.ay + n.h / 2 && ay < n.ay + n.h, `${text}: below the middle, above the bottom of the box`);
  }
  const box = find(doc, 'Box');
  const [x, y] = edgePoint(box, box.ax + 1000, box.ay + box.h / 2, 0);
  assert.deepEqual([x, y], [box.ax + box.w, box.ay + box.h / 2]);
});

test('the drawing shows shapes, own colors, slanted and struck-through text, and the map typeface', () => {
  const doc = makeDoc(
    T(
      'Root',
      T(
        'Main',
        S('Slanted', { italic: true }),
        S('Gone', { strike: true, color: '#9aa0ae' }),
        S('Round', { shape: 'ellipse', fill: '#ffe08a' }),
        S('Edgy', { shape: 'diamond', fill: 'none', border: '#102030' }),
      ),
      S('Lined', { shape: 'underline' }),
    ),
  );
  const plain = svgOf(makeDoc(T('Root', T('Main', T('Slanted'), T('Gone'), T('Round'), T('Edgy')), T('Lined'))));
  const svg = svgOf(doc);
  assert.ok(!plain.includes('font-style="italic"') && svg.includes('font-style="italic"'));
  assert.ok(svg.includes('fill="#ffe08a"') && !plain.includes('#ffe08a'));
  assert.ok(svg.includes('stroke="#102030"'));
  assert.ok(svg.includes('fill="#9aa0ae"'), 'the text color');
  assert.ok(svg.includes('stroke="#9aa0ae"'), 'the line through the text has the color of the text');
  // An underlined main topic draws its own underline (its tapered branch cannot carry it) …
  const num = (v: number): string => String(Math.round(v * 100) / 100);
  const underline = (n: MNode): string => `d="M${num(n.ax)} ${num(n.ay + n.h)}L${num(n.ax + n.w)} ${num(n.ay + n.h)}"`;
  assert.ok(svg.includes(underline(find(doc, 'Lined'))), 'underline of the main topic');
  // … while the underline of a subtopic stays part of its connector: it is not drawn a second time.
  const slanted = find(doc, 'Slanted');
  assert.equal(slanted.ul, true);
  assert.ok(!svg.includes(underline(slanted)));
  assert.ok(svg.includes(`L${num(slanted.ax + slanted.w)} ${num(slanted.ay + slanted.h)}`), 'the connector runs on under the text');
  // typeface and thicker lines come from the settings of the map
  doc.style = { font: 'serif', line: 2 };
  const serif = svgOf(doc);
  assert.ok(serif.includes('Mincho') && !svg.includes('Mincho'));
  const widths = (s: string): number[] => [...s.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...widths(serif)) > Math.max(...widths(svg)), 'thicker branch lines');
});

// ---------------------------------------------------------------------- xmind

test('Xmind export and import keep styles, widths and the background', async () => {
  const data: DocData = {
    format: 'kozue',
    version: 1,
    theme: DEFAULT_THEME,
    layout: 'logic',
    style: { background: '#fdf6e3', font: 'serif' },
    root: {
      text: 'Root',
      style: { shape: 'rect' },
      children: [
        { text: 'A', style: { shape: 'diamond', fill: '#ffe08a', border: '#102030', color: '#aa0000' }, width: 140 },
        { text: 'B', style: { shape: 'pill', fill: 'none', bold: true, italic: true, strike: true, size: 18 } },
        {
          text: 'C',
          style: { shape: 'underline', bold: false },
          children: [
            { text: 'c1', style: { shape: 'ellipse' } },
            { text: 'c2', style: { shape: 'none' } },
          ],
        },
        { text: 'D', style: { shape: 'rounded' } },
        { text: 'E' },
      ],
    },
  };
  const bytes = await toXmind(data, 'test');
  const back = await parseXmind(bytes);
  const strip = (n: NodeData): unknown => ({ text: n.text, style: n.style, width: n.width, children: n.children?.map(strip) });
  assert.deepEqual(strip(back.root), strip(data.root));
  // the background travels; the typeface has no counterpart in the sheet
  assert.deepEqual(back.style, { background: '#fdf6e3' });
  const imported = await importFile('x.xmind', bytes);
  assert.deepEqual(imported.style, { background: '#fdf6e3' });
  // what the file says, in Xmind's own words
  const files = await unzip(bytes, (name) => name === 'content.json');
  const sheet = JSON.parse(new TextDecoder().decode(files.get('content.json')))[0];
  const a = sheet.rootTopic.children.attached[0];
  assert.equal(a.style.properties['shape-class'], 'org.xmind.topicShape.diamond');
  assert.equal(a.style.properties['svg:fill'], '#ffe08a');
  assert.equal(a.customWidth, 140);
  assert.equal(sheet.style.properties['svg:fill'], '#fdf6e3');
  assert.equal('style' in sheet.rootTopic.children.attached[4], false);
});

test('styles of Xmind files made elsewhere are read as far as Kozue has a counterpart', async () => {
  const enc = new TextEncoder();
  const topic = (title: string, properties: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
    id: title,
    title,
    style: { id: 's-' + title, properties },
    ...extra,
  });
  const content = [
    {
      id: 'sheet',
      title: 'Sheet',
      style: { id: 'ss', properties: { 'svg:fill': '#FFF8E1FF' } },
      rootTopic: {
        id: 'root',
        title: 'Root',
        children: {
          attached: [
            topic('caps', { 'shape-class': 'org.xmind.topicShape.ellipserect', 'svg:fill': '#ABC', 'fo:color': '#FFFFFF' }),
            topic('cloud', { 'shape-class': 'org.xmind.topicShape.cloud', 'fo:font-weight': '700', 'fo:font-size': '18pt' }),
            topic('clear', { 'svg:fill': '#11223300', 'border-line-color': '#445566', 'border-line-width': '3pt' }),
            topic('none', { 'svg:fill': 'none', 'border-line-color': '#445566', 'border-line-width': '0pt', 'fo:font-weight': 'normal' }),
            topic('deco', { 'fo:text-decoration': 'underline line-through', 'fo:font-style': 'italic', 'fo:font-weight': 'bold' }),
            topic('circle', { 'shape-class': 'org.xmind.topicShape.circle' }, { customWidth: 220.4 }),
            topic(
              'junk',
              { 'shape-class': 42, 'svg:fill': 'rgb(1,2,3)', 'fo:color': 'red', 'fo:font-size': 'big' },
              { customWidth: 'wide' },
            ),
            { id: 'bare', title: 'bare' },
          ],
        },
      },
    },
  ];
  const bytes = await zip([{ name: 'content.json', data: enc.encode(JSON.stringify(content)) }]);
  const x = await parseXmind(bytes);
  const by = new Map((x.root.children ?? []).map((k) => [k.text, k]));
  assert.deepEqual(by.get('caps')!.style, { shape: 'pill', fill: '#aabbcc', color: '#ffffff' });
  assert.deepEqual(by.get('cloud')!.style, { bold: true, size: 18 }, 'an unknown shape is left to the theme');
  assert.deepEqual(by.get('clear')!.style, { fill: 'none', border: '#445566' });
  assert.deepEqual(by.get('none')!.style, { fill: 'none', bold: false }, 'a border of no width is no border');
  assert.deepEqual(by.get('deco')!.style, { bold: true, italic: true, strike: true });
  assert.deepEqual([by.get('circle')!.style, by.get('circle')!.width], [{ shape: 'ellipse' }, 220]);
  assert.equal(by.get('junk')!.style, undefined);
  assert.equal(by.get('junk')!.width, undefined);
  assert.equal(by.get('bare')!.style, undefined);
  assert.deepEqual(x.style, { background: '#fff8e1' });

  // Xmind 8 keeps the styles in a file of their own.
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">' +
    '<sheet id="s" style-id="bg"><topic id="r" style-id="st1"><title>Root</title><children><topics type="attached">' +
    '<topic id="a" style-id="st2" svg:width="180"><title>A</title></topic><topic id="b" style-id="missing"><title>B</title></topic>' +
    '</topics></children></topic></sheet></xmap-content>';
  const styles =
    '<?xml version="1.0" encoding="UTF-8"?><xmap-styles xmlns="urn:xmind:xmap:xmlns:style:2.0" xmlns:fo="x" xmlns:svg="y"><styles>' +
    '<style id="st1" type="topic"><topic-properties shape-class="org.xmind.topicShape.rect" svg:fill="#102030"/></style>' +
    '<style id="bg" type="map"><map-properties svg:fill="#eeeeee"/></style></styles>' +
    '<automatic-styles><style id="st2" type="topic"><topic-properties shape-class="org.xmind.topicShape.diamond" fo:font-weight="bold" fo:color="#aa0000"/></style></automatic-styles></xmap-styles>';
  const old = await parseXmind(
    await zip([
      { name: 'content.xml', data: enc.encode(xml) },
      { name: 'styles.xml', data: enc.encode(styles) },
    ]),
  );
  assert.deepEqual(old.root.style, { shape: 'rect', fill: '#102030' });
  assert.deepEqual(old.root.children![0].style, { shape: 'diamond', color: '#aa0000', bold: true });
  assert.equal(old.root.children![0].width, 180);
  assert.equal(old.root.children![1].style, undefined);
  assert.deepEqual(old.style, { background: '#eeeeee' });
  // without the styles file the map still opens
  const bare = await parseXmind(await zip([{ name: 'content.xml', data: enc.encode(xml) }]));
  assert.equal(bare.root.children!.length, 2);
  assert.equal(bare.root.style, undefined);
});
