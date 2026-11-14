// Labels, to-dos, boundaries, summaries, relationships, branch structures,
// the branch-only layout and find & replace.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import type { DocData, LayoutKind, NodeData } from '../src/core/model.ts';
import { Doc, MNode, Rel, balancedSplit, cleanLabels, cloneForPaste, isBalanced, walkVisible } from '../src/core/model.ts';
import { A_DOWN, A_LEFT, A_RIGHT, A_TREE_DL, A_TREE_DR, BRANCH_KINDS, LAYOUT_KINDS } from '../src/core/structures.ts';
import { occurrences } from '../src/core/text.ts';
import { DEFAULT_THEME, FRAME_GAP, themeById } from '../src/core/themes.ts';
import { importFile } from '../src/io/formats.ts';
import { parseOutline, toMarkdown } from '../src/io/outline.ts';
import { parseXmind, toXmind } from '../src/io/xmind.ts';
import { unzip, zip } from '../src/io/zip.ts';
import { frameRect, relCurve, snapPositions } from '../src/render/scene.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

let stamp = 5000;
const opts = (): LayoutOpts => ({ theme: themeById(DEFAULT_THEME), measurer: fakeMeasurer, epoch: 1, stamp: ++stamp, editing: null });
const palette = themeById(DEFAULT_THEME).palette.length;

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
const cx = (n: MNode): number => n.x + n.w / 2;
const cy = (n: MNode): number => n.y + n.h / 2;
const kidsOf = (n: MNode): string => n.children.map((k) => k.text + (k.sum !== undefined ? `(${k.sum})` : '')).join(' ');

/** Fails when two topic boxes overlap. */
function assertNoOverlap(root: MNode, where: string): void {
  const nodes = visible(root);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      assert.ok(apart, `${where}: "${a.text}" overlaps "${b.text}"`);
    }
  }
}

const parent = (...kids: string[]): NodeData => T('Root', T('P', ...kids.map((k) => T(k))), T('Q', T('q1'), T('q2')));

// ---------------------------------------------------------------------- model

test('new topic properties are saved and loaded; malformed values are dropped', () => {
  const data: DocData = {
    format: 'kozue',
    version: 1,
    theme: DEFAULT_THEME,
    layout: 'map',
    root: {
      text: 'Root',
      children: [
        {
          text: 'A',
          side: 'r',
          color: 0,
          todo: false,
          labels: ['x', 'y'],
          structure: 'org',
          boundary: 'Frame',
          children: [{ text: 'a1', todo: true }],
        },
        { text: 'B', side: 'r', color: 1 },
        { text: 'S', side: 'r', color: 2, summary: 2 },
      ],
    },
  };
  const doc = Doc.fromData(JSON.parse(JSON.stringify(data)), DEFAULT_THEME, palette);
  assert.deepEqual(doc.toData(), data);

  const odd = {
    ...data,
    root: {
      text: 'Root',
      structure: 'org',
      boundary: 'no frame around the whole map',
      children: [
        { text: 'A', structure: 'map', labels: [' x ', 'x', 3, ''], todo: 'yes', summary: 1.5, boundary: 7 },
        { text: 'B', structure: 'nonsense', summary: 0 },
      ],
    },
  };
  const back = Doc.fromData(JSON.parse(JSON.stringify(odd)), DEFAULT_THEME, palette).toData();
  assert.deepEqual(
    back.root.children!.map((k) => ({ ...k, side: undefined, color: undefined })),
    [
      { text: 'A', labels: ['x'], side: undefined, color: undefined },
      { text: 'B', side: undefined, color: undefined },
    ],
  );
  assert.equal(back.root.structure, undefined);
  assert.equal(back.root.boundary, undefined);
});

test('cleanLabels trims, de-duplicates and bounds', () => {
  assert.deepEqual(cleanLabels([' a  b ', 'a b', '', 'c']), ['a b', 'c']);
  assert.equal(cleanLabels(['', '  ']), undefined);
  assert.equal(cleanLabels(Array.from({ length: 40 }, (_, i) => 'l' + i))!.length, 12);
});

