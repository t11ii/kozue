// Everything that differs between the desktop shell (Tauri) and a plain
// browser tab: file dialogs, reading / writing files, window chrome.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isMac = /Macintosh|Mac OS X|iPhone|iPad/i.test(ua);
export const isWindows = /Windows/i.test(ua);

/** Where a document lives: a path (desktop) or a file handle (browser). */
export interface FileRef {
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
}

export interface OpenedFile {
  ref: FileRef;
  bytes: Uint8Array;
}

export interface FileType {
  description: string;
  extensions: string[];
  mime: string;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface PickerWindow {
  showOpenFilePicker?: (o: {
    types?: PickerType[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[] }) => Promise<FileSystemFileHandle>;
}
const picker = (typeof window !== 'undefined' ? window : {}) as PickerWindow;

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

const fileName = (path: string): string => path.replace(/^.*[/\\]/, '');

// ----------------------------------------------------------------- reading

export async function readPath(path: string): Promise<OpenedFile> {
  const buf = await invoke<ArrayBuffer | number[]>('read_file', { path });
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf);
  return { ref: { name: fileName(path), path }, bytes };
}

function pickWithInput(extensions: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Shows an Open dialog. Resolves to null when cancelled. */
export async function pickOpen(type: FileType): Promise<OpenedFile | null> {
  if (isTauri) {
    const sel = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: type.description, extensions: type.extensions }],
    });
    return typeof sel === 'string' ? readPath(sel) : null;
  }
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({
        multiple: false,
        types: [{ description: type.description, accept: { [type.mime]: type.extensions.map((e) => '.' + e) } }],
      });
      const file = await handle.getFile();
      return { ref: { name: file.name, handle }, bytes: new Uint8Array(await file.arrayBuffer()) };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const file = await pickWithInput(type.extensions);
  return file ? { ref: { name: file.name }, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
}

// ----------------------------------------------------------------- writing

async function writePath(path: string, data: Uint8Array): Promise<void> {
  // Raw IPC body: [u32 path length][path utf-8][file bytes] — no JSON round trip for the payload.
  const p = new TextEncoder().encode(path);
  const body = new Uint8Array(4 + p.length + data.length);
  new DataView(body.buffer).setUint32(0, p.length, true);
  body.set(p, 4);
  body.set(data, 4 + p.length);
  await invoke('write_file', body);
}

async function writeHandle(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  await w.write(data as Uint8Array<ArrayBuffer>);
  await w.close();
}

function download(name: string, data: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True when `ref` points at a place we can write back to without asking. */
export function canWriteBack(ref: FileRef | null): ref is FileRef {
  return !!ref && (ref.path !== undefined || ref.handle !== undefined);
}

export async function writeBack(ref: FileRef, data: Uint8Array): Promise<void> {
  if (ref.path !== undefined) await writePath(ref.path, data);
  else if (ref.handle) await writeHandle(ref.handle, data);
  else throw new Error('No destination');
}

/**
 * Shows a Save dialog and writes the data produced by `produce`.
 * Resolves to the chosen destination, or null when cancelled.
 */
export async function pickSave(
  suggestedName: string,
  type: FileType,
  produce: () => Promise<Uint8Array> | Uint8Array,
): Promise<FileRef | null> {
  const ext = '.' + type.extensions[0];
  const withExt = (n: string): string => (n.toLowerCase().endsWith(ext) ? n : n + ext);
  if (isTauri) {
    const path = await saveDialog({
      defaultPath: withExt(suggestedName),
      filters: [{ name: type.description, extensions: type.extensions }],
    });
    if (!path) return null;
    await writePath(path, await produce());
    return { name: fileName(path), path };
  }
  if (picker.showSaveFilePicker) {
    let handle: FileSystemFileHandle;
    try {
      handle = await picker.showSaveFilePicker({
        suggestedName: withExt(suggestedName),
        types: [{ description: type.description, accept: { [type.mime]: [ext] } }],
      });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    await writeHandle(handle, await produce());
    return { name: handle.name, handle };
  }
  const name = withExt(suggestedName);
  download(name, await produce(), type.mime);
  return { name };
}

export interface NamedFile {
  name: string;
  data: Uint8Array;
  mime: string;
}

/** `name`, or `name (2)`, `name (3)` … — whichever `taken` does not report as in use. */
async function freeName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; i < 1000 && (await taken(candidate)); i++) candidate = `${stem} (${i})${ext}`;
  return candidate;
}

