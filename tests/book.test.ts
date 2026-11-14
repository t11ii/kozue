// Files with several sheets, and the numbering of subtopics.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BookData, FileData } from '../src/core/book.ts';
import { Book, MAX_SHEET_NAME, Sheet, cleanSheetName, isBookData } from '../src/core/book.ts';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import type { DocData, NodeData, Numbering } from '../src/core/model.ts';
import { Doc, MNode, cleanNumbering, formatNumber, numberLabel } from '../src/core/model.ts';
import { LAYOUT_KINDS } from '../src/core/structures.ts';
import { DEFAULT_THEME, themeById } from '../src/core/themes.ts';
import { importFile, serializeNative } from '../src/io/formats.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { unzip, zip } from '../src/io/zip.ts';
import { SvgPainter } from '../src/render/painter.ts';
import { drawScene, snapPositions, todoBox } from '../src/render/scene.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

let stamp = 12000;
const opts = (): LayoutOpts => ({ theme: themeById(DEFAULT_THEME), measurer: fakeMeasurer, epoch: ++stamp, stamp, editing: null });
const fresh = (text: string, ...kids: string[]): Doc => makeDoc(T(text, ...kids.map((k) => T(k))));
const makeFrom = (data: unknown): Doc => Doc.fromData(data, DEFAULT_THEME, themeById(DEFAULT_THEME).palette.length);
const names = (book: Book): string => book.sheets.map((s) => (s === book.active ? '*' : '') + (s.name || s.doc.root.text)).join(' ');
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

// --------------------------------------------------------------------- sheets

test('a book always has a sheet; adding shows the new one, removing shows a neighbour', () => {
  assert.throws(() => new Book([]));
  const book = Book.single(fresh('A'));
  assert.equal(names(book), '*A');
  assert.equal(book.remove(), null, 'the last sheet stays');

  const b = new Sheet(fresh('B'));
  const c = new Sheet(fresh('C'));
  assert.ok(book.add(b));
  assert.ok(book.add(c, 1));
  assert.equal(names(book), 'A *C B');
  assert.equal(book.add(c), null, 'a sheet is in a book once');

  // removing the sheet on show: the one that takes its place is shown, or the last one
  book.remove(c);
  assert.equal(names(book), 'A *B');
  book.remove(b);
  assert.equal(names(book), '*A');
  // removing another sheet leaves the one on show alone
  book.undo();
  book.undo();
  assert.equal(names(book), 'A *C B');
  book.remove(book.sheets[0]);
  assert.equal(names(book), '*C B');
});

test('sheet operations can be undone and redone, and bring back which sheet was on show', () => {
  const a = new Sheet(fresh('A'));
  const book = new Book([a]);
  const b = new Sheet(fresh('B'));
  book.add(b);
  book.rename(b, '  Plans   for 2027 ');
  assert.equal(b.name, 'Plans for 2027');
  assert.equal(book.rename(b, 'Plans for 2027'), null, 'nothing to do');
  book.move(b, 0);
  assert.equal(names(book), '*Plans for 2027 A');
  assert.equal(book.move(b, 0), null);
  assert.equal(book.move(b, -5), null, 'already at the front');
  book.remove(b);
  assert.equal(names(book), '*A');

  const steps = ['*Plans for 2027 A', 'A *Plans for 2027', 'A *B', '*A'];
  for (const want of steps) {
    assert.ok(book.undo());
    assert.equal(names(book), want);
  }
  assert.equal(book.undo(), null);
  for (const want of ['A *B', 'A *Plans for 2027', '*Plans for 2027 A', '*A']) {
    assert.ok(book.redo());
    assert.equal(names(book), want);
  }
  assert.equal(book.redo(), null);
  // a new step forgets what was undone
  book.undo();
  book.add(new Sheet(fresh('C')));
  assert.equal(book.redoStack.length, 0);
  // moving past the end lands at the end
  book.move(book.sheets[0], 99);
  assert.equal(book.indexOf(book.sheets[book.sheets.length - 1]) === book.sheets.length - 1, true);
});