test('relationships are saved by id, survive moves and die with their topics', () => {
  const doc = makeDoc(parent('a', 'b', 'c'));
  const [a, b, c] = ['a', 'b', 'c'].map((t) => find(doc, t));
  const q = find(doc, 'Q');
  const rel = new Rel(a, c, 'leads to');
  rel.bend = -40;
  doc.run('rel', () => doc.addRel(rel));
  doc.run('rel', () => doc.addRel(new Rel(b, q)));

  const data = doc.toData();
  assert.equal(data.relationships!.length, 2);
  assert.deepEqual(data.relationships![0], { from: a.ref, to: c.ref, text: 'leads to', bend: -40 });
  assert.equal(JSON.stringify(data).match(/"id"/g)!.length, 4, 'only the four ends carry an id');
  const again = Doc.fromData(JSON.parse(JSON.stringify(data)), DEFAULT_THEME, palette);
  assert.deepEqual(
    again.rels.map((r) => [r.from.text, r.to.text, r.text, r.bend]),
    [
      ['a', 'c', 'leads to', -40],
      ['b', 'Q', '', undefined],
    ],
  );
  assert.deepEqual(again.toData(), data);

  // Moving an end keeps the relationship.
  doc.run('move', () => {
    doc.remove(a);
    doc.insert(a, q);
  });
  assert.equal(doc.rels.length, 2);
  // Deleting an end (even through an ancestor) removes it; undo brings it back.
  doc.run('delete', () => doc.remove(q));
  assert.deepEqual(
    doc.rels.map((r) => r.from.text + '>' + r.to.text),
    [],
  );
  doc.undo();
  assert.deepEqual(
    doc.rels.map((r) => r.from.text + '>' + r.to.text),
    ['a>c', 'b>Q'],
  );
  // Relationships whose ends are unknown, or the same topic, are not loaded.
  const broken = { ...data, relationships: [{ from: 'nope', to: c.ref }, { from: c.ref, to: c.ref }, 5, { from: a.ref, to: c.ref }] };
  assert.equal(Doc.fromData(JSON.parse(JSON.stringify(broken)), DEFAULT_THEME, palette).rels.length, 1);
});

test('changes to a relationship are undoable; typing its text is one step', () => {
  const doc = makeDoc(parent('a', 'b'));
  const rel = new Rel(find(doc, 'a'), find(doc, 'b'));
  doc.run('add', () => doc.addRel(rel));
  for (const text of ['h', 'he', 'hey']) doc.run('text', () => doc.setRel(rel, 'text', text), { merge: 'rel' });
  assert.equal(doc.undoStack.length, 2);
  doc.undo();
  assert.equal(rel.text, '');
  doc.redo();
  assert.equal(rel.text, 'hey');
  doc.undo();
  doc.undo();
  assert.equal(doc.rels.length, 0);
  doc.redo();
  assert.deepEqual(doc.rels, [rel]);
});

test('a summary follows what happens to the topics it sums up', () => {
  const doc = makeDoc(parent('a', 'b', 'c', 'd'));
  const p = find(doc, 'P');
  const s = new MNode('S');
  s.sum = 2;
  doc.run('summary', () => doc.insert(s, p, 3)); // sums up b and c
  assert.equal(kidsOf(p), 'a b c S(2) d');

  const add = (text: string, index: number): MNode => {
    const n = new MNode(text);
    doc.run('add', () => doc.insert(n, p, index));
    return n;
  };
  add('x', 2); // between b and c
  assert.equal(kidsOf(p), 'a b x c S(3) d');
  add('y', 4); // right before the summary: joins
  assert.equal(kidsOf(p), 'a b x c y S(4) d');
  add('z', 1); // right before the first summarized topic: stays outside
  assert.equal(kidsOf(p), 'a z b x c y S(4) d');
  add('w', 7); // after the summary
  assert.equal(kidsOf(p), 'a z b x c y S(4) w d');

  doc.run('del', () => doc.remove(find(doc, 'x')));
  assert.equal(kidsOf(p), 'a z b c y S(3) w d');
  doc.run('del', () => doc.remove(find(doc, 'a'))); // not summed up
  assert.equal(kidsOf(p), 'z b c y S(3) w d');
  doc.undo();
  doc.undo();
  assert.equal(kidsOf(p), 'a z b x c y S(4) w d');

  // Removing everything it sums up leaves an ordinary topic.
  doc.run('del', () => {
    for (const t of ['b', 'x', 'c', 'y']) doc.remove(find(doc, t));
  });
  assert.equal(kidsOf(p), 'a z S w d');
  doc.undo();
  assert.equal(kidsOf(p), 'a z b x c y S(4) w d');
  // Copies of a summary topic are ordinary topics.
  assert.equal(cloneForPaste(s).summary, undefined);
});

