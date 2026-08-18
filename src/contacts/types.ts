// ─────────────────────────────────────────────────────────────────────────
// The shapes that cross the osascript boundary, and the shapes the panel
// renders. Pure types only — this module is imported by both the view and
// the worker, so it must never reach for `asyar-sdk/view` or `/worker`.
// ─────────────────────────────────────────────────────────────────────────

/** One labelled value as the helper emits it. Keys are one character because
 *  the whole index is JSON that crosses postMessage and then lands in the
 *  extension cache as a string; at ~2700 contacts the short keys are worth
 *  roughly a fifth of the payload. */
export interface RawLabeled {
  /** Localized label, e.g. "Mobil" / "Arbeit". Empty when the field has none. */
  l: string;
  /** The number or address exactly as macOS stores it. */
  v: string;
}

/** One contact as `CONTACTS_JXA` emits it. See `src/contacts/jxa.ts`. */
export interface RawContact {
  id: string;
  /** givenName */ g: string;
  /** middleName */ m: string;
  /** familyName */ f: string;
  /** nickname */ n: string;
  /** organizationName */ o: string;
  /** jobTitle */ j: string;
  /** 1 when the record is an organization rather than a person */ c: 0 | 1;
  /** 1 when a contact photo exists and can be fetched by identifier */ a: 0 | 1;
  /** phoneNumbers, omitted when empty */ p?: RawLabeled[];
  /** emailAddresses, omitted when empty */ e?: RawLabeled[];
}

/** Every line the helper can write to stdout. Exactly one JSON object per
 *  line — `ShellService` hands output over line by line, so a multi-line
 *  document could not be reassembled without buffering the whole stream. */
export type HelperLine =
  | { auth: number }
  | { auth: number; granted: 0 | 1 }
  | { region: string }
  | { batch: RawContact[] }
  | { done: number }
  | { image: string | null }
  | { error: string; auth?: number };

/** `CNAuthorizationStatus`. Only `authorized` lets the helper read anything. */
export const AUTH = {
  notDetermined: 0,
  restricted: 1,
  denied: 2,
  authorized: 3,
} as const;

export interface PhoneNumber {
  /** Localized label as macOS stores it, e.g. "Mobil". Never empty — falls
   *  back to "Telefon" so the UI always has something to show. */
  label: string;
  /** The number as stored, for display. */
  display: string;
  /** Digits (and a leading `+`) only, ready to paste into a `tel:` URL. */
  dial: string;
}

export interface EmailAddress {
  label: string;
  address: string;
}

export interface Contact {
  id: string;
  /** "Kai Osthoff", or the organization name for a company record. */
  name: string;
  /** Organization, shown as the subtitle when it differs from `name`. */
  organization: string;
  jobTitle: string;
  nickname: string;
  isOrganization: boolean;
  hasPhoto: boolean;
  phones: PhoneNumber[];
  emails: EmailAddress[];
  /** Lowercased name + organization + nickname + every number in dial form,
   *  precomputed once at load so filtering a 2700-row list per keystroke stays
   *  a substring scan rather than a rebuild. */
  haystack: string;
  /** Lowercased name, used for the alphabetical tiebreak in ranking. */
  sortKey: string;
}

/** The cached index, as it is stored (JSON) under one cache key. */
export interface ContactIndex {
  /** Schema version. A bump invalidates every previously cached index. */
  v: number;
  /** Unix millis of the read that produced this index. */
  at: number;
  /** ISO 3166-1 alpha-2 region of the Mac at read time, for `countryCode: auto`. */
  region: string;
  contacts: Contact[];
}

export const INDEX_VERSION = 1;
