// ─────────────────────────────────────────────────────────────────────────
// Running the helper through `ShellService` and turning its stream into an
// index.
//
// `spawn()` is callback-based and returns immediately; everything here exists
// to wrap that in a promise that resolves exactly once, whichever of the four
// possible endings arrives first (done / error / abort / timeout). The one
// subtlety worth stating: `onChunk` callbacks must be registered in the same
// JavaScript turn as the spawn, before the host can deliver a line.
// ─────────────────────────────────────────────────────────────────────────

import type { IShellService } from 'asyar-sdk/contracts';
import { HELPER_PROGRAM, helperArgs, type HelperMode } from './jxa';
import { collectHelperLines, parseHelperLine, type HelperOutcome } from './protocol';
import { normalizeAll, parsePreferredLabels } from './normalize';
import { resolveDialPrefix } from './phone';
import { AUTH, INDEX_VERSION, type ContactIndex, type HelperLine } from './types';

/** Reading ~2700 contacts takes about three seconds on an M-series Mac. Sixty
 *  seconds is not a performance budget — it is the point past which the
 *  helper is certainly wedged (a modal TCC prompt nobody answered, most
 *  likely) and the panel should say so rather than spin forever. */
const LIST_TIMEOUT_MS = 60_000;
/** One photo, or one authorization probe. Anything but instant means trouble. */
const SHORT_TIMEOUT_MS = 15_000;
/** `request` blocks on the user answering the system prompt; the helper's own
 *  run loop gives up at 120 s, so this sits just past that. */
const REQUEST_TIMEOUT_MS = 130_000;

export type HelperFailure =
  | { kind: 'not-authorized'; auth: number }
  | { kind: 'spawn-failed'; code: string; message: string }
  | { kind: 'timeout' }
  | { kind: 'helper-error'; token: string }
  | { kind: 'no-output'; exitCode?: number };

export type HelperResult<T> = { ok: true; value: T } | { ok: false; failure: HelperFailure };

function timeoutFor(mode: HelperMode): number {
  if (mode === 'list') return LIST_TIMEOUT_MS;
  if (mode === 'request') return REQUEST_TIMEOUT_MS;
  return SHORT_TIMEOUT_MS;
}

/**
 * Spawn the helper in `mode` and resolve once it has finished.
 *
 * Resolves rather than rejects on every failure mode — the caller renders all
 * of them, and a rejection would just be a `try`/`catch` that reconstructs the
 * same union.
 */
export function runHelper(
  shell: IShellService,
  mode: HelperMode,
  argument?: string,
): Promise<HelperResult<HelperOutcome>> {
  return new Promise((resolve) => {
    const lines: HelperLine[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: HelperResult<HelperOutcome>): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    let handle: ReturnType<IShellService['spawn']>;
    try {
      handle = shell.spawn({ program: HELPER_PROGRAM, args: helperArgs(mode, argument) });
    } catch (error) {
      finish({
        ok: false,
        failure: {
          kind: 'spawn-failed',
          code: 'SPAWN_THREW',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    timer = setTimeout(() => {
      handle.abort();
      finish({ ok: false, failure: { kind: 'timeout' } });
    }, timeoutFor(mode));

    handle.onChunk(({ stream, data }) => {
      // stderr carries osascript's own diagnostics, never our JSON. Dropping
      // it keeps a warning from being mistaken for a protocol line; the exit
      // code is what actually reports failure.
      if (stream !== 'stdout') return;
      const parsed = parseHelperLine(data);
      if (parsed !== null) lines.push(parsed);
    });

    handle.onDone((exitCode) => {
      const outcome = collectHelperLines(lines);

      if (outcome.error === 'not_authorized' || (outcome.auth !== null && outcome.auth !== AUTH.authorized && mode === 'list')) {
        finish({ ok: false, failure: { kind: 'not-authorized', auth: outcome.auth ?? AUTH.notDetermined } });
        return;
      }
      if (outcome.error !== null) {
        finish({ ok: false, failure: { kind: 'helper-error', token: outcome.error } });
        return;
      }
      if (lines.length === 0) {
        finish({ ok: false, failure: { kind: 'no-output', exitCode } });
        return;
      }
      finish({ ok: true, value: outcome });
    });

    handle.onError(({ code, message }) => {
      finish({ ok: false, failure: { kind: 'spawn-failed', code, message } });
    });
  });
}

export interface LoadOptions {
  /** The raw `countryCode` preference — `"auto"`, `"+49"`, or empty. */
  countryCode: string;
  /** The raw `preferredLabels` preference. */
  preferredLabels: string;
  includeOrganizations: boolean;
}

/** Read the address book and build a cacheable index. */
export async function loadIndex(
  shell: IShellService,
  options: LoadOptions,
  now: number = Date.now(),
): Promise<HelperResult<ContactIndex>> {
  const result = await runHelper(shell, 'list');
  if (!result.ok) return result;

  const { region, contacts } = result.value;
  return {
    ok: true,
    value: {
      v: INDEX_VERSION,
      at: now,
      region,
      contacts: normalizeAll(contacts, {
        dialPrefix: resolveDialPrefix(options.countryCode, region),
        preferredLabels: parsePreferredLabels(options.preferredLabels),
        includeOrganizations: options.includeOrganizations,
      }),
    },
  };
}

/** Current Contacts authorization, without reading a single record. */
export async function checkAuthorization(shell: IShellService): Promise<number> {
  const result = await runHelper(shell, 'auth');
  if (!result.ok) {
    return result.failure.kind === 'not-authorized' ? result.failure.auth : AUTH.notDetermined;
  }
  return result.value.auth ?? AUTH.notDetermined;
}

/** Trigger the system's Contacts prompt and wait for the answer. */
export async function requestAuthorization(shell: IShellService): Promise<number> {
  const result = await runHelper(shell, 'request');
  if (!result.ok) {
    return result.failure.kind === 'not-authorized' ? result.failure.auth : AUTH.notDetermined;
  }
  return result.value.auth ?? AUTH.notDetermined;
}

/** Base64 JPEG thumbnail for one contact, or `null` when it has none. */
export async function loadPhoto(
  shell: IShellService,
  identifier: string,
): Promise<string | null> {
  const result = await runHelper(shell, 'image', identifier);
  return result.ok ? result.value.image : null;
}
