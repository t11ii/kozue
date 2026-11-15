// Marker catalogue. Drawing lives in render/markers.ts.

export interface MarkerGroup {
  id: 'priority' | 'task' | 'flag' | 'symbol' | 'star' | 'people' | 'arrow' | 'object' | 'face';
  items: string[];
  /** Shown in the panel only after "more markers" was opened. */
  more?: boolean;
}

/** Within a group, a topic carries at most one marker. */
export const MARKER_GROUPS: readonly MarkerGroup[] = [
  { id: 'priority', items: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'] },
  { id: 'task', items: ['t0', 't25', 't50', 't75', 'done'] },
  { id: 'flag', items: ['flag-red', 'flag-orange', 'flag-yellow', 'flag-green', 'flag-blue', 'flag-purple', 'flag-gray'] },
  { id: 'symbol', items: ['q', 'ex', 'info', 'x', 'plus', 'minus', 'warn'] },
  { id: 'star', items: ['star', 'star-red', 'star-green', 'star-blue', 'star-purple', 'star-gray'], more: true },
  { id: 'people', items: ['people-red', 'people-orange', 'people-green', 'people-blue', 'people-purple', 'people-gray'], more: true },
  {
    id: 'arrow',
    items: [
      'arrow-up',
      'arrow-up-right',
      'arrow-right',
      'arrow-down-right',
      'arrow-down',
      'arrow-down-left',
      'arrow-left',
      'arrow-up-left',
      'arrow-refresh',
    ],
    more: true,
  },
  { id: 'object', items: ['heart', 'idea', 'pin', 'lock', 'clock', 'calendar', 'money', 'like', 'dislike'], more: true },
  { id: 'face', items: ['face-smile', 'face-laugh', 'face-neutral', 'face-sad', 'face-angry', 'face-surprise'], more: true },
];

export const MARKER_IDS: ReadonlySet<string> = new Set(MARKER_GROUPS.flatMap((g) => g.items));

const GROUP_OF = new Map<string, MarkerGroup>();
for (const g of MARKER_GROUPS) for (const id of g.items) GROUP_OF.set(id, g);

const ORDER = new Map<string, number>();
[...MARKER_IDS].forEach((id, i) => ORDER.set(id, i));

/** Toggles `id`, replacing any other marker of the same group. */
export function toggleMarker(current: readonly string[] | undefined, id: string): string[] | undefined {
  const group = GROUP_OF.get(id);
  if (!group) return current ? current.slice() : undefined;
  const cur = current ?? [];
  const had = cur.includes(id);
  const next = cur.filter((m) => GROUP_OF.get(m) !== group);
  if (!had) next.push(id);
  next.sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
  return next.length ? next : undefined;
}
