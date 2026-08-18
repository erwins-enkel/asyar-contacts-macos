// ─────────────────────────────────────────────────────────────────────────
// The keyboard map.
//
// The constraint that shapes all of it: while the launcher's search bar has
// focus — the normal case, since that bar is what filters this list — the
// launcher intercepts keys before they can become DOM events in this iframe
// and re-delivers only six of them (`ArrowUp`, `ArrowDown`, `ArrowLeft`,
// `ArrowRight`, `Enter`, `Tab`) as an `asyar:view:keydown` message. It does
// forward the modifier flags alongside, and that is the whole trick here:
// modified Enter is the only way to get more than one one-keystroke action
// out of a panel the user is typing into.
//
// So: Enter calls, and ⌘/⌥/⇧/⌃+Enter reach the same person a different way.
// Everything else lives in the ⌘K drawer, which the SDK forwards to the host
// unconditionally.
// ─────────────────────────────────────────────────────────────────────────

import type { ReachAction } from './phone';

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export type Intent =
  | { kind: 'move'; direction: 'up' | 'down' }
  | { kind: 'cycle-number'; direction: 'next' | 'previous' }
  | { kind: 'reach'; action: ReachAction }
  | { kind: 'open-in-contacts' };

/**
 * What a key press means, or `null` when the panel should ignore it.
 *
 * `primaryAction` is the user's `primaryAction` preference — unmodified Enter
 * does whatever they chose there, defaulting to placing a call.
 *
 * ⌘ and ⌃ are treated as one modifier throughout: the launcher forwards both
 * flags and macOS users reach for ⌘, but a Ctrl-based external keyboard
 * should not be a dead end.
 */
export function intentFor(event: KeyEventLike, primaryAction: ReachAction): Intent | null {
  const command = event.metaKey === true || event.ctrlKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;

  switch (event.key) {
    case 'ArrowDown':
      return { kind: 'move', direction: 'down' };
    case 'ArrowUp':
      return { kind: 'move', direction: 'up' };

    // Left/right walk the highlighted contact's own numbers, so a colleague
    // with a desk line and a mobile is two keystrokes from either.
    case 'ArrowRight':
      return { kind: 'cycle-number', direction: 'next' };
    case 'ArrowLeft':
      return { kind: 'cycle-number', direction: 'previous' };

    case 'Enter':
      // Every combination is spelled out and the more specific ones come
      // first, because these overlap: ⇧⌥⏎ has to be caught before the bare
      // `alt` branch, or WhatsApp would fall through to Messages.
      if (shift && alt && !command) return { kind: 'reach', action: 'whatsapp' };
      if (shift && !command && !alt) return { kind: 'reach', action: 'copy' };
      if (command && shift) return { kind: 'open-in-contacts' };
      if (command && alt) return { kind: 'reach', action: 'email' };
      if (command) return { kind: 'reach', action: 'facetime' };
      if (alt) return { kind: 'reach', action: 'sms' };
      return { kind: 'reach', action: primaryAction };

    default:
      return null;
  }
}

/** Label shown in the panel's footer hint row and in the ⌘K drawer, so the
 *  bindings are documented in exactly one place. */
export const SHORTCUT_HINTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '↑ ↓', label: 'Kontakt' },
  { keys: '← →', label: 'Nummer' },
  { keys: '⏎', label: 'Anrufen' },
  { keys: '⌘⏎', label: 'FaceTime' },
  { keys: '⌥⏎', label: 'Nachricht' },
  { keys: '⇧⌥⏎', label: 'WhatsApp' },
  { keys: '⌥⌘⏎', label: 'E-Mail' },
  { keys: '⇧⏎', label: 'Kopieren' },
  { keys: '⇧⌘⏎', label: 'Kontakte-App' },
];
