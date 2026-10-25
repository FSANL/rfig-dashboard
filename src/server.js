'use strict';
// RFIG Dashboard — lokale server. Alleen bereikbaar vanaf deze pc (127.0.0.1).
// Start: node src/server.js  (of dubbelklik op start.bat)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const dbm = require('./db');
const { makeSync, datasetStatus, DATASETS } = require('./sync');
const A = require('./analytics');
const B = require('./backup');
const I = require('./importer');
const { seedDemo } = require('./demo');
const { writeAgentExport } = require('./agentExport');
const D = require('./calc/dates');
const { COST_TYPES } = require('./calc/margin');

const db = dbm.open(config.dbFile);
if (config.mode === 'DEMO') seedDemo(db);
const sync = makeSync(db, config);
const PUBLIC = path.join(config.root, 'public');

// ---------- Planning: synchroniseren, back-up, hersteltest ----------
function log(...a) { console.log(new Date().toLocaleString('nl-NL', { timeZone: D.TZ }), ...a); }

async function runSync(reason) {
  if (config.mode !== 'LIVE') return;
  log(`Synchronisatie gestart (${reason})`);
  const res = await sync.syncAll({ includeTests: reason === 'koppeltest' });
  for (const r of res) log(`  ${r.ok ? 'OK ' : 'FOUT'} ${r.dataset}: ${r.message || ''}`);
  refreshAgentExport();
  return res;
}

function refreshAgentExport() {
  if (!config.backupDir) return;
  try { const r = writeAgentExport(db, config); dbm.setMeta(db, 'agent_export_at', new Date().toISOString()); dbm.setMeta(db, 'agent_export_error', ''); log(`Agent-export bijgewerkt (${Math.round(r.bytes / 1024)} kB)`); }
  catch (e) { dbm.setMeta(db, 'agent_export_error', `${new Date().toISOString()} ${e.message}`); log(`Agent-export mislukt: ${e.message}`); }
}

function backupIfDue(reason) {
  if (!config.backupDir) return;
  const last = dbm.getMeta(db, 'last_backup_at');
  if (reason !== 'start' && last && Date.now() - Date.parse(last) < 20 * 3600000) return;
  try {
    const r = B.makeBackup(db, config);
    dbm.setMeta(db, 'last_backup_error', '');
    log(`Back-up gemaakt: ${r.file} (${Math.round(r.bytes / 1024)} kB)${r.removed.length ? `, ${r.removed.length} oude kopie(ën) opgeruimd` : ''}`);
  } catch (e) {
    dbm.setMeta(db, 'last_backup_error', `${new Date().toISOString()} ${e.message}`);
    log(`Back-up mislukt: ${e.message}`);
  }
  const lt = dbm.getMeta(db, 'last_restore_test');
  let lastAt = null; try { lastAt = lt ? JSON.parse(lt).at : null; } catch { /* */ }
  if (!lastAt || Date.now() - Date.parse(lastAt) > 30 * 86400000) {
    try { const t = B.restoreTest(db, config); log(`Hersteltest ${t.ok ? 'geslaagd' : 'MISLUKT'}: ${t.file}`); } catch (e) { log(`Hersteltest niet uitgevoerd: ${e.message}`); }
  }
}

// ---------- Hulpfuncties HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  const data = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Bestand te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('Ongeldige JSON')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown; charset=utf-8' };

