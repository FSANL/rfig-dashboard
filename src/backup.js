'use strict';
// Back-up van de database naar een map (bv. de Google Drive-map "Project Dashboard\Backups").
// - VACUUM INTO maakt een consistente momentopname, ook terwijl de app draait.
// - Eerst naar een tijdelijke naam, dan hernoemen: Drive synchroniseert nooit een half bestand.
// - Bewaarschema: 7 dagelijkse, 4 wekelijkse, 12 maandelijkse kopieën.
// - Hersteltest: kopie openen, integriteit controleren en tabellen tellen.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const D = require('./calc/dates');
const { getMeta, setMeta } = require('./db');

const PREFIX = 'rfig-backup-';
const RE = /^rfig-backup-(\d{4}-\d{2}-\d{2})_(\d{4})\.sqlite$/;

function backupDirFor(config) {
  if (!config.backupDir) return null;
  return path.join(config.backupDir, config.mode === 'DEMO' ? 'Backups-demo' : 'Backups');
}

function makeBackup(db, config, nowMs = Date.now()) {
  const dir = backupDirFor(config);
  if (!dir) throw new Error('BACKUP_DIR is niet ingesteld in .env');
  if (!fs.existsSync(config.backupDir)) throw new Error(`Back-upmap niet gevonden: ${config.backupDir} (staat Google Drive voor Desktop aan?)`);
  fs.mkdirSync(dir, { recursive: true });
  const day = D.amsDate(nowMs);
  const hhmm = new Intl.DateTimeFormat('nl-NL', { timeZone: D.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(nowMs).replace(':', '');
  const name = `${PREFIX}${day}_${hhmm}.sqlite`;
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}.sqlite`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const final = path.join(dir, name);
  if (fs.existsSync(final)) fs.rmSync(final);
  fs.renameSync(tmp, final);
  const removed = applyRetention(dir, nowMs);
  setMeta(db, 'last_backup_at', new Date(nowMs).toISOString());
  setMeta(db, 'last_backup_file', name);
  return { file: name, dir, bytes: fs.statSync(final).size, removed };
}

/** Behoudt per dag (7), per ISO-week (4) en per maand (12) de nieuwste kopie. */
function applyRetention(dir, nowMs = Date.now()) {
  const files = listBackups(dir);
  const keep = new Set();
  const today = D.amsDate(nowMs);
  const pick = (keyFn, n, minDay) => {
    const seen = new Map();
    for (const f of files) { // nieuwste eerst
      if (f.day < minDay) continue;
      const k = keyFn(f.day);
      if (!seen.has(k)) seen.set(k, f.name);
      if (seen.size >= n) break;
    }
    for (const v of seen.values()) keep.add(v);
  };
  pick((d) => d, 7, D.addDays(today, -6));
  pick((d) => isoWeek(d), 4, D.addDays(today, -7 * 4));
  pick((d) => d.slice(0, 7), 12, D.addDays(today, -366));
  const removed = [];
  for (const f of files) if (!keep.has(f.name)) { fs.rmSync(path.join(dir, f.name)); removed.push(f.name); }
  return removed;
}

function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((name) => {
    const m = RE.exec(name);
    if (!m) return null;
    const st = fs.statSync(path.join(dir, name));
    return { name, day: m[1], time: m[2], bytes: st.size };
  }).filter(Boolean).sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
}

/** Hersteltest: opent de nieuwste back-up los van de app en controleert die. */
function restoreTest(db, config) {
  const dir = backupDirFor(config);
  const [latest] = listBackups(dir);
  if (!latest) throw new Error('Geen back-up gevonden om te testen');
  const copy = path.join(config.dataDir, 'hersteltest.sqlite');
  fs.copyFileSync(path.join(dir, latest.name), copy);
  const t = new DatabaseSync(copy, { readOnly: true });
  try {
    const integrity = t.prepare('PRAGMA integrity_check').get();
    const ok = Object.values(integrity)[0] === 'ok';
    const counts = {};
    for (const tbl of ['products', 'order_items', 'price_observations', 'costs', 'targets', 'workspace_items']) {
      counts[tbl] = t.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get().c;
    }
    const result = { at: new Date().toISOString(), file: latest.name, ok, counts };
    setMeta(db, 'last_restore_test', JSON.stringify(result));
    return result;
  } finally {
    t.close();
    fs.rmSync(copy, { force: true });
  }
}

function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return `${dt.getUTCFullYear()}-W${Math.ceil(((dt - y0) / 86400000 + 1) / 7)}`;
}

function status(db, config) {
  const dir = backupDirFor(config);
  let restore = null;
  try { restore = JSON.parse(getMeta(db, 'last_restore_test') || 'null'); } catch { /* leeg */ }
  return {
    configured: !!config.backupDir,
    dirExists: !!config.backupDir && fs.existsSync(config.backupDir),
    dir,
    lastBackupAt: getMeta(db, 'last_backup_at'),
    lastBackupError: getMeta(db, 'last_backup_error'),
    backups: listBackups(dir).slice(0, 30),
    lastRestoreTest: restore,
  };
}

module.exports = { makeBackup, applyRetention, listBackups, restoreTest, status, backupDirFor };
