# Contacts — macOS Contacts for Asyar

Your macOS address book inside the Asyar launcher: type, highlight, `⏎` — and the
number is dialled through **Phone.app**, and with it your paired iPhone.

The launcher command is **“Search Contacts”** — deliberately with a verb, so it is
distinguishable from macOS' own Contacts.app in the result list. The scheduled
background refresh is called **“Refresh address book cache”**, because Asyar offers
no way to hide a command from search, so it must not compete on the same first
letters.

`dev.erwins-enkel.contacts` · macOS only · reads locally, never touches the network.

---

## What it does

| Key | Action |
| --- | --- |
| `↑` `↓` | move between contacts |
| `←` `→` | move between the highlighted contact's numbers |
| `⏎` | **Call** (`tel:` → Phone.app → iPhone) |
| `⌘⏎` | FaceTime Video |
| `⌥⏎` | Message (Messages) |
| `⇧⌥⏎` | WhatsApp |
| `⌥⌘⏎` | Email |
| `⇧⏎` | copy the number to the clipboard |
| `⇧⌘⏎` | open in the Contacts app |
| `⌘K` | action drawer with everything above, plus FaceTime Audio and “Reload contacts” |

Filtering runs through **Asyar's own search bar** — the extension deliberately has
no input field of its own, because focus would otherwise leave the launcher. The
search covers name, company, nickname, job title, every email address and every
phone number, both as stored and in dial form (`0172 …` **and** `+49172 …` find
the same contact).

What Enter does is configurable — see **Settings** below.

## Installation

```bash
npm install
npm run build
npx asyar link --copy      # not the bare `asyar link`, see below
```

Then **restart Asyar**: the launcher only scans its extensions directory at startup.

Opening it the first time needs two approvals, each of them once:

1. **Asyar → Settings (⌘,) → Extensions → “Contacts” → approve the permissions.**
   Until that happens Asyar withholds *every* permission the extension declares —
   including the ones that have nothing to do with the call that just failed. The
   panel explains this state instead of hanging.
2. **macOS: “asyar would like to access your contacts” → Allow.** The panel offers
   a button for it and otherwise links into System Settings.

Both become due again whenever `permissions` **or** `permissionArgs` change in the
manifest — one additional URL scheme is enough.

Asyar also asks once whether the extension may run `/usr/bin/osascript`. The binary
is declared under `permissionArgs["shell:spawn"]` so the question appears in the
consent dialog rather than arriving unannounced later from the background worker.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Enter key | Call | what `⏎` triggers — call, FaceTime, message, WhatsApp or copy |
| Country code | `auto` | dialing prefix for nationally stored numbers. `auto` takes the region from macOS; empty leaves numbers untouched |
| Preferred numbers | `iPhone, Mobile, …` | the order in which number labels are picked |
| Show contact photos | on | load the photo of the highlighted contact |
| Include companies | on | also show company-only records |
| Refresh in the background | on | refresh the cache every 30 minutes |

## How it works

### Reading contacts

An Asyar extension cannot ship a native helper; the only route to the operating
system is `ShellService.spawn()`. So the macOS half runs as a JXA script inside
`/usr/bin/osascript` (`src/contacts/jxa.ts`) and talks to the **Contacts framework**
directly through the ObjC bridge.

This is deliberately *not* AppleScript against Contacts.app: no app launch, no
Automation prompt, and `CNContactStore.enumerateContacts` streams. Measured on the
development machine: **2713 contacts in ~3.4 s**.

Output is one JSON object per line, contacts in batches of 250 — `ShellService`
delivers stdout line by line, and 2700 separate postMessage round trips would cost
far more than eleven fat ones.

### Why it caches

Three seconds per panel open would not be a launcher experience. The prepared index
goes into the extension cache; the panel paints it immediately and pushes the fresh
read behind it (`STALE_AFTER_MS`, 15 minutes). The worker additionally refreshes
every 30 minutes — but **never the first** read: the macOS contacts prompt should
always visibly follow from someone opening the panel, never arrive unannounced from
an invisible iframe.

### Dialling

`messageBroker.invoke('opener:open', { url })` under `shell:open-url`. The SDK has
no typed opener service — `getService('opener')` throws. On macOS 26 `tel:` is
registered to Phone.app, which routes the call through the paired iPhone.
`facetime:`, `facetime-audio:`, `sms:`, `whatsapp:` and `addressbook:` are unlocked
through `permissionArgs["shell:open-url"]`; `tel:` and `mailto:` are covered by the
base permission.

