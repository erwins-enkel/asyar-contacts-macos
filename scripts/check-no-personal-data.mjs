#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Kein echtes Adressbuch im Repository.
//
// Diese Erweiterung liest die Kontakte ihres Nutzers. Beim Entwickeln liegt es
// nahe, einen echten Datensatz als Testfixture zu nehmen — und genau das ist
// hier einmal passiert: echte Namen und Rufnummern Dritter landeten in den
// Tests und in einem Commit. Aufgefallen ist es erst, als es ums
// Veröffentlichen ging.
//
// Sorgfalt reicht dagegen nicht. Also wird es geprüft.
//
// Das Prinzip ist eine **Allowlist, keine Denylist**: eine Denylist müsste
// wissen, welche Nummern echt sind, und das kann sie nicht. Stattdessen muss
// jede telefonnummer- oder mailadressenförmige Zeichenkette hier unten
// ausdrücklich als erfunden eingetragen sein. Eine neue Testnummer aufzunehmen
// ist damit eine bewusste Handlung, kein Versehen.
//
// Namen lassen sich so nicht prüfen — dafür gilt die Regel, die die
// Fehlermeldung nennt und die `normalize.test.ts` im Kopf dokumentiert:
// Deutschlands kanonische Platzhalterpersonen (Max/Erika Mustermann, Lieschen
// Müller, Musterfirma GmbH), nie jemand Echtes.
// ─────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Erfundene Rufnummern, in Ziffern normalisiert (ohne +, Leerzeichen, /).
 *  Jede hier ist bewusst als offensichtliche Folge gewählt — 1234567, 765432,
 *  1112223, 0000 — damit sie auch beim Lesen niemand für echt hält. */
const ALLOWED_NUMBERS = new Set([
  // Mobil
  '491721234567', '01721234567',
  '491511234567', '01511234567',
  '491701234567', '00491701234567',
  '491701112223', '01701112223',
  // Festnetz mit Vorwahl
  '497131123456', '07131123456',
  '497131123400', '00497131123400',
  '497195765432', '07195765432',
  '497111234567',
  '49301',
  // Nordamerika: 555-01xx ist für Fiktion reserviert
  '5551234567', '15551234567',
  // Nur für Fehlerfälle gedacht
  '490000000000',
  // Präfixe, die als Suchanfrage in Tests vorkommen
  '4915112',
]);

/** Mailadressen dürfen nur aus diesen Domains stammen: die
 *  RFC-2606-Beispieldomains und die des Autors. */
const ALLOWED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net',
  'osthoff.blog',
  'b.de', // 'a@b.de' — kürzestmögliche offensichtliche Attrappe
]);

const SCANNED = /\.(ts|svelte|md|json|html|mjs|js)$/;

/** Diese Datei ist die Registry selbst; sie zu scannen hieße, jeden erlaubten
 *  Eintrag als Fund zu melden. */
const SELF = 'scripts/check-no-personal-data.mjs';

/** Telefonnummerförmig: international (+…), 00-Schreibweise, oder national mit
 *  führender 0 und Vorwahl. Mindestens sechs Ziffern, damit Versionsnummern,
 *  Zeitstempel und Ländervorwahlen nicht hängenbleiben. */
const PHONE = /(?<!\d)(\+\d[\d\s/().-]{5,}\d|00\d[\d\s/().-]{5,}\d|0\d{1,4}[\s/.-]?\d{5,})(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f !== '' && SCANNED.test(f) && f !== SELF);
}

const findings = [];

for (const file of trackedFiles()) {
  const text = readFileSync(resolve(root, file), 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    for (const match of line.matchAll(PHONE)) {
      const digits = match[0].replace(/\D/g, '');
      if (ALLOWED_NUMBERS.has(digits)) continue;
      findings.push({ file, line: index + 1, kind: 'Rufnummer', value: match[0].trim() });
    }
    for (const match of line.matchAll(EMAIL)) {
      const domain = match[0].split('@')[1]?.toLowerCase() ?? '';
      if (ALLOWED_EMAIL_DOMAINS.has(domain)) continue;
      findings.push({ file, line: index + 1, kind: 'Mailadresse', value: match[0] });
    }
  });
}

if (findings.length > 0) {
  console.error('\ncheck-no-personal-data: nicht freigegebene Daten gefunden.\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.kind}: ${f.value}`);
  }
  console.error(`
Diese Erweiterung liest Adressbücher. Nichts Echtes gehört ins Repository —
weder in Tests noch in Kommentare, Dokumentation oder Commit-Nachrichten.

Wenn der Fund erfunden ist, trag ihn in ALLOWED_NUMBERS bzw.
ALLOWED_EMAIL_DOMAINS in ${SELF} ein.
Wähle Ziffernfolgen, die auch beim Lesen niemand für echt hält (1234567,
765432, 1112223).

Für Namen gilt dieselbe Regel, nur ohne Prüfung: Max/Erika Mustermann,
Lieschen Müller, Musterfirma GmbH.
`);
  process.exit(1);
}

console.log('check-no-personal-data: ok (keine echten Rufnummern oder Mailadressen)');