test('a book is unsaved when a sheet changed or the sheets themselves did', () => {
  const book = Book.single(fresh('A', 'x'));
  assert.equal(book.dirty, false);
  const doc = book.active.doc;
  doc.run('edit', () => doc.set(doc.root, 'text', 'A!'));
  assert.equal(book.dirty, true);
  book.markSaved();
  assert.equal(book.dirty, false);

  const b = new Sheet(fresh('B'));
  book.add(b);
  assert.equal(book.dirty, true, 'a new sheet');
  book.undo();
  assert.equal(book.dirty, false, 'taken back');
  book.redo();
  book.markSaved();
  b.doc.run('edit', () => b.doc.set(b.doc.root, 'text', 'B!'));
  assert.equal(book.dirty, true, 'an edit in a sheet that is not on show');
  b.doc.undo();
  assert.equal(book.dirty, false);
  book.rename(b, 'Named');
  assert.equal(book.dirty, true);
  book.markSaved();
  book.markDirty();
  assert.equal(book.dirty, true, 'restored unsaved work');
});

test('a single unnamed sheet is saved as a plain document; anything more as sheets', () => {
  const book = Book.single(fresh('Solo', 'x'));
  const solo = book.toData() as DocData;
  assert.equal(isBookData(solo), false);
  assert.deepEqual(solo, book.active.doc.toData());
  assert.equal(solo.version, 1);

  book.rename(book.active, 'Named');
  const named = book.toData() as BookData;
  assert.equal(isBookData(named), true);
  assert.deepEqual(
    named.sheets.map((s) => s.name),
    ['Named'],
  );
  assert.equal(named.version, 2);
  assert.equal('active' in named, false, 'the first sheet needs no mention');

  const second = makeDoc(T('Two', T('p'), T('q')), 'org');
  second.style = { background: '#fdf6e3' };
  book.add(new Sheet(second));
  const data = book.toData() as BookData;
  assert.equal(data.sheets.length, 2);
  assert.equal(data.active, 1);
  assert.deepEqual(Object.keys(data.sheets[1]), ['theme', 'layout', 'style', 'root']);
  assert.equal(data.sheets[1].layout, 'org');

  // and back, through the file format
  const text = serializeNative(data);
  const back = Book.fromData(JSON.parse(text), makeFrom);
  assert.equal(names(back), 'Named *Two');
  assert.deepEqual(back.toData(), data);
  assert.equal(back.dirty, false);
  assert.equal(back.sheets[1].doc.style.background, '#fdf6e3');
});

test('file data from elsewhere: bad sheets are skipped, names are cleaned, a plain document still opens', () => {
  const plain = Book.fromData({ format: 'kozue', version: 1, theme: 'sora', layout: 'logic', root: { text: 'Old' } }, makeFrom);
  assert.equal(names(plain), '*Old');
  assert.equal(plain.active.doc.layout, 'logic');

  const odd = Book.fromData(
    {
      sheets: [
        null,
        'x',
        { name: 7, root: { text: 'One' } },
        { name: 'n'.repeat(200), root: { text: 'Two' } },
        { name: 'no root' },
        { name: '  a   b ', root: { text: 'Three' } },
      ],
      active: 9,
    },
    makeFrom,
  );
  assert.deepEqual(
    odd.sheets.map((s) => s.name),
    ['', 'n'.repeat(MAX_SHEET_NAME), 'a b'],
  );
  assert.equal(odd.active, odd.sheets[2], 'an index past the end shows the last sheet');
  assert.throws(() => Book.fromData({ sheets: [] }, makeFrom));
  assert.throws(() => Book.fromData({ sheets: [{ name: 'empty' }] }, makeFrom));
  assert.throws(() => Book.fromData({}, makeFrom));
  assert.equal(cleanSheetName(42), '');
});

