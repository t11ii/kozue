// File format registry: detection, import to plain document data, text export.

import type { BookData, FileData } from '../core/book.ts';
import { cleanSheetName, isBookData } from '../core/book.ts';
import type { DocData, LayoutKind, MapStyle, NodeData, RelData } from '../core/model.ts';
import { parseFreemind, parseOpml, toOpml } from './opml.ts';
import { forestToRoot, parseOutline, toMarkdown, toOutline } from './outline.ts';
import { parseXmind } from './xmind.ts';

export const NATIVE_EXT = 'kozue';

/** One sheet of an imported file. */
export interface ImportedSheet {
  name?: string;
  root: NodeData;
  layout?: LayoutKind;
  theme?: string;
  relationships?: RelData[];
  /** The map's own settings (background, line thickness, typeface). */
  style?: MapStyle;
}

/**
 * An imported file. The fields of its first sheet are at the top level (most
 * formats have just the one); `sheets` lists all of them when the file has
 * several, or a named one.
 */
export interface Imported extends ImportedSheet {
  /** True for Kozue's own format (the file can be saved back in place). */
  native: boolean;
  sheets?: ImportedSheet[];
  /** Index of the sheet that was on show when the file was saved. */
  active?: number;
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
  const data = JSON.parse(text) as Partial<DocData> | Partial<BookData>;
  if (!data || typeof data !== 'object' || data.format !== 'kozue') throw new Error('Not a Kozue document');
  if (isBookData(data)) {
    const sheets: ImportedSheet[] = [];
    for (const s of data.sheets as Partial<ImportedSheet>[]) {
      if (!s || typeof s !== 'object' || !s.root) continue;
      const name = cleanSheetName(s.name);
      sheets.push({
        ...(name ? { name } : {}),
        root: s.root,
        layout: s.layout,
        theme: s.theme,
        relationships: s.relationships,
        style: s.style,
      });
    }
    if (!sheets.length) throw new Error('Not a Kozue document');
    const active =
      typeof data.active === 'number' && Number.isInteger(data.active) && data.active > 0 && data.active < sheets.length ? data.active : 0;
    return { ...sheets[0], native: true, sheets, ...(active ? { active } : {}) };
  }
  const doc = data as Partial<DocData>;
  if (!doc.root) throw new Error('Not a Kozue document');
  return { root: doc.root, layout: doc.layout, theme: doc.theme, relationships: doc.relationships, style: doc.style, native: true };
}

export async function importFile(name: string, bytes: Uint8Array): Promise<Imported> {
  let ext = extOf(name);
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) ext = 'xmind';
  if (ext === 'xmind') {
    const x = await parseXmind(bytes);
    const first: ImportedSheet = { root: x.root, layout: x.layout, relationships: x.relationships, style: x.style };
    // Several sheets, or one with a name of its own: keep them all.
    return x.sheets.length > 1 || x.sheets[0].name ? { ...first, native: false, sheets: x.sheets } : { ...first, native: false };
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

export function serializeNative(data: FileData): string {
  return JSON.stringify(data, null, 1) + '\n';
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
