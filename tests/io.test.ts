import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import type { DocData, NodeData } from '../src/core/model.ts';
import { exportText, importFile, serializeNative } from '../src/io/formats.ts';
import { parseFreemind, parseOpml, toOpml } from '../src/io/opml.ts';
import { forestToRoot, parseOutline, toMarkdown, toOutline } from '../src/io/outline.ts';
import { buildPdf, rgbaToRgb } from '../src/io/pdf.ts';
import { parseXml } from '../src/io/xml.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { crc32, deflateZlib, unzip, zip } from '../src/io/zip.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

const sample: NodeData = {
  text: 'プロジェクト計画',
  note: 'root note',
  children: [
    {
      text: '目的 & <範囲>',
      side: 'r',
      children: [
        { text: 'done item', markers: ['done'] },
        { text: 'todo item', markers: ['t0'], note: 'line 1\nline 2' },
        { text: 'Kozue', link: 'https://example.com/a?b=1&c=2' },
      ],
    },
    { text: 'スケジュール', side: 'l', collapsed: true, children: [{ text: '4月', children: [{ text: 'キックオフ' }] }] },
    { text: 'リスク', side: 'l', markers: ['p1', 'flag-red'] },
  ],
};

/** Keeps only what a text format can carry. */
function strip(n: NodeData, keep: (keyof NodeData)[]): NodeData {
  const out: NodeData = { text: n.text };
  for (const k of keep) if (n[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = n[k];
  if (n.children) out.children = n.children.map((c) => strip(c, keep));
  return out;
}

// ------------------------------------------------------------------ outline

test('parseOutline handles tabs, spaces, bullets and numbering', () => {
  const forest = parseOutline('A\n\tB\n\t\tC\n\tD\nE\n  - F\n  - G\n      1. H\n');
  assert.equal(toOutline(forest), 'A\n\tB\n\t\tC\n\tD\nE\n\tF\n\tG\n\t\tH\n');
});

test('parseOutline reads Markdown headings, checkboxes, links and notes', () => {
  const md = '# Root\n> about\n\n## One\n\n- [x] a\n  - [ ] b\n- [site](https://x.dev)\n\n## Two\n';
  const root = forestToRoot(parseOutline(md), 'fallback');
  assert.deepEqual(root, {
    text: 'Root',
    note: 'about',
    children: [
      {
        text: 'One',
        children: [
          { text: 'a', todo: true, children: [{ text: 'b', todo: false }] },
          { text: 'site', link: 'https://x.dev' },
        ],
      },
      { text: 'Two' },
    ],
  });
});

test('Markdown export round-trips structure, notes, links and task state', () => {
  const md = toMarkdown(sample);
  const back = forestToRoot(parseOutline(md), 'x');
  const expect = strip(sample, ['note', 'link']);
  // Task markers come back as to-dos: Markdown has one notation for both.
  expect.children![0].children![0].todo = true;
  expect.children![0].children![1].todo = false;
  assert.deepEqual(back, expect);
});

test('several top-level items become children of a new root', () => {
  assert.deepEqual(forestToRoot(parseOutline('a\nb'), 'title'), { text: 'title', children: [{ text: 'a' }, { text: 'b' }] });
});

// ---------------------------------------------------------------------- xml

test('parseXml copes with entities, CDATA, comments and doctype', () => {
  const doc = parseXml(
    '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a k="1 &amp; 2" q=\'&#x3042;\'><!-- c --><b/>t&lt;<![CDATA[<raw>]]></a>',
  );
  const a = doc.children[0];
  assert.equal(a.name, 'a');
  assert.deepEqual(a.attrs, { k: '1 & 2', q: 'あ' });
  assert.equal(a.children[0].name, 'b');
  assert.equal(a.text, 't<<raw>');
});

test('OPML round-trips text, notes and links', () => {
  const back = parseOpml(toOpml(sample), 'x');
  const expect = strip(sample, ['note', 'link']);
  expect.children![0].children![0].todo = true;
  assert.deepEqual(back, expect);
});

test('OPML with several top-level outlines uses the head title', () => {
  const src =
    '<opml><head><title>Plan</title></head><body><outline text="a"/><outline text="b"><outline text="c"/></outline></body></opml>';
  assert.deepEqual(parseOpml(src, 'x'), { text: 'Plan', children: [{ text: 'a' }, { text: 'b', children: [{ text: 'c' }] }] });
});

test('FreeMind import maps sides, folding, icons, links and rich notes', () => {
  const mm = `<map version="1.0.1"><node TEXT="Root">
    <node TEXT="L" POSITION="left" FOLDED="true"><icon BUILTIN="full-2"/><icon BUILTIN="button_ok"/><node TEXT="x"/></node>
    <node TEXT="R" POSITION="right" LINK="https://a.b"><richcontent TYPE="NOTE"><html><body><p>one</p><p>two</p></body></html></richcontent></node>
  </node></map>`;
  assert.deepEqual(parseFreemind(mm), {
    text: 'Root',
    children: [
      { text: 'L', side: 'l', markers: ['p2', 'done'], children: [{ text: 'x' }], collapsed: true },
      { text: 'R', note: 'one\ntwo', link: 'https://a.b', side: 'r' },
    ],
  });
});

// ---------------------------------------------------------------------- zip

test('crc32 matches the reference value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
});

test('zip round-trips entries, compressing when it helps', async () => {
  const big = enc.encode('abc'.repeat(5000));
  const archive = await zip([
    { name: 'a.txt', data: enc.encode('hi') },
    { name: 'dir/日本語.json', data: big },
  ]);
  assert.ok(archive.length < big.length / 4, 'repetitive data should be deflated');
  const files = await unzip(archive);
  assert.equal(dec.decode(files.get('a.txt')), 'hi');
  assert.deepEqual(files.get('dir/日本語.json'), big);
  await assert.rejects(unzip(enc.encode('not a zip at all, definitely')));
});

// -------------------------------------------------------------------- xmind

test('Xmind export round-trips through import', async () => {
  const doc: DocData = { format: 'kozue', version: 1, theme: 'hinata', layout: 'map', root: sample };
  const bytes = await toXmind(doc, '0.0.0');
  const files = await unzip(bytes);
  assert.deepEqual([...files.keys()].sort(), ['content.json', 'manifest.json', 'metadata.json']);
  const back = await parseXmind(bytes);
  assert.equal(back.layout, 'map');
  assert.equal(back.sheets.length, 1);
  assert.deepEqual(back.root, sample);
});

test('Xmind structure classes map to Kozue structures and back', async () => {
  for (const layout of ['logic-left', 'brace', 'org-up', 'tree', 'timeline', 'timeline-v', 'fishbone', 'fishbone-right'] as const) {
    const doc: DocData = { format: 'kozue', version: 1, theme: 'hinata', layout, root: { text: 'r', children: [{ text: 'a' }] } };
    assert.equal((await parseXmind(await toXmind(doc, '0'))).layout, layout);
  }
  // No counterpart in Xmind: falls back to the closest structure.
  const hybrid: DocData = { format: 'kozue', version: 1, theme: 'hinata', layout: 'org-tree', root: { text: 'r' } };
  assert.equal((await parseXmind(await toXmind(hybrid, '0'))).layout, 'org');
});

test('Xmind import reads structure, markers, notes, folding and floating topics', async () => {
  const content = [
    {
      title: 'Sheet 1',
      rootTopic: {
        title: 'Central',
        structureClass: 'org.xmind.ui.logic.right',
        children: {
          attached: [
            {
              title: 'A\r\nB',
              branch: 'folded',
              markers: [{ markerId: 'priority-7' }, { markerId: 'task-oct' }, { markerId: 'star-red' }, { markerId: 'people-red' }],
              notes: { plain: { content: ' memo \n' } },
              href: 'xmind:#abc',
              children: { attached: [{ title: 'kid' }] },
            },
            { title: 'web', href: 'https://xmind.app' },
          ],
          detached: [{ title: 'floating' }],
        },
      },
    },
    { title: 'Sheet 2', rootTopic: { title: 'other' } },
  ];
  const bytes = await zip([{ name: 'content.json', data: enc.encode(JSON.stringify(content)) }]);
  const x = await parseXmind(bytes);
  assert.equal(x.sheets.length, 2);
  assert.equal(x.layout, 'logic');
  assert.deepEqual(x.root, {
    text: 'Central',
    children: [
      { text: 'A\nB', note: 'memo', markers: ['p5', 't25', 'star'], children: [{ text: 'kid' }], collapsed: true },
      { text: 'web', link: 'https://xmind.app' },
      { text: 'floating' },
    ],
  });
});

test('legacy Xmind 8 content.xml is supported', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink">
    <sheet id="s"><topic id="r" structure-class="org.xmind.ui.org-chart.down"><title>Root &amp; Co</title><children><topics type="attached">
      <topic id="a" branch="folded" xlink:href="https://a.b"><title>A</title><notes><plain>n1</plain></notes>
        <marker-refs><marker-ref marker-id="task-done"/></marker-refs>
        <children><topics type="attached"><topic id="a1"><title>A1</title></topic></topics></children></topic>
    </topics></children></topic><title>Sheet</title></sheet></xmap-content>`;
  const x = await parseXmind(await zip([{ name: 'content.xml', data: enc.encode(xml) }]));
  assert.equal(x.layout, 'org');
  assert.deepEqual(x.root, {
    text: 'Root & Co',
    children: [{ text: 'A', note: 'n1', link: 'https://a.b', markers: ['done'], children: [{ text: 'A1' }], collapsed: true }],
  });
});

// ------------------------------------------------------------------ formats

test('importFile detects formats by extension and by content', async () => {
  const doc: DocData = { format: 'kozue', version: 1, theme: 'sora', layout: 'org', root: sample };
  const native = await importFile('plan.kozue', enc.encode(serializeNative(doc)));
  assert.equal(native.native, true);
  assert.equal(native.theme, 'sora');
  assert.equal(native.layout, 'org');
  assert.deepEqual(native.root, sample);

  const md = await importFile('notes.md', enc.encode('﻿# T\n- a\n'));
  assert.deepEqual(md.root, { text: 'T', children: [{ text: 'a' }] });
  assert.equal(md.native, false);

  const sniffed = await importFile('export.xml', enc.encode(toOpml(sample)));
  assert.equal(sniffed.root.text, sample.text);

  const zipped = await importFile('renamed.bin', await toXmind(doc, '0'));
  assert.equal(zipped.root.text, sample.text);

  const txt = await importFile('list.txt', enc.encode('one\ntwo\n'));
  assert.deepEqual(txt.root, { text: 'list', children: [{ text: 'one' }, { text: 'two' }] });

  await assert.rejects(importFile('bad.kozue', enc.encode('{"format":"other"}')));
  assert.ok(exportText('txt', doc).startsWith('プロジェクト計画\n\t目的'));
});

// ---------------------------------------------------------------------- pdf

test('buildPdf writes a consistent cross-reference table', async () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255]);
  const rgb = rgbaToRgb(rgba);
  assert.equal(rgb.length, 12);
  const z = await deflateZlib(rgb);
  assert.deepEqual(new Uint8Array(inflateSync(z)), rgb);
  const pdf = buildPdf(z, 2, 2, 150, 150);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const entries = text.slice(xref).split('\n').slice(3, 8);
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + 7), `${i + 1} 0 obj`);
  });
  assert.ok(text.includes(`/Length ${z.length}`));
});
