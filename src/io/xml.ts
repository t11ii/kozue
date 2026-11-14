// A small, dependency-free XML reader — enough for OPML, FreeMind and
// legacy Xmind files. Not a validating parser.

export interface XmlEl {
  name: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  /** Concatenated character data directly inside this element. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e.charAt(0) === '#') {
      const hex = e.charAt(1) === 'x' || e.charAt(1) === 'X';
      const cp = parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(src: string): XmlEl {
  const doc: XmlEl = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlEl[] = [doc];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let e = lt + 2;
      let depth = 0;
      for (; e < n; e++) {
        const ch = src.charAt(e);
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
      }
      i = e + 1;
    } else if (src.charAt(lt + 1) === '/') {
      const e = src.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = e < 0 ? n : e + 1;
    } else {
      let e = lt + 1;
      let quote = '';
      for (; e < n; e++) {
        const ch = src.charAt(e);
        if (quote) {
          if (ch === quote) quote = '';
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      let body = src.slice(lt + 1, e);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/>]+/.exec(body)?.[0] ?? '';
      const el: XmlEl = { name, attrs: {}, children: [], text: '' };
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      const rest = body.slice(name.length);
      for (let a = re.exec(rest); a; a = re.exec(rest)) el.attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
      top.children.push(el);
      if (!selfClosing) stack.push(el);
      i = e + 1;
    }
  }
  return doc;
}

export const childOf = (el: XmlEl | undefined, name: string): XmlEl | undefined => el?.children.find((c) => c.name === name);

export const childrenOf = (el: XmlEl | undefined, name: string): XmlEl[] => el?.children.filter((c) => c.name === name) ?? [];

/** Finds the first descendant with the given name (depth-first). */
export function findEl(el: XmlEl, name: string): XmlEl | undefined {
  for (const c of el.children) {
    if (c.name === name) return c;
    const f = findEl(c, name);
    if (f) return f;
  }
  return undefined;
}

const BLOCK = new Set(['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4']);

/** Text content of an element tree, with block elements separated by newlines. */
export function textOf(el: XmlEl): string {
  let out = el.text;
  for (const c of el.children) {
    const inner = textOf(c);
    out += inner;
    if (BLOCK.has(c.name.toLowerCase())) out += '\n';
  }
  return out;
}

export function escapeAttr(s: string): string {
  return s.replace(/[&<>"\n]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\n': '&#10;' })[c]!);
}
