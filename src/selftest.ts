// Desktop smoke test. When the app is launched with the environment variable
// KOZUE_SELFTEST=<directory>, it drives itself through editing, saving,
// loading and every export inside the real web view, writes the results and
// a report.json to that directory, and quits (exit code 0 on success).

import { invoke } from '@tauri-apps/api/core';
import type { App } from './app/app.ts';
import { welcomeDoc } from './app/files.ts';
import { templates } from './app/templates.ts';
import { MARKER_GROUPS } from './core/markers.ts';
import type { MNode } from './core/model.ts';
import { Doc, countDescendants, walk } from './core/model.ts';
import { LAYOUT_KINDS } from './core/structures.ts';
import { DEFAULT_THEME, THEMES, themeById } from './core/themes.ts';
import { exportText, importFile, serializeNative } from './io/formats.ts';
import { toXmind } from './io/xmind.ts';
import { isTauri, readPath, writeBack } from './platform.ts';
import { sceneToJpeg, sceneToPdf, sceneToPng, sceneToSvg } from './render/export.ts';

export async function selfTestDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>('selftest_dir');
  } catch {
    return null;
  }
}

/**
 * When the next frame is drawn, in ms since the page began to load. Null when none comes:
 * nothing is drawn while the display sleeps or the window is covered.
 */
function nextFrame(): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 1500);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve(Math.round(performance.now()));
    });
  });
}

