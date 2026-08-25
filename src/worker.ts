// ─────────────────────────────────────────────────────────────────────────
// worker.ts — the background half, loaded by dist/worker.html.
//
// Two jobs.
//
// Keeping the cached contact index warm, so opening the panel is instant rather
// than a three-second read: the scheduled `refresh` command plus the manifest's
// "Reload contacts" action.
//
// And answering Asyar's *root* search, so a name typed into the launcher offers
// the person directly. That round is capped at 200 ms, far too little for a
// cache read per keystroke, so the index is held in memory here and `search()`
// only ever scans it.
//
// One deliberate restraint. The worker never performs the *first* read. It
// refreshes an index that already exists and otherwise does nothing, so the
// macOS Contacts prompt always arrives because the user opened the panel —
// never unprompted, minutes after login, from a hidden iframe with no visible
// cause.
//
// Imports come from `asyar-sdk/worker` (role-asserted) and `asyar-sdk/contracts`
// (pure types + the message broker). Nothing here touches the DOM.
// ─────────────────────────────────────────────────────────────────────────

import {
  ExtensionContext as WorkerExtensionContext,
  extensionBridge,
} from 'asyar-sdk/worker';
import type {
  Extension,
  ExtensionResult,
  ICacheService,
  ILogService,
  IShellService,
} from 'asyar-sdk/contracts';

import manifest from '../manifest.json';
import { readIndex, writeIndex } from './contacts/cache';
import { loadIndex } from './contacts/loader';
import { buildRootResults, parseCallPayload } from './contacts/rootSearch';
import { reachUrl } from './contacts/phone';
import type { Contact } from './contacts/types';
import { openExternal } from './opener';

const FALLBACK_ID = 'dev.erwins-enkel.contacts';

const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] || FALLBACK_ID
    : window.location.hostname || FALLBACK_ID;

const context = new WorkerExtensionContext();
context.setExtensionId(extensionId);

const log = context.getService<ILogService>('log');
const cache = context.getService<ICacheService>('cache');
const shell = context.getService<IShellService>('shell');

/** Guards against a scheduled tick landing on top of a still-running read.
 *  Two concurrent osascript processes over the same address book would just
 *  race to write the same cache key. */
let running = false;

/** The index, in memory, purely so `search()` can answer inside the launcher's
 *  200 ms budget. It is a mirror of the cache, never a second source of truth:
 *  every write goes through `writeIndex` first and lands here afterwards. */
let index: Contact[] = [];

/** Pull the cached index into memory. Called at boot, after every refresh this
 *  worker performs, and over RPC when the panel has written a fresher one. */
async function loadIndexIntoMemory(): Promise<void> {
  try {
    const cached = await readIndex(cache);
    index = cached?.contacts ?? [];
  } catch {
    // An unreadable cache costs root-search results until the next refresh.
    // It must not take the worker down with it.
    index = [];
  }
}

interface Prefs {
  countryCode: string;
  preferredLabels: string;
  includeOrganizations: boolean;
  backgroundRefresh: boolean;
}

/** The worker's preference snapshot can boot empty; `refresh()` is IPC and
 *  needs `preferences:read`, which the manifest declares. */
async function readPrefs(): Promise<Prefs> {
  let values = (context.preferences.values ?? {}) as Record<string, unknown>;
  if (typeof values.countryCode !== 'string') {
    // `refresh()` is gated on `preferences:read` and rejects while the
    // extension's consent is still withheld. Defaults are a complete working
    // configuration, and a background refresh is not the place to surface a
    // permission problem — the panel does that.
    try {
      values = (await context.preferences.refresh()) as Record<string, unknown>;
    } catch {
      values = {};
    }
  }
  const str = (key: string, fallback: string): string =>
    typeof values[key] === 'string' && (values[key] as string).trim() !== ''
      ? (values[key] as string)
      : fallback;
  const bool = (key: string, fallback: boolean): boolean =>
    typeof values[key] === 'boolean' ? (values[key] as boolean) : fallback;

  return {
    countryCode: str('countryCode', 'auto'),
    preferredLabels: str('preferredLabels', 'iPhone, Mobil, Mobile, Handy, Privat'),
    includeOrganizations: bool('includeOrganizations', true),
    backgroundRefresh: bool('backgroundRefresh', true),
  };
}

