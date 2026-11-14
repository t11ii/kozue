import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import { toggleMarker } from '../src/core/markers.ts';
import {
  Doc,
  MNode,
  balancedSplit,
  fromData,
  inDocOrder,
  isBalanced,
  nextColor,
  splitIndex,
  toData,
  topLevel,
  walkVisible,
} from '../src/core/model.ts';
import { LAYOUT_KINDS } from '../src/core/structures.ts';
import { wrapText } from '../src/core/text.ts';
import { DEFAULT_THEME, themeById } from '../src/core/themes.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

const px = (s: string): number => {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0)! > 0x2e7f ? 10 : 5;
  return w;
};

let stamp = 0;
const opts = (): LayoutOpts => ({
  theme: themeById(DEFAULT_THEME),
  measurer: fakeMeasurer,
  epoch: 1,
  stamp: ++stamp,
  editing: null,
});

// --------------------------------------------------------------------- text

test('wrapText keeps short text on one line', () => {
  const b = wrapText('hello world', 200, px);
  assert.deepEqual(b.lines, ['hello world']);
  assert.equal(b.width, 55);
});

test('wrapText breaks latin text at spaces and drops the break space', () => {
  const b = wrapText('aaaa bbbb cccc dddd', 50, px);
  assert.deepEqual(b.lines, ['aaaa bbbb', 'cccc dddd']);
  assert.ok(b.width <= 50);
});

test('wrapText breaks CJK anywhere but honours kinsoku', () => {
  // 10px per char, 50px wide: five chars per line; 。 may not start a line.
  const b = wrapText('あいうえお。かきくけこ', 50, px);
  assert.equal(b.lines.join(''), 'あいうえお。かきくけこ');
  for (const l of b.lines) assert.ok(!'。、）'.includes(l[0]), `line starts with punctuation: ${l}`);
  const c = wrapText('あいうえ「かきくけこ」', 50, px);
  for (const l of c.lines) assert.ok(!l.endsWith('「'), `line ends with opening bracket: ${l}`);
});

test('wrapText splits words longer than the line and keeps explicit newlines', () => {
  const b = wrapText('abcdefghijklmnopqrstuvwxyz', 50, px);
  assert.equal(b.lines.join(''), 'abcdefghijklmnopqrstuvwxyz');
  assert.ok(b.lines.every((l) => px(l) <= 50));
  assert.deepEqual(wrapText('a\n\nb', 100, px).lines, ['a', '', 'b']);
  assert.deepEqual(wrapText('', 100, px).lines, ['']);
});

// -------------------------------------------------------------------- model

test('transactions undo and redo structural edits', () => {
  const doc = makeDoc(T('root', T('a'), T('b')));
  const [a, b] = doc.root.children;
  const c = new MNode('c');
  doc.run('add', () => doc.insert(c, a, 0));
  doc.run('move', () => {
    doc.remove(c);
    doc.insert(c, b, 0);
    doc.set(c, 'text', 'c2');
  });
  assert.equal(b.children[0], c);
  assert.equal(c.text, 'c2');
  doc.undo();
  assert.equal(a.children[0], c);
  assert.equal(c.text, 'c');
  doc.undo();
  assert.equal(a.children.length, 0);
  assert.equal(c.parent, null);
  doc.redo();
  doc.redo();
  assert.equal(b.children[0], c);
  assert.equal(c.text, 'c2');
  assert.equal(doc.canRedo, false);
});

test('mutating outside run() throws, empty transactions leave no trace', () => {
  const doc = makeDoc(T('root', T('a')));
  assert.throws(() => doc.set(doc.root, 'text', 'x'));
  assert.equal(
    doc.run('noop', () => doc.set(doc.root, 'text', 'root')),
    false,
  );
  assert.equal(doc.canUndo, false);
});

