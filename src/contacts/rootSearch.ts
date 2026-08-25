// ─────────────────────────────────────────────────────────────────────────
// Contacts in Asyar's *root* search, before any panel is open.
//
// Two jobs, and the second one is the reason this file exists at all.
//
//   1. Surface matching people directly. Typing a name in the launcher should
//      offer the person, not a command that then offers the person.
//
//   2. Make the extension findable in the user's own language. Asyar's command
//      search matches a command's `name` and nothing else (verified in
//      `search_engine/models.rs`: `SearchableItem::Command(c) => vec![c.name]`).
//      `trigger` is stored but never matched, and commands have no `keywords`
//      field. So on a German macOS — where the Contacts app is called
//      "Kontakte" — a command named "Search Contacts" is invisible to someone
//      typing what they see on screen. Rather than bend the command name into
//      something bilingual and awkward, the keyword list below answers for it.
//
// Everything here is pure: it returns plain data, no closures. The launcher
// rebuilds each result across `postMessage` and drops functions on the way, so
// `action` is meaningless here — navigation goes through `viewPath`, and
// anything else through `actionId` + `actionPayload`.
//
// The whole round is capped at 200 ms by the launcher, which is why the caller
// holds the index in memory and this function only ever scans it.
// ─────────────────────────────────────────────────────────────────────────

import { filterContacts } from './search';
import type { Contact } from './types';

/** Words that should offer "open the contacts panel", across the languages a
 *  macOS user is likely to be reading their own address book in. Matched as
 *  prefixes, so "kontak" and "adress" hit too. */
const PANEL_KEYWORDS = [
  // English
  'contact', 'address book', 'addressbook', 'phone book', 'phonebook',
  // German — the case that prompted this
  'kontakt', 'adressbuch', 'telefonbuch', 'rufnummer', 'telefon',
  // A few more that cost nothing
  'contatti', 'contacto', 'contactos', 'kontakter', 'contacten', 'annuaire',
];

/** Below this, a query is too vague to be worth answering: two letters would
 *  match a large slice of any address book and bury the launcher's own
 *  results. The panel itself has no such floor — there the user has already
 *  said what they want. */
const MIN_QUERY = 3;

/** Root search is a shared surface. Even a perfect match set should not push
 *  the user's apps and commands off the screen. */
const MAX_CONTACTS = 6;

export interface RootResult {
  score: number;
  title: string;
  subtitle?: string;
  type: 'result' | 'view';
  icon?: string;
  viewPath?: string;
  actionId?: string;
  actionPayload?: unknown;
}

export interface CallPayload {
  /** E.164 where we could get there; whatever was stored otherwise. */
  dial: string;
  /** Only for the confirmation toast — the handler never re-derives from it. */
  name: string;
}

export function matchesPanelKeyword(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_QUERY) return false;
  return PANEL_KEYWORDS.some((word) => word.startsWith(q) || q.startsWith(word));
}

/**
 * Results for one root-search query.
 *
 * `viewPath` on the panel entry is what the launcher navigates to; contact rows
 * carry `actionId: 'search-call'` so Enter dials without opening anything.
 * Contacts with no dialable number are dropped rather than offered — a row
 * whose primary action cannot run is worse than no row.
 */
export function buildRootResults(
  contacts: readonly Contact[],
  query: string,
  extensionId: string,
): RootResult[] {
  const q = query.trim();
  const results: RootResult[] = [];

  if (matchesPanelKeyword(q)) {
    results.push({
      // Above the contact rows: someone typing "kontakte" is asking for the
      // address book, not for a person whose name happens to contain it.
      score: 0.95,
      title: 'Search Contacts',
      subtitle: 'Browse your macOS address book',
      type: 'view',
      icon: '📇',
      viewPath: `${extensionId}/ContactsView`,
    });
  }

  if (q.length >= MIN_QUERY && contacts.length > 0) {
    const matched = filterContacts(contacts as Contact[], q)
      .filter((contact) => contact.phones.length > 0)
      .slice(0, MAX_CONTACTS);

    matched.forEach((contact, index) => {
      const phone = contact.phones[0]!;
      results.push({
        // Descending inside our own set, well under the panel entry so the
        // ordering we intend survives the launcher's merge.
        score: 0.9 - index * 0.05,
        title: contact.name,
        subtitle: `${phone.label} · ${phone.display}`,
        type: 'result',
        icon: '📞',
        actionId: 'search-call',
        actionPayload: { dial: phone.dial, name: contact.name } satisfies CallPayload,
      });
    });
  }

  return results;
}

/** Narrow an unknown payload arriving from the host back to `CallPayload`. It
 *  has crossed `postMessage` and a JSON round trip, so nothing about its shape
 *  is guaranteed by the type system. */
export function parseCallPayload(payload: unknown): CallPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = payload as Partial<CallPayload>;
  if (typeof candidate.dial !== 'string' || candidate.dial === '') return null;
  return { dial: candidate.dial, name: typeof candidate.name === 'string' ? candidate.name : '' };
}
