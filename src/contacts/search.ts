// ─────────────────────────────────────────────────────────────────────────
// Filtering and ranking the contact list against the launcher's search bar.
//
// Substring matching, not fuzzy. In an address book the query is almost
// always a name the user already knows how to spell, and fuzzy matching in a
// list this size mostly produces confident-looking wrong answers — which, on
// a panel whose Enter key places a phone call, is the expensive kind of
// wrong.
// ─────────────────────────────────────────────────────────────────────────

import type { Contact } from './types';

/** Highest tier wins. Kept as explicit numbers so the ordering is readable at
 *  the comparison site rather than implied by enum declaration order. */
const TIER = {
  namePrefix: 0,
  nameWordStart: 1,
  nameSubstring: 2,
  otherField: 3,
} as const;

function tierFor(contact: Contact, needle: string): number | null {
  const name = contact.sortKey;
  if (name.startsWith(needle)) return TIER.namePrefix;
  // A word boundary inside the name: "ost" should rank "Kai Osthoff" above a
  // contact who merely has "ost" somewhere in an email address.
  if (name.includes(` ${needle}`)) return TIER.nameWordStart;
  if (name.includes(needle)) return TIER.nameSubstring;
  if (contact.haystack.includes(needle)) return TIER.otherField;
  return null;
}

/** Every term must match somewhere, so "kai ost" narrows rather than widens.
 *  The tier reported is the best any single term achieved — a query whose
 *  first term hits the name should not be demoted because its second term
 *  only matched a phone number. */
function scoreAllTerms(contact: Contact, terms: string[]): number | null {
  let best: number | null = null;
  for (const term of terms) {
    const tier = tierFor(contact, term);
    if (tier === null) return null;
    if (best === null || tier < best) best = tier;
  }
  return best;
}

/**
 * Contacts matching `query`, best first.
 *
 * An empty query returns everything in the address book's own order, which is
 * already sorted the way the user sorts Contacts.app — a freshly opened panel
 * should look like the app it mirrors, not like a search result page.
 */
export function filterContacts(contacts: Contact[], query: string): Contact[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return contacts;

  const scored: Array<{ contact: Contact; tier: number; index: number }> = [];
  contacts.forEach((contact, index) => {
    const tier = scoreAllTerms(contact, terms);
    if (tier !== null) scored.push({ contact, tier, index });
  });

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Someone you can actually call outranks a name-only record at the same
    // tier — this panel exists to place calls.
    const aReachable = a.contact.phones.length > 0 ? 0 : 1;
    const bReachable = b.contact.phones.length > 0 ? 0 : 1;
    if (aReachable !== bReachable) return aReachable - bReachable;
    if (a.contact.sortKey !== b.contact.sortKey) {
      return a.contact.sortKey < b.contact.sortKey ? -1 : 1;
    }
    return a.index - b.index;
  });

  return scored.map((entry) => entry.contact);
}
