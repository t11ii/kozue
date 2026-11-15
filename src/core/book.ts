// A file: one or more sheets, each a map of its own with its own undo history.
// What happens to the sheets themselves (adding, removing, naming, reordering)
// has a small undo history here.

import type { Doc, DocData, LayoutKind, MapStyle, NodeData, RelData } from './model.ts';
import { isTopicLink, walk } from './model.ts';

export const MAX_SHEETS = 100;
export const MAX_SHEET_NAME = 60;
/** Version written for files that use the `sheets` form. */
export const BOOK_VERSION = 2;

/** One sheet as it is saved. */
export interface SheetData {
  /** Name given by the user; left out for the numbered default ("Sheet 2"). */
  name?: string;
  theme: string;
  layout: LayoutKind;
  style?: MapStyle;
  root: NodeData;
  relationships?: RelData[];
}

/** A file with several sheets, or with a named one. */
export interface BookData {
  format: 'kozue';
  version: number;
  sheets: SheetData[];
  /** Index of the sheet that was on show. */
  active?: number;
}

/** What a `.kozue` file holds: a single unnamed sheet is written as a plain document. */
export type FileData = DocData | BookData;

export const cleanSheetName = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SHEET_NAME) : '';

export class Sheet {
  readonly doc: Doc;
  /** Name given by the user; empty shows the numbered default. */
  name: string;

  constructor(doc: Doc, name = '') {
    this.doc = doc;
    this.name = name;
  }
}

export type BookOp =
  | { k: 'add'; sheet: Sheet; index: number }
  | { k: 'del'; sheet: Sheet; index: number }
  | { k: 'name'; sheet: Sheet; from: string; to: string }
  | { k: 'move'; sheet: Sheet; from: number; to: number };

export interface BookTxn {
  op: BookOp;
  /** The sheet on show before / after, restored by undo / redo. */
  before: Sheet;
  after: Sheet;
}

export class Book {
  /** Never empty. */
  sheets: Sheet[];
  /** The sheet on show. */
  active: Sheet;
  undoStack: BookTxn[] = [];
  redoStack: BookTxn[] = [];
  /** Top of the undo stack at the last save; `undefined` = unreachable. */
  private saved: BookTxn | null | undefined = null;

  constructor(sheets: Sheet[], active = 0) {
    if (!sheets.length) throw new Error('a book needs a sheet');
    this.sheets = sheets;
    this.active = sheets[Math.max(0, Math.min(active, sheets.length - 1))];
  }

  static single(doc: Doc): Book {
    return new Book([new Sheet(doc)]);
  }

  indexOf(sheet: Sheet = this.active): number {
    return this.sheets.indexOf(sheet);
  }

  // ---------------------------------------------------------------- history

  get dirty(): boolean {
    if (this.saved === undefined || (this.undoStack.at(-1) ?? null) !== this.saved) return true;
    return this.sheets.some((s) => s.doc.dirty);
  }

  markSaved(): void {
    this.saved = this.undoStack.at(-1) ?? null;
    for (const s of this.sheets) s.doc.markSaved();
  }

  markDirty(): void {
    this.saved = undefined;
  }

  private commit(op: BookOp, before: Sheet): BookTxn {
    const txn: BookTxn = { op, before, after: this.active };
    this.undoStack.push(txn);
    this.redoStack.length = 0;
    return txn;
  }

  private apply(op: BookOp, invert: boolean): void {
    const list = this.sheets;
    switch (op.k) {
      case 'add':
      case 'del': {
        const attach = (op.k === 'add') !== invert;
        const i = list.indexOf(op.sheet);
        if (attach && i < 0) list.splice(Math.min(op.index, list.length), 0, op.sheet);
        else if (!attach && i >= 0) list.splice(i, 1);
        break;
      }
      case 'name':
        op.sheet.name = invert ? op.from : op.to;
        break;
      case 'move': {
        const i = list.indexOf(op.sheet);
        if (i < 0) break;
        list.splice(i, 1);
        list.splice(Math.min(invert ? op.from : op.to, list.length), 0, op.sheet);
        break;
      }
    }
  }

  /** The sheet to show when the one at `index` is gone: the one that took its place, else the last one. */
  private near(index: number): Sheet {
    return this.sheets[Math.min(index, this.sheets.length - 1)];
  }

