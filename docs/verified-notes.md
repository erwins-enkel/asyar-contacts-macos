# Verifizierte Erkenntnisse

Was dieses Projekt über Asyar und die macOS-Kontakte tatsächlich weiß, und woher.

**Stand:** 18.08.2026 · Asyar `0.1.1-42` (`/Applications/asyar.app`, `org.asyar.app`) ·
`asyar-sdk` 4.7.0 · macOS 26.5.1 · Node 24 · vite 6.4.3 · Svelte 5 · TypeScript 5.

| Marker | Bedeutung |
| --- | --- |
| **BELEGT** | Auf diesem Rechner ausgeführt und beobachtet. |
| **QUELLE** | Aus dem Launcher- oder SDK-Code gelesen, nicht ausgeführt. |

---

## macOS

### Kontakte lesen: JXA + Contacts-Framework

**BELEGT.** `osascript -l JavaScript -e <skript> list` mit
`ObjC.import('Contacts')` und `CNContactStore.enumerateContacts` liefert
**2713 Kontakte in ~3,4 s**. Ohne Memoisierung von
`CNLabeledValue.localizedStringForLabel` waren es ~4,1 s — dieselben paar Labels
werden über tausende Datensätze hinweg neu lokalisiert, und jede Auflösung ist
eine Brückenüberquerung.

Fallstricke, alle beim ersten Versuch aufgetreten:

- `$.CNContactStore.authorizationStatusForEntityType(...)` liefert kein JS-`number`.
  `JSON.stringify` machte `"3"` daraus und `status !== 3` war wahr. `Number(...)`
  drumherum. Dasselbe gilt für `contact.contactType` und `list.count`.
- `$.NSArray.arrayWithObjects(a, b, c)` wirft
  `wrong number of arguments for selector`. Stattdessen ein JS-Array bridgen:
  `$(['givenName', 'familyName', …])`.
- Die Keys sind schlicht die Property-Namen (`ObjC.unwrap($.CNContactGivenNameKey)`
  → `"givenName"`), String-Literale funktionieren also genauso.

Die Alternative — AppleScript gegen Contacts.app — wurde nicht genommen: sie
startet die App, löst einen Automation-Dialog aus und ist um Größenordnungen
langsamer.

### TCC: Asyar bekommt die Kontaktfreigabe

**BELEGT.** `/Applications/asyar.app/Contents/Info.plist` enthält **kein**
`NSContactsUsageDescription` — das war das größte offene Risiko dieses Projekts,
weil ein fehlender Usage-String die Systemabfrage normalerweise verhindert.

Trotzdem funktioniert es: nach dem ersten Lesevorgang aus dem Panel steht in
`~/Library/Application Support/com.apple.TCC/TCC.db`

```
kTCCServiceAddressBook|org.asyar.app|2      -- 2 = erlaubt
```

Die Freigabe wird also dem verantwortlichen Prozess (Asyar) zugeschrieben, nicht
dem gespawnten `osascript`. Sollte das auf einem anderen System scheitern, wäre
der saubere Fix, `NSContactsUsageDescription` upstream in Asyars `tauri.conf`
aufzunehmen.

### URL-Schemata auf macOS 26

**BELEGT** über `NSWorkspace.URLForApplicationToOpenURL`:

| Schema | Handler |
| --- | --- |
| `tel:` | **Phone.app** — führt den Anruf über das gekoppelte iPhone |
| `facetime-audio:` | Phone.app |
| `facetime:` | FaceTime.app |
| `sms:` / `imessage:` | Messages.app |
| `addressbook:` | Contacts.app |
| `x-apple.systempreferences:` | System Settings.app |

**BELEGT** über den laufenden Launcher: Enter auf einem markierten Kontakt öffnet
`tel:` und der Anruf läuft — sichtbar als „mit deinem iPhone" im Anruf-Overlay.

`addressbook://<uuid>:ABPerson` muss **unkodiert** bleiben. Mit
prozentkodiertem Doppelpunkt nimmt LaunchServices die URL zwar an, Contacts.app
löst sie aber nicht zu einer Person auf.

---

## Asyar

### `searchable: true` ist das, was die Suchleiste ans Panel hängt

