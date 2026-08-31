// Selection arithmetic for the highlighted row and the highlighted number.
//
// The highlight is virtual state, not DOM focus. Calling `.focus()` on a row
// would take focus off the launcher's search bar and stop the typing that
// feeds the filter — so the panel tracks an id and paints it, and never moves
// the caret.

/** Move the highlight one step, clamping at both ends rather than wrapping.
 *  Wrapping in a 2700-row list means ArrowUp on the first row jumps to the
 *  bottom of the address book, which reads as a bug. */
export function moveSelection(
  ids: readonly string[],
  current: string | null,
  direction: 'up' | 'down',
): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return direction === 'down' ? ids[0]! : ids[ids.length - 1]!;
  const next = direction === 'down' ? index + 1 : index - 1;
  if (next < 0 || next >= ids.length) return current;
  return ids[next]!;
}

/** Keep the highlight on a row that is actually on screen: the top one when
 *  the list first loads, or when filtering has hidden the previous pick. That
 *  is what makes the panel a one-keystroke jump — type, press Enter, call the
 *  top match — without touching the arrow keys. */
export function settleSelection(
  ids: readonly string[],
  current: string | null,
): string | null {
  if (ids.length === 0) return null;
  if (current !== null && ids.includes(current)) return current;
  return ids[0]!;
}

/** Step through a contact's own numbers. This one *does* wrap: the lists are
 *  two or three long, and wrapping is how a two-number contact toggles. */
export function cycleIndex(
  length: number,
  current: number,
  direction: 'next' | 'previous',
): number {
  if (length <= 0) return 0;
  const step = direction === 'next' ? 1 : -1;
  return (((current + step) % length) + length) % length;
}

/**
 * Keep the highlighted row on screen even when the row cap would have hidden it.
 *
 * The panel paints at most `MAX_ROWS` of the match set. That is fine while the
 * user is typing, and in practice a panel opened from root search arrives still
 * filtered by the query that produced the row — the launcher clears
 * `searchStores.query` but keeps the search bar's own `localSearchValue`, which
 * is what feeds a searchable view. This is the guard for when it does not: with
 * an empty filter the panel shows the first 200 of some 2700 contacts, a person
 * further down the alphabet is not among them, and `settleSelection` would find
 * the highlight off-screen and drop it to the top row.
 *
 * So the chosen one is pulled to the front. Returns the original array
 * unchanged whenever it already contains the selection, so the common case
 * allocates nothing and the reactive derivation does not churn.
 */
export function pinSelected<T extends { id: string }>(
  rows: readonly T[],
  all: readonly T[],
  selectedId: string | null,
): readonly T[] {
  if (selectedId === null) return rows;
  if (rows.some((row) => row.id === selectedId)) return rows;
  const pinned = all.find((row) => row.id === selectedId);
  return pinned === undefined ? rows : [pinned, ...rows];
}

/**
 * The contact a freshly opened panel should start on, or `null` for the top row.
 *
 * Called at the moment the index is applied, never before. `settleSelection`
 * empties the highlight whenever the list is empty, so a selection set while
 * the panel is still loading is wiped one frame later — which is exactly what
 * made an identifier arriving in the view path look like it was ignored.
 * Applying it together with the contacts closes that window.
 */
export function pickInitialSelection<T extends { id: string }>(
  contacts: readonly T[],
  wanted: string | null,
): string | null {
  if (wanted === null || contacts.length === 0) return null;
  return contacts.some((contact) => contact.id === wanted) ? wanted : null;
}

/**
 * The single row a panel opened from root search should show.
 *
 * Picking a person in the launcher is a decision, not a search: the panel that
 * follows shows that person, not the four others whose names also contain
 * "hartmut". Returns `null` when there is nothing to narrow to — the panel was
 * opened normally, or the identifier no longer matches anyone — and the caller
 * falls back to the ordinary query filter.
 */
export function focusList<T extends { id: string }>(
  all: readonly T[],
  focusedId: string | null,
): readonly T[] | null {
  if (focusedId === null) return null;
  const one = all.find((item) => item.id === focusedId);
  return one === undefined ? null : [one];
}

/**
 * Decide whether a focused panel survives an incoming query.
 *
 * The launcher replays the text that produced the root-search row into the
 * panel's search bar, so the first query to arrive is not someone typing — it
 * is the query that *led here*, and dropping the focus on it would undo the
 * narrowing before it was ever seen. So the first one is adopted, and the focus
 * ends at the first query that differs from it: at that point the user is
 * searching again and wants the whole address book back.
 */
export function adoptFocusQuery(
  seen: string | null,
  incoming: string,
): { seen: string; keepFocus: boolean } {
  if (seen === null) return { seen: incoming, keepFocus: true };
  return { seen: incoming, keepFocus: incoming === seen };
}
