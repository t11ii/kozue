// Links from one topic to another: the ids they hang on, saving, copying, and other formats.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BookData } from '../src/core/book.ts';
import { Book, Sheet } from '../src/core/book.ts';
import type { DocData, NodeData } from '../src/core/model.ts';
import { Doc, MNode, Rel, cloneForPaste, findByRef, isTopicLink, topicLinkTo } from '../src/core/model.ts';
import { DEFAULT_THEME, themeById } from '../src/core/themes.ts';
import { exportText, importFile, serializeNative } from '../src/io/formats.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { unzip, zip } from '../src/io/zip.ts';
import { T, makeDoc } from './helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const makeFrom = (data: unknown): Doc => Doc.fromData(data, DEFAULT_THEME, themeById(DEFAULT_THEME).palette.length);
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
/** The ids in a saved tree, by the text of their topic. */
const idsOf = (root: NodeData): Record<string, string> => {
  const out: Record<string, string> = {};
  const visit = (d: NodeData): void => {
    if (d.id !== undefined) out[d.text] = d.id;
    d.children?.forEach(visit);
  };
  visit(root);
  return out;
};
const saved = (book: Book): DocData => book.toData() as DocData;

test('a link to a topic is "#" and an id; everything else leads somewhere else', () => {
  for (const link of ['#abc', '#k0123456789', '#ID_123', '#a-b']) assert.equal(isTopicLink(link), true, link);
  for (const other of [undefined, '', '#', 'abc', 'https://example.com/#abc', '#a b', '#日本語', '#' + 'x'.repeat(49)])
    assert.equal(isTopicLink(other), false, String(other));
});

