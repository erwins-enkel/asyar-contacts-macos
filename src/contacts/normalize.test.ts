// Alle Fixtures hier sind erfunden: Max/Erika Mustermann und Lieschen Müller,
// dazu Rufnummern aus offensichtlichen Ziffernfolgen. Das ist keine Kosmetik —
// eine Erweiterung, die Adressbücher liest, darf beim Testen keine echten
// Personen in ihr eigenes Repository tragen. Die *Struktur* der Nummern ist
// dagegen echt (deutsche Mobilnummer, Festnetz mit Vorwahl, 0049-Schreibweise),
// denn genau die prüfen die Tests.
import { describe, expect, it } from 'vitest';
import { displayName, normalizeAll, normalizeContact, parsePreferredLabels } from './normalize';
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
    expect(displayName(raw({ n: 'Schwiegermutter' }))).toBe('Schwiegermutter');
    expect(displayName(raw({ p: [{ l: 'Mobil', v: '0172 1' }] }))).toBe('0172 1');
    expect(displayName(raw({ e: [{ l: '', v: 'a@b.de' }] }))).toBe('a@b.de');
  });

  it('never renders a blank row', () => {
    expect(displayName(raw())).toBe('Ohne Namen');
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
    expect(contact.phones[0]!.label).toBe('Telefon');
    expect(contact.emails[0]!.label).toBe('E-Mail');
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
    // "müller" must find a contact stored as "Müller".
    expect(contact.haystack).toContain('müller');
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