test('importFile reads Kozue files with sheets and Xmind workbooks with all their sheets', async () => {
  const enc = new TextEncoder();
  const data: FileData = {
    format: 'kozue',
    version: 2,
    active: 1,
    sheets: [
      {
        theme: 'hinata',
        layout: 'map',
        root: {
          text: 'First',
          children: [
            { text: 'a', id: 'x' },
            { text: 'b', id: 'y' },
          ],
        },
        relationships: [{ from: 'x', to: 'y' }],
      },
      { name: 'Second sheet', theme: 'yoru', layout: 'tree', style: { line: 1.6 }, root: { text: 'Second' } },
    ],
  };
  const native = await importFile('book.kozue', enc.encode(serializeNative(data)));
  assert.equal(native.native, true);
  assert.equal(native.root.text, 'First', 'the first sheet is also at the top level');
  assert.equal(native.sheets?.length, 2);
  assert.equal(native.active, 1);
  assert.deepEqual(
    native.sheets?.map((s) => [s.name, s.theme, s.layout]),
    [
      [undefined, 'hinata', 'map'],
      ['Second sheet', 'yoru', 'tree'],
    ],
  );
  const book = Book.fromData(native, (s) => makeFrom(s));
  assert.equal(names(book), 'First *Second sheet');
  assert.equal(book.sheets[0].doc.rels.length, 1);

  // the same file as an Xmind workbook, and back
  const xmind = await toXmind(data, 'test');
  const files = await unzip(xmind, (name) => name === 'content.json');
  const content = JSON.parse(new TextDecoder().decode(files.get('content.json')));
  assert.deepEqual(
    content.map((s: { title: string }) => s.title),
    ['First', 'Second sheet'],
  );
  const x = await parseXmind(xmind);
  assert.equal(x.sheets.length, 2);
  assert.equal(x.root.text, 'First');
  assert.deepEqual(
    x.sheets.map((s) => [s.name, s.root.text, s.layout, s.relationships?.length ?? 0]),
    [
      [undefined, 'First', 'map', 1],
      ['Second sheet', 'Second', 'tree', 0],
    ],
  );
  const imported = await importFile('book.xmind', xmind);
  assert.equal(imported.native, false);
  assert.equal(imported.sheets?.length, 2);

  // a single sheet whose title says nothing new is a plain import
  const one = await importFile(
    'one.xmind',
    await toXmind({ format: 'kozue', version: 1, theme: 'hinata', layout: 'map', root: { text: 'Only' } }, 'test'),
  );
  assert.equal(one.sheets, undefined);
  assert.equal(one.root.text, 'Only');
});

test('Xmind sheet titles become names unless they are defaults or repeat the central topic', async () => {
  const enc = new TextEncoder();
  const sheet = (title: string, root: string): unknown => ({ id: title, title, rootTopic: { id: 'r' + title, title: root } });
  const content = [
    sheet('Sheet 1', 'Alpha'),
    sheet('シート 2', 'Beta'),
    sheet('Gamma', 'Gamma'),
    sheet('  Budget   2027 ', 'Delta'),
    sheet('Map 3', 'E'),
    { id: 'no topic' },
  ];
  const x = await parseXmind(await zip([{ name: 'content.json', data: enc.encode(JSON.stringify(content)) }]));
  assert.deepEqual(
    x.sheets.map((s) => s.name),
    [undefined, undefined, undefined, 'Budget 2027', undefined],
  );
  // the old XML form has its sheets too
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">' +
    '<sheet id="s1"><topic id="a"><title>One</title></topic><title>Sheet 1</title></sheet>' +
    '<sheet id="s2"><topic id="b" structure-class="org.xmind.ui.org-chart.down"><title>Two</title></topic><title>Roadmap</title></sheet></xmap-content>';
  const old = await parseXmind(await zip([{ name: 'content.xml', data: enc.encode(xml) }]));
  assert.deepEqual(
    old.sheets.map((s) => [s.name, s.root.text, s.layout]),
    [
      [undefined, 'One', 'map'],
      ['Roadmap', 'Two', 'org'],
    ],
  );
  await assert.rejects(parseXmind(await zip([{ name: 'content.json', data: enc.encode('[]') }])));
});

// ------------------------------------------------------------------ numbering