test('balancing the sides never separates a summary from its topics', () => {
  const doc = makeDoc(T('Root', T('a'), T('b'), T('c'), T('d')));
  const kids = doc.root.children;
  const s = new MNode('S');
  s.sum = 2;
  doc.run('summary', () => doc.insert(s, doc.root, 3)); // a b c S d — sums up b, c
  const k = balancedSplit(doc.root.children);
  assert.ok(k <= 1 || k >= 4, `split at ${k} cuts through the summary`);
  doc.root.children.forEach((c, i) => (c.side = i < 2 ? 'r' : 'l')); // a b | c S d
  assert.equal(isBalanced(doc.root.children), false);
  assert.equal(kids.length, 5);
});

// --------------------------------------------------------------------- layout

test('labels and a to-do box take room in the topic', () => {
  const doc = makeDoc(T('Root', T('Plain'), T('Plain')));
  layoutDoc(doc, opts());
  const [a, b] = doc.root.children;
  const { w, h, tx } = a;
  doc.run('props', () => {
    doc.set(b, 'todo', false);
    doc.set(b, 'labels', ['one', 'two']);
  });
  layoutDoc(doc, opts());
  assert.equal(a.w, w);
  assert.ok(b.h > h && b.tx > tx, 'to-do and labels enlarge the box');
  assert.equal(b.lab.length, 2);
  assert.ok(b.lab[0].y >= b.ty + b.th && b.lab[1].x > b.lab[0].x + b.lab[0].w);
  assert.ok(
    b.lab.every((l) => l.x + l.w <= b.w && l.y + 17 <= b.h),
    'chips stay inside the box',
  );
});

test('a branch can have a structure of its own, in any structure of the map', () => {
  for (const kind of LAYOUT_KINDS) {
    for (const sub of BRANCH_KINDS) {
      const doc = makeDoc(
        T(
          'Root',
          T('Alpha', T('a1'), T('a2', T('a2x'), T('a2y'))),
          T('Beta', T('b1'), T('b2', T('b2x')), T('b3')),
          T('Gamma', T('g1')),
          T('Delta'),
        ),
        kind,
      );
      doc.root.children[1].structure = sub;
      doc.root.children[1].children[1].structure = sub === 'org' ? 'tree' : 'org';
      layoutDoc(doc, opts());
      assertNoOverlap(doc.root, `${sub} in ${kind}`);
      for (const n of visible(doc.root)) {
        assert.ok([n.x, n.y, n.bx0, n.bx1, n.by0, n.by1].every(Number.isFinite), `${sub} in ${kind}: ${n.text}`);
        for (let p: MNode | null = n; p; p = p.parent) {
          assert.ok(
            n.x >= p.bx0 - 1e-6 && n.x + n.w <= p.bx1 + 1e-6 && n.y >= p.by0 - 1e-6 && n.y + n.h <= p.by1 + 1e-6,
            `${sub} in ${kind}: ${n.text}`,
          );
        }
      }
    }
  }
});

test('an org chart branch in a mind map hangs its topics below it, boxed; a tree branch follows its side', () => {
  const doc = makeDoc(T('Root', T('Org', T('o1'), T('o2')), T('Plain', T('p1')), T('Tree', T('t1'), T('t2'))));
  const [org, plain, tree] = doc.root.children;
  org.side = plain.side = 'r';
  tree.side = 'l';
  org.structure = 'org';
  tree.structure = 'tree';
  layoutDoc(doc, opts());
  assert.equal(org.cdir, A_DOWN);
  assert.ok(org.children.every((k) => k.y > org.y + org.h && k.box && !k.ul));
  assert.equal(org.children[0].y, org.children[1].y);
  assert.ok(plain.children[0].ul && plain.children[0].dir === A_RIGHT);
  assert.equal(tree.dir, A_LEFT);
  assert.equal(tree.cdir, A_TREE_DL);
  assert.ok(
    tree.children.every((k) => k.y > tree.y + tree.h && k.x + k.w < tree.x + tree.w),
    'the list is indented to the left',
  );
  // On the right the same list is indented to the right.
  tree.side = 'r';
  layoutDoc(doc, opts());
  assert.equal(tree.cdir, A_TREE_DR);
  assert.ok(tree.children.every((k) => k.x > tree.x));
});