test('linking gives the target an id of its own, once', () => {
  const doc = makeDoc(T('Root', T('A'), T('B')));
  const a = find(doc, 'A');
  const b = find(doc, 'B');
  const link = topicLinkTo(a);
  assert.match(link, /^#k[a-z0-9]{10}$/);
  assert.equal(a.ref, link.slice(1));
  assert.equal(topicLinkTo(a), link, 'the next link to it uses the same id');
  assert.equal(findByRef(doc.root, link.slice(1)), a);
  assert.equal(findByRef(doc.root, 'nope'), null);

  // The id of the end of a relationship ("t1") counts within its map only: a link gets another.
  doc.run('rel', () => doc.addRel(new Rel(a, b)));
  doc.toData();
  assert.equal(b.ref, 't1');
  const toB = topicLinkTo(b);
  assert.match(toB, /^#k[a-z0-9]{10}$/);
  assert.deepEqual(doc.toData().relationships, [{ from: a.ref, to: b.ref }], 'the relationship follows');
});

test('a file names the topics that something points at, and no others', () => {
  const doc = makeDoc(T('Root', T('A'), T('B'), T('C')));
  const a = find(doc, 'A');
  const b = find(doc, 'B');
  const link = topicLinkTo(b);
  doc.run('link', () => doc.set(a, 'link', link));
  const book = Book.single(doc);
  assert.deepEqual(idsOf(saved(book).root), { B: link.slice(1) });
  assert.equal(saved(book).root.children![0].link, link);

  // Without the link the id is not written any more — but it stays with the topic ...
  doc.run('unlink', () => doc.set(a, 'link', undefined));
  assert.deepEqual(idsOf(saved(book).root), {});
  assert.equal(b.ref, link.slice(1));
  // ... so that a link that undo brings back still leads there.
  doc.undo();
  assert.equal(a.link, link);
  assert.deepEqual(idsOf(saved(book).root), { B: link.slice(1) });

  // A map on its own (a sheet that is copied) keeps every such id.
  doc.run('unlink', () => doc.set(a, 'link', undefined));
  assert.deepEqual(idsOf(doc.toData().root), { B: link.slice(1) });
});

test('links survive saving and loading, also into another sheet', () => {
  const one = makeDoc(T('One', T('A'), T('B')));
  const two = makeDoc(T('Two', T('X')));
  const book = new Book([new Sheet(one), new Sheet(two)]);
  const link = topicLinkTo(find(one, 'B'));
  one.run('link', () => one.set(find(one, 'A'), 'link', link));
  two.run('link', () => two.set(find(two, 'X'), 'link', link));

  const text = serializeNative(book.toData());
  const back = Book.fromData(JSON.parse(text), makeFrom);
  assert.equal(find(back.sheets[0].doc, 'A').link, link);
  assert.equal(find(back.sheets[1].doc, 'X').link, link);
  assert.equal(findByRef(back.sheets[0].doc.root, link.slice(1))?.text, 'B');
  assert.equal(findByRef(back.sheets[1].doc.root, link.slice(1)), null);
  assert.equal(serializeNative(back.toData()), text, 'saved again, the file is the same');

  // The target is named because of the link in the other sheet alone, too.
  one.run('unlink', () => one.set(find(one, 'A'), 'link', undefined));
  const data = book.toData() as BookData;
  assert.deepEqual(idsOf(data.sheets[0].root), { B: link.slice(1) });
  two.run('unlink', () => two.set(find(two, 'X'), 'link', undefined));
  assert.deepEqual(idsOf((book.toData() as BookData).sheets[0].root), {});
});

test('an id belongs to one topic of a map; one that a link points at is kept whatever it looks like', () => {
  // read from a file: the first topic keeps it
  const doc = makeFrom({
    root: {
      text: 'R',
      children: [
        { text: 'A', id: 'same' },
        { text: 'B', id: 'same' },
        { text: 'C', link: '#same' },
      ],
    },
  });
  assert.equal(find(doc, 'A').ref, 'same');
  assert.equal(find(doc, 'B').ref, undefined);
  assert.deepEqual(idsOf(saved(Book.single(doc)).root), { A: 'same' });

  // in memory: saving tidies up
  const twice = makeDoc(T('R', T('A'), T('B')));
  find(twice, 'A').ref = 'kdouble';
  find(twice, 'B').ref = 'kdouble';
  twice.toData(new Set(['kdouble']));
  assert.equal(find(twice, 'A').ref, 'kdouble');
  assert.equal(find(twice, 'B').ref, undefined);

  // "t7" looks like the id of a relationship end, but a link (from a file made elsewhere) needs it
  const odd = makeFrom({
    root: {
      text: 'R',
      children: [
        { text: 'A', id: 't7' },
        { text: 'B', link: '#t7' },
      ],
    },
  });
  const book = Book.single(odd);
  assert.deepEqual(idsOf(saved(book).root), { A: 't7' });
  odd.run('unlink', () => odd.set(find(odd, 'B'), 'link', undefined));
  assert.deepEqual(idsOf(saved(book).root), {}, 'without the link it is the id of a relationship that is gone');
  assert.equal(find(odd, 'A').ref, undefined);
});

test('a copy for the clipboard can carry the ids that links point at', () => {
  const doc = makeDoc(T('R', T('A', T('A1')), T('B')));
  const a = find(doc, 'A');
  const link = topicLinkTo(find(doc, 'A1'));
  doc.run('rel', () => doc.addRel(new Rel(a, find(doc, 'B'))));
  doc.toData(); // the ends of the relationship get "t1" and "t2"
  assert.equal(a.ref, 't1');

  const plain = cloneForPaste(a);
  assert.deepEqual(idsOf(plain), {}, 'a plain copy has no ids');
  const moved = cloneForPaste(a, true);
  assert.deepEqual(idsOf(moved), { A1: link.slice(1) }, 'the id for links comes along, that of the relationship does not');
});

test('Xmind export and import keep links to topics, also into another sheet', async () => {
  const data: BookData = {
    format: 'kozue',
    version: 2,
    sheets: [
      {
        theme: DEFAULT_THEME,
        layout: 'logic',
        root: {
          text: 'One',
          children: [
            { text: 'A', id: 'ka' },
            { text: 'B', link: '#ka' },
            { text: 'C', link: '#gone' },
            { text: 'W', link: 'https://example.com/' },
            { text: 'Ahead', link: '#klater' },
            { text: 'Later', id: 'klater' },
          ],
        },
      },
      {
        name: 'Second',
        theme: DEFAULT_THEME,
        layout: 'logic',
        root: {
          text: 'Two',
          link: '#ka',
          children: [
            { text: 'X', id: 'kx' },
            { text: 'Y', link: '#kx' },
          ],
        },
      },
    ],
  };
  const bytes = await toXmind(data, 'test');
  const content = JSON.parse(new TextDecoder().decode((await unzip(bytes, (n) => n === 'content.json')).get('content.json')!));
  interface Raw {
    id: string;
    title: string;
    href?: string;
    children?: { attached?: Raw[] };
  }
  const all: Raw[] = [];
  const visit = (t: Raw): void => {
    all.push(t);
    t.children?.attached?.forEach(visit);
  };
  for (const sheet of content) visit(sheet.rootTopic);
  const raw = (title: string): Raw => all.find((t) => t.title === title)!;
  assert.equal(new Set(all.map((t) => t.id)).size, all.length, 'every topic has an id of its own');
  assert.equal(raw('B').href, 'xmind:#' + raw('A').id);
  assert.equal(raw('Ahead').href, 'xmind:#' + raw('Later').id, 'a link to a topic further down');
  assert.equal(raw('Two').href, 'xmind:#' + raw('A').id, 'a link into another sheet');
  assert.equal(raw('Y').href, 'xmind:#' + raw('X').id);
  assert.equal(raw('C').href, undefined, 'a link that leads nowhere is left out');
  assert.equal(raw('W').href, 'https://example.com/');

  const back = await parseXmind(bytes);
  const [a, b, c, w, ahead, later] = back.sheets[0].root.children!;
  assert.ok(a.id && later.id);
  assert.equal(b.link, '#' + a.id);
  assert.equal(ahead.link, '#' + later.id);
  assert.equal(c.link, undefined);
  assert.equal(w.link, 'https://example.com/');
  assert.equal(back.sheets[1].root.link, '#' + a.id);
  const [x, y] = back.sheets[1].root.children!;
  assert.equal(y.link, '#' + x.id);
  assert.deepEqual(Object.keys(idsOf(back.sheets[0].root)), ['A', 'Later'], 'only what is pointed at carries an id');

  // As a file of Kozue: the links still lead to their topics.
  const book = new Book(back.sheets.map((s) => new Sheet(makeFrom(s), s.name)));
  const again = Book.fromData(JSON.parse(serializeNative(book.toData())), makeFrom);
  const target = find(again.sheets[1].doc, 'Two').link!;
  assert.equal(findByRef(again.sheets[0].doc.root, target.slice(1))?.text, 'A');
});

test('Xmind files made elsewhere: a link to a topic that is not there is dropped; ids like "t1" are told apart from Kozue\'s own', async () => {
  const content = [
    {
      id: 's',
      title: 'Sheet 1',
      rootTopic: {
        id: 'r',
        title: 'Root',
        structureClass: 'org.xmind.ui.logic.right',
        children: {
          attached: [
            { id: 't1', title: 'A' },
            { id: 'b', title: 'B', href: 'xmind:#t1' },
            { id: 'c', title: 'C', href: 'xmind:#nowhere' },
            { id: 'd', title: 'D', href: 'xmind:#sum' },
            { id: 'e', title: 'E', href: 'file:///somewhere/else.xmind' },
          ],
          summary: [{ id: 'sum', title: 'Sum' }],
        },
        summaries: [{ id: 'x1', range: '(0,1)', topicId: 'sum' }],
      },
      relationships: [{ id: 'x', end1Id: 't1', end2Id: 'b' }],
    },
  ];
  const x = await parseXmind(await zip([{ name: 'content.json', data: enc(JSON.stringify(content)) }]));
  const byText = new Map(x.root.children!.map((k) => [k.text, k]));
  assert.equal(byText.get('A')!.id, 'xt1');
  assert.equal(byText.get('B')!.link, '#xt1');
  assert.equal(byText.get('C')!.link, undefined);
  assert.equal(byText.get('D')!.link, '#sum', 'a summary topic can be linked to as well');
  assert.equal(byText.get('Sum')!.id, 'sum');
  assert.equal(byText.get('E')!.link, undefined, 'links to files are not followed');
  assert.deepEqual(x.relationships, [{ from: 'xt1', to: 'b' }]);

  // Both hold in the document, and stay after it was saved and read again.
  const doc = makeFrom({ root: x.root, layout: x.layout, relationships: x.relationships });
  const again = makeFrom(JSON.parse(serializeNative(Book.single(doc).toData())));
  assert.equal(findByRef(again.root, find(again, 'B').link!.slice(1))?.text, 'A');
  assert.equal(again.rels.length, 1);
  assert.equal(again.rels[0].from.text, 'A');
});

test('links to topics are read from Xmind 8 files, too', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">
<sheet id="s1"><topic id="r1" structure-class="org.xmind.ui.logic.right"><title>One</title><children><topics type="attached">
<topic id="a1"><title>A</title></topic>
<topic id="b1" xlink:href="xmind:#a1"><title>B</title></topic>
<topic id="c1" xlink:href="xmind:#x2"><title>C</title></topic>
<topic id="d1" xlink:href="xmind:#lost"><title>D</title></topic>
</topics></children></topic><title>Sheet 1</title></sheet>
<sheet id="s2"><topic id="r2"><title>Two</title><children><topics type="attached">
<topic id="x2"><title>X</title></topic>
</topics></children></topic><title>Sheet 2</title></sheet>
</xmap-content>`;
  const x = await parseXmind(await zip([{ name: 'content.xml', data: enc(xml) }]));
  const [a, b, c, d] = x.sheets[0].root.children!;
  assert.equal(a.id, 'a1');
  assert.equal(b.link, '#a1');
  assert.equal(c.link, '#x2');
  assert.equal(d.link, undefined);
  assert.equal(x.sheets[1].root.children![0].id, 'x2');
  assert.equal(b.id, undefined);
});

test('FreeMind: links between nodes come along', async () => {
  const mm = `<map version="1.0.1"><node TEXT="Root" ID="ID_1">
<node TEXT="A" ID="ID_2"/>
<node TEXT="B" ID="ID_3" LINK="#ID_2"/>
<node TEXT="C" LINK="https://example.com/"/>
<node TEXT="D" LINK="#not an id"/>
<node TEXT="E" LINK="#ID_404"/>
</node></map>`;
  const imp = await importFile('map.mm', enc(mm));
  const [a, b, c, d, e] = imp.root.children!;
  assert.equal(a.id, 'ID_2');
  assert.equal(b.link, '#ID_2');
  assert.equal(b.id, undefined, 'only what is pointed at carries an id');
  assert.equal(c.link, 'https://example.com/');
  assert.equal(d.link, undefined);
  assert.equal(e.link, undefined, 'a link to a node that is not there is dropped');
  const doc = makeFrom({ root: imp.root });
  assert.equal(findByRef(doc.root, 'ID_2')?.text, 'A');
});

test('Markdown and OPML leave links to topics out; text that is read takes no "#anchor" for one', async () => {
  const doc: DocData = {
    format: 'kozue',
    version: 1,
    theme: DEFAULT_THEME,
    layout: 'map',
    root: {
      text: 'R',
      children: [
        { text: 'A', id: 'ka' },
        { text: 'B', link: '#ka' },
        { text: 'W', link: 'https://example.com/' },
      ],
    },
  };
  const md = exportText('md', doc);
  assert.ok(!md.includes('#ka'), md);
  assert.ok(md.includes('[W](https://example.com/)'), md);
  assert.match(md, /^#+ B$/m);
  const opml = exportText('opml', doc);
  assert.ok(!opml.includes('#ka'), opml);
  assert.ok(opml.includes('url="https://example.com/"'), opml);

  const back = await importFile('notes.md', enc('# R\n\n- [Intro](#intro)\n- [W](https://example.com/)\n'));
  assert.deepEqual(back.root.children, [{ text: 'Intro' }, { text: 'W', link: 'https://example.com/' }]);
});
