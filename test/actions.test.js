'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dbm = require('../src/db');
const ACT = require('../src/actions');

const CSV = [
  'ID;Datum gemeld;Agent;Classificatie;Wat;Waarom belangrijk;Wat te doen;Wie;Wanneer;Bron',
  'A3;2026-10-27;Ralph;Important;Later;x;y;Ivo;2026-11-10;',
  'A1;2026-10-27;Ralph;Essential;"Buy-box kwijt; check";x;"**Prijs** controleren";Compagnon;31-10-2026;https://drive.google.com/x',
  'A2;2026-10-27;Meindert;Paramount;Urgent;x;y;Ivo;;',
  'A4;2026-10-27;Linda;Important;Eerder;x;y;Ivo;2026-11-01;',
  'A4;2026-10-27;Linda;Important;Dubbel;x;y;Ivo;;',
  'A5;2026-10-27;Linda;weet niet;Onbekend;x;y;Ivo;;',
].join('\r\n');

test('actielijst: inlezen, sorteren op belang en deadline, markdown weg, dubbel en onbekend gemeld', () => {
  const { actions, problems } = ACT.parseActions(CSV);
  const ids = ACT.sortActions(actions).map((a) => a.id);
  assert.deepEqual(ids, ['A2', 'A1', 'A4', 'A3', 'A5']);
  const a1 = actions.find((a) => a.id === 'A1');
  assert.equal(a1.what, 'Buy-box kwijt; check');
  assert.equal(a1.todo, 'Prijs controleren');
  assert.equal(a1.due, '2026-10-31');
  assert.ok(problems.some((p) => /A4 staat dubbel/.test(p)));
  assert.ok(problems.some((p) => /A5/.test(p)));
});

test('actielijst: afvinken bewaard per ID, heropenen, te laat, ontbrekend bestand gemeld', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'act-'));
  const db = dbm.open(path.join(dir, 'rfig.sqlite'));
  const file = path.join(dir, 'a.csv'); fs.writeFileSync(file, '\uFEFF' + CSV);
  const cfg = { mode: 'LIVE', actionsFile: file };
  ACT.setStatus(db, 'A1', true, 'Ivo');
  let r = ACT.loadActions(db, cfg, '2026-11-05');
  assert.equal(r.done.length, 1); assert.equal(r.done[0].doneBy, 'Ivo');
  assert.equal(r.open.find((a) => a.id === 'A4').overdue, true);
  assert.equal(r.open.find((a) => a.id === 'A3').overdue, false);
  ACT.setStatus(db, 'A1', false);
  r = ACT.loadActions(db, cfg, '2026-11-05');
  assert.equal(r.done.length, 0);
  const miss = ACT.loadActions(db, { mode: 'LIVE', actionsFile: path.join(dir, 'nee.csv') }, '2026-11-05');
  assert.equal(miss.fileFound, false); assert.match(miss.problems[0], /niet gevonden/);
});

test('actielijst: standaardpad in de map van Linda; demo gebruikt voorbeeldbestand', () => {
  assert.equal(ACT.actionsFile({ mode: 'LIVE', agentExportDir: 'G:/CM' }), path.join('G:/CM', 'Linda (Rapportage & Analyse)', 'Actielijst RFIG.csv'));
  const demo = ACT.actionsFile({ mode: 'DEMO', root: path.resolve(__dirname, '..') });
  assert.ok(fs.existsSync(demo));
  assert.equal(ACT.parseActions(fs.readFileSync(demo, 'utf8')).problems.length, 0);
});
