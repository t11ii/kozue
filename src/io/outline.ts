// Plain-text outlines and Markdown <-> topic trees.

import type { NodeData } from '../core/model.ts';
import { isTopicLink } from '../core/model.ts';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;
const BULLET = /^(?:[-*+•・‣◦▪]|\d+[.)])\s+(.*)$/;
const CHECK = /^\[( |x|X)\]\s+(.*)$/;
const LINK = /^\[([^\]]+)\]\(\s*(\S+?)\s*\)$/;

function indentOf(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4;
    else if (ch === '　') w += 2;
    else break;
  }
  return w;
}

/**
 * Parses indented text, bullet lists and Markdown headings into a forest.
 * Headings set the level directly; list items nest below the last heading
 * according to their indentation; `>` lines become the note of the item above.
 */
export function parseOutline(text: string): NodeData[] {
  const forest: NodeData[] = [];
  const stack: { level: number; node: NodeData }[] = [];
  let base = 0; // level of list items directly below the current heading
  let indents: number[] = [];
  let last: NodeData | null = null;

  const add = (level: number, node: NodeData): void => {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : null;
    if (parent) (parent.children ??= []).push(node);
    else forest.push(node);
    stack.push({ level, node });
    last = node;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const indent = indentOf(raw);
    let body = raw.trim();

    if (body.startsWith('>') && last) {
      const line = body.replace(/^>\s?/, '');
      const node: NodeData = last;
      node.note = node.note ? node.note + '\n' + line : line;
      continue;
    }

    const h = indent < 4 ? HEADING.exec(body) : null;
    let level: number;
    if (h) {
      level = h[1].length - 1;
      body = h[2];
      base = level + 1;
      indents = [];
    } else {
      const b = BULLET.exec(body);
      if (b) body = b[1];
      while (indents.length && indent < indents[indents.length - 1]) indents.pop();
      if (!indents.length || indent > indents[indents.length - 1]) indents.push(indent);
      level = base + indents.length - 1;
    }

    const node: NodeData = { text: body };
    const c = CHECK.exec(body);
    if (c) {
      node.text = c[2];
      node.todo = c[1] !== ' ';
    }
    const l = LINK.exec(node.text);
    if (l) {
      node.text = l[1];
      // A link to a place in the same text ("#section") leads nowhere in a map.
      if (l[2].charAt(0) !== '#') node.link = l[2];
    }
    add(level, node);
  }
  return forest;
}

/** A single tree: the lone top-level item, or a new root holding the forest. */
export function forestToRoot(forest: NodeData[], fallbackTitle: string): NodeData {
  if (forest.length === 1) return forest[0];
  return { text: fallbackTitle, children: forest };
}

const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, ' ');

/** Tab-indented outline, one topic per line. */
export function toOutline(nodes: readonly NodeData[], depth = 0): string {
  let out = '';
  for (const n of nodes) {
    out += '\t'.repeat(depth) + oneLine(n.text) + '\n';
    if (n.children) out += toOutline(n.children, depth + 1);
  }
  return out;
}

function mdText(n: NodeData): string {
  const text = oneLine(n.text) || ' ';
  // A link to another topic means nothing outside the map.
  return n.link && !isTopicLink(n.link) ? `[${text.replace(/[[\]]/g, '\\$&')}](${n.link})` : text;
}

function mdNote(n: NodeData, indent: string): string {
  if (!n.note) return '';
  return (
    n.note
      .split('\n')
      .map((l) => `${indent}> ${l}`.trimEnd())
      .join('\n') + '\n'
  );
}

function mdList(nodes: readonly NodeData[], depth: number): string {
  let out = '';
  const indent = '  '.repeat(depth);
  for (const n of nodes) {
    // A to-do is a task list item; so is a topic that only carries a task marker.
    const done = n.todo ?? (n.markers?.includes('done') ? true : n.markers?.includes('t0') ? false : undefined);
    const box = done === undefined ? '' : done ? '[x] ' : '[ ] ';
    out += `${indent}- ${box}${mdText(n)}\n`;
    out += mdNote(n, indent + '  ');
    if (n.children) out += mdList(n.children, depth + 1);
  }
  return out;
}

/** Root as `#`, main topics as `##`, everything below as nested lists. */
export function toMarkdown(root: NodeData): string {
  let out = `# ${mdText(root)}\n`;
  out += mdNote(root, '');
  for (const main of root.children ?? []) {
    out += `\n## ${mdText(main)}\n`;
    out += mdNote(main, '');
    if (main.children?.length) out += '\n' + mdList(main.children, 0);
  }
  return out;
}
