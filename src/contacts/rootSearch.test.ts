import { describe, expect, it } from 'vitest';
import { buildRootResults, matchesPanelKeyword } from './rootSearch';
import type { Contact } from './types';

const EXT = 'dev.erwins-enkel.contacts';

function contact(name: string, dial = '+491721234567'): Contact {
  return {
    id: name,
    name,
    organization: '',
    jobTitle: '',
    nickname: '',
    isOrganization: false,
    hasPhoto: false,
    phones: dial === '' ? [] : [{ label: 'Mobile', display: dial, dial }],
    emails: [],
    haystack: `${name} ${dial}`.toLowerCase(),
    sortKey: name.toLowerCase(),
  };
}

describe('matchesPanelKeyword', () => {
  it('answers for the word a German user actually types', () => {
    // The whole reason this exists: Asyar matches a command by its `name`
    // only, so "Search Contacts" is invisible to someone reading "Kontakte"
    // on their own screen.
    expect(matchesPanelKeyword('kontakte')).toBe(true);
    expect(matchesPanelKeyword('kont')).toBe(true);
    expect(matchesPanelKeyword('adressbuch')).toBe(true);
    expect(matchesPanelKeyword('telefonbuch')).toBe(true);
  });

  it('answers in English too', () => {
    expect(matchesPanelKeyword('contacts')).toBe(true);
    expect(matchesPanelKeyword('address book')).toBe(true);
  });

  it('ignores queries too short to mean anything', () => {
    expect(matchesPanelKeyword('ko')).toBe(false);
    expect(matchesPanelKeyword('')).toBe(false);
  });

  it('does not fire on an unrelated word', () => {
    expect(matchesPanelKeyword('calculator')).toBe(false);
  });
});

describe('buildRootResults', () => {
  const people = [
    contact('Erika Mustermann'),
    contact('Max Mustermann', '+497131123456'),
    contact('Lieschen Müller', '+491511234567'),
  ];

  it('offers the panel for a keyword query, ranked above any people', () => {
    const results = buildRootResults(people, 'kontakte', EXT);
    expect(results[0]!.type).toBe('view');
    expect(results[0]!.viewPath).toBe(`${EXT}/ContactsView`);
    expect(results[0]!.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('offers matching people with a dialable number', () => {
    const results = buildRootResults(people, 'mustermann', EXT);
    expect(results.map((r) => r.title)).toEqual(['Erika Mustermann', 'Max Mustermann']);
  });

  it('opens the contact rather than dialling it', () => {
    // Enter is the launcher's only key on a result row — it carries no
    // modifier the extension could see — so it may not place a call. The row
    // navigates, and carries the identifier so the panel opens on the person.
    const results = buildRootResults(people, 'mustermann', EXT);
    expect(results[0]!.viewPath).toBe(`${EXT}/ContactsView?id=Erika%20Mustermann`);
  });

  it('percent-encodes the identifier, which macOS builds with a colon in it', () => {
    // A CNContact identifier looks like "<uuid>:ABPerson". The launcher pastes
    // the view path into an iframe URL without encoding anything, so the row
    // has to arrive already safe.
    const withColon = { ...contact('Erika Mustermann'), id: 'AB-12:ABPerson' };
    const results = buildRootResults([withColon], 'mustermann', EXT);
    expect(results[0]!.viewPath).toBe(`${EXT}/ContactsView?id=AB-12%3AABPerson`);
  });

  it('carries no actionId — the launcher never runs one on a search result', () => {
    // searchResultMapper checks the host-side `action` closure first, and
    // extensionSearchAggregator attaches one to every Tier 2 result. An
    // actionId here would look like it worked and never fire.
    const results = buildRootResults(people, 'mustermann', EXT);
    expect(results[0]!.actionId).toBeUndefined();
  });

  it('shows the number it would dial, even though Enter no longer dials it', () => {
    const results = buildRootResults(people, 'mustermann', EXT);
    expect(results[0]!.subtitle).toBe('Mobile · +491721234567');
  });

  it('drops people with no number — a row whose Enter cannot run is worse than none', () => {
    const results = buildRootResults([contact('Nameless', '')], 'nameless', EXT);
    expect(results).toEqual([]);
  });

  it('stays quiet on a query too short to narrow anything', () => {
    expect(buildRootResults(people, 'mu', EXT)).toEqual([]);
  });

  it('caps how much of the launcher it takes over', () => {
    const many = Array.from({ length: 30 }, (_, i) => contact(`Muster ${i}`));
    expect(buildRootResults(many, 'muster', EXT)).toHaveLength(6);
  });

  it('answers with nothing when the index has not been built yet', () => {
    expect(buildRootResults([], 'mustermann', EXT)).toEqual([]);
  });

  it('still offers the panel when the index is empty', () => {
    // First run: nothing cached, but "kontakte" must still lead somewhere.
    const results = buildRootResults([], 'kontakte', EXT);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('view');
  });

  it('scores its own rows in descending order', () => {
    const results = buildRootResults(people, 'muster', EXT);
    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});

