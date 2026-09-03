#!/usr/bin/env node
/**
 * watch.mjs — Seitendiff-Wächter
 *
 * Ruft Seiten aus watch.config.json ab, vergleicht mit dem letzten Stand
 * und meldet Änderungen. Kein npm, reine Node-Standardbibliothek.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── SelectorError ────────────────────────────────────────────────────────────

class SelectorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SelectorError';
  }
}

// ─── Void-Elemente (kein schließendes Tag) ───────────────────────────────────

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Selektor-Muster ──────────────────────────────────────────────────────────

// Unterstützte Formen: tag, .klasse, #id, tag.klasse, tag#id
const SELECTOR_PATTERN = /^([a-zA-Z][a-zA-Z0-9]*)?([.#][a-zA-Z0-9_-]+)?$/;

/**
 * Zerlegt einen unterstützten Selektor in { tag, id, cls }.
 * Wirft SelectorError bei nicht unterstützter Form.
 * Leerer Selektor → { tag: null, id: null, cls: null }
 */
function parseSelector(selector) {
  if (!SELECTOR_PATTERN.test(selector)) {
    throw new SelectorError(`Nicht unterstützter Selektor: "${selector}"`);
  }
  const m = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)?([.#][a-zA-Z0-9_-]+)?$/);
  const tag = m[1] || null;
  const modifier = m[2] || null;
  let id = null;
  let cls = null;
  if (modifier) {
    if (modifier[0] === '#') id = modifier.slice(1);
    else cls = modifier.slice(1);
  }
  return { tag, id, cls };
}

/**
 * Baut ein Regex, das den ersten passenden öffnenden Tag im HTML findet.
 * Der capture-Group 1 enthält den tatsächlichen Tag-Namen.
 *
 * Hinweis: Lookaheads prüfen Attribute; das Regex ist case-insensitive.
 */
function buildOpenTagRegex(parsed) {
  // Tag-Name-Muster für das Regex (capture group 1)
  const tagPat = parsed.tag ? escapeRegex(parsed.tag) : '[a-zA-Z][a-zA-Z0-9]*';

  // Lookaheads für Attribute
  let lookaheads = '';

  if (parsed.id) {
    // id-Attribut muss exakt diesen Wert haben
    // Erlaubt id="wert", id='wert' oder id=wert (kein Anführungszeichen)
    lookaheads += `(?=[^>]*\\bid="${escapeRegex(parsed.id)}"[^>]*)`;
  }

  if (parsed.cls) {
    // class-Attribut muss die Klasse als Wort enthalten
    lookaheads += `(?=[^>]*\\bclass="[^"]*(?:^|\\s)${escapeRegex(parsed.cls)}(?:\\s|")[^>]*)`;
  }

  // Das ganze öffnende Tag: <tagname[...attrs...]>
  // Capture Group 1 = Tag-Name (für spätere Tiefenzählung)
  const pattern = `<(${tagPat})${lookaheads}(?:\\s[^>]*)?>`;
  return new RegExp(pattern, 'i');
}

// ─── extractBySelector ────────────────────────────────────────────────────────

/**
 * Extrahiert das erste Element, das dem Selektor entspricht, inklusive Tags.
 * Arbeitet per Regex auf dem Rohstring (kein HTML-Parser).
 *
 * @param {string} html
 * @param {string} selector
 * @returns {string}
 * @throws {SelectorError}
 */
function extractBySelector(html, selector) {
  // Body-Inhalt ermitteln
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;

  // Leerer/fehlender Selektor → Body zurückgeben
  if (!selector || selector.trim() === '') {
    return body;
  }

  // Selektor parsen (wirft SelectorError bei ungültiger Form)
  const parsed = parseSelector(selector);

  // Falls nach dem Parsen alles null (kann eigentlich nicht passieren bei nicht-leerem Selektor)
  if (!parsed.tag && !parsed.id && !parsed.cls) {
    return body;
  }

  const openTagRegex = buildOpenTagRegex(parsed);

  // Ersten passenden öffnenden Tag im Body suchen
  const startMatch = openTagRegex.exec(body);
  if (!startMatch) {
    throw new SelectorError(`Selektor "${selector}" hat kein passendes Element gefunden`);
  }

  // Tatsächlicher Tag-Name aus Capture Group 1
  const tagName = startMatch[1];

  // Void-Element: kein schließendes Tag → nur das öffnende Tag zurückgeben
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) {
    return startMatch[0];
  }

  // Tiefenzählung für verschachtelte gleichnamige Tags
  const startPos = startMatch.index;
  const afterOpen = startPos + startMatch[0].length;

  const nestedOpenPattern = new RegExp(`<${escapeRegex(tagName)}(?:\\s[^>]*)?>`, 'gi');
  const closeTagPattern = new RegExp(`<\\/${escapeRegex(tagName)}>`, 'gi');

  nestedOpenPattern.lastIndex = afterOpen;
  closeTagPattern.lastIndex = afterOpen;

  let nextOpen = nestedOpenPattern.exec(body);
  let nextClose = closeTagPattern.exec(body);
  let depth = 1;
  let endPos = body.length;

  while (depth > 0) {
    if (!nextClose) {
      // Malformed HTML — geben zurück was wir haben
      endPos = body.length;
      break;
    }

    const openPos = nextOpen ? nextOpen.index : Infinity;
    const closePos = nextClose.index;

    if (openPos < closePos) {
      depth++;
      nestedOpenPattern.lastIndex = openPos + nextOpen[0].length;
      nextOpen = nestedOpenPattern.exec(body);
    } else {
      depth--;
      endPos = closePos + nextClose[0].length;
      if (depth > 0) {
        closeTagPattern.lastIndex = endPos;
        nextClose = closeTagPattern.exec(body);
      }
    }
  }

  return body.slice(startPos, endPos);
}