test('numbers in every format', () => {
  const upTo = (format: Numbering['format'], n: number): string =>
    Array.from({ length: n }, (_, i) => formatNumber(i + 1, format)).join(' ');
  assert.equal(upTo('arabic', 4), '1 2 3 4');
  assert.equal(upTo('upper', 3), 'A B C');
  assert.equal(upTo('lower', 3), 'a b c');
  assert.equal(upTo('roman', 10), 'I II III IV V VI VII VIII IX X');
  assert.equal(upTo('roman-lower', 4), 'i ii iii iv');
  assert.deepEqual(
    [26, 27, 52, 53, 702, 703].map((n) => formatNumber(n, 'upper')),
    ['Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA'],
  );
  assert.deepEqual(
    [14, 40, 49, 90, 400, 1994, 3999].map((n) => formatNumber(n, 'roman')),
    ['XIV', 'XL', 'XLIX', 'XC', 'CD', 'MCMXCIV', 'MMMCMXCIX'],
  );
  assert.equal(formatNumber(4000, 'roman'), '4000', 'past what the numerals can say');
  assert.equal(numberLabel(3, { format: 'arabic' }, ''), '3.');
  assert.equal(numberLabel(3, { format: 'arabic' }, '2.'), '3.', 'not tiered: on its own');
  assert.equal(numberLabel(3, { format: 'arabic', tiered: true }, '2.'), '2.3');
  assert.equal(numberLabel(2, { format: 'lower', tiered: true }, '1.4'), '1.4.b');
  assert.equal(numberLabel(1, { format: 'upper', tiered: true }, ''), 'A.', 'nothing to carry');
  assert.deepEqual(cleanNumbering({ format: 'roman', tiered: true, junk: 1 }), { format: 'roman', tiered: true });
  assert.deepEqual(cleanNumbering({ format: 'upper', tiered: 'yes' }), { format: 'upper' });
  assert.equal(cleanNumbering({ format: 'binary' }), undefined);
  assert.equal(cleanNumbering('1.'), undefined);
});

test('a numbering numbers the subtopics of its topic, skipping summary topics; it is saved and undoable', () => {
  const root: NodeData = {
    text: 'Root',
    numbering: { format: 'arabic' },
    children: [
      {
        text: 'One',
        numbering: { format: 'lower', tiered: true },
        children: [{ text: 'a' }, { text: 'b' }, { text: 'sum', summary: 2 }, { text: 'c' }],
      },
      {
        text: 'Two',
        numbering: { format: 'roman' },
        children: [{ text: 'x', numbering: { format: 'arabic', tiered: true }, children: [{ text: 'deep' }] }],
      },
      { text: 'Three', children: [{ text: 'plain' }] },
    ],
  };
  const doc = makeDoc(root, 'logic');
  layoutDoc(doc, opts());
  const num = (text: string): string => find(doc, text).num;
  assert.deepEqual(['One', 'Two', 'Three'].map(num), ['1.', '2.', '3.']);
  assert.deepEqual(['a', 'b', 'sum', 'c'].map(num), ['1.a', '1.b', '', '1.c']);
  assert.equal(num('x'), 'I.', 'not tiered: starts afresh');
  assert.equal(num('deep'), 'I.1');
  assert.equal(num('plain'), '');
  assert.equal(num('Root'), '');
  // the number takes room in front of the text, after the markers and the to-do box
  const plain = makeDoc({ text: 'Root', children: [{ text: 'One', todo: false, markers: ['p1'] }] }, 'logic');
  layoutDoc(plain, opts());
  const doc2 = makeDoc(
    { text: 'Root', numbering: { format: 'arabic' }, children: [{ text: 'One', todo: false, markers: ['p1'] }] },
    'logic',
  );
  layoutDoc(doc2, opts());
  snapPositions(doc2.root);
  snapPositions(plain.root);
  const [with1, without] = [find(doc2, 'One'), find(plain, 'One')];
  assert.ok(with1.nw > 0 && with1.w === without.w + with1.nw && with1.tx === without.tx + with1.nw);
  assert.equal(todoBox(with1)[0] - with1.ax, todoBox(without)[0] - without.ax, 'the to-do box stays at the front');

  // saved with the topic, and through an Xmind file
  assert.deepEqual(makeFrom(doc.toData()).toData(), doc.toData());
  assert.deepEqual(doc.toData().root.numbering, { format: 'arabic' });

  // reordering, adding and removing renumber; undo restores
  const one = find(doc, 'One');
  doc.run('move', () => {
    const b = find(doc, 'b');
    doc.remove(b);
    doc.insert(b, one, 0);
  });
  layoutDoc(doc, opts());
  assert.deepEqual(['b', 'a', 'c'].map(num), ['1.a', '1.b', '1.c']);
  doc.run('off', () => doc.set(doc.root, 'numbering', undefined));
  layoutDoc(doc, opts());
  assert.deepEqual(['One', 'b', 'deep'].map(num), ['', 'a.', 'I.1'], 'nothing to carry any more');
  doc.undo();
  layoutDoc(doc, opts());
  assert.equal(num('b'), '1.a');
  // a width set by hand is the width of the text, with or without a number
  doc.run('w', () => doc.set(find(doc, 'a'), 'width', 120));
  layoutDoc(doc, opts());
  assert.equal(find(doc, 'a').tw, 120);
});

