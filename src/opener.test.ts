import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IOpenerService } from 'asyar-sdk/contracts';
import { openExternal } from './opener';

/** Only `openUrl` is exercised; the rest of the service surface is irrelevant
 *  here and a cast keeps the fake from having to track the SDK's interface. */
function fakeOpener(openUrl: IOpenerService['openUrl']): IOpenerService {
  return { openUrl } as IOpenerService;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('openExternal', () => {
  it('reports the URL as opened when the service resolves', async () => {
    const openUrl = vi.fn(async () => {});
    await expect(openExternal(fakeOpener(openUrl), 'tel:+491701234567')).resolves.toBe('opened');
    expect(openUrl).toHaveBeenCalledWith('tel:+491701234567');
  });

  it('reports failure instead of throwing when the host rejects', async () => {
    // What a withheld `shell:open-url` consent looks like from in here: the
    // panel needs a notice, not an unhandled rejection.
    const openUrl = vi.fn(async () => {
      throw new Error('permission denied');
    });
    await expect(openExternal(fakeOpener(openUrl), 'tel:+491701234567')).resolves.toBe('failed');
  });

  it('gives up after 3 s rather than waiting out the SDK ambient timeout', async () => {
    vi.useFakeTimers();
    // A host that is not routing `opener:open` at all: the promise never
    // settles, and the SDK would sit on it for ten seconds.
    const openUrl = vi.fn(() => new Promise<void>(() => {}));
    const route = openExternal(fakeOpener(openUrl), 'tel:+491701234567');

    await vi.advanceTimersByTimeAsync(2_999);
    // Still waiting — the guard must not fire early on a slow-but-live host.
    await expect(Promise.race([route, Promise.resolve('pending')])).resolves.toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await expect(route).resolves.toBe('failed');
  });
});