test('merge keys collapse steps and dirty tracking follows the history', () => {
  const doc = makeDoc(T('root'));
  assert.equal(doc.dirty, false);
  const n = new MNode('');
  doc.run('new', () => doc.insert(n, doc.root), { merge: 'new:' + n.id });
  doc.run('text', () => doc.set(n, 'text', 'hello'), { merge: 'new:' + n.id });
  assert.equal(doc.undoStack.length, 1);
  assert.equal(doc.dirty, true);
  doc.markSaved();
  assert.equal(doc.dirty, false);
  doc.run('text', () => doc.set(n, 'text', 'hello!'), { merge: 'new:' + n.id });
  assert.equal(doc.dirty, true, 'merging into the saved step must mark the doc dirty');
  doc.markSaved();
  doc.undo();
  assert.equal(doc.dirty, true);
  assert.equal(doc.root.children.length, 0);
  doc.redo();
  assert.equal(doc.dirty, false);
  assert.equal(n.text, 'hello!');
});

test('serialization round-trips and sanitises input', () => {
  const doc = makeDoc(
    T('root', { text: 'a', note: 'memo', link: 'https://example.com', markers: ['p1', 'done'], children: [T('a1')] }, T('b')),
  );
  const again = Doc.fromData(JSON.parse(JSON.stringify(doc.toData())), DEFAULT_THEME, 7);
  assert.deepEqual(again.toData(), doc.toData());
  const dirty = fromData({ text: 42, side: 'x', color: 'red', markers: ['p1', 'bogus', 'p1'], children: [null, { text: 'ok' }] });
  assert.deepEqual(toData(dirty), { text: '', markers: ['p1'], children: [{ text: '' }, { text: 'ok' }] });
});

test('main topics get balanced sides and rotating colors', () => {
  const doc = makeDoc(T('root', T('a'), T('b'), T('c'), T('d')));
  assert.deepEqual(
    doc.root.children.map((k) => k.side),
    ['r', 'r', 'l', 'l'],
  );
  assert.deepEqual(
    doc.root.children.map((k) => k.color),
    [0, 1, 2, 3],
  );
  assert.equal(nextColor(doc.root, 7), 4);
  doc.root.children[1].color = 6;
  assert.equal(nextColor(doc.root, 7, doc.root.children[0]), 1, 'reuses the freed slot after the reference');
});

test('balancedSplit weighs subtrees and moves as few topics as possible', () => {
  const kids = (...weights: number[]): MNode[] =>
    weights.map((w) => fromData(T('m', ...Array.from({ length: w > 1 ? w : 0 }, () => T('leaf')))));
  assert.equal(balancedSplit(kids(1)), 1);
  assert.equal(balancedSplit(kids(1, 1)), 1);
  assert.equal(balancedSplit(kids(1, 1, 1)), 2, 'ties prefer the right-hand side');
  assert.equal(balancedSplit(kids(1, 1, 1), 1), 1, 'ties keep the current split when asked to');
  assert.equal(balancedSplit(kids(1, 1, 1, 1), 1), 2, 'a clearly better split wins over staying put');
  assert.equal(balancedSplit(kids(9, 1, 1, 1)), 1, 'one heavy branch balances several light ones');
  assert.equal(balancedSplit([]), 0);
});

test('isBalanced recognises automatic and hand-made arrangements', () => {
  const doc = makeDoc(T('root', T('a'), T('b'), T('c'), T('d')));
  const kids = doc.root.children;
  assert.equal(splitIndex(kids), 2);
  assert.equal(isBalanced(kids), true);
  kids[1].side = 'l'; // r l l l: one against three
  assert.equal(splitIndex(kids), 1);
  assert.equal(isBalanced(kids), false);
  kids[1].side = 'r';
  kids[0].side = 'l'; // l r l l: sides interleave
  assert.equal(splitIndex(kids), -1);
  assert.equal(isBalanced(kids), false);
  assert.equal(isBalanced([]), true);
});

test('topLevel and inDocOrder', () => {
  const doc = makeDoc(T('root', T('a', T('a1'), T('a2')), T('b')));
  const [a, b] = doc.root.children;
  assert.deepEqual(topLevel([a.children[0], a, b]), [a, b]);
  assert.deepEqual(inDocOrder(doc.root, [b, a.children[1], a]), [a, a.children[1], b]);
});

test('toggleMarker is exclusive within a group', () => {
  assert.deepEqual(toggleMarker(undefined, 'p1'), ['p1']);
  assert.deepEqual(toggleMarker(['p1'], 'p2'), ['p2']);
  assert.deepEqual(toggleMarker(['p2', 'done'], 'star'), ['p2', 'done', 'star']);
  assert.equal(toggleMarker(['p2'], 'p2'), undefined);
});

