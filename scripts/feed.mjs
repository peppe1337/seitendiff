#!/usr/bin/env node
/**
 * feed.mjs — Atom-Feed-Generator für Seitendiff-Wächter
 *
 * Liest alle *.diff-Dateien aus out/ und baut/aktualisiert feed.xml.
 * Wird nach watch.mjs aufgerufen, wenn Änderungen erkannt wurden.
 *
 * Kein npm, reine Node-Standardbibliothek.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Konfiguration laden ──────────────────────────────────────────────────────

const configPath = join(ROOT, 'watch.config.json');
let watchers;
try {
  watchers = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`[feed] Fehler beim Lesen von watch.config.json: ${err.message}`);
  process.exit(2);
}

const watcherMap = Object.fromEntries(watchers.map(w => [w.id, w]));

// ─── Bestehenden Feed laden ───────────────────────────────────────────────────

const feedPath = join(ROOT, 'feed.xml');
const MAX_ENTRIES = 50;

/**
 * Existierende Einträge aus dem Atom-Feed extrahieren.
 * Wir parsen nur die <entry>-Blöcke per Regex (kein XML-Parser nötig,
 * da wir selbst schreiben und das Format kennen).
 */
function loadExistingEntries(feedXml) {
  const entries = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryPattern.exec(feedXml)) !== null) {
    entries.push(m[0]); // den vollständigen <entry>...</entry> Block
  }
  return entries;
}

let existingEntries = [];
if (existsSync(feedPath)) {
  try {
    const feedXml = readFileSync(feedPath, 'utf8');
    existingEntries = loadExistingEntries(feedXml);
  } catch (err) {
    console.warn(`[feed] Konnte bestehenden Feed nicht lesen: ${err.message}`);
  }
}

// ─── Neue Einträge aus out/*.diff ─────────────────────────────────────────────

const outDir = join(ROOT, 'out');
const newEntries = [];

const args = process.argv.slice(2);
// Optional: --ids=id1,id2 um nur bestimmte IDs zu verarbeiten
const idsArg = args.find(a => a.startsWith('--ids='));
const filterIds = idsArg ? idsArg.slice(6).split(',').filter(Boolean) : null;

let diffFiles = [];
if (existsSync(outDir)) {
  diffFiles = readdirSync(outDir).filter(f => f.endsWith('.diff'));
}

const now = new Date().toISOString();

for (const diffFile of diffFiles) {
  const id = basename(diffFile, '.diff');

  if (filterIds && !filterIds.includes(id)) continue;

  const watcher = watcherMap[id];
  if (!watcher) {
    console.warn(`[feed] Kein Wächter für ID "${id}" in config gefunden — überspringe`);
    continue;
  }

  const diffPath = join(outDir, diffFile);
  let diffContent = '';
  try {
    diffContent = readFileSync(diffPath, 'utf8');
  } catch (err) {
    console.warn(`[feed] Konnte ${diffFile} nicht lesen: ${err.message}`);
    continue;
  }

  // Zustand für Zeitstempel
  const stateJsonPath = join(ROOT, 'state', `${id}.json`);
  let timestamp = now;
  try {
    const state = JSON.parse(readFileSync(stateJsonPath, 'utf8'));
    timestamp = state.timestamp || now;
  } catch (_) {}

  // Eindeutige Entry-ID: sha256 aus id + timestamp
  const entryId = createHash('sha256')
    .update(`${id}:${timestamp}`)
    .digest('hex')
    .slice(0, 16);

  const escaped = {
    label: xmlEscape(watcher.label),
    url: xmlEscape(watcher.url),
    diff: xmlEscape(diffContent),
    id: xmlEscape(id),
    timestamp: xmlEscape(timestamp),
    entryId: xmlEscape(entryId),
  };

  newEntries.push(`  <entry>
    <id>urn:seitendiff:${escaped.id}:${escaped.entryId}</id>
    <title>Änderung: ${escaped.label}</title>
    <link href="${escaped.url}"/>
    <updated>${escaped.timestamp}</updated>
    <summary type="text">Änderung erkannt auf: ${escaped.url}</summary>
    <content type="text">${escaped.diff}</content>
  </entry>`);

  console.log(`[feed] Neuer Eintrag für: ${id}`);
}

// ─── Feed zusammenbauen ───────────────────────────────────────────────────────

// Neuste Einträge zuerst, dann alte (bis MAX_ENTRIES)
const allEntries = [...newEntries, ...existingEntries].slice(0, MAX_ENTRIES);

const feedUpdated = now;

// Repo-URL aus Umgebungsvariable (GitHub Actions setzt GITHUB_REPOSITORY)
const repoUrl = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/OWNER/REPO';

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(repoUrl)}/seitendiff</id>
  <title>Seitendiff-Wächter</title>
  <subtitle>Automatische Erkennung von Webseitenänderungen</subtitle>
  <link href="${xmlEscape(repoUrl)}"/>
  <link rel="self" href="${xmlEscape(repoUrl)}/raw/main/feed.xml"/>
  <updated>${feedUpdated}</updated>
  <author>
    <name>Seitendiff-Wächter</name>
  </author>
${allEntries.join('\n')}
</feed>
`;

try {
  writeFileSync(feedPath, feedXml, 'utf8');
  console.log(`[feed] feed.xml geschrieben (${allEntries.length} Einträge).`);
} catch (err) {
  console.error(`[feed] Fehler beim Schreiben von feed.xml: ${err.message}`);
  process.exit(1);
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
