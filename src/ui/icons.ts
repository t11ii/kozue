// Line icons (20×20 grid, drawn with the current text color).

const svg = (body: string): string =>
  '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Mirrors an icon body left-to-right / top-to-bottom. */
const flipH = (body: string): string => `<g transform="translate(20 0) scale(-1 1)">${body}</g>`;
const flipV = (body: string): string => `<g transform="translate(0 20) scale(1 -1)">${body}</g>`;

const MAP =
  '<rect x="7" y="7.75" width="6" height="4.5" rx="1.3"/><path d="M7 10H5M13 10h2M5 6v8M15 6v8M5 6H2.5M5 14H2.5M15 6h2.5M15 14h2.5"/>';
const LOGIC = '<rect x="2.5" y="7.75" width="6" height="4.5" rx="1.3"/><path d="M8.5 10H11M11 5v10M11 5h6.5M11 10h6.5M11 15h6.5"/>';
const ORG =
  '<rect x="7" y="2.75" width="6" height="4.5" rx="1.3"/><path d="M10 7.25V10M4.5 12.5V10h11v2.5M10 10v2.5"/>' +
  '<path d="M3 13h3v3H3zM8.5 13h3v3h-3zM14 13h3v3h-3z"/>';
const FISHBONE =
  '<rect x="2" y="8" width="4" height="4" rx="1.3"/><path d="M6 10h11.5M9 10l2.2-5M13.5 10l2.2-5M9 10l2.2 5M13.5 10l2.2 5"/>';

