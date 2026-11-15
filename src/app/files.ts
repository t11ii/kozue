// Document lifecycle: new / open / save / export, session restore and
// the list of recently used files.

import type { FileData } from '../core/book.ts';
import { Book } from '../core/book.ts';
import type { MapStyle, NodeData, RelData } from '../core/model.ts';
import { Doc, MNode } from '../core/model.ts';
import type { Theme } from '../core/themes.ts';
import { DEFAULT_THEME, themeById } from '../core/themes.ts';
import { getLang, t } from '../i18n.ts';
import type { TextFormat } from '../io/formats.ts';
import { NATIVE_EXT, OPEN_EXTENSIONS, baseName, exportText, importFile, serializeNative } from '../io/formats.ts';
import { toXmind } from '../io/xmind.ts';
import type { Template } from './templates.ts';
import { templates } from './templates.ts';
import type { FileRef, FileType, NamedFile, OpenedFile } from '../platform.ts';
import {
  canWriteBack,
  initialFile,
  isMac,
  isTauri,
  newWindow,
  pickOpen,
  pickSave,
  readPath,
  saveMany,
  takeOpenRequests,
  windowLabel,
  writeBack,
} from '../platform.ts';
import { sceneToJpeg, sceneToPdf, sceneToPng, sceneToSvg } from '../render/export.ts';
import type { App } from './app.ts';

export const APP_VERSION = '0.1.0';

export type ImageKind = 'png' | 'jpeg' | 'svg' | 'pdf';
export type ExportKind = ImageKind | 'xmind' | TextFormat;

const IMAGE_KINDS: readonly string[] = ['png', 'jpeg', 'svg', 'pdf'];

export interface ExportOptions {
  /** The whole map, one branch, or one file for each main branch. */
  range: 'all' | 'branch' | 'split';
  scale: number;
  transparent: boolean;
}

export interface FilesUi {
  toast(message: string, kind?: 'info' | 'error'): void;
  confirmUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'>;
  /** Lets the user choose a template (drawn in `theme`); resolves to null when cancelled. */
  pickTemplate(list: readonly Template[], theme: Theme): Promise<Template | null>;
  /** Asks how to export an image; resolves to null when cancelled. */
  exportOptions(kind: ImageKind, choice: { branch: boolean; split: boolean; preferBranch: boolean }): Promise<ExportOptions | null>;
}

/** A piece of a topic's text that is safe in a file name. */
const fileWords = (text: string): string =>
  text
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim();

const NATIVE_TYPE: FileType = { description: 'Kozue Mind Map', extensions: [NATIVE_EXT], mime: 'application/json' };
const OPEN_TYPE: FileType = { description: 'Mind Maps', extensions: OPEN_EXTENSIONS, mime: 'application/octet-stream' };
const EXPORT_TYPES: Record<ExportKind, FileType> = {
  png: { description: 'PNG Image', extensions: ['png'], mime: 'image/png' },
  jpeg: { description: 'JPEG Image', extensions: ['jpg', 'jpeg'], mime: 'image/jpeg' },
  svg: { description: 'SVG Image', extensions: ['svg'], mime: 'image/svg+xml' },
  pdf: { description: 'PDF Document', extensions: ['pdf'], mime: 'application/pdf' },
  md: { description: 'Markdown', extensions: ['md'], mime: 'text/markdown' },
  txt: { description: 'Text Outline', extensions: ['txt'], mime: 'text/plain' },
  opml: { description: 'OPML', extensions: ['opml'], mime: 'text/x-opml' },
  xmind: { description: 'Xmind', extensions: ['xmind'], mime: 'application/vnd.xmind.workbook' },
};

const THEME_KEY = 'kozue.theme';
const RECENT_KEY = 'kozue.recent';
const WELCOMED_KEY = 'kozue.welcomed';
const MAX_RECENT = 10;

interface Draft {
  v: 1;
  /** The whole file (the name of the field dates from when a file was a single map). */
  doc: FileData;
  path?: string;
  name?: string;
  dirty: boolean;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage full or unavailable: the app works without it */
    }
  },
};

export function preferredTheme(): string {
  return themeById(store.get(THEME_KEY) ?? DEFAULT_THEME).id;
}

export function rememberTheme(id: string): void {
  store.set(THEME_KEY, id);
}

