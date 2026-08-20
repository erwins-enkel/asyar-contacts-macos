#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// No real address book in this repository.
//
// This extension reads its user's contacts. While developing it is tempting to
// grab a real record as a test fixture — and that is exactly what happened here
// once: real names and phone numbers of third parties ended up in the tests and
// in a commit. It was only noticed when it came to publishing.
//
// Care is not a countermeasure. So it is checked.
//
// The principle is an **allowlist, not a denylist**: a denylist would have to
// know which numbers are real, and it cannot. Instead every phone-number- or
// email-shaped string has to be listed below as explicitly invented. Adding a
// new test number is therefore a deliberate act, not an oversight.
//
// Names cannot be checked this way — for those the rule is the one the error
// message states and `normalize.test.ts` documents at the top: Germany's
// canonical placeholder people (Max/Erika Mustermann, Lieschen Müller,
// Musterfirma GmbH), never anyone real.
// ─────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Invented phone numbers, normalised to digits (no +, spaces or slashes).
 *  Every one is deliberately an obvious run — 1234567, 765432, 1112223, 0000 —
 *  so that nobody mistakes them for real while reading. */
const ALLOWED_NUMBERS = new Set([
  // Mobile
  '491721234567', '01721234567',
  '491511234567', '01511234567',
  '491701234567', '00491701234567',
  '491701112223', '01701112223',
  // Landline with area code
  '497131123456', '07131123456',
  '497131123400', '00497131123400',
  '497195765432', '07195765432',
  '497111234567',
  '49301',
  // North America: 555-01xx is reserved for fiction
  '5551234567', '15551234567',
  // Only ever used to exercise a failure path
  '490000000000',
  // Prefixes used as search queries in tests
  '4915112',
]);

/** Email addresses may only come from these domains: the RFC 2606 example
 *  domains and the author's own. */
const ALLOWED_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net',
  'osthoff.blog',
  'b.de', // 'a@b.de' — the shortest possible obvious dummy
]);

const SCANNED = /\.(ts|svelte|md|json|html|mjs|js)$/;

/** This file is the registry itself; scanning it would report every allowed
 *  entry as a finding. */
const SELF = 'scripts/check-no-personal-data.mjs';

/** Phone-number-shaped: international (+…), the 00 spelling, or national with
 *  a leading 0 and an area code. At least six digits, so version numbers,
 *  timestamps and bare country codes do not get caught. */
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
      findings.push({ file, line: index + 1, kind: 'phone number', value: match[0].trim() });
    }
    for (const match of line.matchAll(EMAIL)) {
      const domain = match[0].split('@')[1]?.toLowerCase() ?? '';
      if (ALLOWED_EMAIL_DOMAINS.has(domain)) continue;
      findings.push({ file, line: index + 1, kind: 'email address', value: match[0] });
    }
  });
}

if (findings.length > 0) {
  console.error('\ncheck-no-personal-data: found data that is not on the allowlist.\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.kind}: ${f.value}`);
  }
  console.error(`
This extension reads address books. Nothing real belongs in the repository —
not in tests, not in comments, documentation or commit messages.

If the finding is invented, add it to ALLOWED_NUMBERS or
ALLOWED_EMAIL_DOMAINS in ${SELF}.
Pick digit runs nobody would mistake for real (1234567, 765432, 1112223).

The same rule applies to names, just without a check: Max/Erika Mustermann,
Lieschen Müller, Musterfirma GmbH.
`);
  process.exit(1);
}

console.log('check-no-personal-data: ok (no real phone numbers or email addresses)');
