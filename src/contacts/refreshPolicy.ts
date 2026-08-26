// ─────────────────────────────────────────────────────────────────────────
// Whether a scheduled tick is allowed to read the address book.
//
// The worker's `refresh` command used to fire every thirty minutes and read
// all ~2700 contacts unconditionally — about two seconds of `osascript` and a
// 1.4 MB cache write, forty-eight times a day, on a machine whose owner might
// not touch the extension for a week. The address book changes maybe monthly;
// paying for freshness on a clock rather than on use is the wrong trade.
//
// So the tick is a heartbeat, not a job. It only reads when all of these hold:
//
//   * the user has left background refresh on,
//   * an index already exists (the *first* read stays the panel's job, so the
//     macOS Contacts prompt always follows visibly from someone opening it),
//   * Contacts access was not refused recently,
//   * the launcher actually answered someone with a contact since the last
//     attempt,
//   * and the index is old enough to be worth re-reading.
//
// Kept pure and separate from `worker.ts` so every one of those clauses is
// testable without a shell, a cache or an iframe.
// ─────────────────────────────────────────────────────────────────────────

import { isStale } from './cache';
import type { RootResult } from './rootSearch';
import type { ContactIndex } from './types';

/** How long a refused read silences the scheduler. Access can only come back
 *  through the panel or System Settings, and the panel announces a fresh index
 *  over `indexUpdated` — so this is a backstop for the case where someone
 *  grants access in System Settings and then never opens the panel, not the
 *  mechanism that recovers. Until it elapses, root search keeps answering from
 *  the index already in memory. */
export const AUTH_BACKOFF_MS = 24 * 60 * 60 * 1000;

export type SkipReason =
  | 'background-refresh-off'
  | 'no-index'
  | 'authorization-backoff'
  | 'unused'
  | 'fresh-enough';

export type RefreshDecision = { run: true } | { run: false; reason: SkipReason };

export interface ScheduledRefreshInput {
  /** The `backgroundRefresh` preference. */
  backgroundRefresh: boolean;
  /** Whatever the cache holds, or `null` when the panel has never run. */
  index: ContactIndex | null;
  /** Root search has offered a contact since the last attempt. */
  usedSinceRefresh: boolean;
  /** When a read last came back `not-authorized`, or `null`. */
  deniedAt: number | null;
  now: number;
}

/**
 * Decide whether this tick may spawn the helper.
 *
 * The reasons are ordered cheapest-and-most-decisive first: a preference the
 * user set outranks everything, a missing index means there is nothing to
 * refresh at all, and a refusal outranks the usage check because a denied
 * extension would otherwise burn one failed spawn per use.
 */
export function decideScheduledRefresh(input: ScheduledRefreshInput): RefreshDecision {
  if (!input.backgroundRefresh) return { run: false, reason: 'background-refresh-off' };
  if (input.index === null) return { run: false, reason: 'no-index' };
  if (input.deniedAt !== null && input.now - input.deniedAt < AUTH_BACKOFF_MS) {
    return { run: false, reason: 'authorization-backoff' };
  }
  if (!input.usedSinceRefresh) return { run: false, reason: 'unused' };
  if (!isStale(input.index, input.now)) return { run: false, reason: 'fresh-enough' };
  return { run: true };
}

/**
 * Did this root-search round actually use the address book?
 *
 * Only a contact row counts. The panel entry is offered on a keyword and needs
 * no index at all, so someone typing "kontakte" and walking away must not book
 * the extension a read.
 */
export function hasContactHit(results: readonly RootResult[]): boolean {
  return results.some((result) => result.actionId === 'search-call');
}

/**
 * Did the scheduler send this `executeCommand`, or did someone pick the command
 * in the launcher?
 *
 * It matters because Asyar offers no way to hide a command from search
 * (`ExtensionCommand` has no `hidden` field), so "Refresh address book cache"
 * sits in root search as an ordinary entry. Someone who chooses it is asking
 * for a read in as many words, and none of the clauses above apply to them.
 *
 * **SOURCE**, `extensions/scheduler.rs`: a scheduled tick carries
 * `args: { "scheduledTick": true }`, asserted by a test in the launcher and
 * relied on by its own `commandService` to bypass the preference gate. The
 * check is strict — the payload has crossed `postMessage`.
 */
export function isScheduledTick(args?: Record<string, unknown>): boolean {
  return args?.scheduledTick === true;
}