Numbers are normalised to E.164 before dialling, but only where that is unambiguous
(`src/contacts/phone.ts`): `+…` stays, `00…` becomes `+…`, a leading `0` is replaced
by the country code. A number *without* a trunk prefix is left untouched — it
carries no evidence of which country it belongs to, and guessing would dial a
different subscriber.

**WhatsApp** is the exception: `whatsapp://send?phone=` wants bare E.164 digits
**without** a leading `+`, which the app puts back itself. That one action therefore
requires a number with a country code; a nationally stored number would otherwise be
read as belonging to a country that does not exist. Rather than guess, the extension
refuses and names the setting that is missing.

Fax numbers always sort last. Enter dials, and a fax machine is the one number in an
address book that must never be the default.

### Keyboard

While Asyar's search bar has focus — the normal case, since that bar is the filter —
the launcher intercepts keys before they can become DOM events in the iframe and
re-delivers exactly six of them as `asyar:view:keydown`: `↑ ↓ ← →`, `⏎`, `Tab`. The
modifier flags come along. The whole key map rests on that: modified Enter is the
only way to get more than one single-keystroke action out of a panel you are typing
into.

That is also why the highlight is pure state (`selectedId`) and never DOM focus —
`.focus()` on a row would take focus off the search bar and stop the typing that
filters the list.

## Development

```bash
npm run setup      # once: enables the pre-commit hook
npm run check      # tsc --noEmit && svelte-check && check:data
npm test           # 79 unit tests over the pure layer
npm run check:data # no real phone numbers/email addresses in the repo
npm run build      # vite build + bundle check
npm run validate   # asyar validate
```

Run `npx asyar link --copy` again after every build; the panel loads fresh the next
time it opens. Manifest changes need an Asyar restart.

**`asyar link --copy`, not the bare `asyar link`.** The default variant creates a
symlink. The Rust scheme handler canonicalises the hit and checks it against
`is_path_allowed()`; the rule that would permit arbitrary symlink targets sits behind
`#[cfg(debug_assertions)]`. On a release build `view.html` therefore returns **403** —
visible only as an empty panel plus `[workerRegistry] unmount … reason=timeout` in
the log.

### No real personal data in the repository

`scripts/check-no-personal-data.mjs` runs before every build and on every commit
(`.githooks/pre-commit`, enabled by `npm run setup`). It aborts as soon as a
phone-number- or email-shaped string appears anywhere that is not explicitly listed
as invented.

It is deliberately an **allowlist**: a denylist would have to know which numbers are
real, and it cannot. Adding a new test number is therefore a deliberate act.

The reason was a real mistake — while developing, it was tempting to use a slice of
the author's own address book as a fixture, and so names and phone numbers of third
parties ended up in tests and in a commit. It was only noticed when it came to
publishing. For an extension that reads address books this is the most obvious way to
do harm, so it is checked rather than merely watched for.

Names get no check, only the rule: Max/Erika Mustermann, Lieschen Müller,
Musterfirma GmbH.

`scripts/check-bundle.mjs` runs after every build and checks the one thing that can
break silently: `view.ts` and `worker.ts` share modules, so Rollup emits a common
chunk. `asyar-sdk/view` and `asyar-sdk/worker` throw at module load when
`window.__ASYAR_ROLE__` does not match — if such an assertion ever landed in that
shared chunk, the worker would die on every boot with a message pointing at the SDK
rather than at this build. The rule: shared modules take their types from
`asyar-sdk/contracts` only.

## Layout

```
manifest.json             permissions, commands, settings
view.html / worker.html   entry points; the filenames decide __ASYAR_ROLE__
src/view.ts               panel bootstrap
src/worker.ts             scheduled cache refresh + root-search action
src/ContactsView.svelte   the panel
src/opener.ts             the one way to hand a URL to macOS
src/contacts/
  jxa.ts                  the macOS script, as a string
  protocol.ts             stdout → records
  loader.ts               ShellService orchestration
  normalize.ts            raw records → displayable contacts
  phone.ts                number normalisation, tel:/facetime:/sms:/whatsapp: URLs
  dialingCodes.ts         ISO region → country calling code
  search.ts               filtering and ranking
  selection.ts            selection arithmetic
  keys.ts                 the key map
  diagnose.ts             failures → what the human should do
  cache.ts                index persistence
```

Everything under `src/contacts/` is pure and testable in `node` — it imports at most
types from `asyar-sdk/contracts`, never the role-asserting entries.

## License

MIT — see [LICENSE](LICENSE).