test('a boundary takes room around its branch and keeps other topics out', () => {
  for (const kind of LAYOUT_KINDS) {
    const doc = makeDoc(T('Root', T('Alpha', T('a1'), T('a2')), T('Beta', T('b1'), T('b2', T('b2x'))), T('Gamma', T('g1'))), kind);
    const beta = doc.root.children[1];
    const plain = layoutDoc(doc, opts()).bounds;
    beta.boundary = 'Group';
    beta.children[1].boundary = '';
    const framed = layoutDoc(doc, opts()).bounds;
    assert.ok(framed.x1 - framed.x0 + (framed.y1 - framed.y0) > plain.x1 - plain.x0 + (plain.y1 - plain.y0), kind);
    snapPositions(doc.root);
    for (const f of [beta, beta.children[1]]) {
      const [x, y, w, h] = frameRect(f);
      const inside = new Set(visible(f));
      for (const n of visible(doc.root)) {
        if (inside.has(n)) {
          assert.ok(
            n.x >= x && n.x + n.w <= x + w && n.y >= y && n.y + n.h <= y + h,
            `${kind}: ${n.text} sticks out of the frame of ${f.text}`,
          );
        } else if (n !== doc.root && !inside.has(n) && !(f === beta.children[1] && n === beta)) {
          const apart = n.x + n.w <= x || n.x >= x + w || n.y + n.h <= y || n.y >= y + h;
          assert.ok(apart, `${kind}: ${n.text} lies in the frame of ${f.text}`);
        }
      }
    }
    assertNoOverlap(doc.root, kind);
  }
  assert.ok(FRAME_GAP > 0);
});

test('a summary topic stands beside the topics it sums up, which make room for it', () => {
  const make = (kind: LayoutKind): Doc => {
    const doc = makeDoc(
      T('Root', T('P', T('a'), T('b', T('b1')), T('c'), T('S', T('s1'), T('s2'), T('s3'), T('s4')), T('d')), T('Q', T('q1'))),
      kind,
    );
    find(doc, 'S').sum = 2;
    return doc;
  };
  for (const kind of ['map', 'logic', 'logic-left', 'org', 'org-up', 'tree', 'brace'] as const) {
    const doc = make(kind);
    layoutDoc(doc, opts());
    const [b, c, s] = ['b', 'c', 'S'].map((t) => find(doc, t));
    assert.equal(s.sumN, 2, kind);
    assert.equal(b.cover, s, kind);
    assert.equal(c.cover, s, kind);
    assert.equal(find(doc, 'a').cover, null, kind);
    assert.equal(s.dir, b.dir, kind);
    assertNoOverlap(doc.root, kind);
    const members = [b, c, find(doc, 'b1')];
    if (kind === 'org' || kind === 'org-up') {
      // Below (above) the row, centered on the two topics.
      const v = kind === 'org' ? 1 : -1;
      assert.ok(
        members.every((m) => v * (cy(s) - cy(m)) > 0),
        kind,
      );
      assert.ok(Math.abs(cx(s) - (b.bx0 + c.bx1) / 2) < 1, kind);
    } else {
      const h = s.dir === A_LEFT ? -1 : 1;
      assert.ok(
        members.every((m) => h * (s.x - m.x) > 0),
        `${kind}: the summary is past its topics`,
      );
      assert.ok(cy(s) > b.by0 && cy(s) < c.by1, `${kind}: the summary is level with its topics`);
    }
    // Four subtopics are taller than two topics: the neighbours keep clear of them.
    const d = find(doc, 'd');
    const sKids = s.children;
    assert.ok(
      sKids.every((k) => k.y + k.h <= d.y || k.x >= d.x + d.w || k.x + k.w <= d.x || k.y >= d.y + d.h),
      kind,
    );
  }
  // Where summaries are not available the topic is laid out like any other.
  for (const kind of ['timeline', 'fishbone'] as const) {
    const doc = makeDoc(T('Root', T('a'), T('b'), T('S'), T('c')), kind);
    find(doc, 'S').sum = 2;
    layoutDoc(doc, opts());
    assert.equal(find(doc, 'S').sumN, 0, kind);
    assertNoOverlap(doc.root, kind);
  }
  // In a mind map a summary only sums up topics on one side of the central topic.
  const doc = makeDoc(T('Root', T('a'), T('b'), T('S')));
  const [a, b, s] = doc.root.children;
  s.sum = 2;
  a.side = 'r';
  b.side = s.side = 'l';
  layoutDoc(doc, opts());
  assert.equal(s.sumN, 1);
  assert.equal(a.cover, null);
  assert.equal(s.dir, A_LEFT);
});