// ------------------------------------------------------------------- layout

function overlaps(a: MNode, b: MNode): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function visible(doc: Doc): MNode[] {
  const out: MNode[] = [];
  walkVisible(doc.root, (n) => out.push(n));
  return out;
}

function bigTree(): ReturnType<typeof T> {
  const sub = (p: string, n: number): ReturnType<typeof T>[] =>
    Array.from({ length: n }, (_, i) => T(`${p}.${i} 項目`, ...(i % 2 ? [T('leaf one'), T('葉っぱ'), T('x')] : [])));
  return T('中心トピック', ...Array.from({ length: 7 }, (_, i) => T(`Main ${i}`, ...sub(`m${i}`, 2 + (i % 4)))));
}

for (const kind of LAYOUT_KINDS) {
  test(`${kind} layout: no overlaps, bounds contain every node`, () => {
    const doc = makeDoc(bigTree(), kind);
    const { bounds, count } = layoutDoc(doc, opts());
    const nodes = visible(doc);
    assert.equal(count, nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      assert.ok(a.x >= bounds.x0 - 1e-6 && a.x + a.w <= bounds.x1 + 1e-6 && a.y >= bounds.y0 - 1e-6 && a.y + a.h <= bounds.y1 + 1e-6);
      for (let j = i + 1; j < nodes.length; j++) assert.ok(!overlaps(a, nodes[j]), `${a.text} overlaps ${nodes[j].text}`);
    }
  });
}

test('map layout puts sides on opposite halves and centers parents on their children', () => {
  const doc = makeDoc(bigTree());
  layoutDoc(doc, opts());
  const root = doc.root;
  assert.equal(root.x + root.w / 2, 0);
  assert.equal(root.y + root.h / 2, 0);
  for (const k of root.children) {
    if (k.side === 'l') assert.ok(k.x + k.w < root.x);
    else assert.ok(k.x > root.x + root.w);
    if (k.children.length) {
      const first = k.children[0];
      const last = k.children.at(-1)!;
      const mid = (first.y + first.h / 2 + last.y + last.h / 2) / 2;
      assert.ok(Math.abs(mid - (k.y + k.h / 2)) < 1e-6);
      for (const c of k.children) assert.equal(c.dir, k.side === 'l' ? -1 : 1);
    }
  }
});

test('collapsed branches are skipped and counted', () => {
  const doc = makeDoc(bigTree());
  const main = doc.root.children[1];
  main.collapsed = true;
  const { count } = layoutDoc(doc, opts());
  assert.equal(count, visible(doc).length);
  assert.ok(main.hidden > 0);
  assert.equal(main.bx1 - main.bx0, main.w);
});

test('layout only re-measures nodes whose content changed', () => {
  const doc = makeDoc(bigTree());
  let calls = 0;
  const counting = {
    ...fakeMeasurer,
    width: (f: Parameters<typeof fakeMeasurer.width>[0], s: string) => (calls++, fakeMeasurer.width(f, s)),
  };
  const o = (): LayoutOpts => ({ ...opts(), measurer: counting });
  layoutDoc(doc, o());
  assert.ok(calls > 0);
  calls = 0;
  layoutDoc(doc, o());
  assert.equal(calls, 0);
  doc.run('edit', () => doc.set(doc.root.children[0], 'text', 'changed'));
  layoutDoc(doc, o());
  assert.ok(calls > 0 && calls < 5);
});

test('relayout of ~9,000 topics stays fast', () => {
  const kids = (d: number): ReturnType<typeof T>[] =>
    d === 0 ? [] : Array.from({ length: 6 }, (_, i) => T(`node ${d}-${i}`, ...kids(d - 1)));
  const doc = makeDoc(T('root', ...kids(5)));
  layoutDoc(doc, opts());
  const t0 = performance.now();
  const { count } = layoutDoc(doc, opts());
  const dt = performance.now() - t0;
  assert.ok(count > 9000, `count ${count}`);
  assert.ok(dt < 50, `relayout took ${dt.toFixed(1)}ms`);
});
