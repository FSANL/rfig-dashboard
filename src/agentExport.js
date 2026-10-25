'use strict';
// Agent-export: een leesbaar Excel-bestand in de Drive-map, zodat de RFIG-agents (bv. Ralph)
// de bol-gegevens kunnen raadplegen zonder zelf bol.com te openen. Wordt na elke synchronisatie vernieuwd.
// Bevat geen klantgegevens en geen geheimen.

const fs = require('node:fs');
const path = require('node:path');
const D = require('./calc/dates');
const { buildXlsx } = require('./xlsx');
const { datasetStatus } = require('./sync');
const { getMeta } = require('./db');

const FILE = 'RFIG agent-export.xlsx';
const SUBFOLDER = 'Dashboard-export';

function exportDir(config) {
  // Demo nooit in de agentmap: agents mogen geen synthetische gegevens zien.
  if (config.mode === 'DEMO') return config.backupDir ? path.join(config.backupDir, 'Agent-export-demo') : null;
  // Eigen submap, zodat het bestand niet los tussen de agentmappen staat.
  if (config.agentExportDir) return path.join(config.agentExportDir, SUBFOLDER);
  return config.backupDir ? path.join(config.backupDir, 'Agent-export') : null;
}

const nl = (iso) => (iso ? new Date(iso).toLocaleString('nl-NL', { timeZone: D.TZ, dateStyle: 'short', timeStyle: 'short' }) : '');
const yn = (v) => (v == null ? 'onbekend' : v ? 'ja' : 'nee');

