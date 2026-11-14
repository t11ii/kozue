import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutDoc } from '../src/core/layout.ts';
import type { LayoutOpts } from '../src/core/layout.ts';
import type { LayoutKind, MNode } from '../src/core/model.ts';
import { Doc, walkVisible } from '../src/core/model.ts';
import {
  A_BOTH,
  A_RIBS_D,
  A_RIBS_U,
  A_RIGHT,
  A_SPINE_R,
  A_TREE_DR,
  A_TREE_UR,
  BONE_COT,
  BONE_INSET,
  LAYOUT_KINDS,
  childArrangement,
  childArrows,
  navRule,
} from '../src/core/structures.ts';
import { DEFAULT_THEME, themeById } from '../src/core/themes.ts';
import { T, fakeMeasurer, makeDoc } from './helpers.ts';

let stamp = 1000;
const opts = (): LayoutOpts => ({ theme: themeById(DEFAULT_THEME), measurer: fakeMeasurer, epoch: 1, stamp: ++stamp, editing: null });

/** Six main topics; some with nested subtopics, one without any. */
function sample(kind: LayoutKind): Doc {
  const doc = makeDoc(
    T(
      'Root',
      T('Alpha', T('a1'), T('a2', T('a2x'), T('a2y')), T('a3')),
      T('Beta', T('b1'), T('b2')),
      T('Gamma'),
      T('Delta', T('d1', T('d1x')), T('d2'), T('d3'), T('d4')),
      T('Epsilon', T('e1')),
      T('Zeta', T('z1'), T('z2', T('z2x'))),
    ),
    kind,
  );
  layoutDoc(doc, opts());
  return doc;
}

const cx = (n: MNode): number => n.x + n.w / 2;
const cy = (n: MNode): number => n.y + n.h / 2;
const all = (doc: Doc): MNode[] => {
  const out: MNode[] = [];
  walkVisible(doc.root, (n) => out.push(n));
  return out;
};
const below = (doc: Doc): MNode[] => all(doc).filter((n) => n.parent);

test('every structure keeps its root at the origin and reports the right bounds', () => {
  for (const kind of LAYOUT_KINDS) {
    const doc = sample(kind);
    assert.ok(Math.abs(cx(doc.root)) < 1e-9 && Math.abs(cy(doc.root)) < 1e-9, kind);
    for (const n of all(doc)) {
      // Subtree bounds contain the node and all of its visible descendants.
      for (let p: MNode | null = n; p; p = p.parent) {
        assert.ok(
          n.x >= p.bx0 - 1e-6 && n.x + n.w <= p.bx1 + 1e-6 && n.y >= p.by0 - 1e-6 && n.y + n.h <= p.by1 + 1e-6,
          `${kind}: ${n.text} outside ${p.text}`,
        );
      }
    }
  }
});

test('mirrored structures are exact mirror images', () => {
  const pairs: [LayoutKind, LayoutKind, 'x' | 'y'][] = [
    ['logic', 'logic-left', 'x'],
    ['org', 'org-up', 'y'],
    ['fishbone', 'fishbone-right', 'x'],
  ];
  for (const [a, b, axis] of pairs) {
    const na = all(sample(a));
    const nb = all(sample(b));
    assert.equal(na.length, nb.length);
    na.forEach((n, i) => {
      const m = nb[i];
      if (axis === 'x') {
        assert.ok(Math.abs(m.x + (n.x + n.w)) < 1e-6 && Math.abs(m.y - n.y) < 1e-6, `${b}: ${n.text}`);
      } else {
        assert.ok(Math.abs(m.y + (n.y + n.h)) < 1e-6 && Math.abs(m.x - n.x) < 1e-6, `${b}: ${n.text}`);
      }
    });
  }
});

test('logic-left and org-up grow away from the root', () => {
  for (const n of below(sample('logic-left'))) assert.ok(n.x + n.w < n.parent!.x, n.text);
  for (const n of below(sample('org-up'))) assert.ok(n.y + n.h < n.parent!.y, n.text);
});

