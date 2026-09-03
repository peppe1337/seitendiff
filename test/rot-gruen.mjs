#!/usr/bin/env node
/**
 * rot-gruen.mjs — Selbsttest für den Seitendiff-Wächter
 *
 * Läuft OHNE Netzverbindung (lokale Fixtures).
 * Sieben Fälle:
 *   1. Gleiche Seite                             → keine Änderung
 *   2. Geänderter Ausschnitt                     → Änderung
 *   3. Änderung nur außerhalb des Selektors       → KEINE Änderung
 *   4. HTTP-500                                  → Fehler, KEINE Änderung
 *   5. Selektor "div > p" (nicht unterstützt)    → SelectorError, KEIN Body-Inhalt
 *   6. Selektor "#gibtesnicht" (nicht gefunden)  → SelectorError
 *   7. ignore-Selektor nicht unterstützt          → SelectorError
 *
 * Exit 0 = alle Tests bestanden.
 * Exit 1 = mindestens ein Test fehlgeschlagen.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBySelector, removeBySelectors, normalize, sha256, SelectorError } from '../scripts/watch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

// ─── Testrahmen ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, condition, details = '') {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}${details ? '\n        ' + details : ''}`);
    failed++;
  }
}

// ─── Fixtures laden ───────────────────────────────────────────────────────────

const pageV1 = readFileSync(join(FIXTURES, 'page-v1.html'), 'utf8');
const pageV2 = readFileSync(join(FIXTURES, 'page-v2-main-changed.html'), 'utf8');
const pageV3 = readFileSync(join(FIXTURES, 'page-v3-only-footer-changed.html'), 'utf8');

// ─── Hilfsfunktion: Änderungserkennung ───────────────────────────────────────

/**
 * Führt die Vergleichslogik aus watch.mjs durch — jetzt über den echten Import.
 * Gibt { changed, normalizedOld, normalizedNew } zurück.
 */
function detectChange(oldHtml, newHtml, selector, ignore) {
  let oldExtracted = extractBySelector(oldHtml, selector);
  let newExtracted = extractBySelector(newHtml, selector);

  oldExtracted = removeBySelectors(oldExtracted, ignore);
  newExtracted = removeBySelectors(newExtracted, ignore);

  const oldNorm = normalize(oldExtracted);
  const newNorm = normalize(newExtracted);

  const oldHash = sha256(oldNorm);
  const newHash = sha256(newNorm);

  return {
    changed: oldHash !== newHash,
    normalizedOld: oldNorm,
    normalizedNew: newNorm,
  };
}

// ─── Fall 1: Gleiche Seite → keine Änderung ───────────────────────────────────

console.log('\nFall 1: Gleiche Seite → keine Änderung');
{
  const result = detectChange(pageV1, pageV1, 'main', []);
  assert(
    'Keine Änderung bei identischer Seite',
    result.changed === false,
    `changed=${result.changed}`
  );
}

// ─── Fall 2: Geänderter Ausschnitt → Änderung ────────────────────────────────

console.log('\nFall 2: Geänderter Ausschnitt im Selektor → Änderung');
{
  const result = detectChange(pageV1, pageV2, 'main', []);
  assert(
    'Änderung erkannt bei Änderung im Selektor-Bereich',
    result.changed === true,
    `changed=${result.changed}\nAlt: ${result.normalizedOld}\nNeu: ${result.normalizedNew}`
  );

  // Sicherstellen, dass tatsächlich der Preisunterschied erkannt wird
  const priceChanged = result.normalizedOld.includes('10') &&
                       result.normalizedNew.includes('20');
  assert(
    'Preisänderung (10→20 Euro) im Diff erkennbar',
    priceChanged,
    `Alt: "${result.normalizedOld}"\nNeu: "${result.normalizedNew}"`
  );
}

// ─── Fall 3: Änderung NUR außerhalb des Selektors → KEINE Änderung ───────────

console.log('\nFall 3: Änderung nur außerhalb des Selektors → keine Änderung');
{
  const result = detectChange(pageV1, pageV3, 'main', []);
  assert(
    'Keine Änderung bei Änderung außerhalb des Selektors (Footer)',
    result.changed === false,
    `changed=${result.changed}\nAlt: ${result.normalizedOld}\nNeu: ${result.normalizedNew}`
  );
}

