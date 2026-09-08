// ─────────────────────────────────────────────────────────────────────────
// Raw helper records → the rows the panel renders.
//
// Everything expensive happens exactly once, here, at load: the display name,
// the dial forms, the label ordering and the search haystack. Filtering then
// runs on a flat lowercase string per contact, which is what keeps a ~2700
// row list responsive on every keystroke of the launcher's search bar.
// ─────────────────────────────────────────────────────────────────────────

import { normalizeDial } from './phone';
import type { Contact, EmailAddress, PhoneNumber, RawContact } from './types';

export interface NormalizeOptions {
  /** From `resolveDialPrefix()` — `"+49"`, or `''` to leave numbers as stored. */
  dialPrefix: string;
  /** Lowercased label preferences, most-wanted first. See `parsePreferredLabels`. */
  preferredLabels: string[];
  /** When false, records macOS marks as organizations are dropped. */
  includeOrganizations: boolean;
}

/** The `preferredLabels` default, mirrored from `manifest.json`.
 *
 *  Four English words are enough because ranking goes through the label *key*
 *  (`_$!<Mobile>!$_`), not the localized text — see `labelRank`. The view and
 *  the worker fall back to this when `preferences.refresh()` rejects, which is
 *  the permission case `diagnose.ts` handles; a test holds it against the
 *  manifest so the two cannot drift apart again. */
export const DEFAULT_PREFERRED_LABELS = 'iPhone, Mobile, Home, Work';

/** `"iPhone, Mobil, Privat"` → `["iphone", "mobil", "privat"]`. Blank entries
 *  are dropped so a trailing comma cannot create an empty rule that matches
 *  every unlabelled number. */
export function parsePreferredLabels(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
}

/** Where a label sorts. Lower is dialled first.
 *
 *  The label arrives twice: `key` is what macOS calls it in every language
 *  ("Mobile"), `label` is what it shows the user ("Handy" on a German Mac,
 *  "Portable" on a French one). The key is asked first, which is the whole
 *  reason the preference can be four English words and still order a
 *  Portuguese address book correctly. Labels the user typed have no key, and
 *  for those the text is still the only thing there is.
 *
 *  Exact preference match wins outright. A containment match ("Fax Arbeit"
 *  against a preference for "Arbeit") lands half a step below its exact
 *  counterpart, so a work phone always outranks the work fax rather than
 *  tying with it and losing on address-book order. Unknown labels sort after
 *  every known one, keeping their relative order.
 *
 *  Fax goes last unconditionally, ahead of nothing. This panel's Enter key
 *  places a call, and a fax machine is the one number in an address book that
 *  must never be the default. `_$!<HomeFax>!$_` says so in Japanese too, where
 *  the localized text no longer contains the word. */
function labelRank(label: string, key: string | undefined, preferred: string[]): number {
  const canonical = (key ?? '').trim().toLowerCase();
  const needle = label.trim().toLowerCase();
  const unknown = preferred.length;

  if (canonical.includes('fax') || needle.includes('fax')) return unknown + 2;
  if (canonical === '' && needle === '') return unknown;

  // The key is matched exactly and never by containment: "homefax" must not
  // half-match a preference for "home", and the fax rule above has already
  // taken every case where it would.
  const byKey = canonical === '' ? -1 : preferred.indexOf(canonical);
  if (byKey !== -1) return byKey;

  const exact = preferred.indexOf(needle);
  if (exact !== -1) return exact;

  const partial = preferred.findIndex((p) => needle.includes(p));
  return partial === -1 ? unknown : partial + 0.5;
}

function fullName(raw: RawContact): string {
  return [raw.g, raw.m, raw.f].map((part) => part.trim()).filter(Boolean).join(' ');
}

/** What the row shows as its title. A person's name wins; a company record
 *  falls back to the organization, then the nickname, and finally to the
 *  first way of reaching them so a row is never blank. */
export function displayName(raw: RawContact): string {
  const person = fullName(raw);
  if (person !== '') return person;
  if (raw.o.trim() !== '') return raw.o.trim();
  if (raw.n.trim() !== '') return raw.n.trim();
  const firstPhone = raw.p?.[0]?.v?.trim();
  if (firstPhone) return firstPhone;
  const firstMail = raw.e?.[0]?.v?.trim();
  if (firstMail) return firstMail;
  return 'No name';
}

function toPhones(raw: RawContact, options: NormalizeOptions): PhoneNumber[] {
  // The key rides alongside rather than into `PhoneNumber`: it decides the
  // order here, once, and what the row shows is the localized text.
  const entries = (raw.p ?? [])
    .map((item, index) => ({
      index,
      key: item.k,
      phone: {
        label: item.l.trim() === '' ? 'Phone' : item.l.trim(),
        display: item.v.trim(),
        dial: normalizeDial(item.v, options.dialPrefix),
      } satisfies PhoneNumber,
    }))
    .filter((entry) => entry.phone.dial !== '');

  // Stable sort by label preference: `index` breaks ties so two numbers with
  // the same label keep the order the address book gave them.
  entries.sort((a, b) => {
    const rank = labelRank(a.phone.label, a.key, options.preferredLabels) -
      labelRank(b.phone.label, b.key, options.preferredLabels);
    return rank !== 0 ? rank : a.index - b.index;
  });

  // The same subscriber stored twice — "+4917…" and "0049 17…" — is ordinary
  // in a synced address book, and after normalization the two are literally
  // the same number to dial. Keeping both would cost an extra ← → press for
  // no reachable difference. Dedup runs *after* the sort so the survivor is
  // the best-labelled spelling, not whichever came first in the record.
  const seen = new Set<string>();
  const unique: PhoneNumber[] = [];
  for (const entry of entries) {
    if (seen.has(entry.phone.dial)) continue;
    seen.add(entry.phone.dial);
    unique.push(entry.phone);
  }
  return unique;
}

function toEmails(raw: RawContact): EmailAddress[] {
  const seen = new Set<string>();
  const emails: EmailAddress[] = [];
  for (const item of raw.e ?? []) {
    const address = item.v.trim();
    if (address === '') continue;
    // Addresses are case-insensitive for routing purposes; two spellings of
    // one address are one address.
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push({ label: item.l.trim() === '' ? 'Email' : item.l.trim(), address });
  }
  return emails;
}

export function normalizeContact(raw: RawContact, options: NormalizeOptions): Contact {
  const name = displayName(raw);
  const organization = raw.o.trim();
  const phones = toPhones(raw, options);
  const emails = toEmails(raw);

  // Both the stored and the dial form go into the haystack: someone who
  // remembers "0172" should find the contact, and so should someone pasting
  // "+49172".
  const haystack = [
    name,
    organization,
    raw.n,
    raw.j,
    ...phones.flatMap((p) => [p.display, p.dial]),
    ...emails.map((m) => m.address),
  ]
    .join(' ')
    .toLowerCase();

  return {
    id: raw.id,
    name,
    organization,
    jobTitle: raw.j.trim(),
    nickname: raw.n.trim(),
    isOrganization: raw.c === 1,
    hasPhoto: raw.a === 1,
    phones,
    emails,
    haystack,
    sortKey: name.toLowerCase(),
  };
}

export function normalizeAll(raws: RawContact[], options: NormalizeOptions): Contact[] {
  const contacts: Contact[] = [];
  for (const raw of raws) {
    if (!options.includeOrganizations && raw.c === 1) continue;
    contacts.push(normalizeContact(raw, options));
  }
  return contacts;
}
