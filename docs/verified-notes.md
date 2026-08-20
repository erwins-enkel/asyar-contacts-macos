# Verified findings

What this project actually knows about Asyar and macOS Contacts, and how it knows it.

**As of:** 2026-08-20 · Asyar `0.1.1-42` (`/Applications/asyar.app`, `org.asyar.app`) ·
`asyar-sdk` 4.7.0 · macOS 26.5.1 · Node 24 · vite 6.4.3 · Svelte 5 · TypeScript 5.

| Marker | Meaning |
| --- | --- |
| **OBSERVED** | Executed on this machine and watched happen. |
| **SOURCE** | Read out of the launcher or SDK source, not executed. |

---

## macOS

### Reading contacts: JXA + the Contacts framework

**OBSERVED.** `osascript -l JavaScript -e <script> list` with
`ObjC.import('Contacts')` and `CNContactStore.enumerateContacts` returns
**2713 contacts in ~3.4 s**. Without memoising
`CNLabeledValue.localizedStringForLabel` it was ~4.1 s — the same handful of
labels gets localised again across thousands of records, and every resolution is
a bridge crossing.

Pitfalls, all of them hit on the first attempt:

- `$.CNContactStore.authorizationStatusForEntityType(...)` does not return a JS
  `number`. `JSON.stringify` turned it into `"3"` and `status !== 3` was true.
  Wrap it in `Number(...)`. The same goes for `contact.contactType` and
  `list.count`.
- `$.NSArray.arrayWithObjects(a, b, c)` throws
  `wrong number of arguments for selector`. Bridge a JS array instead:
  `$(['givenName', 'familyName', …])`.
- The keys are simply the property names
  (`ObjC.unwrap($.CNContactGivenNameKey)` → `"givenName"`), so string literals
  work just as well.

The alternative — AppleScript against Contacts.app — was not taken: it launches
the app, triggers an Automation prompt, and is orders of magnitude slower.

### TCC: Asyar does get the contacts grant

**OBSERVED.** `/Applications/asyar.app/Contents/Info.plist` contains **no**
`NSContactsUsageDescription` — this was the largest open risk in the project,
because a missing usage string normally prevents the system prompt entirely.

It works anyway: after the first read from the panel,
`~/Library/Application Support/com.apple.TCC/TCC.db` holds

```
kTCCServiceAddressBook|org.asyar.app|2      -- 2 = allowed
```

The grant is therefore attributed to the responsible process (Asyar), not to the
spawned `osascript`. Should this fail on another system, the clean fix would be
to add `NSContactsUsageDescription` upstream in Asyar's `tauri.conf`.

### URL schemes on macOS 26

**OBSERVED** via `NSWorkspace.URLForApplicationToOpenURL`:

| Scheme | Handler |
| --- | --- |
| `tel:` | **Phone.app** — routes the call through the paired iPhone |
| `facetime-audio:` | Phone.app |
| `facetime:` | FaceTime.app |
| `sms:` / `imessage:` | Messages.app |
| `whatsapp:` | WhatsApp.app |
| `addressbook:` | Contacts.app |
| `x-apple.systempreferences:` | System Settings.app |

**OBSERVED** on the running launcher: Enter on a highlighted contact opens `tel:`
and the call connects — visible as “with your iPhone” in the call overlay.

`addressbook://<uuid>:ABPerson` must stay **unencoded**. With a percent-encoded
colon LaunchServices still accepts the URL, but Contacts.app does not resolve it
to a person.

**WhatsApp is the odd one out.** `whatsapp://send?phone=` wants bare E.164 digits
**without** a leading `+`; the app puts it back itself. **OBSERVED:** passing
`490000000000` made WhatsApp report that “+490000000000” is not registered. The
consequence is a real constraint — a nationally stored number has nothing safe to
send, so `whatsappUrl()` refuses rather than guessing.

---

## Asyar

> **On the extension ID in the log quotes below.** During these observations the
> extension was called `blog.osthoff.contacts`; it is now
> `dev.erwins-enkel.contacts`. The quotes stay verbatim — rewriting a log line
> that was never emitted that way would be the worse trade for a little tidiness.

### `searchable: true` is what attaches the search bar to the panel

**OBSERVED**, explained by **SOURCE**. Without the flag Asyar's search field stays
unusable while a view is open (“Press Escape to go back”) and the panel never
receives a query.

The path is `searchController.svelte.ts`, effect 5:

```ts
} else if (state.activeViewVal && state.activeViewSearchableVal && …) {
  extensionManager.handleViewSearch(state.localSearchValue);
}
```

and `activeViewSearchableVal` comes from `viewManager.navigateTo`:
`searchable: manifest.searchable ?? false`. `handleViewSearch` itself checks
nothing further — the flag is the entire gate.

