// Every fixture here is invented: Max/Erika Mustermann and Lieschen Müller,
// Germany's canonical placeholder people, plus numbers built from obvious digit
// runs. That is not cosmetic — an extension that reads address books must never
// carry real people into its own repository while testing. The *structure* of
// the numbers is real (German mobile, landline with area code, the 0049
// spelling), because that structure is exactly what these tests exercise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERRED_LABELS,
  displayName,
  normalizeAll,
  normalizeContact,
  parsePreferredLabels,
} from './normalize';
import type { NormalizeOptions } from './normalize';
import type { RawContact } from './types';

const DEFAULTS: NormalizeOptions = {
  dialPrefix: '+49',
  preferredLabels: parsePreferredLabels('iPhone, Mobil, Privat, Arbeit'),
  includeOrganizations: true,
};

function raw(overrides: Partial<RawContact> = {}): RawContact {
  return {
    id: 'id-1',
    g: '', m: '', f: '', n: '', o: '', j: '',
    c: 0, a: 0,
    ...overrides,
  };
}

describe('parsePreferredLabels', () => {
  it('lowercases and trims, dropping blanks from a trailing comma', () => {
    expect(parsePreferredLabels(' iPhone , Mobil ,, ')).toEqual(['iphone', 'mobil']);
  });
});

describe('displayName', () => {
  it('joins the parts of a person name', () => {
    expect(displayName(raw({ g: 'Kai', m: 'M.', f: 'Osthoff' }))).toBe('Kai M. Osthoff');
  });

  it('falls back to the organization for a company record', () => {
    expect(displayName(raw({ o: 'Musterfirma GmbH', c: 1 }))).toBe('Musterfirma GmbH');
  });

  it('falls back to a nickname, then to a way of reaching them', () => {
    expect(displayName(raw({ n: 'Mother-in-law' }))).toBe('Mother-in-law');
    expect(displayName(raw({ p: [{ l: 'Mobil', v: '0172 1' }] }))).toBe('0172 1');
    expect(displayName(raw({ e: [{ l: '', v: 'a@b.de' }] }))).toBe('a@b.de');
  });

  it('never renders a blank row', () => {
    expect(displayName(raw())).toBe('No name');
  });
});

describe('normalizeContact', () => {
  it('orders numbers by the label preference, keeping address-book order within a label', () => {
    const contact = normalizeContact(
      raw({
        g: 'Max', f: 'Mustermann',
        p: [
          { l: 'Fax Arbeit', v: '07131/123456' },
          { l: 'Arbeit', v: '00497131123400' },
          { l: 'Arbeit', v: '07195/765432' },
          { l: 'Mobil', v: '0172/1234567' },
        ],
      }),
      DEFAULTS,
    );

    expect(contact.phones.map((p) => p.label)).toEqual([
      'Mobil',
      'Arbeit',
      'Arbeit',
      // "Fax Arbeit" ranks with "Arbeit" via the containment fallback rather
      // than dropping below every unknown label — but after the exact match.
      'Fax Arbeit',
    ]);
    expect(contact.phones[1]!.dial).toBe('+497131123400');
    expect(contact.phones[2]!.dial).toBe('+497195765432');
  });

  it('drops numbers with nothing dialable in them', () => {
    const contact = normalizeContact(
      raw({ g: 'A', p: [{ l: 'Mobil', v: 'keine' }, { l: 'Privat', v: '030 1' }] }),
      DEFAULTS,
    );
    expect(contact.phones).toHaveLength(1);
    expect(contact.phones[0]!.dial).toBe('+49301');
  });

  it('labels an unlabelled number and an unlabelled address', () => {
    const contact = normalizeContact(
      raw({ g: 'A', p: [{ l: '', v: '030 1' }], e: [{ l: '', v: 'a@b.de' }] }),
      DEFAULTS,
    );
    expect(contact.phones[0]!.label).toBe('Phone');
    expect(contact.emails[0]!.label).toBe('Email');
  });

  it('keeps one entry per dialable number, preferring the best-labelled spelling', () => {
    // Seen in a real address book: the same mobile stored once as "+4917…"
    // and once as "004917…". Both normalize to the same number to dial.
    const contact = normalizeContact(
      raw({
        g: 'Erika', f: 'Mustermann',
        p: [
          { l: 'Arbeit', v: '00491701234567' },
          { l: 'Mobil', v: '+491701234567' },
          { l: 'Mobil', v: '+497111234567' },
        ],
      }),
      DEFAULTS,
    );

    expect(contact.phones.map((p) => p.dial)).toEqual([
      '+491701234567',
      '+497111234567',
    ]);
    // The survivor is the one the label preference ranked first, not the one
    // the address book happened to list first.
    expect(contact.phones[0]!.label).toBe('Mobil');
  });

  it('keeps one entry per address, ignoring case', () => {
    const contact = normalizeContact(
      raw({
        g: 'A',
        e: [
          { l: 'Privat', v: 'Kai@Osthoff.blog' },
          { l: 'Arbeit', v: 'kai@osthoff.blog' },
          { l: 'Arbeit', v: 'zweite@osthoff.blog' },
        ],
      }),
      DEFAULTS,
    );
    expect(contact.emails.map((m) => m.address)).toEqual([
      'Kai@Osthoff.blog',
      'zweite@osthoff.blog',
    ]);
  });

  it('indexes both the stored and the dial form of every number', () => {
    const contact = normalizeContact(
      raw({ g: 'Lieschen', f: 'Müller', p: [{ l: 'Mobil', v: '0151 1234567' }] }),
      DEFAULTS,
    );
    expect(contact.haystack).toContain('0151 1234567');
    expect(contact.haystack).toContain('+491511234567');
    expect(contact.haystack).toContain('lieschen');
    // The haystack is lowercased, and umlauts have to survive that — typing
    // "müller" must find a contact stored as "Müller". German address books are
    // the reason this extension exists, so this is not an edge case.
    expect(contact.haystack).toContain('müller');
  });
});

