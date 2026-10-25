'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbm = require('../src/db');
const I = require('../src/importer');
const B = require('../src/backup');
const D = require('../src/calc/dates');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'rfig-')); }

test('import: kolomherkenning, EAN als tekst, fouten en dubbele regels', () => {
  const db = dbm.open(path.join(tmp(), 't.sqlite'));
  const rows = [
    { EAN: 8712345678906, Kostensoort: 'KOSTPRIJS', 'Bedrag per stuk ex btw': '17,50', 'Geldig vanaf': '01-09-2026', Basis: 'geboekt' },
    { EAN: '8712345678906', Kostensoort: 'kostprijs', 'Bedrag per stuk ex btw': 17.5, 'Geldig vanaf': '2026-09-01' }, // dubbel
    { EAN: '871234', Kostensoort: 'TRANSPORT', 'Bedrag per stuk ex btw': 'abc' }, // fout
    { EAN: '0012345678905', Kostensoort: 'Verpakking', 'Bedrag per stuk ex btw': 0.6 },
  ];
  const pv = I.preview(db, 'KOSTEN', rows);
  assert.deepEqual(pv.missingRequired, []);
  assert.deepEqual(pv.rows.map((r) => r.status), ['NIEUW', 'DUBBEL_IN_BESTAND', 'FOUT', 'NIEUW']);
  assert.equal(pv.rows[0].data.ean, '8712345678906');
  assert.equal(pv.rows[0].data.amount, 17.5);
  assert.equal(pv.rows[0].data.valid_from, '2026-09-01');
  assert.equal(pv.rows[0].data.basis, 'GEBOEKT');
  assert.equal(pv.rows[3].data.ean, '0012345678905'); // voorloopnullen behouden
  const r = I.commit(db, 'KOSTEN', rows, { filename: 'test.xlsx' });
  assert.deepEqual([r.ok, r.skipped, r.errors], [2, 1, 1]);
  // tweede keer: bestaat al -> overgeslagen tenzij overwrite
  const r2 = I.commit(db, 'KOSTEN', rows.slice(0, 1));
  assert.equal(r2.skipped, 1);
  const r3 = I.commit(db, 'KOSTEN', [{ ...rows[0], 'Bedrag per stuk ex btw': 18 }], { overwrite: true });
  assert.equal(r3.ok, 1);
  assert.equal(db.prepare("SELECT amount FROM costs WHERE cost_type='KOSTPRIJS'").get().amount, 18);
});

test('import: handmatige productgegevens worden niet door synchronisatie overschreven', () => {
  const db = dbm.open(path.join(tmp(), 't.sqlite'));
  I.commit(db, 'PRODUCTEN', [{ ean: '8712345678906', titel: 'Verwarmingsdeken 160x200', type: 'Seizoen' }]);
  // zelfde statement als de synchronisatie gebruikt
  db.prepare("INSERT INTO products(ean, title, title_source) VALUES (?, ?, 'BOL') ON CONFLICT(ean) DO UPDATE SET title = excluded.title WHERE products.title IS NULL OR products.title_source = 'BOL'").run('8712345678906', 'Titel van bol');
  assert.equal(db.prepare('SELECT title FROM products').get().title, 'Verwarmingsdeken 160x200');
});

test('back-up: momentopname, bewaarschema en hersteltest', () => {
  const dir = tmp();
  const config = { backupDir: dir, mode: 'LIVE', dataDir: tmp() };
  const db = dbm.open(path.join(config.dataDir, 'rfig.sqlite'));
  db.prepare("INSERT INTO products(ean, title) VALUES ('8712345678906', 'x')").run();
  const now = D.startOfDay('2026-12-31') + 12 * 3600000;
  // 400 dagen dagelijkse back-ups simuleren
  for (let i = 400; i >= 0; i--) B.makeBackup(db, config, now - i * 86400000);
  const files = B.listBackups(path.join(dir, 'Backups'));
  // 7 dagelijks + max 4 wekelijks + max 12 maandelijks (overlap mogelijk)
  assert.ok(files.length <= 23 && files.length >= 12, `aantal ${files.length}`);
  assert.equal(files[0].day, '2026-12-31');
  const days = files.map((f) => f.day);
  for (const d of ['2026-12-31', '2026-12-30', '2026-12-25']) assert.ok(days.includes(d), d);
  assert.ok(!days.some((d) => d < '2025-12-01'));
  const t = B.restoreTest(db, config);
  assert.equal(t.ok, true);
  assert.equal(t.counts.products, 1);
  assert.ok(!fs.readdirSync(path.join(dir, 'Backups')).some((f) => f.startsWith('.tmp')));
});