test('a branch laid out on its own keeps its shape, level and direction', () => {
  for (const kind of LAYOUT_KINDS) {
    const doc = makeDoc(
      T(
        'Root',
        T('Alpha', T('a1'), T('a2', T('a2x'), T('a2y')), T('a3')),
        T('Beta', T('b1', T('b1x')), T('b2')),
        T('Gamma'),
        T('Delta', T('d1')),
      ),
      kind,
    );
    layoutDoc(doc, opts());
    for (const from of [doc.root.children[1], doc.root.children[0].children[1]]) {
      layoutDoc(doc, opts());
      const whole = visible(from).map((n) => [n.text, n.lv, n.dir, n.cdir, n.branch, n.x - from.x, n.y - from.y]);
      const res = layoutDoc(doc, opts(), from);
      assert.ok(Math.abs(cx(from)) < 1e-9 && Math.abs(cy(from)) < 1e-9, `${kind}: ${from.text} is the new origin`);
      assert.equal(res.count, whole.length, kind);
      const alone = visible(from).map((n) => [n.text, n.lv, n.dir, n.cdir, n.branch, n.x - from.x, n.y - from.y]);
      assert.deepEqual(
        alone.map((r) => r.slice(0, 5)),
        whole.map((r) => r.slice(0, 5)),
        kind,
      );
      // Offsets inside the branch do not depend on the rest of the map (org charts align rows across branches).
      if (kind !== 'org' && kind !== 'org-up' && kind !== 'org-tree') {
        alone.forEach((r, i) => {
          assert.ok(
            Math.abs((r[5] as number) - (whole[i][5] as number)) < 1e-6 && Math.abs((r[6] as number) - (whole[i][6] as number)) < 1e-6,
            `${kind}: ${r[0]}`,
          );
        });
      }
      assert.ok(res.bounds.x0 <= from.x && res.bounds.x1 >= from.x + from.w, kind);
    }
  }
});

test('relationship curves start and end at the edges of their topics and can be bent', () => {
  const doc = makeDoc(parent('a', 'b', 'c'), 'logic');
  layoutDoc(doc, opts());
  snapPositions(doc.root);
  const a = find(doc, 'a');
  const c = find(doc, 'c');
  const rel = new Rel(a, c);
  const onEdge = (n: MNode, x: number, y: number, gap: number): boolean => {
    const dx = Math.max(n.x - x, x - (n.x + n.w));
    const dy = Math.max(n.y - y, y - (n.y + n.h));
    return Math.abs(Math.max(dx, dy) - gap) < 1e-6;
  };
  const auto = relCurve(rel);
  assert.ok(onEdge(a, auto.x0, auto.y0, 4) && onEdge(c, auto.x1, auto.y1, 6));
  rel.bend = 200;
  const left = relCurve(rel);
  rel.bend = -200;
  const right = relCurve(rel);
  assert.ok(left.c1x !== right.c1x && Math.sign(left.c1x - cx(a)) !== Math.sign(right.c1x - cx(a)), 'the bend chooses the side');
  rel.bend = 0;
  const straight = relCurve(rel);
  assert.ok(Math.abs(straight.c1x - cx(a)) < 1 && Math.abs(straight.c2x - cx(c)) < 1);
});