// ─── removeBySelectors ────────────────────────────────────────────────────────

/**
 * Entfernt alle Elemente, die einem der Selektoren entsprechen, iterativ.
 * Leeres/fehlendes Array → HTML unverändert.
 * Selektor nicht gefunden → kein Fehler, HTML unverändert.
 * Nicht unterstützte Selektorform → SelectorError.
 *
 * @param {string} html
 * @param {string[]} selectors
 * @returns {string}
 * @throws {SelectorError}
 */
function removeBySelectors(html, selectors) {
  if (!selectors || selectors.length === 0) return html;

  let result = html;
  for (const selector of selectors) {
    // Wirft SelectorError bei ungültiger Form
    const parsed = parseSelector(selector);
    if (!parsed.tag && !parsed.id && !parsed.cls) continue;

    result = removeAllMatching(result, parsed);
  }
  return result;
}

/**
 * Entfernt alle Vorkommen von Elementen, die `parsed` entsprechen, aus `html`.
 */
function removeAllMatching(html, parsed) {
  const openTagRegex = buildOpenTagRegex(parsed);
  let result = html;
  let safetyCounter = 0;

  while (safetyCounter++ < 10000) {
    openTagRegex.lastIndex = 0;
    const startMatch = openTagRegex.exec(result);
    if (!startMatch) break;

    const tagName = startMatch[1];
    const startPos = startMatch.index;

    if (VOID_ELEMENTS.has(tagName.toLowerCase())) {
      // Void-Element: nur das öffnende Tag entfernen
      result = result.slice(0, startPos) + result.slice(startPos + startMatch[0].length);
      continue;
    }

    // Tiefenzählung
    const afterOpen = startPos + startMatch[0].length;
    const nestedOpenPattern = new RegExp(`<${escapeRegex(tagName)}(?:\\s[^>]*)?>`, 'gi');
    const closeTagPattern = new RegExp(`<\\/${escapeRegex(tagName)}>`, 'gi');

    nestedOpenPattern.lastIndex = afterOpen;
    closeTagPattern.lastIndex = afterOpen;

    let nextOpen = nestedOpenPattern.exec(result);
    let nextClose = closeTagPattern.exec(result);
    let depth = 1;
    let endPos = result.length;

    while (depth > 0) {
      if (!nextClose) {
        endPos = result.length;
        break;
      }
      const openPos = nextOpen ? nextOpen.index : Infinity;
      const closePos = nextClose.index;

      if (openPos < closePos) {
        depth++;
        nestedOpenPattern.lastIndex = openPos + nextOpen[0].length;
        nextOpen = nestedOpenPattern.exec(result);
      } else {
        depth--;
        endPos = closePos + nextClose[0].length;
        if (depth > 0) {
          closeTagPattern.lastIndex = endPos;
          nextClose = closeTagPattern.exec(result);
        }
      }
    }

    result = result.slice(0, startPos) + result.slice(endPos);
  }

  return result;
}

// ─── normalize ────────────────────────────────────────────────────────────────

/**
 * Entfernt HTML-Kommentare, kollabiert Whitespace auf einzelne Leerzeichen,
 * trimmt das Ergebnis. Deterministisch.
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')   // HTML-Kommentare entfernen
    .replace(/\s+/g, ' ')              // Whitespace kollabieren
    .trim();
}

// ─── sha256 ───────────────────────────────────────────────────────────────────

/**
 * SHA-256 Hex-Digest über node:crypto.
 *
 * @param {string} text
 * @returns {string}
 */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── fetchWithTimeout ─────────────────────────────────────────────────────────

/**
 * Fetch mit Timeout. Wirft nie — gibt immer { ok, status, text, error? } zurück.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, text: string, error?: Error}>}
 */
async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Seitendiff-Wächter/1.0; +https://github.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: '', error: err };
  } finally {
    clearTimeout(timer);
  }
}

// ─── unified diff (einfach, zeilenbasiert) ────────────────────────────────────

/**
 * Erzeugt einen einfachen zeilenbasierten Diff. Maximal maxLines Zeilen.
 * (Kein LCS-Algorithmus — wie in README dokumentiert.)
 */