export async function runSelfTest(app: App, dir: string): Promise<void> {
  // The interface is built and the shell has answered: this far a launch has come.
  const readyMs = Math.round(performance.now());
  const enc = new TextEncoder();
  const errors: string[] = [];
  const report: Record<string, unknown> = { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason)));
  const write = (name: string, data: Uint8Array): Promise<void> => writeBack({ name, path: `${dir}/${name}` }, data);
  const check = (name: string, ok: boolean): void => {
    if (!ok) errors.push('check failed: ' + name);
  };

  try {
    report.features = {
      segmenter: 'Segmenter' in Intl,
      compressionStream: typeof CompressionStream !== 'undefined',
      fontMetrics: Number.isFinite(document.createElement('canvas').getContext('2d')!.measureText('M').fontBoundingBoxAscent),
    };

    // How long a first launch takes until its map is on the screen (the panel is closed).
    app.setDoc(welcomeDoc());
    report.startup = { readyMs, firstFrameMs: await nextFrame() };

    // Editing through the same entry points the keyboard uses.
    const root = app.doc.root;
    const before = countDescendants(root);
    app.select([root]);
    app.addChild();
    const el = app.editor.el;
    el.value = 'セルフテスト OK';
    el.dispatchEvent(new Event('input'));
    report.editing = { active: app.editor.state !== null, focused: document.activeElement === el };
    app.editor.commit();
    const added = app.primary;
    check('topic added', countDescendants(root) === before + 1 && added?.text === 'セルフテスト OK');
    if (added) app.toggleMarker('star');
    app.doc.undo();
    app.doc.redo();
    check('undo / redo', added?.markers?.[0] === 'star');

    // Native save and load through the file commands.
    const native = enc.encode(serializeNative(app.doc.toData()));
    await write('selftest.kozue', native);
    const back = await readPath(`${dir}/selftest.kozue`);
    check('file round trip', back.bytes.length === native.length && back.bytes.every((b, i) => b === native[i]));
    const imported = await importFile('selftest.kozue', back.bytes);
    check('native import', JSON.stringify(imported.root) === JSON.stringify(app.doc.toData().root));

    // Every export format.
    const t0 = performance.now();
    const png = await sceneToPng(app.exportScene());
    const pdf = await sceneToPdf(app.exportScene());
    const svg = enc.encode(sceneToSvg(app.exportScene()));
    const xmind = await toXmind(app.doc.toData(), 'selftest');
    const md = enc.encode(exportText('md', app.doc.toData()));
    await write('selftest.png', png.bytes);
    await write('selftest.pdf', pdf.bytes);
    await write('selftest.svg', svg);
    await write('selftest.xmind', xmind);
    await write('selftest.md', md);
    const xback = await importFile('selftest.xmind', (await readPath(`${dir}/selftest.xmind`)).bytes);
    check('xmind import', xback.root.text === root.text && (xback.root.children?.length ?? 0) === root.children.length);
    check('xmind keeps relationships', xback.relationships?.length === app.doc.rels.length && app.doc.rels.length === 1);

    // To-dos, labels, boundaries, summaries and relationships of the welcome map, in this web view.
    const topics: MNode[] = [];
    walk(root, (n) => topics.push(n));
    const summary = topics.find((n) => n.sum !== undefined);
    const framed = topics.find((n) => n.boundary !== undefined);
    check('summary brackets its topics', summary?.sumN === 3 && summary.parent!.children[summary.idx - 1].cover === summary);
    check('labels and to-dos are laid out', topics.some((n) => n.lab.length > 0) && topics.some((n) => n.todo === true));
    const drawn = sceneToSvg(app.exportScene());
    check('frames and relationships are drawn', drawn.split('stroke-dasharray').length >= 3);
    report.organize = { summary: summary?.text, framed: framed?.text, relationships: app.doc.rels.length };

    // A branch with a structure of its own, and a branch exported on its own.
    const branch = root.children[1];
    app.select([branch]);
    app.setBranchStructure('org');
    check('branch structure', branch.structure === 'org' && branch.children.every((k) => k.y > branch.y + branch.h));
    const whole = app.exportScene().bounds;
    const part = app.withBranch(branch, () => app.exportScene().bounds);
    check('branch scene is smaller than the map', part.x1 - part.x0 < whole.x1 - whole.x0 && app.focus === null);
    const partPng = await app.withBranch(branch, () => sceneToPng(app.exportScene(), { scale: 3, transparent: true }));
    const jpeg = await sceneToJpeg(app.exportScene(), { scale: 1 });
    await write('selftest-branch.png', partPng.bytes);
    await write('selftest.jpg', jpeg.bytes);
    check('png and jpeg signatures', partPng.bytes[1] === 0x50 && jpeg.bytes[0] === 0xff && jpeg.bytes[1] === 0xd8);
    // Exporting several files at once asks the shell which names are taken.
    const taken = await invoke<boolean>('path_exists', { path: `${dir}/selftest.jpg` });
    const free = await invoke<boolean>('path_exists', { path: `${dir}/no-such-file.jpg` });
    check('path_exists', taken && !free);
    app.doc.undo();
    check('undo of the branch structure', branch.structure === undefined);

    // Find and replace, the branch-only view and the filter.
    app.setSearch('Kozue');
    const found = app.matches.length;
    check('replace', found > 0 && app.replace('Kozue!', true) === found && root.text.includes('Kozue!'));
    app.doc.undo();
    app.clearSearch();
    app.setFocus(branch);
    check('branch only', app.vroot === branch && app.count === countDescendants(branch) + 1);
    app.setFocus(null);
    app.toggleFilter('todo', 'done');
    check('filter', app.filterCount >= 1);
    app.setFilter(null);

    // Topic styles, a width set by hand and the map's own settings, in this web view.
    const styled = root.children[0];
    app.select([styled]);
    app.patchStyle({ shape: 'ellipse', fill: '#ffe08a' });
    app.toggleFlag('italic');
    app.toggleFlag('strike');
    app.setWidth(180);
    check('style and width', styled.shp === 'ellipse' && styled.tw === 180 && styled.font.italic && styled.tc);
    app.setMapStyle({ background: '#1f2330', font: 'serif', line: 1.6 });
    check('map settings', app.theme.dark && app.theme.bg === '#1f2330' && app.theme.lineScale === 1.6);
    const styledSvg = sceneToSvg(app.exportScene());
    check('styles are drawn', styledSvg.includes('font-style="italic"') && styledSvg.includes('#ffe08a') && styledSvg.includes('Mincho'));
    const styledPng = await sceneToPng(app.exportScene(), { scale: 1 });
    await write('selftest-style.png', styledPng.bytes);
    const styledBack = await importFile('styled.xmind', await toXmind(app.doc.toData(), 'selftest'));
    const mainBack = styledBack.root.children?.find((k) => k.text === styled.text);
    check(
      'xmind keeps styles',
      mainBack?.style?.shape === 'ellipse' && mainBack.width === 180 && styledBack.style?.background === '#1f2330',
    );
    // Text measured in the DOM (the editor) and on the canvas must agree for the styled font too.
    app.editor.begin(styled, 'all');
    const editFont = app.editor.el.style.font;
    app.editor.cancel();
    check('editor follows the style', /italic/.test(editFont) && app.editor.state === null);
    for (let i = 0; i < 5; i++) app.doc.undo();
    check('styles undone', styled.style === undefined && styled.width === undefined && Object.keys(app.doc.style).length === 0);
    report.style = { png: styledPng.bytes.length, editFont };

    // Numbered topics, a topic removed without its subtopics, and a second sheet in the file.
    app.select([root.children[1]]);
    app.setNumbering('arabic');
    check('numbering', root.children[0].num === '1.' && root.children[1].num === '2.' && root.children[1].nw > 0);
    app.undo();
    const mains = root.children.length;
    const kids = branch.children.length;
    app.select([branch]);
    app.deleteSingle();
    check('topic removed, subtopics kept', root.children.length === mains - 1 + kids && branch.parent === null);
    app.undo();
    check('and restored', root.children.length === mains && branch.parent === root && branch.children.length === kids);
    const firstDoc = app.doc;
    app.addSheet();
    app.addChild();
    app.editor.el.value = 'on the second sheet';
    app.editor.el.dispatchEvent(new Event('input'));
    app.editor.commit();
    check('second sheet', app.book.sheets.length === 2 && app.doc !== firstDoc && app.doc.root.children[0]?.text === 'on the second sheet');
    const bookData = app.book.toData();
    await write('selftest-sheets.kozue', enc.encode(serializeNative(bookData)));
    const bookBack = await importFile('selftest-sheets.kozue', (await readPath(`${dir}/selftest-sheets.kozue`)).bytes);
    check('sheets are saved and loaded', bookBack.sheets?.length === 2 && bookBack.active === 1);
    const xbook = await importFile('selftest-sheets.xmind', await toXmind(bookData, 'selftest'));
    check('xmind keeps the sheets', xbook.sheets?.length === 2);
    app.undo();
    app.undo();
    check('undo takes the sheet away again', app.book.sheets.length === 1 && app.doc === firstDoc);
    report.sheets = { bytes: serializeNative(bookData).length };

    // Links to topics: the one in the welcome map, one made here, and how Xmind gets it.
    const jump = topics.find((n) => n.link?.startsWith('#'));
    check('the welcome map links to a topic', !!jump && app.linkTarget(jump.link)?.node === styled);
    if (jump) check('following a link', app.followLink(jump) && app.primary === styled);
    const far = root.children[root.children.length - 1];
    app.select([branch]);
    app.startTopicLink();
    app.finishTopicLink(far);
    check('linking', app.linking === null && far.ref !== undefined && branch.link === '#' + far.ref && app.primary === branch);
    const linked = await importFile('linked.xmind', await toXmind(app.book.toData(), 'selftest'));
    const farBack = linked.root.children?.find((k) => k.text === far.text)?.id;
    check(
      'xmind keeps links to topics',
      farBack !== undefined && linked.root.children?.find((k) => k.text === branch.text)?.link === '#' + farBack,
    );
    app.undo();
    check('link undone', branch.link === undefined);
    report.exports = {
      png: png.bytes.length,
      pdf: pdf.bytes.length,
      svg: svg.length,
      xmind: xmind.length,
      md: md.length,
      ms: Math.round(performance.now() - t0),
    };

    // Every structure lays out and draws in this web view.
    const widths: Record<string, number> = {};
    for (const kind of LAYOUT_KINDS) {
      app.setLayout(kind);
      const scene = app.exportScene();
      check(`${kind} draws`, sceneToSvg(scene).length > 1000);
      widths[kind] = Math.round(scene.bounds.x1 - scene.bounds.x0);
    }
    app.setLayout('fishbone');
    await write('selftest-fishbone.png', (await sceneToPng(app.exportScene())).bytes);
    app.setLayout('map');
    report.structures = widths;

    // Layout speed in this web view.
    const t1 = performance.now();
    for (let i = 0; i < 50; i++) app.relayout(false);
    report.layout = { topics: app.count, msPerPass: +((performance.now() - t1) / 50).toFixed(3) };
    report.view = { width: app.view.width, height: app.view.height, zoom: app.view.zoom };

    // Every theme, every marker and every template, drawn in this web view.
    // (A presentation is left out: it would take the whole screen of whoever runs this.)
    const themed: Record<string, number> = {};
    for (const th of THEMES) {
      app.setTheme(th.id);
      const out = sceneToSvg(app.exportScene());
      check(`theme ${th.id} draws`, app.theme.bg === th.bg && out.length > 1000 && !/NaN|undefined/.test(out));
      themed[th.id] = out.length;
    }
    report.themes = themed;
    const paletteSize = themeById(DEFAULT_THEME).palette.length;
    const markerRoot = {
      text: 'Markers',
      children: MARKER_GROUPS.map((g) => ({ text: g.id, children: g.items.map((id) => ({ text: id, markers: [id] })) })),
    };
    app.setDoc(Doc.fromData({ root: markerRoot, layout: 'logic' }, DEFAULT_THEME, paletteSize));
    const markersPng = await sceneToPng(app.exportScene(), { scale: 2 });
    await write('selftest-markers.png', markersPng.bytes);
    check('markers are drawn', markersPng.bytes.length > 20000);
    const opened: Record<string, number> = {};
    for (const tpl of templates()) {
      app.setDoc(Doc.fromData({ root: tpl.root, layout: tpl.layout }, DEFAULT_THEME, paletteSize));
      const out = sceneToSvg(app.exportScene());
      check(`template ${tpl.id} opens`, app.doc.layout === tpl.layout && out.length > 300 && !/NaN|undefined/.test(out));
      opened[tpl.id] = app.count;
    }
    report.templates = opened;
    report.markers = { png: markersPng.bytes.length };
  } catch (e) {
    errors.push('exception: ' + (e instanceof Error ? (e.stack ?? e.message) : String(e)));
  }

  report.errors = errors;
  report.ok = errors.length === 0;
  try {
    await write('report.json', enc.encode(JSON.stringify(report, null, 2)));
  } finally {
    await invoke('exit_app', { code: errors.length === 0 ? 0 : 1 });
  }
}