function writeAgentExport(db, config, nowMs = Date.now()) {
  const dir = exportDir(config);
  if (!dir) throw new Error('AGENT_EXPORT_DIR en BACKUP_DIR zijn niet ingesteld');
  const base = config.mode !== 'DEMO' && config.agentExportDir ? config.agentExportDir : config.backupDir;
  if (!fs.existsSync(base)) throw new Error(`Map niet gevonden: ${base} (staat Google Drive voor Desktop aan?)`);
  fs.mkdirSync(dir, { recursive: true });

  const status = datasetStatus(db);
  const offersOk = status.find((s) => s.key === 'OFFERS');
  const ordersOk = status.find((s) => s.key === 'ORDERS');
  const stale = (s) => !s || !s.lastSuccessAt || nowMs - Date.parse(s.lastSuccessAt) > 26 * 3600000;

  const products = db.prepare('SELECT * FROM products ORDER BY title').all();
  const offers = db.prepare('SELECT * FROM offers WHERE removed IS NULL OR removed = 0').all();

  const leesmij = [
    ['Onderdeel', 'Waarde'],
    ['Modus', config.mode === 'DEMO' ? 'DEMO — synthetische gegevens, NIET gebruiken voor beslissingen' : 'LIVE'],
    ['Export gemaakt op', nl(new Date(nowMs).toISOString())],
    ['Laatste geslaagde synchronisatie aanbod (prijs/status/voorraad)', nl(offersOk && offersOk.lastSuccessAt) || 'nog niet'],
    ['Laatste geslaagde synchronisatie orders', nl(ordersOk && ordersOk.lastSuccessAt) || 'nog niet'],
    ['Actualiteit', stale(offersOk) || stale(ordersOk) ? 'VEROUDERD: ouder dan 26 uur of mislukt. Niet als actuele stand gebruiken.' : 'ACTUEEL (≤ 26 uur oud)'],
    ['Prijsregistratie sinds', nl(getMeta(db, 'price_registration_start')) || 'onbekend'],
    ['Bron', 'bol Retailer API, alleen-lezen, via het RFIG Dashboard op de pc van Ivo'],
    ['Let op', 'Niet in deze export: ranking/zoekposities (MarktMentor), concurrenten, reviews, productcontent (titel/tekst/afbeeldingen).'],
    ['Let op', 'Wijzigingsmoment ligt tussen "Vorige meting" en "Waargenomen". Stond de pc uit, dan is het exacte moment onbekend.'],
  ];

  const aanbod = [['EAN', 'Product', 'Prijs (incl. btw)', 'Staffelprijzen', 'Te koop NL', 'Te koop BE', 'Gepauzeerd', 'Fulfilment', 'Levertijd / leverbelofte', 'Opgegeven voorraad', 'Verkoopbare voorraad', 'Gemeten op']];
  for (const o of offers) {
    const p = products.find((x) => x.ean === o.ean) || {};
    let staffel = '';
    try { const b = JSON.parse(o.bundle_prices || '[]'); if (b.length > 1) staffel = b.map((x) => `${x.quantity}+: ${x.unitPrice}`).join(' | '); } catch { /* */ }
    aanbod.push([String(o.ean), p.title || '', o.unit_price, staffel || 'geen', yn(o.for_sale_nl), yn(o.for_sale_be), yn(o.on_hold), o.fulfilment_method || '', o.delivery || '', o.stock_amount, o.corrected_stock, nl(o.updated_at)]);
  }

  const since30 = new Date(nowMs - 30 * 86400000).toISOString();
  const wijz = [['Waargenomen', 'Vorige meting', 'EAN', 'Product', 'Soort', 'Wat', 'Was', 'Wordt', 'Laatst gewijzigd volgens bol']];
  for (const c of db.prepare('SELECT c.*, p.title FROM offer_changes c LEFT JOIN products p ON p.ean = c.ean WHERE c.detected_at >= ? ORDER BY c.detected_at DESC').all(since30)) {
    wijz.push([nl(c.detected_at), nl(c.previous_observed_at), String(c.ean), c.title || '', (c.type || '').toLowerCase(), c.label, c.old_text, c.new_text, nl(c.bol_modified_at)]);
  }
  if (wijz.length === 1) wijz.push(['(geen wijzigingen waargenomen in de laatste 30 dagen)']);

  const verkoop = [['Datum', 'EAN', 'Product', 'Verkochte stuks', 'Bestelwaarde incl. btw', 'Gemiddelde betaalde prijs', 'Geannuleerde stuks']];
  const agg = new Map();
  const since90 = new Date(nowMs - 90 * 86400000).toISOString();
  for (const it of db.prepare('SELECT ean, placed_at, quantity, quantity_cancelled, unit_price FROM order_items WHERE placed_at >= ?').all(since90)) {
    const d = D.amsDate(it.placed_at);
    const k = `${d}|${it.ean}`;
    const a = agg.get(k) || { d, ean: it.ean, units: 0, gross: 0, cancelled: 0, priced: 0 };
    const q = Math.max(0, (it.quantity || 0) - (it.quantity_cancelled || 0));
    a.units += q; a.cancelled += it.quantity_cancelled || 0;
    if (it.unit_price != null) { a.gross += it.unit_price * q; a.priced += q; }
    agg.set(k, a);
  }
  for (const a of [...agg.values()].sort((x, y) => (y.d + y.ean).localeCompare(x.d + x.ean))) {
    const p = products.find((x) => x.ean === a.ean) || {};
    verkoop.push([a.d, String(a.ean), p.title || '', a.units, Math.round(a.gross * 100) / 100, a.priced ? Math.round((a.gross / a.priced) * 100) / 100 : null, a.cancelled]);
  }

  const buf = buildXlsx([
    { name: 'Leesmij', rows: leesmij },
    { name: 'Aanbod nu', rows: aanbod },
    { name: 'Wijzigingen 30 dagen', rows: wijz },
    { name: 'Verkoop per dag 90 dagen', rows: verkoop },
  ]);
  const tmp = path.join(dir, `.tmp-${process.pid}.xlsx`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, path.join(dir, FILE));
  return { file: path.join(dir, FILE), bytes: buf.length };
}

module.exports = { writeAgentExport, exportDir, FILE };
