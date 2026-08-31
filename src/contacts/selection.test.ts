import { describe, expect, it } from 'vitest';
import {
  adoptFocusQuery,
  cycleIndex,
  focusList,
  moveSelection,
  pickInitialSelection,
  pinSelected,
  settleSelection,
} from './selection';

const ids = ['a', 'b', 'c'];

describe('moveSelection', () => {
  it('steps through the list', () => {
    expect(moveSelection(ids, 'a', 'down')).toBe('b');
    expect(moveSelection(ids, 'b', 'up')).toBe('a');
  });

  it('clamps rather than wrapping, so ArrowUp on the first row stays put', () => {
    expect(moveSelection(ids, 'a', 'up')).toBe('a');
    expect(moveSelection(ids, 'c', 'down')).toBe('c');
  });

  it('enters the list from the matching end when nothing is selected', () => {
    expect(moveSelection(ids, null, 'down')).toBe('a');
    expect(moveSelection(ids, null, 'up')).toBe('c');
  });

  it('re-enters from the end when the selection has vanished from the list', () => {
    expect(moveSelection(ids, 'gone', 'down')).toBe('a');
  });

  it('has nothing to select in an empty list', () => {
    expect(moveSelection([], 'a', 'down')).toBeNull();
  });
});

describe('settleSelection', () => {
  it('keeps a selection that is still on screen', () => {
    expect(settleSelection(ids, 'b')).toBe('b');
  });

  it('falls to the top match when filtering hid the previous pick', () => {
    expect(settleSelection(ids, 'gone')).toBe('a');
    expect(settleSelection(ids, null)).toBe('a');
  });

  it('clears when nothing matches', () => {
    expect(settleSelection([], 'a')).toBeNull();
  });
});

describe('cycleIndex', () => {
  it('wraps, because a two-number contact toggles', () => {
    expect(cycleIndex(2, 0, 'next')).toBe(1);
    expect(cycleIndex(2, 1, 'next')).toBe(0);
    expect(cycleIndex(2, 0, 'previous')).toBe(1);
  });

  it('stays at zero when there is nothing to cycle', () => {
    expect(cycleIndex(0, 0, 'next')).toBe(0);
    expect(cycleIndex(1, 0, 'next')).toBe(0);
  });
});

describe('pinSelected', () => {
  const row = (id: string) => ({ id });
  const all = [row('a'), row('b'), row('c'), row('d')];

  it('leaves the list alone when the selection is already on screen', () => {
    const rows = all.slice(0, 2);
    expect(pinSelected(rows, all, 'b')).toBe(rows);
  });

  it('pulls the selected contact in when the row cap hid it', () => {
    // Opening from root search clears the launcher's query, so the panel
    // paints the first 200 of ~2700 unfiltered contacts. A person further
    // down the alphabet would otherwise lose the highlight to `settleSelection`.
    expect(pinSelected(all.slice(0, 2), all, 'd').map((c) => c.id)).toEqual(['d', 'a', 'b']);
  });

  it('leaves the list alone when nothing is selected', () => {
    const rows = all.slice(0, 2);
    expect(pinSelected(rows, all, null)).toBe(rows);
  });

  it('leaves the list alone when the id belongs to no contact', () => {
    const rows = all.slice(0, 2);
    expect(pinSelected(rows, all, 'gone')).toBe(rows);
  });
});

describe('pickInitialSelection', () => {
  const all = [{ id: 'a' }, { id: 'b' }];

  it('takes the contact the view path asked for', () => {
    expect(pickInitialSelection(all, 'b')).toBe('b');
  });

  it('declines an identifier this address book does not have', () => {
    // The path outlives the index: a contact deleted since the row was built,
    // or a cache from an older read. Falling back to the top row is right.
    expect(pickInitialSelection(all, 'gone')).toBeNull();
  });

  it('declines when the panel was opened any other way', () => {
    expect(pickInitialSelection(all, null)).toBeNull();
  });

  it('declines before the index has arrived, so nothing is claimed early', () => {
    // The whole reason this is a function: `settleSelection` empties the
    // highlight while the list is empty, so a selection set before the
    // contacts land is wiped a frame later.
    expect(pickInitialSelection([], 'b')).toBeNull();
  });
});

describe('focusList', () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('narrows the panel to the one contact that was opened', () => {
    expect(focusList(all, 'b')).toEqual([{ id: 'b' }]);
  });

  it('yields nothing to narrow to when the panel was opened normally', () => {
    expect(focusList(all, null)).toBeNull();
  });

  it('yields nothing when the address book no longer holds that contact', () => {
    expect(focusList(all, 'gone')).toBeNull();
  });
});

describe('adoptFocusQuery', () => {
  it('adopts the query the launcher replays into a freshly opened panel', () => {
    // The panel opens with the text that produced the root-search row still in
    // the bar, and the launcher sends it along. That is not the user typing.
    expect(adoptFocusQuery(null, 'hartmut')).toEqual({ seen: 'hartmut', keepFocus: true });
  });

  it('tolerates the same query arriving twice', () => {
    expect(adoptFocusQuery('hartmut', 'hartmut')).toEqual({ seen: 'hartmut', keepFocus: true });
  });

  it('releases the focus as soon as the query actually changes', () => {
    expect(adoptFocusQuery('hartmut', 'hartmu')).toEqual({ seen: 'hartmu', keepFocus: false });
  });

  it('releases the focus when the query is cleared', () => {
    expect(adoptFocusQuery('hartmut', '')).toEqual({ seen: '', keepFocus: false });
  });
});
