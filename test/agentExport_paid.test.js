'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dbm = require('../src/db');
const { writeAgentExport } = require('../src/agentExport');

test('agent-export: betaalde prijs 24u/7d en mislukte sync = VEROUDERD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-'));
  const db = dbm.open(path.join(dir, 'rfig.sqlite'));
  const now = Date.parse('2026-10-26T20:00:00Z');
  const iso = (h) => new Date(now - h * 3600000).toISOString();
  db.prepare("INSERT INTO products (ean,title) VALUES ('1','Naaimachine')").run();
  db.prepare("INSERT INTO offers (offer_id,ean,unit_price,for_sale_nl,stock_amount,corrected_stock,updated_at) VALUES ('o1','1',99.99,1,10,10,?)").run(iso(1));
  const oi = db.prepare('INSERT INTO order_items (order_item_id,order_id,ean,quantity,quantity_cancelled,unit_price,placed_at) VALUES (?,?,?,?,?,?,?)');
  oi.run('a','A','1',1,0,79.99,iso(2));   // binnen 24u
  oi.run('b','B','1',2,1,79.99,iso(30));  // binnen 7d, 1 geannuleerd
  oi.run('c','C','1',1,0,99.99,iso(100)); // binnen 7d
  oi.run('d','D','1',1,0,50,iso(200));    // buiten 7d
  const sr = db.prepare('INSERT INTO sync_runs (dataset,started_at,finished_at,status,records,message) VALUES (?,?,?,?,?,?)');
  sr.run('OFFERS', iso(20), iso(20), 'GESLAAGD', 4, '');
  sr.run('ORDERS', iso(20), iso(20), 'GESLAAGD', 4, '');
  sr.run('OFFERS', iso(1), iso(1), 'MISLUKT', 0, 'ID of secret klopt niet');
  const out = path.join(dir, 'export'); fs.mkdirSync(out);
  const r = writeAgentExport(db, { mode: 'LIVE', agentExportDir: out, backupDir: '' }, now);
  assert.ok(fs.existsSync(r.file));
  const xml = require('node:child_process').execSync(`cd ${dir} && unzip -p "${r.file}" xl/worksheets/sheet2.xml xl/worksheets/sheet1.xml xl/sharedStrings.xml 2>/dev/null || true`).toString();
  assert.match(xml, /Betaalde prijs laatste 7 dagen/);
  assert.match(xml, /VEROUDERD: laatste synchronisatie mislukt/);
  fs.writeFileSync(path.join(os.tmpdir(), 'ae-last.xml'), xml);
});
