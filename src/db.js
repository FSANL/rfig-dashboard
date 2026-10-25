'use strict';
// SQLite-opslag via de ingebouwde node:sqlite (geen extra installatie nodig).

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Producten. EAN altijd als tekst. Handmatige velden worden nooit door synchronisatie overschreven.
CREATE TABLE IF NOT EXISTS products (
  ean TEXT PRIMARY KEY,
  title TEXT, sku TEXT, variant TEXT, product_group TEXT,
  season_type TEXT DEFAULT 'SEIZOEN' CHECK (season_type IN ('SEIZOEN','DOORLOPEND')),
  owner TEXT, tags TEXT,
  title_source TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY, ean TEXT NOT NULL, reference TEXT,
  fulfilment_method TEXT, on_hold INTEGER, for_sale_nl INTEGER, for_sale_be INTEGER,
  unit_price REAL, stock_amount INTEGER, corrected_stock INTEGER,
  last_modified TEXT, updated_at TEXT
);

-- Elke prijsmeting (synchronisatie) of handmatig vastgelegde exacte wijziging.
CREATE TABLE IF NOT EXISTS price_observations (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, offer_id TEXT,
  observed_at TEXT NOT NULL, unit_price REAL NOT NULL,
  exact_change INTEGER DEFAULT 0, source TEXT NOT NULL, note TEXT
);
CREATE INDEX IF NOT EXISTS ix_price_ean ON price_observations(ean, observed_at);

CREATE TABLE IF NOT EXISTS stock_snapshots (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, location TEXT NOT NULL,
  observed_at TEXT NOT NULL, amount INTEGER, sellable INTEGER, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stock_ean ON stock_snapshots(ean, observed_at);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, placed_at TEXT, country_code TEXT, fetched_detail_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, ean TEXT, offer_id TEXT,
  quantity INTEGER, quantity_shipped INTEGER, quantity_cancelled INTEGER,
  unit_price REAL, total_price REAL, commission REAL,
  fulfilment_method TEXT, fulfilment_status TEXT, placed_at TEXT, latest_changed_at TEXT,
  detail_fetched INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_oi_ean ON order_items(ean, placed_at);

-- Kosten per stuk excl. btw, met geldigheid. Alleen via import/invoer, nooit via synchronisatie.
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, cost_type TEXT NOT NULL,
  amount REAL NOT NULL, valid_from TEXT, valid_to TEXT,
  basis TEXT DEFAULT 'GESCHAT' CHECK (basis IN ('GEBOEKT','GESCHAT')),
  source TEXT, import_id INTEGER, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (ean, cost_type, valid_from)
);

CREATE TABLE IF NOT EXISTS external_stock (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, location TEXT NOT NULL, amount INTEGER NOT NULL,
  as_of TEXT NOT NULL, import_id INTEGER, UNIQUE (ean, location, as_of)
);

CREATE TABLE IF NOT EXISTS incoming_stock (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, qty INTEGER NOT NULL, expected_date TEXT NOT NULL,
  confirmed INTEGER DEFAULT 0, note TEXT, import_id INTEGER, UNIQUE (ean, expected_date, qty)
);

-- Doelen per EAN (of per productgroep met ean = 'GROEP:<naam>').
CREATE TABLE IF NOT EXISTS targets (
  ean TEXT PRIMARY KEY, target_date TEXT, end_stock INTEGER DEFAULT 0,
  min_price REAL, max_price REAL, min_contribution REAL, price_step REAL,
  min_measure_days INTEGER DEFAULT 7, tolerance_days INTEGER DEFAULT 7,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Mijn werkruimte: notities, hypotheses, inzichten, wensen, taken.
CREATE TABLE IF NOT EXISTS workspace_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('NOTITIE','OBSERVATIE','HYPOTHESE','INZICHT','WENS','TAAK')),
  title TEXT NOT NULL, body TEXT, ean TEXT, owner TEXT,
  status TEXT DEFAULT 'OPEN', priority TEXT, category TEXT,
  expected_effect TEXT, acceptance TEXT, eval_date TEXT, conclusion TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY, filename TEXT, kind TEXT, rows_total INTEGER, rows_ok INTEGER,
  rows_skipped INTEGER, rows_error INTEGER, imported_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY, dataset TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  status TEXT, records INTEGER, message TEXT
);
CREATE INDEX IF NOT EXISTS ix_sync ON sync_runs(dataset, finished_at);

-- Automatisch waargenomen wijzigingen per aanbieding (prijs, status, voorraad, logistiek).
CREATE TABLE IF NOT EXISTS offer_changes (
  id INTEGER PRIMARY KEY, ean TEXT NOT NULL, offer_id TEXT,
  detected_at TEXT NOT NULL, previous_observed_at TEXT, bol_modified_at TEXT,
  field TEXT NOT NULL, label TEXT, type TEXT, old_value TEXT, new_value TEXT, old_text TEXT, new_text TEXT
);
CREATE INDEX IF NOT EXISTS ix_changes_ean ON offer_changes(ean, detected_at);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY, at TEXT DEFAULT (datetime('now')), entity TEXT, entity_id TEXT, action TEXT, detail TEXT
);
`;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO NOTHING").run(String(SCHEMA_VERSION));
  return db;
}

/** Kolommen toevoegen aan bestaande databases zonder gegevens te verliezen. */
function migrate(db) {
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  const offers = cols('offers');
  if (!offers.has('bundle_prices')) db.exec('ALTER TABLE offers ADD COLUMN bundle_prices TEXT');
  if (!offers.has('delivery')) db.exec('ALTER TABLE offers ADD COLUMN delivery TEXT');
  if (!offers.has('removed')) db.exec('ALTER TABLE offers ADD COLUMN removed INTEGER DEFAULT 0');
}

function getMeta(db, key, d = null) {
  const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : d;
}
function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
function log(db, entity, entityId, action, detail) {
  db.prepare('INSERT INTO change_log(entity, entity_id, action, detail) VALUES (?, ?, ?, ?)').run(entity, String(entityId ?? ''), action, detail ? JSON.stringify(detail) : null);
}
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { open, getMeta, setMeta, log, tx, SCHEMA_VERSION };
