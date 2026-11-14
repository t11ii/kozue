// OPML and FreeMind (.mm) import, OPML export.

import type { NodeData } from '../core/model.ts';
import type { XmlEl } from './xml.ts';
import { childOf, childrenOf, escapeAttr, findEl, parseXml, textOf } from './xml.ts';

// --------------------------------------------------------------------- OPML

function fromOutline(el: XmlEl): NodeData {
  const a = el.attrs;
  const n: NodeData = { text: a.text ?? a.title ?? '' };
  if (a._note) n.note = a._note;
  const link = a.url ?? a.htmlUrl ?? a.xmlUrl;
  if (link) n.link = link;
  if (a._status === 'checked' || a._status === 'unchecked') n.todo = a._status === 'checked';
  const kids = childrenOf(el, 'outline');
  if (kids.length) n.children = kids.map(fromOutline);
  return n;
}

export function parseOpml(src: string, fallbackTitle: string): NodeData {
  const doc = parseXml(src);
  const opml = findEl(doc, 'opml');
  const body = childOf(opml, 'body');
  if (!body) throw new Error('Not an OPML file');
  const tops = childrenOf(body, 'outline').map(fromOutline);
  if (tops.length === 1) return tops[0];
  const title = childOf(childOf(opml, 'head'), 'title')?.text.trim();
  return { text: title || fallbackTitle, children: tops };
}

function outline(n: NodeData, depth: number): string {
  const pad = '  '.repeat(depth);
  let attrs = `text="${escapeAttr(n.text)}"`;
  if (n.note) attrs += ` _note="${escapeAttr(n.note)}"`;
  if (n.link) attrs += ` url="${escapeAttr(n.link)}"`;
  if (n.todo === true || n.markers?.includes('done')) attrs += ' _status="checked"';
  else if (n.todo === false) attrs += ' _status="unchecked"';
  if (!n.children?.length) return `${pad}<outline ${attrs}/>\n`;
  return `${pad}<outline ${attrs}>\n${n.children.map((c) => outline(c, depth + 1)).join('')}${pad}</outline>\n`;
}

export function toOpml(root: NodeData): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n' +
    `  <head>\n    <title>${escapeAttr(root.text.replace(/\n/g, ' '))}</title>\n  </head>\n  <body>\n` +
    outline(root, 2) +
    '  </body>\n</opml>\n'
  );
}

// ----------------------------------------------------------------- FreeMind

const FM_ICONS: Record<string, string> = {
  button_ok: 'done',
  button_cancel: 'x',
  help: 'q',
  messagebox_warning: 'ex',
  info: 'info',
  bookmark: 'star',
  flag: 'flag-red',
  'flag-orange': 'flag-orange',
  'flag-yellow': 'flag-orange',
  'flag-green': 'flag-green',
  'flag-blue': 'flag-blue',
  'flag-pink': 'flag-purple',
  unchecked: 't0',
  checked: 'done',
};

function fromFreemind(el: XmlEl): NodeData {
  const a = el.attrs;
  let text = a.TEXT ?? '';
  let note: string | undefined;
  for (const rc of childrenOf(el, 'richcontent')) {
    const body = textOf(rc)
      .replace(/[ \t]*\n\s*/g, '\n')
      .trim();
    if (rc.attrs.TYPE === 'NOTE') note = body;
    else if (rc.attrs.TYPE === 'NODE' && !text) text = body;
  }
  const n: NodeData = { text };
  if (note) n.note = note;
  if (a.LINK) n.link = a.LINK;
  if (a.POSITION === 'left') n.side = 'l';
  else if (a.POSITION === 'right') n.side = 'r';
  const markers: string[] = [];
  for (const ic of childrenOf(el, 'icon')) {
    const id = ic.attrs.BUILTIN ?? '';
    const pr = /^full-(\d)$/.exec(id);
    const m = pr ? 'p' + Math.min(5, Math.max(1, Number(pr[1]))) : FM_ICONS[id];
    if (m && !markers.includes(m)) markers.push(m);
  }
  if (markers.length) n.markers = markers;
  const kids = childrenOf(el, 'node');
  if (kids.length) {
    n.children = kids.map(fromFreemind);
    if (a.FOLDED === 'true') n.collapsed = true;
  }
  return n;
}

export function parseFreemind(src: string): NodeData {
  const map = findEl(parseXml(src), 'map');
  const root = childOf(map, 'node');
  if (!root) throw new Error('Not a FreeMind file');
  return fromFreemind(root);
}
