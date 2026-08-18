import { describe, expect, it } from 'vitest';
import { filterContacts } from './search';
import type { Contact } from './types';

function contact(name: string, extra: Partial<Contact> = {}): Contact {
  return {
    id: name,
    name,
    organization: '',
    jobTitle: '',
    nickname: '',
    isOrganization: false,
    hasPhoto: false,
    phones: [],
    emails: [],
    haystack: name.toLowerCase(),
    sortKey: name.toLowerCase(),
    ...extra,
  };
}

const withPhone = (name: string, dial: string): Contact =>
  contact(name, {
    phones: [{ label: 'Mobil', display: dial, dial }],
    haystack: `${name} ${dial}`.toLowerCase(),
  });

describe('filterContacts', () => {
  it('returns the address book untouched for an empty query', () => {
    const list = [contact('Zoe'), contact('Anna')];
    expect(filterContacts(list, '   ')).toBe(list);
  });

  it('ranks a name prefix above a mid-name match', () => {
    const list = [contact('Bernd Ostermann'), contact('Ost Kai')];
    expect(filterContacts(list, 'ost').map((c) => c.name)).toEqual([
      'Ost Kai',
      'Bernd Ostermann',
    ]);
  });

  it('ranks a word start inside the name above a match in another field', () => {
    const list = [
      contact('Sabine Meyer', { haystack: 'sabine meyer ost@example.com' }),
      contact('Kai Osthoff'),
    ];
    expect(filterContacts(list, 'ost').map((c) => c.name)).toEqual([
      'Kai Osthoff',
      'Sabine Meyer',
    ]);
  });

  it('requires every term to match, so a second word narrows', () => {
    const list = [contact('Kai Osthoff'), contact('Kai Schmidt')];
    expect(filterContacts(list, 'kai ost').map((c) => c.name)).toEqual(['Kai Osthoff']);
  });

  it('finds a contact by a dialable number', () => {
    const list = [withPhone('Lieschen', '+491511234567'), contact('Anna')];
    expect(filterContacts(list, '+4915112').map((c) => c.name)).toEqual(['Lieschen']);
  });

  it('prefers someone reachable over a name-only record at the same tier', () => {
    const list = [contact('Meyer Anna'), withPhone('Meyer Bernd', '+49301')];
    expect(filterContacts(list, 'meyer').map((c) => c.name)).toEqual([
      'Meyer Bernd',
      'Meyer Anna',
    ]);
  });

  it('sorts alphabetically once tier and reachability tie', () => {
    const list = [contact('Meyer Zoe'), contact('Meyer Anna')];
    expect(filterContacts(list, 'meyer').map((c) => c.name)).toEqual([
      'Meyer Anna',
      'Meyer Zoe',
    ]);
  });

  it('returns nothing when a term matches nowhere', () => {
    expect(filterContacts([contact('Kai')], 'zzz')).toEqual([]);
  });
});
