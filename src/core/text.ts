// Text wrapping for canvas rendering: greedy line filling with CJK-aware
// break opportunities and basic kinsoku (line-start / line-end prohibition).

export type MeasureFn = (s: string) => number;

export interface TextBlock {
  lines: string[];
  /** Width of the widest line. */
  width: number;
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

const ASCII = /^[\x00-\x7f]*$/;

export function graphemes(s: string): string[] {
  if (ASCII.test(s)) return s.split('');
  if (!segmenter) return Array.from(s);
  const out: string[] = [];
  for (const g of segmenter.segment(s)) out.push(g.segment);
  return out;
}

/** Characters that allow a line break on either side (CJK, kana, emoji…). */
function isBreakable(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols, dingbats
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK radicals … kana … unified ideographs … Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xffef) || // full-width / half-width forms
    (cp >= 0x1f000 && cp <= 0x1faff) || // emoji
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK extensions
  );
}

/** May not start a line. */
const NO_START = new Set(
  Array.from('、。，．・：；？！゛゜ヽヾゝゞ々ー）〕］｝〉》」』】〙〗〟’”｠»ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ‥…'),
);
/** May not end a line. */
const NO_END = new Set(Array.from('（〔［｛〈《「『【〘〖〝‘“｟«'));

const isSpace = (s: string): boolean => s === ' ' || s === '\t' || s === '　';

/** Splits a paragraph into units between which a line may break. */
function tokenize(para: string): string[] {
  const units: string[] = [];
  let word = '';
  let lastG = '';
  const push = (u: string, startsWith: string): void => {
    const prev = units.length ? units[units.length - 1] : '';
    if (prev && !isSpace(prev) && (NO_START.has(startsWith) || NO_END.has(lastG))) units[units.length - 1] = prev + u;
    else units.push(u);
  };
  let wordFirst = '';
  let wordLast = '';
  const flushWord = (): void => {
    if (!word) return;
    push(word, wordFirst);
    lastG = wordLast;
    word = '';
  };
  for (const g of graphemes(para)) {
    if (isSpace(g)) {
      flushWord();
      units.push(g);
      lastG = g;
    } else if (isBreakable(g.codePointAt(0)!)) {
      flushWord();
      push(g, g);
      lastG = g;
    } else {
      if (!word) wordFirst = g;
      word += g;
      wordLast = g;
    }
  }
  flushWord();
  return units;
}

function wrapPara(para: string, maxWidth: number, measure: MeasureFn, lines: string[]): number {
  let widest = 0;
  let line = '';
  let lineW = 0;
  let pending = ''; // spaces that only materialise if more text follows on the line
  let pendingW = 0;
  let first = true; // still on the first line of the paragraph

  const flush = (): void => {
    const w = measure(line);
    if (w > widest) widest = w;
    lines.push(line);
    line = '';
    lineW = 0;
    pending = '';
    pendingW = 0;
    first = false;
  };

  for (const u of tokenize(para)) {
    const uw = measure(u);
    if (isSpace(u)) {
      if (line === '' && !first) continue; // no leading space on wrapped lines
      pending += u;
      pendingW += uw;
      continue;
    }
    if (line !== '' && lineW + pendingW + uw > maxWidth) flush();
    if (uw > maxWidth) {
      // A single unit wider than the line (long URL…): break inside it.
      if (pending) {
        line += pending;
        lineW += pendingW;
        pending = '';
        pendingW = 0;
      }
      for (const g of graphemes(u)) {
        const gw = measure(g);
        if (line !== '' && lineW + gw > maxWidth) flush();
        line += g;
        lineW += gw;
      }
      continue;
    }
    line += pending + u;
    lineW += pendingW + uw;
    pending = '';
    pendingW = 0;
  }
  if (line !== '' || first) flush();
  return widest;
}

/** Wraps `text` (which may contain newlines) to at most `maxWidth`. */
export function wrapText(text: string, maxWidth: number, measure: MeasureFn): TextBlock {
  const lines: string[] = [];
  let width = 0;
  const paras = text.indexOf('\n') < 0 ? [text] : text.split('\n');
  for (const para of paras) {
    const w = measure(para);
    if (w <= maxWidth) {
      lines.push(para);
      if (w > width) width = w;
    } else {
      const pw = wrapPara(para, maxWidth, measure, lines);
      if (pw > width) width = pw;
    }
  }
  return { lines, width };
}

// ------------------------------------------------------------------- search

export interface SearchOpts {
  matchCase: boolean;
  wholeWord: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD_CHAR.test(ch);

/** Start and end of every occurrence of `query` in `text`. */
export function occurrences(text: string, query: string, o: SearchOpts): [number, number][] {
  const out: [number, number][] = [];
  if (!query) return out;
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.matchCase ? 'gu' : 'giu');
  for (const m of text.matchAll(re)) {
    const end = m.index + m[0].length;
    if (!o.wholeWord || (!isWordChar(text[m.index - 1]) && !isWordChar(text[end]))) out.push([m.index, end]);
  }
  return out;
}