test('tree chart lists every topic below its parent, indented', () => {
  const doc = sample('tree');
  const rows = below(doc);
  for (const n of rows) {
    assert.ok(n.y >= n.parent!.y + n.parent!.h, `${n.text} is below its parent`);
    assert.ok(n.x > n.parent!.x, `${n.text} is indented`);
  }
  // Document order is reading order: rows never go back up.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].y > rows[i - 1].y, rows[i].text);
});

test('org chart (tree) puts main topics in a row and lists the rest', () => {
  const doc = sample('org-tree');
  const mains = doc.root.children;
  for (let i = 0; i < mains.length; i++) {
    assert.equal(mains[i].y, mains[0].y, 'main topics share a row');
    if (i) assert.ok(mains[i].x > mains[i - 1].x + mains[i - 1].w, 'in order, without overlap');
    for (const k of mains[i].children) assert.ok(k.y > mains[i].y + mains[i].h && k.x > mains[i].x, k.text);
  }
});

test('timeline keeps main topics on the axis and alternates their branches', () => {
  const doc = sample('timeline');
  doc.root.children.forEach((m, i, mains) => {
    assert.ok(Math.abs(cy(m)) < 1e-9, `${m.text} sits on the axis`);
    if (i) assert.ok(m.x > mains[i - 1].x + mains[i - 1].w, 'in order along the axis');
    for (const k of m.children) {
      if (i % 2 === 0) assert.ok(k.y + k.h < m.y, `${k.text} is above the axis`);
      else assert.ok(k.y > m.y + m.h, `${k.text} is below the axis`);
    }
  });
  const v = sample('timeline-v');
  v.root.children.forEach((m, i, mains) => {
    assert.ok(Math.abs(cx(m)) < 1e-9, `${m.text} sits on the vertical axis`);
    if (i) assert.ok(m.y > mains[i - 1].y + mains[i - 1].h);
    for (const k of m.children) assert.ok(i % 2 === 0 ? k.x > m.x + m.w : k.x + k.w < m.x, k.text);
  });
});

test('fishbone hangs every rib on its bone, between the topic and the spine', () => {
  const doc = sample('fishbone');
  let lastRoot = -Infinity;
  doc.root.children.forEach((m, i) => {
    const up = i % 2 === 0;
    assert.equal(m.cdir, up ? A_RIBS_D : A_RIBS_U);
    assert.ok(up ? m.y + m.h < 0 : m.y > 0, `${m.text} is on its side of the spine`);
    // The bone runs from the topic's anchor down to the spine at a fixed slope.
    const ax = m.x + BONE_INSET;
    const ay = up ? m.y + m.h : m.y;
    const root = ax - Math.abs(ay) * BONE_COT;
    assert.ok(root > doc.root.x + doc.root.w, 'the bone leaves the spine beyond the head');
    assert.ok(root > lastRoot, 'bones keep their order along the spine');
    lastRoot = root;
    for (const r of m.children) {
      const y = cy(r);
      assert.ok(up ? y > ay && y < 0 : y < ay && y > 0, `${r.text} lies between its topic and the spine`);
      const boneX = ax - Math.abs(ay - y) * BONE_COT;
      assert.ok(r.x > boneX, `${r.text} starts beyond the bone`);
      assert.ok(r.x - boneX < 40, `${r.text} hangs close to the bone`);
      for (const k of r.children) assert.ok(k.x > r.x + r.w, `${k.text} continues to the right`);
    }
  });
});

test('collapsed branches take no room in any structure', () => {
  for (const kind of LAYOUT_KINDS) {
    const doc = sample(kind);
    const open = all(doc).length;
    doc.root.children[3].collapsed = true; // Delta: 5 descendants
    const { count } = layoutDoc(doc, opts());
    assert.equal(count, open - 5, kind);
    assert.equal(doc.root.children[3].hidden, 5, kind);
  }
});