/**
 * Re-read the address book into the cache.
 *
 * `force` marks a user-initiated reload (the ⌘K action). Without it this is
 * the scheduler talking, and it declines to run unless the user has already
 * opted into background refresh *and* an index exists to refresh.
 */
async function refreshIndex(force: boolean): Promise<void> {
  if (running) return;
  running = true;
  try {
    const prefs = await readPrefs();

    if (!force) {
      if (!prefs.backgroundRefresh) return;
      const existing = await readIndex(cache);
      if (existing === null) return; // the panel has never been opened
    }

    const result = await loadIndex(shell, {
      countryCode: prefs.countryCode,
      preferredLabels: prefs.preferredLabels,
      includeOrganizations: prefs.includeOrganizations,
    });

    if (!result.ok) {
      log.warn(`[${extensionId}] contact cache not refreshed: ${result.failure.kind}`);
      return;
    }

    await writeIndex(cache, result.value);
    index = result.value.contacts;
    log.info(`[${extensionId}] contact cache refreshed (${result.value.contacts.length})`);
  } catch (error) {
    log.error(
      `[${extensionId}] contact refresh failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    running = false;
  }
}

class ContactsWorkerExtension implements Extension {
  async initialize(): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}

  async executeCommand(commandId: string): Promise<unknown> {
    if (commandId === 'refresh') {
      await refreshIndex(false);
    }
    return undefined;
  }

  /**
   * Root search. Runs on every keystroke in the launcher, inside a 200 ms
   * budget for the whole extension-search round — so it must not await
   * anything. `buildRootResults` is a scan over the in-memory index.
   *
   * `action` is required by the type but meaningless here: the launcher
   * rebuilds each result across `postMessage` and drops functions on the way.
   * Navigation rides on `viewPath`, dialling on `actionId`/`actionPayload`.
   */
  async search(query: string): Promise<ExtensionResult[]> {
    return buildRootResults(index, query, extensionId).map((result) => ({
      ...result,
      action: () => {},
    }));
  }

  onUnload = (): void => {};
}

const workerExtension = new ContactsWorkerExtension();

// Order is load-bearing: registerExtensionImplementation() logs an error and
// silently returns when no manifest is registered for the id.
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, workerExtension);

// The launcher surfaces manifest `actions` in root search, and dispatches them
// to the worker as `act_<extensionId>_reload-contacts`. `registerActionHandler`
// builds that id internally, so the manifest's plain `"reload-contacts"` goes
// in unprefixed. Registered outside `activate()` so it works from the moment
// the worker boots.
extensionBridge.registerActionHandler(extensionId, 'reload-contacts', async () => {
  await refreshIndex(true);
});

// Enter on a contact row in root search. The payload has crossed postMessage
// and a JSON round trip, so it is re-validated rather than trusted.
extensionBridge.registerActionHandler(extensionId, 'search-call', async (payload) => {
  const call = parseCallPayload(payload);
  if (call === null) {
    log.warn(`[${extensionId}] search-call fired without a usable number`);
    return;
  }
  const url = reachUrl('call', call.dial);
  if (url === null) return;
  const route = await openExternal(url);
  if (route === 'failed') {
    log.error(`[${extensionId}] search-call: opener:open failed for ${call.dial}`);
  }
});

// The panel writes a fresh index straight to the cache; without this the
// worker's copy would sit stale until the next scheduled refresh — up to half
// an hour of root search answering from yesterday's address book.
context.onRequest('indexUpdated', async () => {
  await loadIndexIntoMemory();
});

// Boot: adopt whatever the cache already holds. Deliberately a cache read and
// not a spawn — the worker never performs the first read of the address book,
// so the macOS prompt always follows visibly from someone opening the panel.
void loadIndexIntoMemory();
