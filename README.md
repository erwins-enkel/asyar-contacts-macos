# Kontakte — macOS Contacts für Asyar

Deine macOS-Kontakte direkt im Asyar-Launcher: tippen, markieren, `⏎` — und die
Nummer wird über **Telefon.app** und damit über dein gekoppeltes iPhone gewählt.

`blog.osthoff.contacts` · nur macOS · liest ausschließlich lokal, kein Netzwerk.

---

## Was sie kann

| Taste | Aktion |
| --- | --- |
| `↑` `↓` | Kontakt wechseln |
| `←` `→` | zwischen den Nummern des markierten Kontakts wechseln |
| `⏎` | **Anrufen** (`tel:` → Telefon.app → iPhone) |
| `⌘⏎` | FaceTime Video |
| `⌥⏎` | Nachricht (Messages) |
| `⌥⌘⏎` | E-Mail |
| `⇧⏎` | Nummer in die Zwischenablage |
| `⇧⌘⏎` | in der Kontakte-App öffnen |
| `⌘K` | Aktionsleiste mit allen Aktionen, inkl. FaceTime Audio und „Kontakte neu laden“ |

Gefiltert wird über **Asyars eigene Suchleiste** — die Erweiterung hat bewusst
kein eigenes Eingabefeld, weil der Fokus sonst aus dem Launcher wandern würde.
Gesucht wird über Name, Firma, Spitzname, Jobtitel, jede E-Mail-Adresse und jede
Rufnummer, sowohl in gespeicherter als auch in Wählform (`0172 …` **und**
`+49172 …` finden denselben Kontakt).

Was Enter macht, ist einstellbar — siehe **Einstellungen** unten.

## Installation

```bash
npm install
npm run build
npx asyar link --copy      # nicht das blanke `asyar link`, siehe unten
```

Danach **Asyar neu starten**: der Launcher scannt sein Extensions-Verzeichnis
nur beim Start.

Beim ersten Öffnen sind zwei Freigaben nötig, jeweils einmalig:

1. **Asyar → Einstellungen (⌘,) → Extensions → „Kontakte“ → Berechtigungen
   bestätigen.** Bis das passiert ist, hält Asyar *alle* Berechtigungen der
   Erweiterung zurück — auch die, die mit dem gerade fehlgeschlagenen Aufruf
   nichts zu tun haben. Das Panel erklärt diesen Zustand, statt zu hängen.
2. **macOS: „asyar möchte auf deine Kontakte zugreifen“ → Erlauben.** Das
   Panel bietet dafür einen Knopf an und verlinkt sonst in die
   Systemeinstellungen.

Zusätzlich fragt Asyar einmalig, ob die Erweiterung `/usr/bin/osascript`
starten darf. Das Binary ist im Manifest unter `permissionArgs["shell:spawn"]`
deklariert, damit die Frage im Consent-Dialog erscheint und nicht später
unvermittelt aus dem Hintergrund-Worker kommt.

## Einstellungen

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| Enter-Taste | Anrufen | Was `⏎` auslöst — Anruf, FaceTime, Nachricht oder Kopieren |
| Landesvorwahl | `auto` | Vorwahl für national gespeicherte Nummern. `auto` nimmt die Region aus macOS; leer lässt Nummern unverändert |
| Bevorzugte Rufnummern | `iPhone, Mobil, …` | Reihenfolge, in der Nummern-Labels gewählt werden |
| Kontaktfotos anzeigen | an | Foto des markierten Kontakts nachladen |
| Firmen einschließen | an | reine Firmenkontakte mit anzeigen |
| Im Hintergrund aktualisieren | an | Cache alle 30 Minuten auffrischen |

## Wie sie funktioniert

### Kontakte lesen

Eine Asyar-Erweiterung kann kein natives Helferprogramm mitliefern; der einzige
Weg zum Betriebssystem ist `ShellService.spawn()`. Also läuft der macOS-Teil als
JXA-Skript in `/usr/bin/osascript` (`src/contacts/jxa.ts`) und spricht über die
ObjC-Brücke direkt mit dem **Contacts-Framework**.

Das ist bewusst *nicht* AppleScript gegen Contacts.app: kein App-Start, kein
Automation-Dialog, und `CNContactStore.enumerateContacts` streamt. Gemessen auf
diesem Rechner: **2713 Kontakte in ~3,4 s**.

Ausgabe ist ein JSON-Objekt pro Zeile, Kontakte in Blöcken zu 250 — `ShellService`
liefert stdout zeilenweise, und 2700 einzelne postMessage-Runden wären teurer als
elf dicke.

### Warum gecacht wird

Drei Sekunden pro Panel-Öffnung wäre keine Launcher-Erfahrung. Der aufbereitete
Index landet im Extension-Cache; das Panel zeichnet ihn sofort und schiebt den
frischen Lesevorgang dahinter (`STALE_AFTER_MS`, 15 Minuten). Der Worker frischt
zusätzlich alle 30 Minuten auf — aber **nie den ersten** Lesevorgang: die
macOS-Kontaktabfrage soll immer sichtbar dadurch entstehen, dass jemand das
Panel geöffnet hat, nie unvermittelt aus einem unsichtbaren Iframe.