**BELEGT**, erklärt durch **QUELLE**. Ohne das Flag bleibt Asyars Suchfeld bei
geöffnetem View unbenutzbar („Press Escape to go back") und das Panel bekommt
nie eine Anfrage.

Der Pfad ist `searchController.svelte.ts` Effekt 5:

```ts
} else if (state.activeViewVal && state.activeViewSearchableVal && …) {
  extensionManager.handleViewSearch(state.localSearchValue);
}
```

und `activeViewSearchableVal` kommt aus `viewManager.navigateTo`:
`searchable: manifest.searchable ?? false`. `handleViewSearch` selbst prüft
nichts weiter — das Flag ist das ganze Tor.

**Nebenwirkung, geprüft und harmlos:** `searchable: true` lässt den Launcher auch
Root-Suchanfragen als `asyar:search:request` an den Worker schicken. Hat die
registrierte Implementierung keine `search()`-Methode, antwortet die
`ExtensionBridge` des SDK sofort mit `[]` (**QUELLE**,
`ExtensionBridge.js` Zeile ~185). Kein Hänger, kein Timeout.

### Berechtigungen werden komplett zurückgehalten, bis sie bestätigt sind

**BELEGT.** Eine frisch verlinkte Erweiterung hat keinen Consent-Eintrag, und
Rust registriert sie dann mit **null** Berechtigungen — nicht etwa nur ohne die
neue. Sichtbar wurde das als:

- `context.preferences.refresh()` rejected,
- `shell.spawn()` meldete `SPAWN_FAILED`,
- der Launcher zeigte „blog.osthoff.contacts promise was rejected".

Keine dieser Meldungen sagt „bestätige die Berechtigungen", was das Einzige ist,
das hilft. Deshalb gibt es `src/contacts/diagnose.ts`: es erkennt die Wortlaute
und zeigt stattdessen den Weg (Einstellungen → Extensions → Kontakte →
Berechtigungen bestätigen).

Zwei Bugs kamen mit derselben Ursache ans Licht und sind gefixt:

1. `boot()` hatte keine Fehlergrenze. Eine abgelehnte Promise wurde nie
   gefangen, das Panel blieb für immer beim Spinner.
2. `preferences.refresh()` wurde ungeschützt awaited. Es fällt jetzt auf die
   Defaults zurück — eine vollständige, funktionierende Konfiguration.

Nach der Bestätigung stand in `asyar_data.db`:

```
shell_trusted_binaries: blog.osthoff.contacts | /usr/bin/osascript
```

Das Binary ist im Manifest unter `permissionArgs["shell:spawn"]` deklariert,
damit es im Consent-Dialog erscheint, statt später unvermittelt aus dem
Hintergrund-Worker zu fragen.

**Auch `permissionArgs` allein löst den Gate erneut aus.** **BELEGT:** das
Hinzufügen von `whatsapp` zu `permissionArgs["shell:open-url"]` — ohne jede
Änderung an der `permissions`-Liste — setzte die Erweiterung wieder auf null
Berechtigungen zurück. Das ist konsequent, denn die Args erweitern den Umfang;
aber es heißt, dass jede neue URL-Schema-Freigabe einen Gang in die
Einstellungen kostet.

**Der Wortlaut im Log ist nicht stabil.** Beim ersten Mal war es
*„Withholding permission registration … declared permissions exceed recorded
consent"*, beim zweiten Mal:

```
[PermissionGate] BLOCKED: Extension "blog.osthoff.contacts" is not registered
in the permission registry.
```

Nach der ersten Formulierung zu grepen ergab beim zweiten Mal nichts, und der
Schluss „keine erneute Freigabe nötig" war falsch — das Panel zeigte den
Freigabe-Bildschirm. Verlass dich für diese Frage auf das Panel, nicht auf einen
Log-Grep. `looksLikePermissionProblem` in `src/contacts/diagnose.ts` fängt beide
Formulierungen, weil es auf das Wort `permission` prüft statt auf einen Satz.

### `asyar link --copy`, nicht das blanke `asyar link`

**QUELLE**, `uri_schemes.rs`. Die Symlink-Variante scheitert im Release-Build:
der Scheme-Handler kanonisiert den Treffer und prüft ihn gegen
`is_path_allowed()`; die Regel für beliebige Symlink-Ziele steht hinter
`#[cfg(debug_assertions)]`. Ergebnis wäre **403** für `view.html` — sichtbar nur
als leeres Panel und `[workerRegistry] unmount … reason=timeout` im Log.

### Ein umbenannter Befehl behält seinen alten Namen in der Suche

**BELEGT.** Der Launcher hält jeden Befehl in `search_index.db` (Tabelle
`search_items`, eine JSON-Spalte `data` pro Zeile, Schlüssel
`cmd_<extensionId>_<commandId>`) und schreibt den `name` beim Registrieren
**nicht** neu. Nach `manifest.json` → `link --copy` → Neustart stand dort
weiterhin:

```json
{"id":"cmd_blog.osthoff.contacts_contacts","name":"Kontakte","usageCount":7, …}
```

Die Zeile trägt auch die Häufigkeitsdaten (`usageCount`, `lastUsedAt`), aus denen
sich das Ranking speist. Sie einfach zu löschen erzwingt zwar den neuen Namen,
wirft aber genau diese Daten weg — der Befehl rutschte danach von Platz 1 auf
Platz 4, hinter macOS' eigene Kontakte.app.

**Der richtige Weg** ist, das JSON an Ort und Stelle zu aktualisieren, bei
beendetem Launcher (im laufenden Betrieb überschreibt Asyar die Zeile wieder):

```python
d = json.loads(row['data'])
d['name'] = 'Neuer Name'
if d.get('trigger'): d['trigger'] = d['name']   # trigger folgt per Default dem Namen
```

**BELEGT:** so gesetzt übersteht der neue Name den Neustart, und `usageCount`
bleibt stehen.

### Befehle lassen sich nicht aus der Suche ausblenden

**QUELLE**, `ExtensionCommand` in `extensions/mod.rs`. Es gibt kein `hidden`,
kein `excludeFromSearch` — die legalen Felder sind `id`, `name`, `description`,
`trigger`, `mode`, `icon`, `component`, `schedule`, `preferences`, `actions`,
`arguments`, `requireAnyOf`, `searchBarAccessory`. Jeder deklarierte Befehl
erscheint in der Root-Suche, auch ein reiner `mode: "background"`-Wartungsbefehl.

Praktische Folge: ein interner Befehl braucht einen Namen, der nicht mit dem
eigentlichen konkurriert. Der geplante Cache-Refresh hieß erst „Kontakte
aktualisieren" und rangierte bei der Eingabe `kon` über „Kontakte durchsuchen";
als „Adressbuch-Cache auffrischen" enthält er kein `kon` mehr und ist aus dem
Weg, ohne dass der Zeitplan sich ändert.

### `platforms` heißt `macos`, nicht `mac`

**BELEGT.** Die Tutorials zeigen `"platforms": ["mac"]`. `asyar validate` lehnt
das ab; gültig sind `macos`, `windows`, `linux` — dieselben Werte, die
`discovery.rs` und `installer.rs` verwenden.

### Nur sechs Tasten erreichen ein offenes Panel

**QUELLE**, `launcherKeyboard.ts` `tryRouteToActiveView`, **BELEGT** durch die
funktionierende Belegung. Solange die Suchleiste den Fokus hat, fängt der
Launcher `ArrowUp/Down/Left/Right`, `Enter` und `Tab` ab, ruft `preventDefault()`
und liefert sie als `asyar:view:keydown` nach — **inklusive** der Modifier-Flags:

```ts
extensionManager.forwardKeyToActiveView({
  key: event.key, shiftKey, ctrlKey, metaKey, altKey,
});
```

Darauf beruht die gesamte Tastenbelegung. Modifiziertes Enter ist die einzige
Möglichkeit, aus einem Panel, in das getippt wird, mehr als eine
Ein-Tasten-Aktion zu holen. `⌘C` und Ähnliches erreichen das Iframe nur, wenn
der Fokus per Mausklick schon drin ist.

Folge: Die Markierung muss reiner Zustand sein. `.focus()` auf einer Zeile nähme
den Fokus aus der Suchleiste und beendete das Tippen, das die Liste filtert.

### Es gibt keinen Opener-Service

**QUELLE** plus **BELEGT** über den laufenden Anruf.
`ctx.getService('opener')` wirft — `opener` liegt in keiner Proxy-Tasche. Der Weg
ist `messageBroker.invoke('opener:open', { url })` unter `shell:open-url`.
`messageBroker` kommt aus `asyar-sdk/contracts` und ist damit auch aus dem Worker
erreichbar.

### Manifest-Fallstricke

- Rust liest `ExtensionManifest` mit `#[serde(deny_unknown_fields)]` — ein
  einziger unbekannter Top-Level-Key lässt die Erkennung scheitern, ohne dass
  `asyar validate` etwas sagt.
- `description` muss 10–200 Zeichen haben. Undokumentiert.
- Manifest-`actions` haben ein `shortcut`-Feld, das **nur angezeigt** wird. Echte
  Tastenkürzel im Panel muss die Erweiterung selbst behandeln.
- Registrierungsreihenfolge ist tragend: `registerManifest()` **vor**
  `registerExtensionImplementation()`, sonst wird die Implementierung
  kommentarlos verworfen.

---

## Noch offen

- **Root-Suche.** `enableExtensionSearch` steht auf diesem Rechner auf `true`,
  eine `search()`-Implementierung im Worker würde Kontakte also direkt in der
  Hauptsuche zeigen. Der Worker müsste den Index dafür im Speicher halten: die
  Root-Suche ist auf **200 ms** gedeckelt (**QUELLE**), ein Cache-Lesen pro
  Tastendruck reicht nicht.
- **Inkrementelle Aktualisierung.** `CNChangeHistory` würde den 3,4-Sekunden-Lauf
  auf ein Delta reduzieren. Für den Hintergrund-Refresh alle 30 Minuten bisher
  nicht nötig.
- **Zeilen-Deckel.** Das Panel rendert höchstens 200 Zeilen und zeigt an, wie
  viele es zurückhält. Bei 2713 Kontakten ist Virtualisierung die eigentliche
  Antwort, falls jemand ungefiltert scrollen will.
