// Popup menus (application menu, context menu) with submenus and keyboard navigation.

import type { App } from '../app/app.ts';
import { isMac } from '../platform.ts';
import { h } from './dom.ts';
import { icons } from './icons.ts';

export interface MenuItem {
  label?: string;
  /** Shortcut shown on the right. */
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
  submenu?: MenuItem[];
  separator?: boolean;
}

export const SEP: MenuItem = { separator: true };

/** Formats a shortcut such as "mod+shift+s" for the current platform. */
export function keyHint(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const names: Record<string, string> = {
    enter: isMac ? '↩' : 'Enter',
    tab: isMac ? '⇥' : 'Tab',
    delete: isMac ? '⌫' : 'Del',
    space: 'Space',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    esc: 'Esc',
  };
  const k = names[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (isMac) {
    const sym: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' };
    const order = ['ctrl', 'alt', 'shift', 'mod'];
    return (
      order
        .filter((m) => parts.includes(m))
        .map((m) => sym[m])
        .join('') + k
    );
  }
  const word: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...parts.map((m) => word[m] ?? m), k].join('+');
}

interface OpenMenu {
  el: HTMLElement;
  items: MenuItem[];
  rows: (HTMLElement | null)[];
  active: number;
}

export class Menus {
  private app: App;
  private host: HTMLElement;
  private stack: OpenMenu[] = [];
  private anchor: HTMLElement | null = null;
  private closedAnchor: HTMLElement | null = null;
  private closedAt = 0;

  constructor(app: App, host: HTMLElement) {
    this.app = app;
    this.host = host;
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  /** Opens a menu at a point, or below an anchor element (clicking the anchor again closes it). */
  show(items: MenuItem[], at: { x: number; y: number } | HTMLElement, alignRight = false): void {
    if (at instanceof HTMLElement && at === this.closedAnchor && performance.now() - this.closedAt < 350) return;
    this.close(false);
    this.app.blockKeys++;
    let x: number;
    let y: number;
    if (at instanceof HTMLElement) {
      const r = at.getBoundingClientRect();
      x = alignRight ? r.right : r.left;
      y = r.bottom + 6;
      this.anchor = at;
      at.classList.add('active');
    } else {
      x = at.x;
      y = at.y;
    }
    const menu = this.build(items);
    const w = menu.el.offsetWidth;
    const hgt = menu.el.offsetHeight;
    const left = Math.max(8, Math.min(alignRight ? x - w : x, innerWidth - w - 8));
    const top = y + hgt > innerHeight - 8 ? Math.max(8, innerHeight - hgt - 8) : y;
    menu.el.style.left = left + 'px';
    menu.el.style.top = top + 'px';
    window.addEventListener('pointerdown', this.onOutside, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onBlur);
  }

  close(refocus = true): void {
    if (!this.stack.length) return;
    for (const m of this.stack) m.el.remove();
    this.stack = [];
    this.app.blockKeys--;
    if (this.anchor) {
      this.anchor.classList.remove('active');
      this.closedAnchor = this.anchor;
      this.closedAt = performance.now();
      this.anchor = null;
    }
    window.removeEventListener('pointerdown', this.onOutside, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onBlur);
    if (refocus) this.app.editor.focus();
  }

  private build(items: MenuItem[]): OpenMenu {
    const el = h('div', { class: 'menu' + (items.some((i) => i.checked !== undefined) ? ' has-checks' : ''), role: 'menu' });
    const menu: OpenMenu = { el, items, rows: [], active: -1 };
    items.forEach((it, i) => {
      if (it.separator) {
        el.append(h('div', { class: 'menu-sep' }));
        menu.rows.push(null);
        return;
      }
      const row = h(
        'div',
        { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : ''), role: 'menuitem' },
        h('span', { class: 'menu-check', html: it.checked ? icons.check : '' }),
        h('span', { class: 'menu-label' }, it.label ?? ''),
        it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
        it.submenu ? h('span', { class: 'menu-arrow', html: icons.chevronRight }) : null,
      );
      row.addEventListener('pointerenter', () => this.setActive(menu, i, true));
      row.addEventListener('click', () => this.activate(menu, i));
      row.addEventListener('mousedown', (e) => e.preventDefault());
      el.append(row);
      menu.rows.push(row);
    });
    this.host.append(el);
    this.stack.push(menu);
    return menu;
  }

  private setActive(menu: OpenMenu, index: number, openSub: boolean): void {
    // Close submenus that hang off this menu.
    const level = this.stack.indexOf(menu);
    while (this.stack.length > level + 1) this.stack.pop()!.el.remove();
    if (menu.active >= 0) menu.rows[menu.active]?.classList.remove('active');
    menu.active = index;
    const row = menu.rows[index];
    if (!row) return;
    row.classList.add('active');
    const it = menu.items[index];
    if (openSub && it.submenu && !it.disabled) this.openSub(row, it.submenu);
  }

  private openSub(row: HTMLElement, items: MenuItem[]): OpenMenu {
    const sub = this.build(items);
    const r = row.getBoundingClientRect();
    const w = sub.el.offsetWidth;
    const hgt = sub.el.offsetHeight;
    let left = r.right - 4;
    if (left + w > innerWidth - 8) left = r.left - w + 4;
    const top = Math.max(8, Math.min(r.top - 6, innerHeight - hgt - 8));
    sub.el.style.left = Math.max(8, left) + 'px';
    sub.el.style.top = top + 'px';
    return sub;
  }

  private activate(menu: OpenMenu, index: number): void {
    const it = menu.items[index];
    if (!it || it.disabled || it.separator) return;
    if (it.submenu) {
      this.setActive(menu, index, true);
      return;
    }
    this.close();
    it.action?.();
  }

  private step(menu: OpenMenu, delta: number): void {
    const n = menu.items.length;
    let i = menu.active;
    for (let k = 0; k < n; k++) {
      i = (i + delta + n) % n;
      const it = menu.items[i];
      if (!it.separator && !it.disabled) {
        this.setActive(menu, i, false);
        return;
      }
    }
  }

  private onOutside = (e: PointerEvent): void => {
    const target = e.target as Node | null;
    if (target && this.stack.some((m) => m.el.contains(target))) return;
    this.close();
  };

  private onBlur = (): void => this.close();

  private onKey = (e: KeyboardEvent): void => {
    const menu = this.stack[this.stack.length - 1];
    if (!menu) return;
    e.stopPropagation();
    e.preventDefault();
    switch (e.key) {
      case 'ArrowDown':
        this.step(menu, 1);
        break;
      case 'ArrowUp':
        this.step(menu, menu.active < 0 ? 0 : -1);
        break;
      case 'ArrowRight': {
        const it = menu.items[menu.active];
        const row = menu.rows[menu.active];
        if (it && row && it.submenu && !it.disabled) this.step(this.openSub(row, it.submenu), 1);
        break;
      }
      case 'ArrowLeft':
        if (this.stack.length > 1) this.stack.pop()!.el.remove();
        break;
      case 'Enter':
      case ' ':
        if (menu.active >= 0) this.activate(menu, menu.active);
        break;
      case 'Escape':
        if (this.stack.length > 1) this.stack.pop()!.el.remove();
        else this.close();
        break;
    }
  };
}
