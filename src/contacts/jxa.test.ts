// `jxa.ts` is a string handed to `osascript`, so the TypeScript build never
// looks inside it and no test here can run it — the Contacts framework is on
// the other side of a macOS boundary this suite does not cross.
//
// One thing can be checked without a Mac, and it is the mistake that is easy
// to make while editing: the script is one `String.raw` template, so a single
// backtick in a comment ends it early, and any typo turns the helper into a
// syntax error. On a Mac that shows up as an empty panel and a timeout in the
// log, pointing at the launcher rather than at this file.
import { describe, expect, it } from 'vitest';
import { CONTACTS_JXA, helperArgs } from './jxa';

describe('CONTACTS_JXA', () => {
  it('is syntactically valid JavaScript', () => {
    // `new Function` parses without executing, which is all that is wanted:
    // running it would immediately reach for the ObjC bridge.
    expect(() => new Function(CONTACTS_JXA)).not.toThrow();
  });

  it('still starts with the comment that keeps the run label readable', () => {
    // Asyar labels every spawn with `program + args` truncated to 100
    // characters, and those runs surface in the launcher's search results.
    expect(CONTACTS_JXA.startsWith('// Asyar · Contacts')).toBe(true);
  });

  it('hands the whole script to osascript as one -e argument', () => {
    expect(helperArgs('list')).toEqual(['-l', 'JavaScript', '-e', CONTACTS_JXA, 'list']);
  });
});