function serveStatic(res, file) {
  const p = path.normalize(file);
  const allowed = [PUBLIC, path.join(config.root, 'templates'), path.join(config.root, 'docs')];
  if (!allowed.some((a) => p.startsWith(a + path.sep)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, { error: 'Niet gevonden' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}

function allProductViews() {
  return db.prepare('SELECT ean FROM products ORDER BY product_group, title').all().map((r) => A.productView(db, config, r.ean)).filter(Boolean);
}

function summaryRow(v) {
  const vel = v.velocity.bases;
  const b = (label) => vel.find((x) => x.label === label);
  const cur = vel.find((x) => x.isPriceBasis && x.label.startsWith('Huidige'));
  return {
    ean: v.product.ean, title: v.product.title, sku: v.product.sku, variant: v.product.variant, group: v.product.product_group,
    seasonType: v.product.season_type, owner: v.product.owner, tags: v.product.tags,
    price: v.priceNow ? v.priceNow.price : null,
    stock: v.stock.sellable,
    perDay7: b('Laatste 7 volledige dagen')?.perDay ?? null,
    perDay30: b('Laatste 30 volledige dagen')?.perDay ?? null,
    perDayAll: b('Totale beschikbare historie')?.perDay ?? null,
    perDay1: b('Laatste volledige dag')?.perDay ?? null,
    perDayPrice: cur ? cur.perDay : null, priceDays: cur ? cur.days : 0,
    units30: b('Laatste 30 volledige dagen')?.units ?? 0,
    coverDays: v.stock.sellable != null && b('Laatste 30 volledige dagen')?.perDay ? v.stock.sellable / b('Laatste 30 volledige dagen').perDay : null,
    contribution: v.economics ? v.economics.contributionBeforeAds : null,
    marginPct: v.economics ? v.economics.marginPct : null,
    economicsStatus: v.economics ? v.economics.status : 'GEEN_PRIJS',
    target: v.season ? v.season.target.target_date : null,
    status: v.season ? v.season.status : null,
    required: v.season ? v.season.required : null,
    incoming: v.incoming.reduce((s, i) => s + i.qty, 0),
    firstSale: v.series.find((s) => s.units > 0)?.day ?? null,
    lastSale: [...v.series].reverse().find((s) => s.units > 0)?.day ?? null,
  };
}

// ---------- Routes ----------
const routes = {
  'GET /api/status': () => {
    const rows = datasetStatus(db);
    return {
      config: config.publicView(),
      now: new Date().toISOString(), today: D.today(),
      syncRunning: sync.isRunning(),
      lastSyncAttempt: dbm.getMeta(db, 'last_sync_attempt'),
      datasets: rows,
      account: safeJson(dbm.getMeta(db, 'account_check')),
      priceRegistrationStart: dbm.getMeta(db, 'price_registration_start'),
      orderHistoryStart: dbm.getMeta(db, 'orders_history_start'),
      backup: B.status(db, config),
      agentExport: { at: dbm.getMeta(db, 'agent_export_at'), error: dbm.getMeta(db, 'agent_export_error') },
    };
  },
  'GET /api/overview': () => {
    const views = allProductViews();
    const rows = datasetStatus(db);
    return {
      mode: config.mode,
      kpis: A.kpis(db, config),
      attention: A.attention(db, config, views, rows),
      products: views.map(summaryRow),
      datasets: rows,
    };
  },
  'GET /api/products': () => allProductViews().map(summaryRow),
  'GET /api/product': (q) => {
    const v = A.productView(db, config, q.get('ean'));
    if (!v) throw httpErr(404, 'Product niet gevonden');
    v.costs = db.prepare('SELECT * FROM costs WHERE ean = ? ORDER BY cost_type, valid_from').all(v.product.ean);
    v.notes = db.prepare('SELECT * FROM workspace_items WHERE ean = ? ORDER BY created_at DESC').all(v.product.ean);
    v.timeline = db.prepare("SELECT at, action, detail FROM change_log WHERE entity_id = ? ORDER BY at DESC LIMIT 50").all(v.product.ean);
    v.changes = db.prepare('SELECT * FROM offer_changes WHERE ean = ? ORDER BY detected_at DESC LIMIT 200').all(v.product.ean);
    v.costTypes = COST_TYPES;
    return v;
  },
  'GET /api/season': () => allProductViews().filter((v) => v.product.season_type === 'SEIZOEN').map((v) => ({ ...summaryRow(v), season: v.season, incomingList: v.incoming })),
  'POST /api/sync': async (q, body) => {
    if (config.mode !== 'LIVE') return { results: [{ dataset: 'DEMO', ok: true, message: 'Demomodus: er is (nog) geen bol-toegang ingesteld in .env' }] };
    return { results: await runSync(body && body.koppeltest ? 'koppeltest' : 'handmatig') };
  },
  'POST /api/backup': () => ({ result: B.makeBackup(db, config) }),
  'POST /api/restore-test': () => ({ result: B.restoreTest(db, config) }),
  'POST /api/import/preview': (q, b) => I.preview(db, b.kind, b.rows || []),
  'POST /api/import/commit': (q, b) => I.commit(db, b.kind, b.rows || [], { filename: b.filename, overwrite: !!b.overwrite }),
  'GET /api/imports': () => db.prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 50').all(),
  'GET /api/changes': (q) => {
    const days = Math.min(730, Number(q.get('days') || 90));
    const rows = db.prepare(`SELECT c.*, p.title FROM offer_changes c LEFT JOIN products p ON p.ean = c.ean WHERE c.detected_at >= ? ORDER BY c.detected_at DESC LIMIT 2000`)
      .all(new Date(Date.now() - days * 86400000).toISOString());
    return { since: dbm.getMeta(db, 'price_registration_start'), rows };
  },
  'GET /api/targets':() => db.prepare('SELECT * FROM targets ORDER BY ean').all(),
  'POST /api/targets': (q, b) => { I.upsertTarget(db, { end_stock: 0, min_measure_days: 7, tolerance_days: 7, ...b }); return { ok: true }; },
  'POST /api/product': (q, b) => {
    const p = db.prepare('SELECT * FROM products WHERE ean = ?').get(b.ean);
    if (!p) throw httpErr(404, 'Product niet gevonden');
    const f = ['title', 'sku', 'variant', 'product_group', 'season_type', 'owner', 'tags'];
    for (const k of f) if (k in b) db.prepare(`UPDATE products SET ${k} = ?${k === 'title' ? ", title_source = 'HANDMATIG'" : ''} WHERE ean = ?`).run(b[k] === '' ? null : b[k], b.ean);
    dbm.log(db, 'product', b.ean, 'WIJZIGING', b);
    return { ok: true };
  },
  'GET /api/workspace': () => db.prepare('SELECT * FROM workspace_items ORDER BY updated_at DESC').all(),
  'POST /api/workspace': (q, b) => {
    const f = ['kind', 'title', 'body', 'ean', 'owner', 'status', 'priority', 'category', 'expected_effect', 'acceptance', 'eval_date', 'conclusion'];
    if (!b.title) throw httpErr(400, 'Titel is verplicht');
    if (b.id) {
      for (const k of f) if (k in b) db.prepare(`UPDATE workspace_items SET ${k} = ?, updated_at = datetime('now') WHERE id = ?`).run(b[k] === '' ? null : b[k], b.id);
      dbm.log(db, 'workspace', b.id, 'WIJZIGING', { title: b.title });
      return { id: b.id };
    }
    const r = db.prepare(`INSERT INTO workspace_items(${f.join(',')}) VALUES (${f.map(() => '?').join(',')})`).run(...f.map((k) => (b[k] === '' || b[k] === undefined ? null : b[k])));
    dbm.log(db, 'workspace', r.lastInsertRowid, 'NIEUW', { title: b.title, kind: b.kind });
    return { id: Number(r.lastInsertRowid) };
  },
  'POST /api/workspace/delete': (q, b) => { db.prepare('DELETE FROM workspace_items WHERE id = ?').run(b.id); dbm.log(db, 'workspace', b.id, 'VERWIJDERD'); return { ok: true }; },
  'GET /api/workspace/export': (q) => {
    const w = db.prepare('SELECT * FROM workspace_items WHERE id = ?').get(Number(q.get('id')));
    if (!w) throw httpErr(404, 'Niet gevonden');
    return { markdown: wishToPrompt(w) };
  },
  'GET /api/export': () => {
    const tables = ['products', 'costs', 'targets', 'incoming_stock', 'external_stock', 'workspace_items', 'price_observations', 'imports'];
    return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  },
};

function wishToPrompt(w) {
  const ctx = fs.existsSync(path.join(config.root, 'PROJECT_CONTEXT.md')) ? 'Lees eerst PROJECT_CONTEXT.md in de repository FSANL/rfig-dashboard.' : '';
  return [
    `# Ontwikkelopdracht: ${w.title}`, '',
    ctx, '',
    '## Wens', w.body || '(geen beschrijving)', '',
    `- Categorie: ${w.category || '-'}`, `- Prioriteit: ${w.priority || '-'}`, `- Status: ${w.status || '-'}`, '',
    '## Acceptatiecriteria', w.acceptance || '(nog invullen)', '',
    '## Randvoorwaarden',
    '- Het dashboard leest het bol-account alleen uit; geen wijzigingen zonder expliciete toestemming.',
    '- Verzin geen gegevens; ontbrekende data tonen als ontbrekend, niet als nul.',
    '- Bestaande gegevens en eigen dashboards mogen niet verloren gaan (database-migratie, back-up vooraf).',
    '- Voeg tests toe en werk PROJECT_CONTEXT.md en docs/voortgang.md bij.',
  ].join('\n');
}

function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

const server = http.createServer(async (req, res) => {
  try {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'Niet toegestaan' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    // Alleen verzoeken van deze pc zelf; voorkomt dat andere websites de lokale API aanroepen.
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return send(res, 403, { error: 'Niet toegestaan' });
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const out = await routes[key](url.searchParams, body);
      return send(res, 200, out);
    }
    if (req.method !== 'GET') return send(res, 404, { error: 'Niet gevonden' });
    if (url.pathname.startsWith('/templates/')) return serveStatic(res, path.join(config.root, decodeURIComponent(url.pathname)));
    if (url.pathname.startsWith('/docs/')) return serveStatic(res, path.join(config.root, decodeURIComponent(url.pathname)));
    const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return serveStatic(res, path.join(PUBLIC, file));
  } catch (e) {
    send(res, e.code && Number.isInteger(e.code) ? e.code : 500, { error: e.message });
  }
});

if (require.main === module) {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { log(`Poort ${config.port} is al in gebruik — draait het dashboard al? Open http://localhost:${config.port}`); process.exit(0); }
    throw e;
  });
  server.listen(config.port, config.host, () => {
    log(`RFIG Dashboard draait op http://localhost:${config.port}  (modus: ${config.mode === 'DEMO' ? 'DEMO — synthetische gegevens' : 'LIVE'})`);
    if (config.mode === 'DEMO') log('Geen bol-toegang ingesteld in .env: het dashboard toont DEMODATA.');
    backupIfDue('start');
    if (config.mode === 'DEMO') refreshAgentExport();
    runSync('opstarten / inhalen gemiste synchronisatie').catch((e) => log('Synchronisatie fout:', e.message));
    setInterval(() => { runSync('gepland').catch((e) => log('Synchronisatie fout:', e.message)); }, config.syncIntervalMinutes * 60000);
    setInterval(() => backupIfDue('gepland'), 60 * 60000);
  });
}

module.exports = { server, routes, db };