test('a branch laid out on its own keeps its number; numbers are drawn in every structure', () => {
  const root: NodeData = {
    text: 'Root',
    numbering: { format: 'upper' },
    children: [
      { text: 'First', children: [{ text: 'k' }] },
      { text: 'S', summary: 1 },
      {
        text: 'Second',
        numbering: { format: 'arabic', tiered: true },
        children: [{ text: 'p' }, { text: 'q', numbering: { format: 'lower', tiered: true }, children: [{ text: 'z' }] }],
      },
    ],
  };
  for (const kind of LAYOUT_KINDS) {
    const doc = makeDoc(root, kind);
    const o = opts();
    layoutDoc(doc, o);
    assert.deepEqual(
      ['First', 'S', 'Second', 'p', 'q', 'z'].map((t) => find(doc, t).num),
      ['A.', '', 'B.', 'B.1', 'B.2', 'B.2.a'],
      kind,
    );
    snapPositions(doc.root);
    const p = new SvgPainter();
    drawScene(p, doc.root, {
      theme: o.theme,
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
      rels: [],
      selRel: null,
    });
    const svg = p.out.join('');
    for (const n of ['A.', 'B.', 'B.1', 'B.2', 'B.2.a']) assert.ok(svg.includes(`>${n}</text>`), `${kind}: ${n} is drawn`);
    // the branch of "q" on its own: same numbers as in the whole map
    const q = find(doc, 'q');
    layoutDoc(doc, opts(), q);
    assert.equal(q.num, 'B.2', kind);
    assert.equal(find(doc, 'z').num, 'B.2.a', kind);
    layoutDoc(doc, opts(), find(doc, 'First'));
    assert.equal(find(doc, 'First').num, 'A.', kind);
  }
});

test('Xmind export and import keep the numbering of subtopics', async () => {
  const data: DocData = {
    format: 'kozue',
    version: 1,
    theme: DEFAULT_THEME,
    layout: 'logic',
    root: {
      text: 'Root',
      numbering: { format: 'arabic' },
      children: [
        { text: 'A', numbering: { format: 'upper', tiered: true }, children: [{ text: 'a1' }] },
        { text: 'B', numbering: { format: 'lower' }, children: [{ text: 'b1' }] },
        { text: 'C', numbering: { format: 'roman' }, children: [{ text: 'c1' }] },
        { text: 'D' },
      ],
    },
  };
  const back = await parseXmind(await toXmind(data, 'test'));
  assert.deepEqual(back.root.numbering, { format: 'arabic' });
  assert.deepEqual(
    back.root.children!.map((k) => k.numbering),
    [{ format: 'upper', tiered: true }, { format: 'lower' }, { format: 'roman' }, undefined],
  );
  // the old XML form
  const enc = new TextEncoder();
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet id="s"><topic id="r">' +
    '<title>Root</title><numbering number-format="org.xmind.numbering.roman" prepending-numbers="true"/>' +
    '<children><topics type="attached"><topic id="a"><title>A</title><numbering number-format="org.xmind.numbering.none"/></topic></topics></children>' +
    '</topic></sheet></xmap-content>';
  const old = await parseXmind(await zip([{ name: 'content.xml', data: enc.encode(xml) }]));
  assert.deepEqual(old.root.numbering, { format: 'roman', tiered: true });
  assert.equal(old.root.children![0].numbering, undefined);
});