function simpleDiff(oldText, newText, maxLines = 80) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lines = ['--- alt', '+++ neu'];

  for (const line of oldLines) {
    if (lines.length >= maxLines) break;
    lines.push(`-${line}`);
  }
  for (const line of newLines) {
    if (lines.length >= maxLines) break;
    lines.push(`+${line}`);
  }

  return lines.slice(0, maxLines).join('\n');
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Konfiguration laden
  const configPath = join(ROOT, 'watch.config.json');
  let watchers;
  try {
    watchers = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`[watch] Fehler beim Lesen von watch.config.json: ${err.message}`);
    process.exit(2);
  }

  // Verzeichnisse anlegen
  const stateDir = join(ROOT, 'state');
  const outDir = join(ROOT, 'out');
  if (!dryRun) {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  }

  const changedIds = [];
  const errorIds = [];

  for (const watcher of watchers) {
    const { id, url, selector = '', ignore = [], label } = watcher;
    console.log(`\n[${id}] Prüfe: ${label} (${url})`);

    // Abruf
    const result = await fetchWithTimeout(url);

    if (!result.ok) {
      const msg = result.error
        ? `Netzwerkfehler: ${result.error.message}`
        : `HTTP ${result.status}`;
      console.error(`[${id}] Fehler – ${msg}`);
      errorIds.push(id);
      continue;
    }

    // Extraktion und Bereinigung
    let extracted;
    try {
      extracted = extractBySelector(result.text, selector);
      extracted = removeBySelectors(extracted, ignore);
    } catch (err) {
      if (err instanceof SelectorError) {
        console.error(`[${id}] SelectorError – ${err.message}`);
        errorIds.push(id);
        continue;
      }
      throw err;
    }

    const newNorm = normalize(extracted);
    const newHash = sha256(newNorm);
    const now = new Date().toISOString();

    // Zustand lesen
    const stateTxtPath = join(stateDir, `${id}.txt`);
    const stateJsonPath = join(stateDir, `${id}.json`);

    let oldNorm = '';
    let firstRun = true;

    if (existsSync(stateTxtPath)) {
      try {
        oldNorm = readFileSync(stateTxtPath, 'utf8');
        firstRun = false;
      } catch (err) {
        console.error(`[${id}] Warnung: Zustandsdatei nicht lesbar – ${err.message}`);
      }
    }

    const oldHash = sha256(oldNorm);
    const changed = !firstRun && oldHash !== newHash;

    if (changed) {
      console.log(`CHANGED ${id}`);
      changedIds.push(id);

      const diffContent = simpleDiff(oldNorm, newNorm);
      if (!dryRun) {
        writeFileSync(join(outDir, `${id}.diff`), diffContent, 'utf8');
      } else {
        console.log(`[${id}] --dry-run: Diff nicht geschrieben`);
      }
    } else if (firstRun) {
      console.log(`[${id}] Erster Lauf – Zustand wird gespeichert`);
    } else {
      console.log(`[${id}] Keine Änderung`);
    }

    // Zustand schreiben.
    // Der Zeitstempel wird bei JEDEM erfolgreichen Lauf geschrieben, auch ohne Änderung.
    // Das ist Absicht: dieser Schreibvorgang erzeugt Repo-Aktivität und verhindert,
    // dass GitHub den Cron-Job nach 60 Tagen ohne Commit deaktiviert.
    if (!dryRun) {
      writeFileSync(stateTxtPath, newNorm, 'utf8');
      writeFileSync(stateJsonPath, JSON.stringify({
        sha256: newHash,
        timestamp: now,
        status: result.status,
      }, null, 2), 'utf8');
    } else {
      console.log(`[${id}] --dry-run: Zustand nicht geschrieben`);
    }
  }

  // ─── Zusammenfassung ───────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(50));
  console.log(`Zusammenfassung: ${changedIds.length} Änderung(en), ${errorIds.length} Fehler`);
  if (changedIds.length > 0) {
    console.log(`Geändert: ${changedIds.join(', ')}`);
  }
  if (errorIds.length > 0) {
    console.log(`Fehler bei: ${errorIds.join(', ')}`);
  }

  // GitHub Actions Step-Outputs schreiben
  // Der Workflow wertet steps.watch.outputs.has_changes und steps.watch.outputs.changed_ids aus.
  const hasChanges = changedIds.length > 0;
  const changedIdsStr = changedIds.join(',');

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `has_changes=${hasChanges}\nchanged_ids=${changedIdsStr}\n`,
      { flag: 'a' }
    );
  }

  // Auch auf stdout (für lokale Auswertung)
  console.log(`CHANGED_IDS=${changedIdsStr}`);

  // Exit-Code: 0 wenn keine Fehler, sonst != 0. Änderungen allein sind kein Fehler.
  process.exit(errorIds.length > 0 ? 1 : 0);
}

// ─── Exporte ──────────────────────────────────────────────────────────────────

export { extractBySelector, removeBySelectors, normalize, sha256, SelectorError };

// ─── Einstiegspunkt ───────────────────────────────────────────────────────────
// main() wird NUR ausgeführt, wenn die Datei direkt gestartet wurde.
// Beim Import darf nichts laufen.

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
