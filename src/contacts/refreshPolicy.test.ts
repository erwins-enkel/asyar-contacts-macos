import { describe, expect, it } from 'vitest';
import {
  AUTH_BACKOFF_MS,
  decideScheduledRefresh,
  hasContactHit,
  isScheduledTick,
  type ScheduledRefreshInput,
} from './refreshPolicy';
import { STALE_AFTER_MS } from './cache';
import { INDEX_VERSION, type ContactIndex } from './types';
import type { RootResult } from './rootSearch';

const NOW = 1_700_000_000_000;

function indexAged(ms: number): ContactIndex {
  return { v: INDEX_VERSION, at: NOW - ms, region: 'DE', contacts: [] };
}

/** A tick that would refresh, so each test can negate exactly one condition. */
function input(overrides: Partial<ScheduledRefreshInput> = {}): ScheduledRefreshInput {
  return {
    backgroundRefresh: true,
    index: indexAged(STALE_AFTER_MS + 1),
    usedSinceRefresh: true,
    deniedAt: null,
    now: NOW,
    ...overrides,
  };
}

describe('decideScheduledRefresh', () => {
  it('refreshes a stale index after the launcher matched a contact', () => {
    expect(decideScheduledRefresh(input())).toEqual({ run: true });
  });

  it('skips the tick when nobody searched a contact since the last refresh', () => {
    expect(decideScheduledRefresh(input({ usedSinceRefresh: false }))).toEqual({
      run: false,
      reason: 'unused',
    });
  });

  it('skips while the cached index is still fresh', () => {
    expect(decideScheduledRefresh(input({ index: indexAged(STALE_AFTER_MS - 1) }))).toEqual({
      run: false,
      reason: 'fresh-enough',
    });
  });

  it('skips when the user turned background refresh off', () => {
    expect(decideScheduledRefresh(input({ backgroundRefresh: false }))).toEqual({
      run: false,
      reason: 'background-refresh-off',
    });
  });

  it('skips while no index exists, so the first read stays the panel’s job', () => {
    expect(decideScheduledRefresh(input({ index: null }))).toEqual({
      run: false,
      reason: 'no-index',
    });
  });

  it('stops spawning for a day after a read was refused authorization', () => {
    expect(decideScheduledRefresh(input({ deniedAt: NOW - AUTH_BACKOFF_MS + 1 }))).toEqual({
      run: false,
      reason: 'authorization-backoff',
    });
  });

  it('tries again once the authorization backoff has elapsed', () => {
    expect(decideScheduledRefresh(input({ deniedAt: NOW - AUTH_BACKOFF_MS }))).toEqual({
      run: true,
    });
  });
});

describe('hasContactHit', () => {
  const panelRow: RootResult = {
    score: 0.95,
    title: 'Search Contacts',
    type: 'view',
    viewPath: 'dev.erwins-enkel.contacts/ContactsView',
  };
  const contactRow: RootResult = {
    score: 0.9,
    title: 'Ada Lovelace',
    type: 'result',
    actionId: 'search-call',
    actionPayload: { dial: '+491511234567', name: 'Ada Lovelace' },
  };

  it('counts a contact row as using the address book', () => {
    expect(hasContactHit([contactRow])).toBe(true);
  });

  it('does not count the panel entry, which needs no fresh index', () => {
    expect(hasContactHit([panelRow])).toBe(false);
  });

  it('does not count a query that matched nothing', () => {
    expect(hasContactHit([])).toBe(false);
  });
});

describe('isScheduledTick', () => {
  it('recognises the scheduler’s own invocation', () => {
    expect(isScheduledTick({ scheduledTick: true })).toBe(true);
  });

  it('treats a command the user picked in the launcher as a user request', () => {
    expect(isScheduledTick(undefined)).toBe(false);
  });

  it('treats an argument-less invocation as a user request', () => {
    expect(isScheduledTick({})).toBe(false);
  });

  it('does not accept a stringified flag from across the message boundary', () => {
    expect(isScheduledTick({ scheduledTick: 'true' })).toBe(false);
  });
});
