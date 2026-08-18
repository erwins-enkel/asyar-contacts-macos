import { describe, expect, it, vi } from 'vitest';
import type { ICacheService } from 'asyar-sdk/contracts';
import { CACHE_KEY, isStale, readIndex, STALE_AFTER_MS, writeIndex } from './cache';
import { INDEX_VERSION, type ContactIndex } from './types';

function fakeCache(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const cache: ICacheService = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    remove: vi.fn(async (key: string) => store.delete(key)),
    clear: vi.fn(async () => {
      store.clear();
    }),
  };
  return { cache, store };
}

const index: ContactIndex = {
  v: INDEX_VERSION,
  at: 1_700_000_000_000,
  region: 'DE',
  contacts: [],
};

describe('readIndex / writeIndex', () => {
  it('round-trips an index', async () => {
    const { cache } = fakeCache();
    await writeIndex(cache, index);
    await expect(readIndex(cache)).resolves.toEqual(index);
    expect(cache.set).toHaveBeenCalledWith(CACHE_KEY, expect.any(String), expect.anything());
  });

  it('reports an empty cache rather than throwing', async () => {
    const { cache } = fakeCache();
    await expect(readIndex(cache)).resolves.toBeNull();
  });

  it('discards an entry written by an older schema', async () => {
    const { cache } = fakeCache({
      [CACHE_KEY]: JSON.stringify({ ...index, v: INDEX_VERSION - 1 }),
    });
    await expect(readIndex(cache)).resolves.toBeNull();
  });

  it('discards a corrupt entry instead of crashing the panel', async () => {
    const { cache } = fakeCache({ [CACHE_KEY]: 'not json' });
    await expect(readIndex(cache)).resolves.toBeNull();
  });
});

describe('isStale', () => {
  it('is fresh inside the window and stale past it', () => {
    expect(isStale(index, index.at + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(index, index.at + STALE_AFTER_MS + 1)).toBe(true);
  });
});
