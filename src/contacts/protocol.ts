// Parsing the helper's stdout.
//
// Separated from the ShellService plumbing in `loader.ts` so the wire format
// can be unit-tested without a launcher: everything here is a pure function
// over strings the helper is known to emit.

import type { HelperLine, RawContact } from './types';

/** One line of helper stdout → a `HelperLine`, or `null` when the line is not
 *  ours. osascript writes the odd unsolicited warning to stdout, and a stray
 *  line must never abort a load that is otherwise fine. */
export function parseHelperLine(line: string): HelperLine | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed[0] !== '{') return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value !== 'object' || value === null) return null;
    return value as HelperLine;
  } catch {
    return null;
  }
}

export interface HelperOutcome {
  /** `CNAuthorizationStatus`, or `null` when the helper never reported one —
   *  which in practice means it did not run at all. */
  auth: number | null;
  /** ISO 3166-1 alpha-2 region of the Mac, `''` when not reported. */
  region: string;
  contacts: RawContact[];
  /** The count the helper signed off with. `null` when no `done` line
   *  arrived, i.e. the read was cut short. */
  done: number | null;
  /** Base64 JPEG for `mode: image`. `null` when the contact has no photo. */
  image: string | null;
  /** The helper's own error token (`not_authorized`, `not_found`, …). */
  error: string | null;
}

/** Fold every parsed line into one outcome. Later lines win for the scalar
 *  fields; batches accumulate. */
export function collectHelperLines(lines: HelperLine[]): HelperOutcome {
  const outcome: HelperOutcome = {
    auth: null,
    region: '',
    contacts: [],
    done: null,
    image: null,
    error: null,
  };

  for (const line of lines) {
    if ('auth' in line && typeof line.auth === 'number') outcome.auth = line.auth;
    if ('region' in line && typeof line.region === 'string') outcome.region = line.region;
    if ('batch' in line && Array.isArray(line.batch)) outcome.contacts.push(...line.batch);
    if ('done' in line && typeof line.done === 'number') outcome.done = line.done;
    if ('image' in line) outcome.image = typeof line.image === 'string' ? line.image : null;
    if ('error' in line && typeof line.error === 'string') outcome.error = line.error;
  }

  return outcome;
}
