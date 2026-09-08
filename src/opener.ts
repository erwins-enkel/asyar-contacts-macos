// ─────────────────────────────────────────────────────────────────────────
// Handing a URL to macOS.
//
// This is the line that actually places the call. `tel:` is registered to
// Phone.app on macOS 26, which routes the call through the paired iPhone;
// `facetime:` / `facetime-audio:` / `sms:` / `addressbook:` reach FaceTime,
// Messages and Contacts the same way.
//
// The route is `IOpenerService`, typed and in both proxy bags since SDK 4.8.0.
// Before that this module built the `opener:open` envelope by hand, because
// `getService('opener')` threw — see docs/verified-notes.md for that history.
//
// The service is passed in rather than fetched, which keeps this module free
// of `asyar-sdk/view` (it imports a type from the neutral `contracts` entry,
// so the shared-chunk rule in scripts/check-bundle.mjs holds) and lets the
// timeout be tested against a fake.
//
// Scheme gating: bare `shell:open-url` covers http/https/mailto/tel. The rest
// (`facetime`, `facetime-audio`, `sms`, `imessage`, `whatsapp`, `addressbook`)
// are listed in the manifest's `permissionArgs["shell:open-url"]`, which
// extends the allowlist — exact-matched, lowercase, no globs.
// ─────────────────────────────────────────────────────────────────────────

import type { IOpenerService } from 'asyar-sdk/contracts';

export type OpenRoute = 'opened' | 'failed';

/** `OpenerServiceProxy.openUrl()` passes no timeout, so it inherits the SDK's
 *  ambient one (10 s) — tuned for IPC that may genuinely take a while. Handing
 *  a URL to LaunchServices is local; if it has not answered in three seconds
 *  the host is not routing `opener:open` at all, and the panel should say so
 *  rather than look frozen for ten. Hence the race. */
const OPEN_TIMEOUT_MS = 3_000;

export async function openExternal(
  opener: IOpenerService,
  url: string,
): Promise<OpenRoute> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      opener.openUrl(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`opener:open did not answer in ${OPEN_TIMEOUT_MS} ms`)),
          OPEN_TIMEOUT_MS,
        );
      }),
    ]);
    return 'opened';
  } catch {
    return 'failed';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
