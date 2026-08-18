import { describe, expect, it } from 'vitest';
import { collectHelperLines, parseHelperLine } from './protocol';
import type { HelperLine, RawContact } from './types';

const person = (id: string): RawContact => ({
  id, g: 'A', m: '', f: 'B', n: '', o: '', j: '', c: 0, a: 0,
});

describe('parseHelperLine', () => {
  it('parses a protocol line', () => {
    expect(parseHelperLine('{"auth":3}')).toEqual({ auth: 3 });
    expect(parseHelperLine('  {"done":7}  ')).toEqual({ done: 7 });
  });

  it('ignores anything that is not one of our objects', () => {
    // osascript writes the odd unsolicited warning to stdout; a stray line
    // must not abort a load that is otherwise fine.
    expect(parseHelperLine('')).toBeNull();
    expect(parseHelperLine('osascript: some warning')).toBeNull();
    expect(parseHelperLine('[1,2,3]')).toBeNull();
    expect(parseHelperLine('{ broken')).toBeNull();
    expect(parseHelperLine('null')).toBeNull();
  });
});

describe('collectHelperLines', () => {
  it('folds a complete list run', () => {
    const lines: HelperLine[] = [
      { auth: 3 },
      { region: 'DE' },
      { batch: [person('1'), person('2')] },
      { batch: [person('3')] },
      { done: 3 },
    ];
    const outcome = collectHelperLines(lines);
    expect(outcome.auth).toBe(3);
    expect(outcome.region).toBe('DE');
    expect(outcome.contacts.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(outcome.done).toBe(3);
    expect(outcome.error).toBeNull();
  });

  it('reports a run that was cut short before it signed off', () => {
    const outcome = collectHelperLines([{ auth: 3 }, { batch: [person('1')] }]);
    expect(outcome.done).toBeNull();
    expect(outcome.contacts).toHaveLength(1);
  });

  it('surfaces the helper error token alongside the auth status', () => {
    const outcome = collectHelperLines([{ auth: 0 }, { error: 'not_authorized', auth: 0 }]);
    expect(outcome.error).toBe('not_authorized');
    expect(outcome.auth).toBe(0);
  });

  it('distinguishes "no photo" from "never asked"', () => {
    expect(collectHelperLines([{ image: null }]).image).toBeNull();
    expect(collectHelperLines([{ image: 'AAAA' }]).image).toBe('AAAA');
    expect(collectHelperLines([]).image).toBeNull();
  });
});
