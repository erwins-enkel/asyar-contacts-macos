#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// One standing check on the build output, run after `vite build`.
//
// `view.ts` and `worker.ts` share modules — `manifest.json`, the whole
// `src/contacts/` layer — so Rollup emits a chunk that view.html *and*
// worker.html load. `asyar-sdk/view` and `asyar-sdk/worker` each throw at
// module load when `window.__ASYAR_ROLE__` does not match. If such an
// assertion were ever hoisted into that shared chunk, the worker iframe would
// throw on every boot, with a message pointing at the SDK rather than at this
// build, and the only visible symptom would be the launcher logging
// `[workerRegistry] unmount <id> reason=timeout` three seconds later.
//
// The rule this enforces: modules shared between the two entries take their
// types from `asyar-sdk/contracts` only.
// ─────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** The `./assets/x.js` / `./view.js` references an HTML entry loads. */
function scriptsIn(htmlFile) {
  const html = readFileSync(join(dist, htmlFile), 'utf8');
  return new Set(html.match(/\.\/(assets\/)?[A-Za-z0-9._-]+\.js/g) ?? []);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const failures = [];

let viewScripts;
let workerScripts;
try {
  viewScripts = scriptsIn('view.html');
  workerScripts = scriptsIn('worker.html');
} catch {
  console.error('check-bundle: no dist/ to check — run `npm run build` first.');
  process.exit(1);
}

const shared = [...viewScripts].filter((s) => workerScripts.has(s));
if (shared.length === 0) {
  // Not an error, but worth knowing: it means the entries stopped sharing the
  // manifest import, which would be a surprising change.
  console.log('check-bundle: no shared chunks.');
}

const ASSERTION = 'Imported outside a';

for (const script of shared) {
  const file = join(dist, script.replace(/^\.\//, ''));
  if (readFileSync(file, 'utf8').includes(ASSERTION)) {
    failures.push(`${script} is loaded by both entries and contains a role assertion.`);
  }
}

// Each entry must keep exactly the one assertion its own SDK import carries.
for (const [entry, expected] of [
  ['view.js', 1],
  ['worker.js', 1],
]) {
  const count = readFileSync(join(dist, entry), 'utf8').split(ASSERTION).length - 1;
  if (count !== expected) {
    failures.push(`${entry}: expected ${expected} role assertion, found ${count}.`);
  }
}

// `background.main` must name a file that exists — the launcher never resolves
// the string, but a missing worker bundle is a silent no-worker extension.
const manifest = JSON.parse(readFileSync(resolve(dist, '..', 'manifest.json'), 'utf8'));
const workerMain = manifest.background?.main;
if (workerMain) {
  const all = walk(dist).map((f) => f.slice(resolve(dist, '..').length + 1));
  if (!all.includes(workerMain)) {
    failures.push(`background.main is "${workerMain}", which the build does not produce.`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-bundle: ${failure}`);
  process.exit(1);
}

console.log(`check-bundle: ok (${shared.length} shared chunk(s), assertions confined to entries)`);