export const icons = {
  menu: svg('<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>'),
  undo: svg('<path d="M7.5 4.5 4 8l3.5 3.5"/><path d="M4 8h7.5a4 4 0 0 1 0 8H9"/>'),
  redo: svg('<path d="M12.5 4.5 16 8l-3.5 3.5"/><path d="M16 8H8.5a4 4 0 0 0 0 8H11"/>'),
  topic: svg(
    '<rect x="7.5" y="3" width="9.5" height="5.5" rx="1.6"/><rect x="7.5" y="11.5" width="9.5" height="5.5" rx="1.6"/>' +
      '<path d="M7.5 5.75H5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h2.5"/>',
  ),
  subtopic: svg(
    '<rect x="2.5" y="3.5" width="8.5" height="5.5" rx="1.6"/><rect x="9.5" y="11" width="8" height="5.5" rx="1.6"/>' +
      '<path d="M5.5 9v3.25a1.5 1.5 0 0 0 1.5 1.5h2.5"/>',
  ),
  search: svg('<circle cx="9" cy="9" r="5"/><path d="m13 13 3.5 3.5"/>'),
  format: svg('<path d="M3.5 6h5M13 6h3.5M3.5 14h3M11.5 14h5"/><circle cx="10.5" cy="6" r="2"/><circle cx="9" cy="14" r="2"/>'),
  plus: svg('<path d="M10 4.5v11M4.5 10h11"/>'),
  minus: svg('<path d="M4.5 10h11"/>'),
  fit: svg(
    '<path d="M3.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2M13 3.5h2A1.5 1.5 0 0 1 16.5 5v2M16.5 13v2a1.5 1.5 0 0 1-1.5 1.5h-2M7 16.5H5A1.5 1.5 0 0 1 3.5 15v-2"/>' +
      '<rect x="7" y="7.5" width="6" height="5" rx="1"/>',
  ),
  close: svg('<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>'),
  chevronRight: svg('<path d="m8 5 5 5-5 5"/>'),
  chevronUp: svg('<path d="m5 12.5 5-5 5 5"/>'),
  chevronDown: svg('<path d="m5 7.5 5 5 5-5"/>'),
  check: svg('<path d="m4.5 10.5 3.5 3.5 7.5-8"/>'),
  external: svg(
    '<path d="M8.5 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h8a1.5 1.5 0 0 0 1.5-1.5v-2.5M11.5 4.5h4v4M15.5 4.5 9.5 10.5"/>',
  ),
  relationship: svg(
    '<path d="M5.2 13.6C5.6 8.2 10 5.6 14.6 7"/><path d="m12.4 4.6 2.4 2.5-3 1.6"/>' +
      '<circle cx="5" cy="15" r="1.6" fill="currentColor" stroke="none"/>',
  ),
  boundary: svg('<rect x="3" y="4.5" width="14" height="11" rx="3.2" stroke-dasharray="2.7 2.5"/><path d="M7 10h6"/>'),
  summary: svg(
    '<path d="M4.5 4.5h3M4.5 10h3M4.5 15.5h3"/>' +
      '<path d="M9.5 4c1.4 0 1.9.7 1.9 2v2.3c0 1 .6 1.7 1.6 1.7-1 0-1.6.7-1.6 1.7V14c0 1.3-.5 2-1.9 2"/><path d="M14.6 10h2.4"/>',
  ),
  todo: svg('<rect x="4" y="4" width="12" height="12" rx="3.2"/><path d="m7.1 10.2 2.1 2.1 3.8-4.4"/>'),
  label: svg(
    '<path d="M3.5 9.9V5a1.5 1.5 0 0 1 1.5-1.5h4.9a1.5 1.5 0 0 1 1 .4l5.2 5.2a1.5 1.5 0 0 1 0 2.1l-4.9 4.9a1.5 1.5 0 0 1-2.1 0L3.9 10.9a1.5 1.5 0 0 1-.4-1z"/>' +
      '<circle cx="7.2" cy="7.2" r="1.1"/>',
  ),
  focus: svg('<circle cx="10" cy="10" r="2.4"/><path d="M10 2.8v2.6M10 14.6v2.6M2.8 10h2.6M14.6 10h2.6"/>'),
  filter: svg('<path d="M3.5 5h13l-5 6v4.2l-3-1.4V11z"/>'),
  swap: svg('<path d="M4 7h11.5M12.5 4l3 3-3 3M16 13H4.5M7.5 10l-3 3 3 3"/>'),
  reset: svg('<path d="M4.5 10a5.5 5.5 0 1 0 1.7-4"/><path d="M4.2 3.4v3h3"/>'),
  jump: svg('<path d="M4 4v4.5a3 3 0 0 0 3 3h8.5"/><path d="m12 8 3.5 3.5L12 15"/>'),
  present: svg(
    '<rect x="2.5" y="3.5" width="15" height="10" rx="1.6"/><path d="M10 13.5v3M6.5 16.5h7"/><path d="m8.6 6.6 3.4 1.9-3.4 1.9z" fill="currentColor"/>',
  ),
  chevronLeft: svg('<path d="m12 5-5 5 5 5"/>'),
  star: svg('<path d="m10 3.2 2 4.3 4.6.6-3.4 3.2.9 4.6L10 13.6l-4.1 2.3.9-4.6L3.4 8.1 8 7.5z"/>'),
  strike: svg(
    '<path d="M3.5 10h13"/><path d="M13.4 6.6C13 5.3 11.7 4.5 10 4.5c-2 0-3.4 1-3.4 2.6 0 .8.4 1.5 1.1 1.9M6.4 13.2c.4 1.4 1.8 2.3 3.6 2.3 2.1 0 3.6-1.1 3.6-2.8 0-.3 0-.5-.1-.7"/>',
  ),
  copyStyle: svg(
    '<rect x="3.5" y="3.5" width="9" height="5" rx="1.3"/><path d="M12.5 6h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-3.5a1.5 1.5 0 0 0-1.5 1.5v.5"/>' +
      '<rect x="8.8" y="12" width="2.4" height="5" rx=".8"/>',
  ),
  levels: svg(
    '<rect x="3" y="8" width="4" height="4" rx="1.1"/><path d="M7 10h3M10 5v10M10 5h2.5M10 10h2.5M10 15h2.5"/><path d="M13 3.8h4v2.4h-4zM13 8.8h4v2.4h-4zM13 13.8h4v2.4h-4z"/>',
  ),
  shapeRounded: svg('<rect x="3" y="5.5" width="14" height="9" rx="3"/>'),
  shapeRect: svg('<rect x="3" y="5.5" width="14" height="9"/>'),
  shapePill: svg('<rect x="2.5" y="6" width="15" height="8" rx="4"/>'),
  shapeEllipse: svg('<ellipse cx="10" cy="10" rx="7.3" ry="4.8"/>'),
  shapeDiamond: svg('<path d="M10 4.2 17.5 10 10 15.8 2.5 10z"/>'),
  shapeUnderline: svg('<path d="M5.5 9h9" stroke-opacity=".45"/><path d="M3 13.5h14"/>'),
  shapeNone: svg('<path d="M5 8h10M5 12h6.5" stroke-opacity=".7"/>'),
  trash: svg('<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6M8.6 8.6v4.4M11.4 8.6v4.4"/>'),
  structMap: svg(MAP),
  structLogic: svg(LOGIC),
  structLogicLeft: svg(flipH(LOGIC)),
  structBrace: svg(
    '<rect x="2.5" y="7.75" width="5" height="4.5" rx="1.3"/><path d="M13 4.5c-1.5 0-2 .7-2 2v1.8c0 1-.6 1.7-1.7 1.7 1.1 0 1.7.7 1.7 1.7v1.8c0 1.3.5 2 2 2"/>' +
      '<path d="M15 5.5h2.5M15 10h2.5M15 14.5h2.5"/>',
  ),
  structOrg: svg(ORG),
  structOrgUp: svg(flipV(ORG)),
  structOrgTree: svg(
    '<rect x="7" y="2.5" width="6" height="4" rx="1.2"/><path d="M10 6.5v2M5.5 10.5v-2h9v2"/>' +
      '<rect x="3" y="10.5" width="5" height="3" rx="1"/><rect x="12" y="10.5" width="5" height="3" rx="1"/>' +
      '<path d="M4.5 13.5V17H7M13.5 13.5V17H16"/>',
  ),
  structTree: svg('<rect x="2.5" y="2.5" width="7" height="4" rx="1.2"/><path d="M4.5 6.5V16h3M4.5 11h3M10 11h7.5M10 16h7.5"/>'),
  structTimeline: svg(
    '<path d="M2 10h14.5M14.5 8l2 2-2 2M5 8.5V5h3.5M10.5 11.5V15H14"/>' +
      '<circle cx="5" cy="10" r="1.4" fill="currentColor"/><circle cx="10.5" cy="10" r="1.4" fill="currentColor"/>',
  ),
  structTimelineV: svg(
    '<path d="M10 2v14.5M8 14.5l2 2 2-2M11.5 5h4M8.5 10.5h-4"/>' +
      '<circle cx="10" cy="5" r="1.4" fill="currentColor"/><circle cx="10" cy="10.5" r="1.4" fill="currentColor"/>',
  ),
  structFishbone: svg(FISHBONE),
  structFishboneRight: svg(flipH(FISHBONE)),
} as const;

/** App logo: a twig with three shoots. */
export const logo =
  '<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
  '<defs><linearGradient id="kz" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>' +
  '<rect x="4" y="4" width="56" height="56" rx="14" fill="url(#kz)"/>' +
  '<g fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round">' +
  '<path d="M20 32c10 0 9-12 20-12"/><path d="M20 32h22"/><path d="M20 32c10 0 9 12 20 12"/></g>' +
  '<circle cx="20" cy="32" r="5.2" fill="#fff"/><circle cx="43" cy="20" r="3.6" fill="#fff"/>' +
  '<circle cx="45" cy="32" r="3.6" fill="#fff"/><circle cx="43" cy="44" r="3.6" fill="#fff"/></svg>';