// macOS hands out two things per label: the text it shows the user, which is
// translated, and the name inside `_$!<…>!$_`, which is not. Ordering goes
// through the second, which is what lets four English preferences rank an
// address book in any system language.
describe('ordering by the macOS label key', () => {
  const DEFAULT_ORDER: NormalizeOptions = {
    ...DEFAULTS,
    preferredLabels: parsePreferredLabels(DEFAULT_PREFERRED_LABELS),
  };

  /** The same three numbers as a German and a French Mac emit them. */
  const german = [
    { l: 'Arbeit', k: 'Work', v: '07131/123456' },
    { l: 'Privat', k: 'Home', v: '07195/765432' },
    { l: 'Handy', k: 'Mobile', v: '0172/1234567' },
  ];
  const french = [
    { l: 'travail', k: 'Work', v: '07131/123456' },
    { l: 'domicile', k: 'Home', v: '07195/765432' },
    { l: 'portable', k: 'Mobile', v: '0172/1234567' },
  ];

  it('ranks a German address book with nothing German in the preference', () => {
    const contact = normalizeContact(raw({ g: 'Max', f: 'Mustermann', p: german }), DEFAULT_ORDER);
    expect(contact.phones.map((p) => p.label)).toEqual(['Handy', 'Privat', 'Arbeit']);
  });

  it('ranks a French one identically, still with nothing French in it', () => {
    const contact = normalizeContact(raw({ g: 'Max', f: 'Mustermann', p: french }), DEFAULT_ORDER);
    expect(contact.phones.map((p) => p.label)).toEqual(['portable', 'domicile', 'travail']);
  });

  it('shows the localized label even though the key decided the order', () => {
    const contact = normalizeContact(raw({ g: 'A', p: german }), DEFAULT_ORDER);
    // The row says "Handy" to a German user; "Mobile" never reaches the panel.
    expect(contact.phones[0]!.label).toBe('Handy');
    expect(contact.phones[0]!.dial).toBe('+491721234567');
  });

  it('puts a fax last where the localized text no longer contains "fax"', () => {
    const contact = normalizeContact(
      raw({
        g: 'A',
        p: [
          { l: 'ファックス（勤務先）', k: 'WorkFax', v: '07131/123456' },
          { l: '勤務先', k: 'Work', v: '07195/765432' },
        ],
      }),
      DEFAULT_ORDER,
    );
    // Enter dials the first row, and it must not be the fax machine.
    expect(contact.phones.map((p) => p.dial)).toEqual(['+497195765432', '+497131123456']);
  });

  it('still ranks a label the user typed, which carries no key', () => {
    const contact = normalizeContact(
      raw({
        g: 'A',
        p: [
          { l: 'Arbeit', k: 'Work', v: '07131/123456' },
          { l: 'Handy privat', v: '0172/1234567' },
        ],
      }),
      { ...DEFAULT_ORDER, preferredLabels: parsePreferredLabels('Handy privat, Work') },
    );
    expect(contact.phones[0]!.label).toBe('Handy privat');
  });

  it('leaves a preference stored under the old German-first default working', () => {
    // Nobody's saved setting is rewritten by a new manifest default, so the
    // list that shipped before this change has to keep ordering correctly.
    const contact = normalizeContact(raw({ g: 'A', p: german }), {
      ...DEFAULTS,
      preferredLabels: parsePreferredLabels(
        'iPhone, Mobile, Mobil, Handy, Home, Privat, Work, Arbeit',
      ),
    });
    expect(contact.phones.map((p) => p.label)).toEqual(['Handy', 'Privat', 'Arbeit']);
  });
});

describe('DEFAULT_PREFERRED_LABELS', () => {
  it('is what the manifest declares, so the fallback is a working configuration', () => {
    // The view and the worker fall back to the constant when
    // `preferences.refresh()` rejects. If it drifted from the manifest, that
    // fallback would quietly order numbers differently than the setting says.
    const manifest = JSON.parse(
      readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'),
    ) as { preferences: { name: string; default: string }[] };
    const declared = manifest.preferences.find((p) => p.name === 'preferredLabels');

    expect(declared?.default).toBe(DEFAULT_PREFERRED_LABELS);
  });
});

describe('normalizeAll', () => {
  const people = [
    raw({ id: 'p', g: 'Kai', f: 'Osthoff' }),
    raw({ id: 'o', o: 'Musterfirma GmbH', c: 1 }),
  ];

  it('keeps organizations when asked to', () => {
    expect(normalizeAll(people, DEFAULTS).map((c) => c.id)).toEqual(['p', 'o']);
  });

  it('drops them when not', () => {
    const result = normalizeAll(people, { ...DEFAULTS, includeOrganizations: false });
    expect(result.map((c) => c.id)).toEqual(['p']);
  });
});