  undo(): BookTxn | null {
    const txn = this.undoStack.pop();
    if (!txn) return null;
    this.apply(txn.op, true);
    this.active = this.sheets.includes(txn.before) ? txn.before : this.near(txn.op.k === 'add' ? txn.op.index : 0);
    this.redoStack.push(txn);
    return txn;
  }

  redo(): BookTxn | null {
    const txn = this.redoStack.pop();
    if (!txn) return null;
    this.apply(txn.op, false);
    this.active = this.sheets.includes(txn.after) ? txn.after : this.near(txn.op.k === 'del' ? txn.op.index : 0);
    this.undoStack.push(txn);
    return txn;
  }

  // ------------------------------------------------------------- operations

  /** Adds a sheet at `index` (default: right after the one on show) and shows it. */
  add(sheet: Sheet, index: number = this.indexOf() + 1): BookTxn | null {
    if (this.sheets.length >= MAX_SHEETS || this.sheets.includes(sheet)) return null;
    const before = this.active;
    const op: BookOp = { k: 'add', sheet, index: Math.max(0, Math.min(index, this.sheets.length)) };
    this.apply(op, false);
    this.active = sheet;
    return this.commit(op, before);
  }

  /** Removes a sheet (never the last one). Its neighbour is shown if it was on show. */
  remove(sheet: Sheet = this.active): BookTxn | null {
    const index = this.sheets.indexOf(sheet);
    if (index < 0 || this.sheets.length < 2) return null;
    const before = this.active;
    const op: BookOp = { k: 'del', sheet, index };
    this.apply(op, false);
    if (this.active === sheet) this.active = this.near(index);
    return this.commit(op, before);
  }

  rename(sheet: Sheet, name: string): BookTxn | null {
    const to = cleanSheetName(name);
    if (!this.sheets.includes(sheet) || to === sheet.name) return null;
    const op: BookOp = { k: 'name', sheet, from: sheet.name, to };
    this.apply(op, false);
    return this.commit(op, this.active);
  }

  /** Moves a sheet so that it ends up at position `to`. */
  move(sheet: Sheet, to: number): BookTxn | null {
    const from = this.sheets.indexOf(sheet);
    const target = Math.max(0, Math.min(to, this.sheets.length - 1));
    if (from < 0 || from === target) return null;
    const op: BookOp = { k: 'move', sheet, from, to: target };
    this.apply(op, false);
    return this.commit(op, this.active);
  }

  // ---------------------------------------------------------- serialization

  /** The ids that topic links point at, in all sheets: a link may lead into another sheet. */
  linked(): Set<string> {
    const linked = new Set<string>();
    for (const s of this.sheets) {
      walk(s.doc.root, (n) => {
        if (isTopicLink(n.link)) linked.add(n.link.slice(1));
      });
    }
    return linked;
  }

  toData(): FileData {
    // What a link points at keeps its id in the file, wherever it is.
    const linked = this.linked();
    if (this.sheets.length === 1 && !this.sheets[0].name) return this.sheets[0].doc.toData(linked);
    const sheets = this.sheets.map((s): SheetData => {
      const d = s.doc.toData(linked);
      return {
        ...(s.name ? { name: s.name } : {}),
        theme: d.theme,
        layout: d.layout,
        ...(d.style ? { style: d.style } : {}),
        root: d.root,
        ...(d.relationships ? { relationships: d.relationships } : {}),
      };
    });
    const active = this.indexOf();
    return { format: 'kozue', version: BOOK_VERSION, sheets, ...(active > 0 ? { active } : {}) };
  }

  /**
   * Builds a book from untrusted file data, in either form.
   * @param makeDoc turns the data of one sheet into a document (and throws when it is none)
   */
  static fromData(data: unknown, makeDoc: (sheet: unknown) => Doc): Book {
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (!Array.isArray(d.sheets)) return Book.single(makeDoc(data));
    const sheets: Sheet[] = [];
    for (const raw of d.sheets.slice(0, MAX_SHEETS)) {
      if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).root === undefined) continue;
      sheets.push(new Sheet(makeDoc(raw), cleanSheetName((raw as Record<string, unknown>).name)));
    }
    if (!sheets.length) throw new Error('Not a Kozue document');
    const active = typeof d.active === 'number' && Number.isInteger(d.active) ? d.active : 0;
    return new Book(sheets, active);
  }
}

/** True for file data in the `sheets` form. */
export function isBookData(data: unknown): data is BookData {
  return !!data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).sheets);
}
