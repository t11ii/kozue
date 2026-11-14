// File format registry: detection, import to plain document data, text export.

import type { DocData, LayoutKind, NodeData, RelData } from '../core/model.ts';
import { parseFreemind, parseOpml, toOpml } from './opml.ts';
import { forestToRoot, parseOutline, toMarkdown, toOutline } from './outline.ts';
import { parseXmind } from './xmind.ts';

export const NATIVE_EXT = 'kozue';

export interface Imported {
  root: NodeData;
  layout?: LayoutKind;
  theme?: string;
  relationships?: RelData[];
  /** True for Kozue's own format (the file can be saved back in place). */
  native: boolean;
  /** Sheets in the source file, when it had more than the one imported. */
  sheets?: number;
}

/** Extensions offered in the Open dialog. */
export const OPEN_EXTENSIONS = [NATIVE_EXT, 'xmind', 'md', 'markdown', 'txt', 'opml', 'mm', 'json'];

export function extOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name: string): string {
  const file = name.replace(/^.*[/\\]/, '');
  return file.replace(/\.[^.]+$/, '') || file;
}

function parseNative(text: string): Imported {
  const data = JSON.parse(text) as Partial<DocData>;
  if (!data || typeof data !== 'object' || data.format !== 'kozue' || !data.root) {
    throw new Error('Not a Kozue document');
  }
  return { root: data.root, layout: data.layout, theme: data.theme, relationships: data.relationships, native: true };
}

export async function importFile(name: string, bytes: Uint8Array): Promise<Imported> {
  let ext = extOf(name);
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) ext = 'xmind';
  if (ext === 'xmind') {
    const x = await parseXmind(bytes);
    return { root: x.root, layout: x.layout, relationships: x.relationships, native: false, sheets: x.sheets > 1 ? x.sheets : undefined };
  }

  const text = new TextDecoder('utf-8').decode(bytes);
  const head = text.slice(0, 2048).trimStart();
  if (![NATIVE_EXT, 'json', 'opml', 'mm', 'md', 'markdown', 'txt'].includes(ext)) {
    // Unknown extension: sniff the content.
    if (head.startsWith('{')) ext = 'json';
    else if (head.startsWith('<')) ext = /<opml[\s>]/i.test(head) ? 'opml' : /<map[\s>]/i.test(head) ? 'mm' : 'txt';
    else ext = 'txt';
  }
  switch (ext) {
    case NATIVE_EXT:
    case 'json':
      return parseNative(text);
    case 'opml':
      return { root: parseOpml(text, baseName(name)), native: false };
    case 'mm':
      return { root: parseFreemind(text), native: false };
    default:
      return { root: forestToRoot(parseOutline(text), baseName(name)), native: false };
  }
}

export function serializeNative(doc: DocData): string {
  return JSON.stringify(doc, null, 1) + '\n';
}

export type TextFormat = 'md' | 'txt' | 'opml';

export function exportText(format: TextFormat, doc: DocData): string {
  switch (format) {
    case 'md':
      return toMarkdown(doc.root);
    case 'opml':
      return toOpml(doc.root);
    case 'txt':
      return toOutline([doc.root]);
  }
}