**Side effect, checked and harmless:** `searchable: true` also makes the launcher
send root-search queries to the worker as `asyar:search:request`. If the
registered implementation has no `search()` method, the SDK's `ExtensionBridge`
answers immediately with `[]` (**SOURCE**, `ExtensionBridge.js` around line 185).
No hang, no timeout.

### Permissions are withheld wholesale until they are approved

**OBSERVED.** A freshly linked extension has no consent record, and Rust then
registers it with **zero** permissions — not merely without the new one. It
surfaced as:

- `context.preferences.refresh()` rejecting,
- `shell.spawn()` reporting `SPAWN_FAILED`,
- the launcher showing “blog.osthoff.contacts promise was rejected”.

None of those messages says “approve the permissions”, which is the only thing
that helps. Hence `src/contacts/diagnose.ts`: it recognises the wordings and
shows the route instead (Settings → Extensions → Contacts → approve).

Two bugs surfaced from the same cause and are fixed:

1. `boot()` had no error boundary. A rejected promise was never caught and the
   panel sat on its spinner forever.
2. `preferences.refresh()` was awaited unguarded. It now falls back to the
   defaults — a complete, working configuration.

After approval, `asyar_data.db` held:

```
shell_trusted_binaries: blog.osthoff.contacts | /usr/bin/osascript
```

The binary is declared under `permissionArgs["shell:spawn"]` so it appears in the
consent dialog instead of asking later, unannounced, from the background worker.

**`permissionArgs` alone re-triggers the gate too.** **OBSERVED:** adding
`whatsapp` to `permissionArgs["shell:open-url"]` — with no change at all to the
`permissions` list — put the extension back to zero permissions. That is
consistent, since the args widen the scope; but it means every new URL-scheme
grant costs a trip to Settings.

**The wording in the log is not stable.** The first time it was *“Withholding
permission registration … declared permissions exceed recorded consent”*, the
second time:

```
[PermissionGate] BLOCKED: Extension "blog.osthoff.contacts" is not registered
in the permission registry.
```

Grepping for the first phrasing found nothing the second time, and the conclusion
“no re-approval needed” was wrong — the panel was showing the approval screen.
Trust the panel for this question, not a log grep. `looksLikePermissionProblem`
in `src/contacts/diagnose.ts` catches both wordings because it tests for the word
`permission` rather than for a sentence.

### `asyar link --copy`, not the bare `asyar link`

**SOURCE**, `uri_schemes.rs`. The symlink variant fails on a release build: the
scheme handler canonicalises the hit and checks it against `is_path_allowed()`;
the rule for arbitrary symlink targets sits behind `#[cfg(debug_assertions)]`.
The result would be **403** for `view.html` — visible only as an empty panel and
`[workerRegistry] unmount … reason=timeout` in the log.

### A renamed command keeps its old name in search

**OBSERVED.** The launcher keeps every command in `search_index.db` (table
`search_items`, one JSON column `data` per row, key
`cmd_<extensionId>_<commandId>`) and does **not** rewrite `name` on
registration. After editing `manifest.json`, running `link --copy` and
restarting, it still read:

```json
{"id":"cmd_blog.osthoff.contacts_contacts","name":"Kontakte","usageCount":7, …}
```

That row also carries the frecency data (`usageCount`, `lastUsedAt`) the ranking
feeds on. Simply deleting it does force the new name, but throws exactly that
data away — the command dropped from position 1 to position 4, behind macOS' own
Contacts.app.

**The right way** is to update the JSON in place, with the launcher stopped (a
running Asyar rewrites the row again):

```python
d = json.loads(row['data'])
d['name'] = 'New name'
if d.get('trigger'): d['trigger'] = d['name']   # trigger defaults to the name
```

**OBSERVED:** set that way, the new name survives a restart and `usageCount`
stays put.

### ⌘K actions leak into other extensions' panels

**OBSERVED** (this extension's actions “Call”, “FaceTime”, “WhatsApp” … appeared
in the ⌘K drawer of the **Scripts** view), explained by **SOURCE**. Two things
combine:

**1. The host filters the drawer by context alone.**
`filterActionsByContext` in `services/action/actionService.svelte.ts` compares
`action.context === this.currentContext` and nothing else.
`ActionContext.EXTENSION_VIEW` therefore means “some extension panel is open”,
not “*this* panel is open”. There is no per-extension scoping, and the `visible`
predicate the function also consults is host-side — `ExtensionAction` in the SDK
has no such field, and a function would not survive `postMessage` anyway.

**2. The host only cleans up on the way back to the root.**
`selectionEffects.svelte.ts`, effect 7:

```ts
if (state.lastActiveViewId !== null && currentView === null) {
  actionService.clearActionsForExtension(state.lastActiveViewId.split('/')[0]);
}
```

Going straight from panel A to panel B never passes through `null`, so nothing is
cleared. **This is a bug in Asyar**, not behaviour an extension should have to
work around. The obvious correction would be to check for a change of extension
rather than for `null`:

```ts
const before = state.lastActiveViewId?.split('/')[0] ?? null;
const now = currentView?.split('/')[0] ?? null;
if (before !== null && before !== now) actionService.clearActionsForExtension(before);
```

**And `onDestroy` does not save you.** `ExtensionViewContainer.svelte` wraps
`ExtensionIframe` in `{#key extensionId}`; on a switch the iframe is destroyed,
not gracefully unmounted. The JS context simply ends, so neither `onDestroy` nor
an `$effect` cleanup runs.

What remains to an extension is `pagehide`: it fires while the frame can still
post, and the parent window outlives us. That is where `ContactsView.svelte`
unregisters its actions.

**OBSERVED** that this `pagehide` route closes the leak — checked by hand (open
the contacts panel, switch to another extension panel without going back to the
root, press ⌘K there: the contact actions are gone). It could not be triggered by
script, because the launcher window hides itself after a deeplink and a second
deeplink then no longer switches the view.

**There is no deactivation signal into the iframe.** The host sends a view
exactly three message types — `asyar:view:search`, `asyar:view:submit`,
`asyar:view:keydown`. No `viewDeactivated`, no `onHide`. The `context.onHide(...)`
from the ShellService example in the docs does not exist in the SDK.

### Commands cannot be hidden from search

**SOURCE**, `ExtensionCommand` in `extensions/mod.rs`. There is no `hidden`, no
`excludeFromSearch` — the legal fields are `id`, `name`, `description`,
`trigger`, `mode`, `icon`, `component`, `schedule`, `preferences`, `actions`,
`arguments`, `requireAnyOf`, `searchBarAccessory`. Every declared command shows
in root search, including a pure `mode: "background"` maintenance command.

Practical consequence: an internal command needs a name that does not compete
with the real one. Back when this extension shipped a German UI, the scheduled
cache refresh was called “Kontakte aktualisieren” and outranked the actual
command “Kontakte durchsuchen” on the input `kon`. Renaming it to “Refresh
address book cache” put it out of the way, with no change to its schedule.

### `platforms` is spelled `macos`, not `mac`

**OBSERVED.** The tutorials show `"platforms": ["mac"]`. `asyar validate` rejects
it; the valid values are `macos`, `windows`, `linux` — the same ones
`discovery.rs` and `installer.rs` use.

### Only six keys reach an open panel

**SOURCE**, `launcherKeyboard.ts` `tryRouteToActiveView`, **OBSERVED** through the
working key map. While the search bar has focus, the launcher intercepts
`ArrowUp/Down/Left/Right`, `Enter` and `Tab`, calls `preventDefault()` and
re-delivers them as `asyar:view:keydown` — **including** the modifier flags:

```ts
extensionManager.forwardKeyToActiveView({
  key: event.key, shiftKey, ctrlKey, metaKey, altKey,
});
```

The entire key map rests on this. Modified Enter is the only way to get more than
one single-keystroke action out of a panel that is being typed into. `⌘C` and
similar only reach the iframe once focus is already inside it, via a mouse click.

Consequence: the highlight has to be pure state. `.focus()` on a row would take
focus off the search bar and end the typing that drives the filter.

### There is no opener service

**SOURCE** plus **OBSERVED** through a connected call.
`ctx.getService('opener')` throws — `opener` is in no proxy bag. The route is
`messageBroker.invoke('opener:open', { url })` under `shell:open-url`.
`messageBroker` comes from `asyar-sdk/contracts`, so it is reachable from the
worker too.

### Manifest pitfalls

- Rust reads `ExtensionManifest` with `#[serde(deny_unknown_fields)]` — a single
  unknown top-level key makes discovery fail, without `asyar validate` saying
  anything.
- `description` must be 10–200 characters. Undocumented.
- Manifest `actions` have a `shortcut` field that is **display only**. Real
  in-panel shortcuts have to be handled by the extension itself.
- Registration order is load-bearing: `registerManifest()` **before**
  `registerExtensionImplementation()`, otherwise the implementation is dropped
  without comment.

---

## Still open

- **Root search.** `enableExtensionSearch` is `true` on this machine, so a
  `search()` implementation in the worker would surface contacts directly in the
  main search. The worker would have to hold the index in memory: root search is
  capped at **200 ms** (**SOURCE**), and one cache read per keystroke does not
  fit.
- **Incremental refresh.** `CNChangeHistory` would reduce the 3.4-second run to a
  delta. Not needed so far for a 30-minute background refresh.
- **Row cap.** The panel renders at most 200 rows and states how many it is
  holding back. At 2713 contacts, virtualisation is the real answer if anyone
  wants to scroll unfiltered.
- **Telegram.** Installed and registered on this machine (`tg://resolve?phone=`),
  the same handful of lines as WhatsApp.
