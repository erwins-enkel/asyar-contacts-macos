// ─────────────────────────────────────────────────────────────────────────
// The contact index, persisted.
//
// Reading the address book costs about three seconds. Doing that on every
// panel open would make a launcher extension feel like an application, so the
// index is written to the extension cache and the panel renders from it
// immediately, then refreshes behind the visible list.
//
// The cache entry is deliberately long-lived (30 days). It is not a
// freshness mechanism — `STALE_AFTER_MS` is — it is a floor that stops an
// index the user never refreshes from being silently dropped and turning the
// next open back into a three-second wait.
// ─────────────────────────────────────────────────────────────────────────

import type { ICacheService } from 'asyar-sdk/contracts';
import { INDEX_VERSION, type ContactIndex } from './types';

export const CACHE_KEY = 'contact-index';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Past this age the panel refreshes in the background after rendering the
 *  cached list. Fifteen minutes: long enough that a burst of opens costs one
 *  read, short enough that a number added on the iPhone shows up in the time
 *  it takes to walk to the desk. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** Structural check on whatever came back out of SQLite. A cache entry
 *  written by an older build of this extension is not a crash — it is just an
 *  entry to discard, which is what returning `null` here does. */
function isContactIndex(value: unknown): value is ContactIndex {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ContactIndex>;
  return (
    candidate.v === INDEX_VERSION &&
    typeof candidate.at === 'number' &&
    typeof candidate.region === 'string' &&
    Array.isArray(candidate.contacts)
  );
}

export async function readIndex(cache: ICacheService): Promise<ContactIndex | null> {
  try {
    const raw = await cache.get(CACHE_KEY);
    if (raw === undefined || raw === null || raw === '') return null;
    const parsed: unknown = JSON.parse(raw);
    return isContactIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeIndex(cache: ICacheService, index: ContactIndex): Promise<void> {
  await cache.set(CACHE_KEY, JSON.stringify(index), {
    expirationDate: new Date(Date.now() + CACHE_TTL_MS),
  });
}

export async function clearIndex(cache: ICacheService): Promise<void> {
  try {
    await cache.remove(CACHE_KEY);
  } catch {
    // A cache that refuses to forget is not worth failing a reload over; the
    // fresh read that follows overwrites the entry anyway.
  }
}

export function isStale(index: ContactIndex, now: number = Date.now()): boolean {
  return now - index.at > STALE_AFTER_MS;
}
