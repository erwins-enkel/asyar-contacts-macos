// ─────────────────────────────────────────────────────────────────────────
// Turning a stored phone number into something `tel:` can dial.
//
// Address books are full of "07131/123456", "0172 1234567", "(555) 123-4567"
// and "+49 151 1234567". Handing any of those to `tel:` verbatim mostly
// works when the iPhone happens to be in the same country, and fails when it
// is not. Promoting to E.164 where we safely can is the difference between a
// call that connects abroad and one that does not.
//
// "Where we safely can" is deliberately narrow — see `normalizeDial`. Guessing
// wrong here dials a stranger, so every rule below is one that cannot change
// which subscriber is reached.
// ─────────────────────────────────────────────────────────────────────────

import { dialingPrefixForRegion } from './dialingCodes';

/** Resolve the `countryCode` preference to a dial prefix.
 *
 *  - `"auto"` (the default) → the Mac's own region, as read by the helper.
 *  - `"+49"` / `"49"` / `"0049"` → that prefix, however the user typed it.
 *  - `""` → no prefix; national numbers stay national. */
export function resolveDialPrefix(preference: string, region: string): string {
  const raw = preference.trim();
  if (raw === '') return '';
  if (raw.toLowerCase() === 'auto') return dialingPrefixForRegion(region);

  // A bare region code is a plausible thing to type into a field whose
  // placeholder says "auto", so accept it too.
  if (/^[A-Za-z]{2}$/.test(raw)) return dialingPrefixForRegion(raw);

  const digits = raw.replace(/[^\d]/g, '').replace(/^00/, '');
  return digits === '' ? '' : `+${digits}`;
}

/** Everything a dialer can act on. Letters are dropped rather than mapped to
 *  their keypad digits: "1-800-FLOWERS" is vanishingly rare in a personal
 *  address book, and a wrong mapping dials a wrong number. */
function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, '');
}

/**
 * `"0172/1234567"` + `"+49"` → `"+491721234567"`.
 *
 * The rules, in the order they are tried:
 *
 *   1. Already international (`+…`) → keep, minus the formatting.
 *   2. `00…` → the international prefix in its other spelling; becomes `+…`.
 *   3. A single leading `0` with a prefix configured → national trunk code,
 *      dropped and replaced by the country code. This is the case that makes
 *      a German address book dial from abroad.
 *   4. Anything else → digits only, unchanged. A number stored without any
 *      trunk indicator carries no evidence of which country it belongs to,
 *      and inventing one would dial a different subscriber.
 *
 * Returns `''` when nothing dialable is left, which callers treat as "this
 * entry has no usable number".
 */
export function normalizeDial(raw: string, dialPrefix: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  if (trimmed.startsWith('+')) {
    const digits = digitsOnly(trimmed);
    return digits === '' ? '' : `+${digits}`;
  }

  const digits = digitsOnly(trimmed);
  if (digits === '') return '';

  if (digits.startsWith('00')) return `+${digits.slice(2)}`;

  if (dialPrefix !== '' && digits.startsWith('0') && !digits.startsWith('00')) {
    return `${dialPrefix}${digits.slice(1)}`;
  }

  return digits;
}

/** Percent-encode for use inside a `tel:` / `sms:` / `facetime:` URL. `+` is
 *  significant in E.164 and must survive, so it is restored after encoding. */
function encodeNumber(dial: string): string {
  return encodeURIComponent(dial).replace(/%2B/gi, '+');
}

export type ReachAction =
  | 'call'
  | 'facetime'
  | 'facetime-audio'
  | 'sms'
  | 'whatsapp'
  | 'copy'
  | 'email';

/**
 * WhatsApp's own scheme, which does not take a `tel:`-style number.
 *
 * `whatsapp://send?phone=` wants bare E.164 digits with **no** leading `+` —
 * WhatsApp puts it back itself. Verified against the installed app: passing
 * `490000000000` produced the error "+490000000000 ist nicht bei WhatsApp
 * registriert" (the app is localised; that is German for "is not registered on
 * WhatsApp"). Note the plus in its answer, which we never sent.
 *
 * The number must therefore already carry a country code. A nationally-stored
 * number like `01701112223` would be read as `+01631…`, i.e. a different
 * subscriber in a country that does not exist — so this returns `null` rather
 * than guessing, and the panel explains what to configure. This is the one
 * action where the `Landesvorwahl` preference is not optional.
 */
export function whatsappUrl(dial: string): string | null {
  if (!dial.startsWith('+')) return null;
  const digits = dial.slice(1).replace(/[^\d]/g, '');
  return digits === '' ? null : `whatsapp://send?phone=${digits}`;
}

/**
 * The URL that performs `action` on `dial`.
 *
 * `tel:` is the one that matters here: on macOS 26 it is registered to
 * Phone.app, which places the call over the paired iPhone. FaceTime video and
 * audio get their own schemes; `sms:` opens Messages, `whatsapp:` opens
 * WhatsApp. `copy` has no URL — the caller writes to the clipboard instead —
 * so it returns `null`, as does `email`, which needs an address rather than a
 * number (see `mailUrl`).
 */
export function reachUrl(action: ReachAction, dial: string): string | null {
  if (dial === '') return null;
  const n = encodeNumber(dial);
  switch (action) {
    case 'call':
      return `tel:${n}`;
    case 'facetime':
      return `facetime:${n}`;
    case 'facetime-audio':
      return `facetime-audio:${n}`;
    case 'sms':
      return `sms:${n}`;
    case 'whatsapp':
      return whatsappUrl(dial);
    default:
      return null;
  }
}

/** `mailto:` for the address, with nothing else attached — the user's mail
 *  client owns subject and body. */
export function mailUrl(address: string): string | null {
  const trimmed = address.trim();
  return trimmed === '' ? null : `mailto:${encodeURIComponent(trimmed)}`;
}

/** Opens the record in Contacts.app. The identifier the Contacts framework
 *  hands out (`<uuid>:ABPerson`) is exactly what this scheme expects, and it
 *  is passed through unencoded on purpose: every character in it is already
 *  URL-safe, and percent-encoding the colon produces a URL that LaunchServices
 *  still accepts but Contacts.app does not resolve to a person. Anything that
 *  is *not* a plain identifier is refused rather than escaped — this string
 *  comes from the Contacts framework, so a surprise here means something else
 *  is wrong. */
export function addressBookUrl(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!/^[A-Za-z0-9:_-]+$/.test(trimmed)) return null;
  return `addressbook://${trimmed}`;
}