function docFromData(data: { root: NodeData; theme?: string; layout?: string; relationships?: RelData[]; style?: MapStyle }): Doc {
  const theme = themeById(data.theme ?? preferredTheme());
  return Doc.fromData({ ...data, theme: theme.id }, theme.id, theme.palette.length);
}

/** A file from imported or remembered data: a single map, or several sheets. */
function bookFromData(data: unknown): Book {
  return Book.fromData(data, (sheet) => docFromData(sheet as Parameters<typeof docFromData>[0]));
}

export function blankDoc(): Doc {
  return new Doc(new MNode(t('central')), preferredTheme(), 'map');
}

/** A small tour of the app, shown on first launch. */
export function welcomeDoc(): Doc {
  const ja = getLang() === 'ja';
  const mod = isMac ? '⌘' : 'Ctrl+';
  const zen = isMac ? '⇧⌘F' : 'Ctrl+Shift+F';
  const present = isMac ? '⇧⌘P' : 'Ctrl+Shift+P';
  const n = (text: string, ...children: NodeData[]): NodeData => (children.length ? { text, children } : { text });
  const root: NodeData = ja
    ? n(
        'Kozue',
        {
          text: 'はじめに',
          id: 'start',
          children: [n('Tab でサブトピック'), n('Enter で次のトピック'), n('Space・ダブルクリックで編集'), n('ドラッグで付け替え')],
        },
        n(
          '書き込む',
          { text: 'マーカー', markers: ['p1', 'done'] },
          { text: 'リンク', link: 'https://www.wikipedia.org/' },
          { text: 'トピックへのリンク', link: '#start' },
          // (Last, next to the topic that the relationship comes from: its line crosses nothing.)
          { text: 'ノート', note: 'トピックごとにメモを残せます。\nアイコンをクリックすると表示されます。', id: 'note' },
        ),
        n(
          '整理する',
          { text: '関連線', id: 'rel' },
          { text: 'To-Do', todo: true },
          { text: 'ラベル', labels: ['例'] },
          { text: '囲み', boundary: '' },
          { text: '要約', summary: 3 },
        ),
        n(
          '見た目',
          n('18 のテーマ'),
          n('12 の構造', n('マインドマップ・ロジック'), n('組織図・ツリー'), n('タイムライン・フィッシュボーン')),
          n('ブランチごとの色と構造'),
          { text: '形・色・文字のスタイル', style: { shape: 'pill', fill: '#ffe08a' } },
        ),
        n(
          'ファイル',
          n(`${mod}S で保存`),
          n('1 つのファイルに複数のシート'),
          n('読み込み', n('Xmind'), n('Markdown・OPML'), n('FreeMind')),
          n('書き出し', n('PNG・SVG・PDF'), n('Markdown・Xmind')),
          n('テンプレートから新規'),
        ),
        n(
          '表示',
          n('スクロールで移動'),
          n(`ピンチ・${mod}スクロールで拡大`),
          n(`${mod}F で検索・置換`),
          n(`${mod}1 で全体、${mod}; でブランチのみ`),
          n(`${zen} で ZEN モード`),
          n(`${present} でプレゼンテーション`),
        ),
        n('軽快', n('Canvas で描画'), n('数千トピックでも滑らか'), n('起動は一瞬')),
      )
    : n(
        'Kozue',
        {
          text: 'Getting started',
          id: 'start',
          children: [n('Tab adds a subtopic'), n('Enter adds the next topic'), n('Space or double-click to edit'), n('Drag to rearrange')],
        },
        n(
          'Annotate',
          { text: 'Markers', markers: ['p1', 'done'] },
          { text: 'Links', link: 'https://www.wikipedia.org/' },
          { text: 'Links to topics', link: '#start' },
          { text: 'Notes', note: 'Every topic can carry a note.\nClick the icon to read it.', id: 'note' },
        ),
        n(
          'Organize',
          { text: 'Relationships', id: 'rel' },
          { text: 'To-dos', todo: true },
          { text: 'Labels', labels: ['example'] },
          { text: 'Boundaries', boundary: '' },
          { text: 'Summaries', summary: 3 },
        ),
        n(
          'Look',
          n('18 themes'),
          n('12 structures', n('Mind map, logic chart'), n('Org chart, tree'), n('Timeline, fishbone')),
          n('Colors and structures per branch'),
          { text: 'Shapes, colors and text styles', style: { shape: 'pill', fill: '#ffe08a' } },
        ),
        n(
          'Files',
          n(`${mod}S to save`),
          n('Several sheets in one file'),
          n('Import', n('Xmind'), n('Markdown, OPML'), n('FreeMind')),
          n('Export', n('PNG, SVG, PDF'), n('Markdown, Xmind')),
          n('New from a template'),
        ),
        n(
          'View',
          n('Scroll to pan'),
          n(`Pinch or ${mod}scroll to zoom`),
          n(`${mod}F to find and replace`),
          n(`${mod}1 to fit, ${mod}; for one branch`),
          n(`${zen} for ZEN mode`),
          n(`${present} to present`),
        ),
        n('Fast', n('Canvas rendering'), n('Smooth with thousands of topics'), n('Starts instantly')),
      );
  return docFromData({ root, relationships: [{ from: 'rel', to: 'note' }] });
}