// ------------------------------------------------------------------------- io

const rich: DocData = {
  format: 'kozue',
  version: 1,
  theme: DEFAULT_THEME,
  layout: 'logic',
  root: {
    text: 'Root',
    children: [
      {
        text: 'Plan',
        side: 'r',
        color: 0,
        labels: ['q1', 'team'],
        structure: 'org',
        children: [
          { text: 'draft', id: 't1', todo: true },
          { text: 'review', todo: false, boundary: 'next' },
          { text: 'both done', summary: 2, children: [{ text: 'ship' }] },
          { text: 'later', boundary: '' },
        ],
      },
      { text: 'Risks', side: 'r', color: 1, id: 't2', structure: 'fishbone', children: [{ text: 'time' }] },
    ],
  },
  relationships: [{ from: 't1', to: 't2', text: 'may slip' }],
};

test('Xmind export and import keep labels, to-dos, boundaries, summaries, relationships and branch structures', async () => {
  const back = await parseXmind(await toXmind(rich, 'test'));
  assert.equal(back.layout, 'logic');
  const ids = new Map<string, string>();
  const strip = (n: NodeData): NodeData => {
    const { side: _s, color: _c, id, ...rest } = n;
    const out: NodeData = { ...rest };
    if (id !== undefined) ids.set(id, n.text);
    if (n.children) out.children = n.children.map(strip);
    return out;
  };
  const expect = strip(rich.root);
  ids.clear();
  assert.deepEqual(strip(back.root), expect);
  assert.deepEqual(
    back.relationships!.map((r) => [ids.get(r.from), ids.get(r.to), r.text]),
    [['draft', 'Risks', 'may slip']],
  );
  // The file itself uses Xmind's own notation.
  const json = JSON.parse(
    new TextDecoder().decode((await unzip(await toXmind(rich, 'test'), (n) => n === 'content.json')).get('content.json')!),
  );
  const plan = json[0].rootTopic.children.attached[0];
  assert.equal(plan.structureClass, 'org.xmind.ui.org-chart.down');
  assert.deepEqual(plan.labels, ['q1', 'team']);
  assert.deepEqual(
    plan.children.attached.map((t: { title: string }) => t.title),
    ['draft', 'review', 'later'],
  );
  assert.equal(plan.summaries[0].range, '(0,1)');
  assert.equal(plan.summaries[0].topicId, plan.children.summary[0].id);
  assert.deepEqual(
    plan.boundaries.map((b: { range: string; title?: string }) => [b.range, b.title]),
    [
      ['(1,1)', 'next'],
      ['(2,2)', undefined],
    ],
  );
  assert.equal(json[0].relationships[0].end1Id, plan.children.attached[0].id);
  assert.equal(json[0].relationships[0].title, 'may slip');
});

