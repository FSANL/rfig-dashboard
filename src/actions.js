'use strict';
// Actielijst: zaken die aandacht vragen, opgesteld door Linda (Rapportage & Analyse) op basis van de
// weekrapportages van de agents. Linda schrijft een CSV-bestand in Google Drive; het dashboard leest dat
// bestand alleen. Afvinken is de enige schrijfactie van het dashboard (besluit Ivo 2026-10-29) en wordt
// lokaal in de database bewaard, nooit in het bestand van Linda.

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'Actielijst RFIG.csv';
const LINDA_FOLDER = 'Linda (Rapportage & Analyse)';
const LEVELS = ['PARAMOUNT', 'ESSENTIAL', 'IMPORTANT', 'BASIC'];

// Kolomnamen in het bestand (hoofdletterongevoelig, met een paar varianten).
const COLS = {
  id: ['id', 'actie-id', 'actie id'],
  reported: ['datum gemeld', 'datum', 'gemeld'],
  agent: ['agent', 'gemeld door'],
  level: ['classificatie', 'belang', 'prioriteit'],
  what: ['wat'],
  why: ['waarom belangrijk', 'waarom'],
  todo: ['wat te doen', 'actie'],
  who: ['wie'],
  due: ['wanneer', 'deadline'],
  source: ['bron', 'link', 'bron (link)'],
  product: ['product', 'ean'],
};

function actionsFile(config) {
  if (process.env.ACTIONS_FILE) return process.env.ACTIONS_FILE;
  if (config.actionsFile) return config.actionsFile;
  if (config.mode === 'DEMO') return path.join(config.root, 'templates', 'actielijst-voorbeeld.csv');
  return config.agentExportDir ? path.join(config.agentExportDir, LINDA_FOLDER, FILE) : null;
}

/** CSV-parser met aanhalingstekens; scheidingsteken ; of , wordt automatisch herkend. */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Datum als JJJJ-MM-DD; accepteert ook DD-MM-JJJJ en DD/MM/JJJJ. Onherkenbaar = null (tekst blijft zichtbaar). */
function normDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Verwijdert opmaaktekens die agents soms meesturen (markdown, opsommingstekens), zodat de tekst rustig leest. */
function clean(s) {
  return String(s ?? '').replace(/\*\*|__|`/g, '').replace(/^\s*[-•*]\s+/gm, '').replace(/\s+/g, ' ').trim();
}

function parseActions(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { actions: [], problems: ['Het bestand is leeg.'] };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h));
  const problems = [];
  for (const k of ['id', 'level', 'what', 'todo']) if (idx[k] < 0) problems.push(`Kolom "${COLS[k][0]}" ontbreekt in het bestand.`);
  if (problems.length) return { actions: [], problems };
  const seen = new Set();
  const actions = [];
  rows.slice(1).forEach((r, n) => {
    const get = (k) => (idx[k] >= 0 ? clean(r[idx[k]]) : '');
    const id = get('id');
    if (!id) { problems.push(`Regel ${n + 2}: geen ID, overgeslagen.`); return; }
    if (seen.has(id)) { problems.push(`ID ${id} staat dubbel; alleen de eerste regel is gebruikt.`); return; }
    seen.add(id);
    const lv = get('level').toUpperCase();
    const level = LEVELS.includes(lv) ? lv : 'ONBEKEND';
    if (level === 'ONBEKEND') problems.push(`ID ${id}: classificatie "${get('level')}" onbekend; onderaan gezet.`);
    actions.push({
      id, level, agent: get('agent'), what: get('what'), why: get('why'), todo: get('todo'), who: get('who'),
      dueText: get('due'), due: normDate(get('due')), reported: normDate(get('reported')), reportedText: get('reported'),
      source: get('source'), product: get('product'),
    });
  });
  return { actions, problems };
}

const rank = (a) => { const i = LEVELS.indexOf(a.level); return i < 0 ? LEVELS.length : i; };

/** Meest belangrijk eerst; binnen hetzelfde belang de vroegste deadline eerst, dan de oudste melding. */
function sortActions(list) {
  return [...list].sort((a, b) => rank(a) - rank(b)
    || (a.due == null) - (b.due == null) || String(a.due || '').localeCompare(String(b.due || ''))
    || String(a.reported || '').localeCompare(String(b.reported || '')) || a.id.localeCompare(b.id));
}

function statusMap(db) {
  return new Map(db.prepare('SELECT * FROM action_status').all().map((r) => [r.action_id, r]));
}

/** Leest het bestand en combineert met de afvinkstatus. Ontbreekt het bestand, dan zegt het dat (nooit stil leeg). */
function loadActions(db, config, today) {
  const file = actionsFile(config);
  const out = { file, fileFound: false, fileModified: null, problems: [], open: [], done: [] };
  if (!file) { out.problems.push('AGENT_EXPORT_DIR is niet ingesteld, dus het dashboard weet niet waar de actielijst van Linda staat.'); return out; }
  if (!fs.existsSync(file)) { out.problems.push(`Actielijst niet gevonden: ${file}. Heeft Linda de lijst al gemaakt, en staat Google Drive voor Desktop aan?`); return out; }
  out.fileFound = true;
  out.fileModified = fs.statSync(file).mtime.toISOString();
  const { actions, problems } = parseActions(fs.readFileSync(file, 'utf8'));
  out.problems.push(...problems);
  const st = statusMap(db);
  for (const a of sortActions(actions)) {
    const s = st.get(a.id);
    a.overdue = !!(a.due && today && a.due < today);
    if (s && s.status === 'AFGEROND') out.done.push({ ...a, doneAt: s.done_at, doneBy: s.done_by }); else out.open.push(a);
  }
  out.done.sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  return out;
}

function setStatus(db, id, done, by) {
  if (!id) throw Object.assign(new Error('ID ontbreekt'), { code: 400 });
  if (done) {
    db.prepare(`INSERT INTO action_status(action_id, status, done_at, done_by) VALUES (?, 'AFGEROND', datetime('now'), ?)
      ON CONFLICT(action_id) DO UPDATE SET status = 'AFGEROND', done_at = datetime('now'), done_by = excluded.done_by`).run(String(id), by || null);
  } else {
    db.prepare("UPDATE action_status SET status = 'OPEN', done_at = NULL, done_by = NULL WHERE action_id = ?").run(String(id));
  }
}

module.exports = { FILE, LINDA_FOLDER, LEVELS, actionsFile, parseCsv, parseActions, sortActions, loadActions, setStatus, normDate };
