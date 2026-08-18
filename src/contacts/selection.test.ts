import { describe, expect, it } from 'vitest';
import { cycleIndex, moveSelection, settleSelection } from './selection';

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
