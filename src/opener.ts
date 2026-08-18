// ─────────────────────────────────────────────────────────────────────────
// Handing a URL to macOS.
//
// This is the line that actually places the call. `tel:` is registered to
// Phone.app on macOS 26, which routes the call through the paired iPhone;
// `facetime:` / `facetime-audio:` / `sms:` / `addressbook:` reach FaceTime,
// Messages and Contacts the same way.
//
// There is no typed opener service in the SDK — `ctx.getService('opener')`
// throws, `opener` is in neither proxy bag. `messageBroker.invoke('opener:open',
// { url })` under the `shell:open-url` permission is the route. Note the
// payload shape: the form in Asyar's own troubleshooting docs, with `url` at
// the top level of the postMessage rather than inside `payload`, is a silent
// no-op because the router reads `data.payload`. `invoke()` builds the
// envelope correctly.
//
// `messageBroker` comes from the neutral `asyar-sdk/contracts` entry, so this
// module is safe to import from the worker as well as the view.
//
// Scheme gating: bare `shell:open-url` covers http/https/mailto/tel. The rest
// (`facetime`, `facetime-audio`, `sms`, `imessage`, `addressbook`) are listed
// in the manifest's `permissionArgs["shell:open-url"]`, which extends the
// allowlist — exact-matched, lowercase, no globs.
// ─────────────────────────────────────────────────────────────────────────

import { messageBroker } from 'asyar-sdk/contracts';

export type OpenRoute = 'opened' | 'failed';

/** The SDK's ambient invoke timeout (10 s) is tuned for IPC that may genuinely
 *  take a while. Handing a URL to LaunchServices is local; if it has not
 *  answered in three seconds the host is not routing `opener:open` at all, and
 *  the panel should say so rather than look frozen. */
const OPEN_TIMEOUT_MS = 3_000;

export async function openExternal(url: string): Promise<OpenRoute> {
  try {
    await messageBroker.invoke('opener:open', { url }, undefined, OPEN_TIMEOUT_MS);
    return 'opened';
  } catch {
    return 'failed';
  }
}