export class Files {
  ref: FileRef | null = null;
  /** When set, nothing about this window is remembered for the next launch. */
  sessionless = false;
  /** Name suggested for files imported from another format. */
  private importName: string | null = null;
  private app: App;
  private ui: FilesUi;
  private label = windowLabel();
  private draftTimer = 0;
  private listeners: (() => void)[] = [];

  constructor(app: App, ui: FilesUi) {
    this.app = app;
    this.ui = ui;
    app.on((what) => {
      if (what === 'doc') this.persistSoon();
    });
    window.addEventListener('pagehide', () => this.persistDraft());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.persistDraft();
    });
  }

  /** Fires when the file name or the saved state changes. */
  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const l of this.listeners) l();
    this.persistSoon();
  }

  get displayName(): string {
    if (this.ref) return baseName(this.ref.name);
    if (this.importName) return this.importName;
    // An unnamed file goes by the central topic of its first sheet.
    const title = this.app.book.sheets[0].doc.root.text.split('\n')[0].trim();
    return title ? (title.length > 48 ? title.slice(0, 48) + '…' : title) : t('untitled');
  }

  /**
   * Name for a file that holds the map on show: that of the file — and, when the
   * file has several sheets, what the sheet goes by.
   */
  private get sheetName(): string {
    const book = this.app.book;
    if (book.sheets.length < 2) return this.displayName;
    const sheet = book.active;
    const words = fileWords(sheet.name || sheet.doc.root.text.split('\n')[0]) || String(book.indexOf() + 1);
    return `${fileWords(this.displayName)} - ${words}`;
  }

  /** Nothing in this window is worth keeping. */
  get pristine(): boolean {
    return !this.app.book.dirty && this.ref === null && this.importName === null;
  }

  // ------------------------------------------------------------ open / new

  private async load(file: OpenedFile): Promise<void> {
    const imp = await importFile(file.ref.name, file.bytes);
    this.app.setBook(bookFromData(imp));
    this.ref = imp.native ? file.ref : null;
    this.importName = imp.native ? null : baseName(file.ref.name);
    if (imp.native && file.ref.path) this.addRecent(file.ref.path);
    this.changed();
  }

  private fail(key: 'openFailed' | 'saveFailed' | 'exportFailed', err: unknown): void {
    console.error(err);
    const detail = err instanceof Error ? err.message : String(err);
    this.ui.toast(`${t(key)}: ${detail}`, 'error');
  }

  async newDoc(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.setFresh(blankDoc());
  }

  /** A new map from one of the templates, in the theme used last. */
  async newFromTemplate(): Promise<void> {
    this.app.editor.commit();
    const tpl = await this.ui.pickTemplate(templates(), themeById(preferredTheme()));
    if (!tpl || !(await this.confirmDiscard())) return;
    this.setFresh(docFromData({ root: tpl.root, layout: tpl.layout }));
  }

  async showWelcome(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.setFresh(welcomeDoc());
  }

  private setFresh(doc: Doc): void {
    this.app.setDoc(doc);
    this.ref = null;
    this.importName = null;
    this.changed();
  }

  async open(): Promise<void> {
    this.app.editor.commit();
    if (!(await this.confirmDiscard())) return;
    try {
      const file = await pickOpen(OPEN_TYPE);
      if (file) await this.load(file);
    } catch (e) {
      this.fail('openFailed', e);
    }
  }

  /** Opens a file by path (desktop only). A window with content opens it in a new window. */
  async openPath(path: string): Promise<void> {
    if (!this.pristine) {
      newWindow(path);
      return;
    }
    try {
      await this.load(await readPath(path));
    } catch (e) {
      this.fail('openFailed', e);
    }
  }

  /** Opens a file dropped onto the page (browser). */
  async openDropped(file: File): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      await this.load({ ref: { name: file.name }, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (e) {
      this.fail('openFailed', e);
    }
  }

  // ------------------------------------------------------------------ save

  private nativeBytes(): Uint8Array {
    return new TextEncoder().encode(serializeNative(this.app.book.toData()));
  }

  async save(): Promise<boolean> {
    this.app.editor.commit();
    if (!canWriteBack(this.ref)) return this.saveAs();
    try {
      await writeBack(this.ref, this.nativeBytes());
    } catch (e) {
      this.fail('saveFailed', e);
      return false;
    }
    this.app.book.markSaved();
    this.changed();
    return true;
  }

  async saveAs(): Promise<boolean> {
    this.app.editor.commit();
    try {
      const ref = await pickSave(this.displayName, NATIVE_TYPE, () => this.nativeBytes());
      if (!ref) return false;
      // A plain download leaves no file we could write back to.
      if (canWriteBack(ref)) {
        this.ref = ref;
        this.importName = null;
        if (ref.path) this.addRecent(ref.path);
      }
    } catch (e) {
      this.fail('saveFailed', e);
      return false;
    }
    this.app.book.markSaved();
    this.changed();
    this.ui.toast(t('saved'));
    return true;
  }

  /** Asks about unsaved changes. Resolves to true when it is fine to go on. */
  async confirmDiscard(): Promise<boolean> {
    this.app.editor.commit();
    if (!this.app.book.dirty) return true;
    const answer = await this.ui.confirmUnsaved(this.displayName);
    if (answer === 'cancel') return false;
    if (answer === 'save') return this.save();
    return true;
  }

  /** Called before the window closes; false keeps it open. */
  async confirmClose(): Promise<boolean> {
    this.app.editor.commit();
    if (this.app.book.dirty) {
      const answer = await this.ui.confirmUnsaved(this.displayName);
      if (answer === 'cancel') return false;
      if (answer === 'save' && !(await this.save())) return false;
      if (answer === 'discard') {
        // Forget the discarded changes, but remember which file was open.
        this.writeDraft(this.ref?.path ? { v: 1, doc: blankDoc().toData(), path: this.ref.path, name: this.ref.name, dirty: false } : null);
        return true;
      }
    }
    this.persistDraft();
    return true;
  }

  // ---------------------------------------------------------------- export

  async exportAs(kind: ExportKind): Promise<void> {
    const app = this.app;
    app.editor.commit();
    const enc = new TextEncoder();
    try {
      if (!IMAGE_KINDS.includes(kind)) {
        const ref = await pickSave(kind === 'xmind' ? this.displayName : this.sheetName, EXPORT_TYPES[kind], () =>
          // An Xmind file takes all sheets; the text formats describe the map on show.
          kind === 'xmind' ? toXmind(app.book.toData(), APP_VERSION) : enc.encode(exportText(kind as TextFormat, app.doc.toData())),
        );
        if (ref) this.ui.toast(t('exported'));
        return;
      }
      const image = kind as ImageKind;
      const root = app.doc.root;
      // The branch that can be exported on its own: the one on show, else the selected one.
      const picked = app.sel.length === 1 && app.sel[0] !== root ? app.sel[0] : null;
      const branch = app.focus ?? picked;
      const opts = await this.ui.exportOptions(image, {
        branch: branch !== null,
        split: root.children.length > 1,
        preferBranch: app.focus !== null,
      });
      if (!opts) return;

      let reduced = false;
      /** Image of the whole map (null) or of one branch. */
      const render = async (node: MNode | null): Promise<Uint8Array> => {
        // The branch is laid out and drawn before withBranch() returns; only the encoding takes longer.
        const job = app.withBranch(node, () => {
          const scene = app.exportScene();
          if (image === 'png') return sceneToPng(scene, opts);
          if (image === 'jpeg') return sceneToJpeg(scene, opts);
          if (image === 'pdf') return sceneToPdf(scene);
          return Promise.resolve({ bytes: enc.encode(sceneToSvg(scene, opts.transparent)), reduced: false });
        });
        const r = await job;
        reduced ||= r.reduced;
        return r.bytes;
      };

      const type = EXPORT_TYPES[image];
      if (opts.range === 'split') {
        const files: NamedFile[] = [];
        let i = 0;
        for (const main of root.children) {
          const words = fileWords(main.text) || String(++i);
          files.push({
            name: `${fileWords(this.sheetName)} - ${words}.${type.extensions[0]}`,
            data: await render(main),
            mime: type.mime,
          });
        }
        const n = await saveMany(files);
        if (n !== null) this.ui.toast(reduced ? t('tooLarge') : t('exportedN', { n }));
        return;
      }
      const target = opts.range === 'branch' ? branch : null;
      const name = target ? `${this.sheetName} - ${fileWords(target.text)}` : this.sheetName;
      const ref = await pickSave(name, type, () => render(target));
      if (ref) this.ui.toast(reduced ? t('tooLarge') : t('exported'));
    } catch (e) {
      this.fail('exportFailed', e);
    }
  }

  // ---------------------------------------------------------------- recent

  get recent(): string[] {
    try {
      const list: unknown = JSON.parse(store.get(RECENT_KEY) ?? '[]');
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  }

  private addRecent(path: string): void {
    store.set(RECENT_KEY, JSON.stringify([path, ...this.recent.filter((p) => p !== path)].slice(0, MAX_RECENT)));
  }

  clearRecent(): void {
    store.set(RECENT_KEY, null);
  }

  // --------------------------------------------------------------- session

  /** Only the first window keeps a session; extra windows start from their file. */
  private get persistent(): boolean {
    return !this.sessionless && (this.label === 'main' || this.label === 'web');
  }

  private get draftKey(): string {
    return 'kozue.draft.' + this.label;
  }

  private writeDraft(d: Draft | null): void {
    if (this.persistent) store.set(this.draftKey, d ? JSON.stringify(d) : null);
  }

  private persistSoon(): void {
    if (!this.persistent) return;
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => this.persistDraft(), 700);
  }

  persistDraft(): void {
    clearTimeout(this.draftTimer);
    const book = this.app.book;
    this.writeDraft({
      v: 1,
      doc: book.toData(),
      path: this.ref?.path,
      name: this.ref?.name ?? this.importName ?? undefined,
      dirty: book.dirty,
    });
  }

  /** Decides what the window shows at startup. */
  async start(): Promise<void> {
    await this.restore();
    // Several files opened at once: this window took the first, the rest get their own.
    for (const path of await takeOpenRequests()) newWindow(path);
  }

  private async restore(): Promise<void> {
    const path = await initialFile();
    if (path) {
      try {
        await this.load(await readPath(path));
        return;
      } catch (e) {
        this.fail('openFailed', e);
      }
    }
    if (this.persistent) {
      try {
        const d = JSON.parse(store.get(this.draftKey) ?? 'null') as Draft | null;
        if (d && d.doc) {
          if (!d.dirty && d.path && isTauri) {
            // Nothing unsaved: the file on disk is the truth (it may have changed since).
            try {
              await this.load(await readPath(d.path));
              return;
            } catch {
              d.path = undefined; // the file is gone: show the remembered copy instead
              d.name = undefined;
            }
          }
          const book = bookFromData(d.doc);
          this.app.setBook(book);
          this.ref = d.path ? { name: d.name ?? baseName(d.path), path: d.path } : null;
          this.importName = d.path ? null : (d.name ?? null);
          if (d.dirty) {
            book.markDirty();
            if (isTauri) this.ui.toast(t('restored'));
          }
          this.changed();
          return;
        }
      } catch (e) {
        console.warn('Could not restore the previous session', e);
      }
    }
    if (store.get(WELCOMED_KEY)) this.setFresh(blankDoc());
    else {
      store.set(WELCOMED_KEY, '1');
      this.setFresh(welcomeDoc());
    }
  }
}
