// Toasts and modal dialogs.

import type { App } from '../app/app.ts';
import type { ExportOptions, ImageKind } from '../app/files.ts';
import { APP_VERSION } from '../app/files.ts';
import type { MsgKey } from '../i18n.ts';
import { t } from '../i18n.ts';
import { isMac } from '../platform.ts';
import { h } from './dom.ts';
import { logo } from './icons.ts';
import { keyHint } from './menu.ts';

export class Dialogs {
  private app: App;
  private host: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;

  constructor(app: App, host: HTMLElement) {
    this.app = app;
    this.host = host;
  }

  toast(message: string, kind: 'info' | 'error' = 'info'): void {
    this.toastEl?.remove();
    clearTimeout(this.toastTimer);
    const el = (this.toastEl = h('div', { class: 'toast ' + kind, role: 'status' }, message));
    this.host.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    this.toastTimer = window.setTimeout(
      () => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
      },
      kind === 'error' ? 5000 : 2200,
    );
  }

  /**
   * Shows a modal card. `build` receives a function that closes the dialog with a result.
   * Escape resolves to undefined; Enter picks `defaultResult`.
   */
  private modal(build: (close: (result?: string) => void) => HTMLElement, defaultResult?: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const app = this.app;
      app.editor.commit();
      app.blockKeys++;
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let done = false;
      const close = (result?: string): void => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 160);
        app.blockKeys--;
        if (previous && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
        else app.editor.focus();
        resolve(result);
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(undefined);
        } else if (e.key === 'Enter' && defaultResult !== undefined && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          e.stopPropagation();
          close(defaultResult);
        } else if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') {
          e.stopPropagation();
        }
      };
      const card = build(close);
      const backdrop = h('div', { class: 'modal-backdrop' }, card);
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close(undefined);
      });
      window.addEventListener('keydown', onKey, true);
      this.host.append(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('show'));
      const first = card.querySelector<HTMLElement>('[data-default]') ?? card.querySelector<HTMLElement>('button');
      first?.focus({ preventScroll: true });
    });
  }

  async confirmUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'> {
    const result = await this.modal(
      (close) =>
        h(
          'div',
          { class: 'modal confirm', role: 'alertdialog' },
          h('h2', null, t('unsavedTitle')),
          h('p', null, t('unsavedMsg', { name })),
          h(
            'div',
            { class: 'modal-actions' },
            h('button', { class: 'btn ghost', onclick: () => close('discard') }, t('dontSave')),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn', onclick: () => close('cancel') }, t('cancel')),
            h('button', { class: 'btn primary', 'data-default': true, onclick: () => close('save') }, t('save')),
          ),
        ),
      'save',
    );
    return result === 'save' || result === 'discard' ? result : 'cancel';
  }

  /** Asks for the range, scale and background of an image export. */
  async exportOptions(kind: ImageKind, choice: { branch: boolean; split: boolean; preferBranch: boolean }): Promise<ExportOptions | null> {
    const opts: ExportOptions = { range: choice.branch && choice.preferBranch ? 'branch' : 'all', scale: 2, transparent: false };
    const raster = kind === 'png' || kind === 'jpeg';
    /** A row of mutually exclusive buttons bound to one field of `opts`. */
    const choose = <K extends 'range' | 'scale'>(
      field: K,
      items: readonly [ExportOptions[K], string, boolean?][],
      cls: string,
    ): HTMLElement => {
      const box = h('div', { class: cls });
      const sync = (): void => {
        box.querySelectorAll<HTMLElement>('button').forEach((b, i) => b.classList.toggle('active', items[i][0] === opts[field]));
      };
      for (const [value, label, enabled = true] of items) {
        const b = h('button', { class: cls === 'seg' ? 'seg-btn' : 'opt', disabled: !enabled }, label);
        b.addEventListener('click', () => {
          opts[field] = value;
          sync();
        });
        box.append(b);
      }
      sync();
      return box;
    };
    const result = await this.modal((close) => {
      const body: (HTMLElement | null)[] = [
        h('h2', null, t('exportOptions')),
        h('label', null, t('exportRange')),
        choose(
          'range',
          [
            ['all', t('rangeAll')],
            ['branch', t('rangeBranch'), choice.branch],
            ['split', t('rangeSplit'), choice.split],
          ],
          'opt-list',
        ),
      ];
      if (raster) {
        body.push(
          h('label', null, t('exportScale')),
          choose(
            'scale',
            [
              [1, '1x'],
              [2, '2x'],
              [3, '3x'],
            ],
            'seg',
          ),
        );
      }
      if (kind === 'png' || kind === 'svg') {
        const box = h('input', { type: 'checkbox' });
        box.addEventListener('change', () => (opts.transparent = box.checked));
        body.push(h('label', { class: 'check-row' }, box, h('span', null, t('exportTransparent'))));
      }
      body.push(
        h(
          'div',
          { class: 'modal-actions' },
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', onclick: () => close() }, t('cancel')),
          h('button', { class: 'btn primary', 'data-default': true, onclick: () => close('ok') }, t('exportDo')),
        ),
      );
      return h('div', { class: 'modal export', role: 'dialog' }, ...body);
    }, 'ok');
    return result === 'ok' ? opts : null;
  }

  about(): void {
    void this.modal((close) =>
      h(
        'div',
        { class: 'modal about', role: 'dialog' },
        h('div', { class: 'about-logo', html: logo }),
        h('h2', null, 'Kozue'),
        h('p', { class: 'muted' }, t('version', { v: APP_VERSION })),
        h('p', null, t('aboutText')),
        h(
          'div',
          { class: 'modal-actions center' },
          h('button', { class: 'btn primary', 'data-default': true, onclick: () => close() }, t('ok')),
        ),
      ),
    );
  }

  shortcuts(): void {
    const k = keyHint;
    const alt = isMac ? '⌥' : 'Alt+';
    const mod = isMac ? '⌘' : 'Ctrl+';
    const sections: [MsgKey, [MsgKey, string[]][]][] = [
      [
        'scEditing',
        [
          ['scAddChild', [k('tab')]],
          ['scAddSibling', [k('enter')]],
          ['scAddBefore', [k('shift+enter')]],
          ['scAddParent', [k('mod+enter')]],
          ['scEdit', ['Space', 'F2']],
          ['scNewline', [k('shift+enter')]],
          ['scDelete', [k('delete')]],
          ['scMove', [`${alt}↑`, `${alt}↓`]],
          ['scLevel', [`${alt}←`, `${alt}→`]],
          ['scFold', [k('mod+/')]],
          ['duplicate', [k('mod+d')]],
          ['undo', [k('mod+z')]],
          ['redo', [k('mod+shift+z')]],
        ],
      ],
      [
        'scInsert',
        [
          ['todo', [k('mod+shift+d')]],
          ['relationship', [k('mod+shift+l')]],
          ['boundary', [k('mod+shift+b')]],
          ['editLink', [k('mod+k')]],
          ['editNote', [k('mod+shift+e')]],
        ],
      ],
      [
        'style',
        [
          ['important', [k('mod+shift+1')]],
          ['crossed', [k('mod+shift+2')]],
          ['bold', [k('mod+b')]],
          ['italic', [k('mod+shift+i')]],
          ['strike', [k('mod+shift+x')]],
          ['copyStyle', [k('mod+alt+c')]],
          ['pasteStyle', [k('mod+alt+v')]],
          ['scWidth', [t('keyEdgeDrag')]],
          ['scWidthReset', [t('keyEdgeDouble')]],
        ],
      ],
      [
        'scNavigate',
        [
          ['scSelect', [t('keyArrows')]],
          ['scMulti', [`${isMac ? '⌘' : 'Ctrl+'}${t('keyClick')}`, `${isMac ? '⇧' : 'Shift+'}${t('keyClick')}`]],
          ['scMarquee', [`${isMac ? '⇧' : 'Shift+'}${t('keyDrag')}`]],
          ['scPan', [t('keyScroll'), t('keyBlankDrag')]],
          ['scZoom', [`${mod}${t('keyScroll')}`, k('mod+='), k('mod+-')]],
          ['scFit', [k('mod+1'), k('mod+0')]],
          ['focusBranch', [k('mod+;')]],
          ['scSearch', [k('mod+f')]],
          ['scReplace', [k(isMac ? 'mod+alt+f' : 'mod+h')]],
          ['format', [k('mod+i')]],
        ],
      ],
      [
        'scFile',
        [
          ['new', [k('mod+n')]],
          ['open', [k('mod+o')]],
          ['save', [k('mod+s')]],
          ['saveAs', [k('mod+shift+s')]],
        ],
      ],
    ];
    void this.modal((close) =>
      h(
        'div',
        { class: 'modal shortcuts', role: 'dialog' },
        h('h2', null, t('shortcuts')),
        h(
          'div',
          { class: 'sc-grid' },
          ...sections.map(([title, rows]) =>
            h(
              'section',
              null,
              h('h3', null, t(title)),
              ...rows.map(([label, keys]) =>
                h(
                  'div',
                  { class: 'sc-row' },
                  h('span', null, t(label).replace(/…$/, '')),
                  h('span', { class: 'sc-keys' }, ...keys.map((key) => h('kbd', null, key))),
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'modal-actions center' },
          h('button', { class: 'btn primary', 'data-default': true, onclick: () => close() }, t('ok')),
        ),
      ),
    );
  }
}
