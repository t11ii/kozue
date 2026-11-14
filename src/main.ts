import './styles.css';
import { App } from './app/app.ts';
import { Files } from './app/files.ts';
import { Input } from './app/input.ts';
import { LAYOUT_KINDS } from './core/structures.ts';
import { luminance } from './core/themes.ts';
import { getLang, setLang, t } from './i18n.ts';
import {
  isMac,
  isTauri,
  isWindows,
  newWindow,
  onCloseRequested,
  onFileDrop,
  onMenuCommand,
  onOpenRequest,
  setMenuLanguage,
} from './platform.ts';
import { runSelfTest, selfTestDir } from './selftest.ts';
import { Chrome } from './ui/chrome.ts';
import { Dialogs } from './ui/dialogs.ts';
import { Panel } from './ui/panel.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const html = document.documentElement;
html.classList.toggle('is-mac', isMac);
html.classList.toggle('is-win', isWindows);
html.classList.toggle('is-tauri', isTauri);
html.lang = getLang();

const app = new App($<HTMLCanvasElement>('canvas'), $<HTMLTextAreaElement>('editor'), $('mirror'));
const input = new Input(app);
const overlays = $('overlays');
const dialogs = new Dialogs(app, overlays);
const files = new Files(app, dialogs);
const panel = new Panel(app, $('panel'));
const chrome = new Chrome(app, files, panel, $('toolbar'), overlays);

input.onContextMenu = (x, y, node) => chrome.contextMenu(x, y, node);
input.onIndicator = (node, part, x, y) => chrome.indicator(node, part, x, y);
input.onRelEdit = () => panel.focusRel();
input.onIdleEscape = () => chrome.toggleZen(false);
app.notify = (what) => dialogs.toast(t(what));
app.centralText = () => t('central');
chrome.notify = (message) => dialogs.toast(message);

// ---------------------------------------------------------------- commands

app.register('new', () => void files.newDoc());
app.register('newWindow', () => newWindow());
app.register('open', () => void files.open());
app.register('save', () => void files.save());
app.register('saveAs', () => void files.saveAs());
app.register('welcome', () => void files.showWelcome());
for (const kind of ['png', 'jpeg', 'svg', 'pdf', 'md', 'txt', 'opml', 'xmind'] as const) {
  app.register('export.' + kind, () => void files.exportAs(kind));
}
app.register('search', () => chrome.openSearch());
app.register('replace', () => chrome.openSearch(true));
app.register('editLabels', () => {
  if (app.primary) panel.focusLabels();
});
app.register('editRel', () => {
  if (app.selRel) panel.focusRel();
});
app.register('editStyle', () => panel.showStyle());
app.register('sheet.rename', () => chrome.renameSheet());
app.register('zen', () => chrome.toggleZen());
app.register('togglePanel', () => panel.toggle());
for (const kind of LAYOUT_KINDS) app.register('layout.' + kind, () => app.setLayout(kind));
app.register('editNote', () => {
  if (app.primary) panel.focusNote();
});
app.register('editLink', () => {
  if (app.primary) panel.focusLink();
});
app.register('shortcuts', () => dialogs.shortcuts());
app.register('about', () => dialogs.about());
app.register('language', () => {
  setLang(getLang() === 'ja' ? 'en' : 'ja');
  html.lang = getLang();
  chrome.rebuild();
  panel.rebuild();
  setMenuLanguage(getLang());
});

// ------------------------------------------------------------------- theme

/** The chrome follows the map: light or dark, with the theme's accent color. */
function applyTheme(): void {
  const th = app.theme;
  html.dataset.chrome = th.dark ? 'dark' : 'light';
  html.style.setProperty('--map-bg', th.bg);
  html.style.setProperty('--accent', th.accent);
  html.style.setProperty('--on-accent', luminance(th.accent) > 0.4 ? '#14161b' : '#ffffff');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th.bg);
}
app.on((what) => {
  if (what === 'theme') applyTheme();
});
applyTheme();

// ------------------------------------------------------ desktop integration

/** Menu commands that edit text when a text field has the focus. */
const TEXT_COMMANDS = new Set(['undo', 'redo', 'selectAll']);
/** Menu commands that only make sense for the map. */
const MAP_COMMANDS = new Set([
  'delete',
  'deleteSingle',
  'duplicate',
  'addChild',
  'addSibling',
  'addSiblingBefore',
  'addParent',
  'toggleCollapse',
  'todo',
  'boundary',
  'summary',
  'relationship',
  'focusBranch',
  'bold',
  'italic',
  'strike',
  'important',
  'crossed',
  'copyStyle',
  'pasteStyle',
  'styleToLevel',
  'resetStyle',
]);

onMenuCommand((id) => {
  // A shortcut handled by the page may also arrive through the native menu: run it once.
  if (input.wasRecent(id) || app.blockKeys > 0) return;
  const a = document.activeElement;
  const inField = a instanceof HTMLElement && a !== app.editor.el && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  if (inField) {
    // The note / link / search fields keep their own undo history and selection.
    if (TEXT_COMMANDS.has(id)) document.execCommand(id);
    if (TEXT_COMMANDS.has(id) || MAP_COMMANDS.has(id)) return;
  }
  input.ranFromMenu(id);
  app.exec(id);
});
onCloseRequested(() => files.confirmClose());
onFileDrop((paths) => void files.openPath(paths[0]));
onOpenRequest(async (paths) => {
  for (const p of paths) await files.openPath(p);
});
setMenuLanguage(getLang());

// Files dropped onto the page (browser).
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  e.preventDefault();
  void files.openDropped(file);
});

if (isTauri) {
  // This is an app window, not a browser tab: no reload / print shortcuts, no browser context menu.
  window.addEventListener(
    'keydown',
    (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      if (key === 'f5' || key === 'f3' || key === 'f7' || (mod && ['r', 'p', 'g', 'j', 'u'].includes(key))) e.preventDefault();
    },
    true,
  );
  window.addEventListener('contextmenu', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target === app.editor.el) e.preventDefault();
  });
}

// The page itself never zooms or scrolls; only the canvas does.
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  },
  { passive: false },
);
$('stage').addEventListener('scroll', (e) => {
  const el = e.currentTarget as HTMLElement;
  el.scrollTop = 0;
  el.scrollLeft = 0;
});

if (import.meta.env.DEV) Object.assign(window, { kozue: { app, files, panel, chrome } });

// Smoke test mode (desktop only, see selftest.ts) leaves the user's session untouched.
const selfTest = await selfTestDir();
if (selfTest) {
  files.sessionless = true;
  await runSelfTest(app, selfTest);
} else {
  await files.start();
  app.editor.focus();
}
