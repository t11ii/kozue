// Minimal DOM construction helper.

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  /** Trusted markup (inline SVG icons). */
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
  data?: Record<string, string>;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const key in props) {
      const v = props[key];
      if (v === undefined || v === null || v === false) continue;
      if (key === 'class') el.className = String(v);
      else if (key === 'html') el.innerHTML = String(v);
      else if (key === 'style') Object.assign(el.style, v);
      else if (key === 'data') Object.assign(el.dataset, v);
      else if (key.startsWith('on') && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v as EventListener);
      else if (v === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Keeps a click on chrome from stealing the keyboard focus from the canvas. */
export function keepFocus(el: HTMLElement): void {
  el.addEventListener('mousedown', (e) => e.preventDefault());
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