### Wählen

`messageBroker.invoke('opener:open', { url })` unter `shell:open-url`. Einen
typisierten Opener-Service gibt es im SDK nicht — `getService('opener')` wirft.
`tel:` ist auf macOS 26 mit Telefon.app verknüpft, das den Anruf über das
gekoppelte iPhone führt. `facetime:`, `facetime-audio:`, `sms:` und
`addressbook:` sind über `permissionArgs["shell:open-url"]` freigeschaltet;
`tel:` und `mailto:` deckt die Basisberechtigung ab.

Nummern werden vor dem Wählen nach E.164 normalisiert, aber nur, wo das
eindeutig ist (`src/contacts/phone.ts`): `+…` bleibt, `00…` wird zu `+…`, eine
führende `0` wird durch die Landesvorwahl ersetzt. Eine Nummer *ohne*
Verkehrsausscheidungsziffer bleibt unverändert — ihr fehlt jeder Hinweis auf das
Land, und Raten würde einen anderen Anschluss wählen.

Fax-Nummern rutschen immer ans Ende der Liste. Enter wählt, und ein Faxgerät ist
die eine Nummer im Adressbuch, die nie die Vorauswahl sein darf.

### Tastatur

Während Asyars Suchleiste den Fokus hat — der Normalfall, sie ist ja das Filter —
fängt der Launcher Tasten ab, bevor sie im Iframe DOM-Events werden, und liefert
genau sechs davon als `asyar:view:keydown` nach: `↑ ↓ ← →`, `⏎`, `Tab`. Die
Modifier-Flags kommen mit. Genau darauf beruht die Tastenbelegung: modifiziertes
Enter ist die einzige Möglichkeit, aus einem Panel, in das man tippt, mehr als
eine Ein-Tasten-Aktion herauszuholen.

Deshalb ist die Markierung reiner Zustand (`selectedId`) und nie DOM-Fokus —
`.focus()` auf einer Zeile würde den Fokus aus der Suchleiste nehmen und das
Tippen beenden, das die Liste filtert.

## Entwicklung

```bash
npm run check     # tsc --noEmit && svelte-check
npm test          # 74 Unit-Tests über die reine Schicht
npm run build     # vite build + Bundle-Prüfung
npm run validate  # asyar validate
```

Nach jedem Build `npx asyar link --copy` erneut ausführen; das Panel lädt beim
nächsten Öffnen frisch. Manifest-Änderungen brauchen einen Asyar-Neustart.

**`asyar link --copy`, nicht das blanke `asyar link`.** Die Standardvariante legt
einen Symlink an. Der Rust-Scheme-Handler kanonisiert den Treffer und prüft ihn
gegen `is_path_allowed()`; die Regel, die beliebige Symlink-Ziele erlauben würde,
steht hinter `#[cfg(debug_assertions)]`. Im Release-Build liefert `view.html`
darum **403** — sichtbar nur als leeres Panel plus
`[workerRegistry] unmount … reason=timeout` im Log.

`scripts/check-bundle.mjs` läuft nach jedem Build und prüft die eine Sache, die
still kaputtgehen kann: `view.ts` und `worker.ts` teilen sich Module, also gibt
Rollup einen gemeinsamen Chunk aus. `asyar-sdk/view` und `asyar-sdk/worker`
werfen beim Laden, wenn `window.__ASYAR_ROLE__` nicht passt — landet so eine
Prüfung im geteilten Chunk, stirbt der Worker bei jedem Start mit einer Meldung,
die auf das SDK zeigt statt auf diesen Build. Regel: geteilte Module beziehen
ihre Typen nur aus `asyar-sdk/contracts`.

## Aufbau

```
manifest.json          Berechtigungen, Befehle, Einstellungen
view.html / worker.html   Einstiegspunkte; die Dateinamen bestimmen __ASYAR_ROLE__
src/view.ts            Bootstrap des Panels
src/worker.ts          geplanter Cache-Refresh + Root-Search-Aktion
src/ContactsView.svelte   das Panel
src/opener.ts          der eine Weg, eine URL an macOS zu geben
src/contacts/
  jxa.ts               das macOS-Skript, als String
  protocol.ts          stdout → Datensätze
  loader.ts            ShellService-Orchestrierung
  normalize.ts         Rohdaten → anzeigbare Kontakte
  phone.ts             Nummern-Normalisierung, tel:/facetime:/sms:-URLs
  dialingCodes.ts      ISO-Region → Landesvorwahl
  search.ts            Filtern und Ranking
  selection.ts         Markierungs-Arithmetik
  keys.ts              die Tastenbelegung
  diagnose.ts          Fehler → was der Mensch tun soll
  cache.ts             Index-Persistenz
```

Alles unter `src/contacts/` ist rein und in `node` testbar — es importiert
höchstens Typen aus `asyar-sdk/contracts`, nie die rollenprüfenden Einstiege.