test('Xmind files made elsewhere: ranges of several topics, the central map sides, and the old XML form', async () => {
  const enc = new TextEncoder();
  const content = [
    {
      rootTopic: {
        id: 'r',
        title: 'Root',
        structureClass: 'org.xmind.ui.map.unbalanced',
        extensions: [{ provider: 'org.xmind.ui.map.unbalanced', content: [{ name: 'right-number', content: '2' }] }],
        children: {
          attached: [
            { id: 'a', title: 'A', labels: ['x'], structureClass: 'org.xmind.ui.tree.right' },
            { id: 'b', title: 'B', extensions: [{ provider: 'org.xmind.ui.task', content: { status: 'done' } }] },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
          summary: [{ id: 's', title: 'A and B' }],
        },
        summaries: [{ id: 'x1', range: '(0,1)', topicId: 's' }],
        boundaries: [
          { id: 'x2', range: '(2,3)', title: 'Left' },
          { id: 'x3', range: 'master', title: 'ignored on the central topic' },
        ],
      },
      relationships: [
        { id: 'x4', end1Id: 'a', end2Id: 'd', title: 'see' },
        { id: 'x5', end1Id: 'a' },
      ],
    },
  ];
  const x = await parseXmind(await zip([{ name: 'content.json', data: enc.encode(JSON.stringify(content)) }]));
  assert.deepEqual(x.root.children, [
    { text: 'A', id: 'a', labels: ['x'], structure: 'tree', side: 'r' },
    { text: 'B', todo: true, side: 'r' },
    { text: 'A and B', summary: 2, side: 'r' },
    { text: 'C', boundary: 'Left', side: 'l' },
    { text: 'D', id: 'd', boundary: '', side: 'l' },
  ]);
  assert.deepEqual(x.relationships, [{ from: 'a', to: 'd', text: 'see' }]);
  assert.equal(x.root.boundary, undefined);
  // … and it all loads into a document.
  const doc = Doc.fromData({ root: x.root, layout: x.layout, relationships: x.relationships }, DEFAULT_THEME, palette);
  assert.equal(doc.rels.length, 1);
  layoutDoc(doc, opts());
  assert.equal(find(doc, 'A and B').sumN, 2);

  const xml = `<?xml version="1.0" encoding="UTF-8"?><xmap-content><sheet><topic id="r" structure-class="org.xmind.ui.logic.right"><title>Root</title>
    <children><topics type="attached">
      <topic id="a"><title>A</title><labels><label>x</label><label>y</label></labels></topic>
      <topic id="b" structure-class="org.xmind.ui.org-chart.down"><title>B</title><children><topics type="attached"><topic id="b1"><title>b1</title></topic></topics></children>
        <boundaries><boundary range="master"><title>All of B</title></boundary></boundaries></topic>
      <topic id="c"><title>C</title></topic>
    </topics><topics type="summary"><topic id="s"><title>Sum</title></topic></topics></children>
    <summaries><summary range="(1,2)" topic-id="s"/></summaries>
    <boundaries><boundary range="(0,0)"/></boundaries>
  </topic><relationships><relationship end1="a" end2="b1"><title>why</title></relationship></relationships></sheet></xmap-content>`;
  const old = await parseXmind(await zip([{ name: 'content.xml', data: enc.encode(xml) }]));
  assert.equal(old.layout, 'logic');
  assert.deepEqual(old.root.children, [
    { text: 'A', id: 'a', labels: ['x', 'y'], boundary: '' },
    { text: 'B', children: [{ text: 'b1', id: 'b1' }], structure: 'org', boundary: 'All of B' },
    { text: 'C' },
    { text: 'Sum', summary: 2 },
  ]);
  assert.deepEqual(old.relationships, [{ from: 'a', to: 'b1', text: 'why' }]);
});

test('to-dos are Markdown task list items; a Kozue file keeps everything', async () => {
  const md = toMarkdown({
    text: 'R',
    children: [{ text: 'M', children: [{ text: 'open', todo: false }, { text: 'done', todo: true }, { text: 'plain' }] }],
  });
  assert.match(md, /- \[ \] open\n- \[x\] done\n- plain\n/);
  assert.deepEqual(parseOutline('- [x] a\n- [ ] b\n- c\n'), [{ text: 'a', todo: true }, { text: 'b', todo: false }, { text: 'c' }]);

  const imported = await importFile('rich.kozue', new TextEncoder().encode(JSON.stringify(rich)));
  assert.equal(imported.native, true);
  const doc = Doc.fromData(imported, DEFAULT_THEME, palette);
  assert.deepEqual(doc.toData(), rich);
});

// --------------------------------------------------------------------- search

test('occurrences honours case, whole words and special characters', () => {
  const plain = { matchCase: false, wholeWord: false };
  assert.deepEqual(occurrences('Cat concat CAT', 'cat', plain), [
    [0, 3],
    [7, 10],
    [11, 14],
  ]);
  assert.deepEqual(occurrences('Cat concat CAT', 'cat', { matchCase: true, wholeWord: false }), [[7, 10]]);
  assert.deepEqual(occurrences('Cat concat CAT', 'cat', { matchCase: false, wholeWord: true }), [
    [0, 3],
    [11, 14],
  ]);
  assert.deepEqual(occurrences('a.b a+b (a.b)', 'a.b', plain), [
    [0, 3],
    [9, 12],
  ]);
  assert.deepEqual(occurrences('東京都と京都', '京都', plain), [
    [1, 3],
    [4, 6],
  ]);
  assert.deepEqual(occurrences('anything', '', plain), []);
});