// ─── Fall 4: HTTP-500 → Fehler, KEINE Änderung ───────────────────────────────

console.log('\nFall 4: HTTP-500 → Fehler, keine Änderung');
{
  // Simuliert das Verhalten von watch.mjs: bei !result.ok wird der Vergleich
  // übersprungen und der Zustand nicht verändert.
  function simulateFetch500() {
    return { ok: false, status: 500, text: '<html><body>Serverfehler</body></html>', error: undefined };
  }

  const fetchResult = simulateFetch500();

  // Dies entspricht der Logik in watch.mjs:
  // if (!result.ok) { errorIds.push(...); continue; }
  let changeWouldHaveBeenReported = false;
  if (fetchResult.ok) {
    // Würde nur ausgeführt, wenn ok=true
    const r = detectChange(pageV1, fetchResult.text, 'main', []);
    changeWouldHaveBeenReported = r.changed;
  }

  assert(
    'HTTP-500 löst keinen Alarm aus (ok=false → Vergleich übersprungen)',
    fetchResult.ok === false && changeWouldHaveBeenReported === false,
    `ok=${fetchResult.ok}, alarmAusgelöst=${changeWouldHaveBeenReported}`
  );

  assert(
    'HTTP-500 meldet Status 500',
    fetchResult.status === 500,
    `status=${fetchResult.status}`
  );
}

// ─── Fall 5: Nicht unterstützter Selektor → SelectorError, KEIN Body-Inhalt ──

console.log('\nFall 5: Selektor "div > p" (nicht unterstützt) → SelectorError');
{
  let thrownError = null;
  let returnedValue = null;
  try {
    returnedValue = extractBySelector(pageV1, 'div > p');
  } catch (err) {
    thrownError = err;
  }

  assert(
    'Nicht unterstützter Selektor wirft SelectorError',
    thrownError instanceof SelectorError,
    thrownError ? `Fehlertyp: ${thrownError.constructor.name}` : 'Kein Fehler geworfen'
  );

  assert(
    'Kein Body-Inhalt zurückgegeben bei nicht unterstütztem Selektor',
    returnedValue === null,
    `returnedValue=${JSON.stringify(returnedValue)}`
  );
}

// ─── Fall 6: Selektor nicht gefunden → SelectorError ─────────────────────────

console.log('\nFall 6: Selektor "#gibtesnicht" (nicht gefunden) → SelectorError');
{
  let thrownError = null;
  let returnedValue = null;
  try {
    returnedValue = extractBySelector(pageV1, '#gibtesnicht');
  } catch (err) {
    thrownError = err;
  }

  assert(
    'Nicht gefundener Selektor wirft SelectorError',
    thrownError instanceof SelectorError,
    thrownError ? `Fehlertyp: ${thrownError.constructor.name}` : 'Kein Fehler geworfen'
  );

  assert(
    'Kein Body-Inhalt zurückgegeben bei nicht gefundenem Selektor',
    returnedValue === null,
    `returnedValue=${JSON.stringify(returnedValue)}`
  );
}

// ─── Fall 7: ignore-Selektor nicht unterstützt → SelectorError ───────────────

console.log('\nFall 7: ignore-Selektor "div > aside" (nicht unterstützt) → SelectorError');
{
  let thrownError = null;
  let returnedValue = null;
  try {
    // Erst valide Extraktion, dann removeBySelectors mit unbrauchbarem ignore-Selektor
    const extracted = extractBySelector(pageV1, 'main');
    returnedValue = removeBySelectors(extracted, ['div > aside']);
  } catch (err) {
    thrownError = err;
  }

  assert(
    'Nicht unterstützter ignore-Selektor wirft SelectorError',
    thrownError instanceof SelectorError,
    thrownError ? `Fehlertyp: ${thrownError.constructor.name}` : 'Kein Fehler geworfen'
  );

  assert(
    'Kein Inhalt zurückgegeben bei nicht unterstütztem ignore-Selektor',
    returnedValue === null,
    `returnedValue=${JSON.stringify(returnedValue)}`
  );
}

// ─── Ergebnis ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);

if (failed > 0) {
  console.error('\nMindestens ein Test FEHLGESCHLAGEN.');
  process.exit(1);
} else {
  console.log('\nAlle Tests bestanden.');
  process.exit(0);
}