/**
 * Lets the user choose a folder and writes several files into it, never over
 * a file that is already there. Resolves to the number of files written, or
 * null when cancelled. Without folder access the files are downloaded.
 */
export async function saveMany(files: readonly NamedFile[]): Promise<number | null> {
  if (isTauri) {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== 'string') return null;
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    const base = dir.replace(/[\\/]+$/, '') + sep;
    for (const f of files) {
      const name = await freeName(f.name, (n) => invoke<boolean>('path_exists', { path: base + n }));
      await writePath(base + name, f.data);
    }
    return files.length;
  }
  const w = window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> };
  if (w.showDirectoryPicker) {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await w.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    for (const f of files) {
      const name = await freeName(f.name, (n) =>
        dir.getFileHandle(n).then(
          () => true,
          () => false,
        ),
      );
      await writeHandle(await dir.getFileHandle(name, { create: true }), f.data);
    }
    return files.length;
  }
  for (const f of files) download(f.name, f.data, f.mime);
  return files.length;
}

// ------------------------------------------------------------------- window

export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isTauri) void openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** The part of the Keyboard Lock API used here (Chromium browsers). */
type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };

/** Lets the window fill the whole screen, or ends that. Resolves to false when it could not be done. */
export async function setFullscreen(on: boolean): Promise<boolean> {
  try {
    if (isTauri) {
      await invoke('set_fullscreen', { on });
      return true;
    }
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    if (on) {
      await document.documentElement.requestFullscreen();
      // A browser leaves full screen on Escape. Where it lets a page keep the key (then
      // a long press leaves full screen), Escape goes on cancelling edits as usual.
      await keyboard?.lock?.(['Escape']).catch(() => {});
    } else if (document.fullscreenElement) {
      keyboard?.unlock?.();
      await document.exitFullscreen();
    }
    return true;
  } catch {
    return false;
  }
}

export function setWindowTitle(title: string): void {
  document.title = title;
  if (isTauri) void getCurrentWebviewWindow().setTitle(title);
}

/** `canClose` decides (possibly after asking the user) whether the window may close. */
export function onCloseRequested(canClose: () => Promise<boolean>): void {
  if (!isTauri) return;
  void getCurrentWebviewWindow().onCloseRequested(async (event) => {
    if (!(await canClose())) event.preventDefault();
  });
}

/** Native menu commands (macOS menu bar). */
export function onMenuCommand(handler: (id: string) => void): void {
  if (!isTauri) return;
  void getCurrentWebviewWindow().listen<string>('menu', (e) => handler(e.payload));
}

/** Files dropped onto the window. */
export function onFileDrop(handler: (paths: string[]) => void): void {
  if (!isTauri) return;
  void getCurrentWebviewWindow().onDragDropEvent((e) => {
    if (e.payload.type === 'drop' && e.payload.paths.length) handler(e.payload.paths);
  });
}

/** The OS asked the running app to open files (Finder double-click, "Open With"). */
export function onOpenRequest(handler: (paths: string[]) => void): void {
  if (!isTauri) return;
  void getCurrentWebviewWindow().listen('open-request', async () => {
    const paths = await invoke<string[]>('take_open_requests');
    if (paths.length) handler(paths);
  });
}

/** Files the OS asked for that no window has opened yet. */
export async function takeOpenRequests(): Promise<string[]> {
  if (!isTauri) return [];
  try {
    return await invoke<string[]>('take_open_requests');
  } catch {
    return [];
  }
}

/** The file this window was launched for, if any. */
export async function initialFile(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>('initial_file');
  } catch {
    return null;
  }
}

export function newWindow(path?: string): void {
  if (isTauri) void invoke('new_window', { path: path ?? null });
  else window.open(location.href, '_blank');
}

export function setMenuLanguage(lang: string): void {
  if (isTauri) void invoke('set_menu_language', { lang }).catch(() => {});
}

/** Label of this window; the first one is "main". */
export function windowLabel(): string {
  return isTauri ? getCurrentWebviewWindow().label : 'web';
}
