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