test('arrangements follow the structure rules', () => {
  assert.equal(childArrangement('map', 0, 0, 0), A_BOTH);
  assert.equal(childArrangement('map', 2, -1, 0), -1);
  assert.equal(childArrangement('org-tree', 1, 2, 3), A_TREE_DR);
  assert.equal(childArrangement('timeline', 1, 6, 0), A_TREE_UR);
  assert.equal(childArrangement('timeline', 1, 6, 1), A_TREE_DR);
  assert.equal(childArrangement('timeline', 3, A_TREE_UR, 0), A_TREE_UR, 'branches keep growing the same way');
  assert.equal(childArrangement('fishbone', 0, 0, 0), A_SPINE_R);
  assert.equal(childArrangement('fishbone', 1, A_SPINE_R, 2), A_RIBS_D);
  assert.equal(childArrangement('fishbone', 1, A_SPINE_R, 3), A_RIBS_U);
  assert.equal(childArrangement('fishbone', 2, A_RIBS_D, 0), A_RIGHT);
  for (const kind of LAYOUT_KINDS) assert.notEqual(childArrangement(kind, 0, 0, 0), 0, kind);
});

test('arrow keys map to the visual direction of each arrangement', () => {
  const doc = sample('timeline');
  const [first, second] = doc.root.children;
  assert.deepEqual(navRule(first), { parent: null, prev: 'left', next: 'right', rows: false });
  assert.deepEqual(childArrows(first.cdir), ['right', 'up']);
  assert.deepEqual(childArrows(second.cdir), ['right', 'down']);
  // Lists that grow upwards have their sibling order upside down.
  assert.deepEqual(navRule(first.children[0]), { parent: 'left', prev: 'down', next: 'up', rows: true });
  assert.deepEqual(navRule(second.children[0]), { parent: 'left', prev: 'up', next: 'down', rows: true });

  const fish = sample('fishbone-right');
  const rib = fish.root.children[0].children[0];
  assert.equal(navRule(rib).parent, 'right', 'ribs of a right-headed fishbone point left');
  assert.deepEqual(childArrows(fish.root.cdir), ['left']);
});

test('the structure is saved with the map; an unknown structure opens as a mind map', () => {
  const palette = themeById(DEFAULT_THEME).palette.length;
  for (const kind of LAYOUT_KINDS) {
    const saved = JSON.parse(JSON.stringify(sample(kind).toData()));
    assert.equal(Doc.fromData(saved, DEFAULT_THEME, palette).layout, kind);
  }
  const future = { ...sample('map').toData(), layout: 'radial' };
  assert.equal(Doc.fromData(JSON.parse(JSON.stringify(future)), DEFAULT_THEME, palette).layout, 'map');
});

test('tiny and lopsided maps lay out to finite coordinates in every structure', () => {
  const shapes = [T('Root'), T('Root', T('Only')), T('Root', T('Only', T('leaf'))), T('Root', T('A'), T('B', T('b1', T('b2', T('b3')))))];
  for (const kind of LAYOUT_KINDS) {
    for (const shape of shapes) {
      const doc = makeDoc(shape, kind);
      const { bounds, count } = layoutDoc(doc, opts());
      const nodes = all(doc);
      assert.equal(count, nodes.length, kind);
      for (const n of nodes) {
        assert.ok([n.x, n.y, n.w, n.h, n.bx0, n.bx1, n.by0, n.by1].every(Number.isFinite), `${kind}: ${n.text}`);
      }
      assert.ok([bounds.x0, bounds.y0, bounds.x1, bounds.y1].every(Number.isFinite), kind);
      assert.ok(Math.abs(cx(doc.root)) < 1e-9 && Math.abs(cy(doc.root)) < 1e-9, kind);
    }
  }
});
