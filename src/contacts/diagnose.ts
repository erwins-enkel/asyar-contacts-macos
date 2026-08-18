// ─────────────────────────────────────────────────────────────────────────
// Turning a failure into something the user can act on.
//
// The case that motivated this file: Asyar withholds *every* permission from
// an extension whose declared set exceeds the recorded consent — which is the
// state a freshly linked extension is in, before anyone has opened Settings.
// The symptom is that unrelated calls fail: `preferences.refresh()` rejects,
// `shell.spawn()` reports SPAWN_FAILED, and the launcher shows a bare
// "promise was rejected". None of that says "approve the permissions", which
// is the only thing that fixes it.
//
// So failures are classified here rather than described inline, and the
// classification is unit-tested against the message shapes the layers
// actually produce.
// ─────────────────────────────────────────────────────────────────────────

import type { HelperFailure } from './loader';

export type Diagnosis =
  /** Asyar is withholding the extension's permissions until they are reviewed. */
  | { kind: 'permissions'; detail: string }
  /** macOS has not granted Contacts access to Asyar. */
  | { kind: 'contacts-access'; detail: string }
  /** Anything else — shown as-is with a retry. */
  | { kind: 'failure'; detail: string };

/** Both the permission gate and the Rust trust check phrase their refusal
 *  differently, and neither is stable enough to match exactly. These are the
 *  words that survive across all of them. */
const PERMISSION_HINTS = [
  'permission',
  'not declared',
  'berechtigung',
  'denied',
  'consent',
];

export function looksLikePermissionProblem(message: string): boolean {
  const haystack = message.toLowerCase();
  return PERMISSION_HINTS.some((hint) => haystack.includes(hint));
}

const REVIEW_STEPS =
  'Asyar öffnen → Einstellungen (⌘,) → Extensions → „Kontakte“ auswählen → Berechtigungen prüfen und bestätigen.';

/** The message for a rejection that arrived as a plain `Error`, i.e. from an
 *  SDK call that is not `ShellService` — `preferences.refresh()` above all. */
export function diagnoseError(error: unknown): Diagnosis {
  const message = error instanceof Error ? error.message : String(error);
  if (looksLikePermissionProblem(message)) {
    return { kind: 'permissions', detail: REVIEW_STEPS };
  }
  return { kind: 'failure', detail: message };
}

export function diagnoseFailure(failure: HelperFailure): Diagnosis {
  switch (failure.kind) {
    case 'not-authorized':
      return {
        kind: 'contacts-access',
        detail:
          'macOS gibt das Adressbuch nur nach ausdrücklicher Freigabe heraus. Diese Erweiterung liest ausschließlich lokal und schickt nichts ins Netz.',
      };

    case 'spawn-failed':
      if (
        failure.code === 'PERMISSION_DENIED' ||
        looksLikePermissionProblem(`${failure.code} ${failure.message}`)
      ) {
        return { kind: 'permissions', detail: REVIEW_STEPS };
      }
      if (failure.code === 'NOT_FOUND') {
        return {
          kind: 'failure',
          detail:
            'osascript wurde nicht gefunden. Auf macOS liegt es unter /usr/bin/osascript — fehlt es, ist das System beschädigt.',
        };
      }
      return {
        kind: 'failure',
        detail: `osascript ließ sich nicht starten (${failure.code}): ${failure.message}`,
      };

    case 'timeout':
      return {
        kind: 'failure',
        detail:
          'Das Lesen der Kontakte hat zu lange gedauert. Wahrscheinlich wartet noch ein Systemdialog auf eine Antwort.',
      };

    case 'helper-error':
      return {
        kind: 'failure',
        detail: `Das Kontakte-Skript hat abgebrochen (${failure.token}).`,
      };

    case 'no-output':
      return {
        kind: 'failure',
        detail: `Das Kontakte-Skript hat nichts zurückgegeben (Exit-Code ${failure.exitCode ?? '?'}).`,
      };
  }
}

export { REVIEW_STEPS };
