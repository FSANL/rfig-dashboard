'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/calc/velocity');
const { unitEconomics } = require('../src/calc/margin');
const D = require('../src/calc/dates');

const NOW = D.startOfDay('2026-11-01') + 12 * 3600000; // 1 nov 2026 12:00
const TARGET = '2027-03-01';

function daily(from, to, n) { const o = {}; for (const d of D.daysBetween(from, to)) o[d] = n; return o; }

test('tempo-bases: vandaag telt niet mee en wordt apart getoond', () => {
  const du = { ...daily('2026-10-01', '2026-10-31', 4), '2026-11-01': 9 };
  const r = V.velocityBases({ dailyUnits: du, historyStart: '2026-10-01', nowMs: NOW });
  assert.equal(r.todayUnits, 9);
  assert.equal(r.bases[0].perDay, 4);
  assert.equal(r.bases[1].days, 7);
  assert.equal(r.bases[2].days, 30);
  assert.equal(r.bases[3].days, 31);
});

test('korte historie: venster wordt als onvolledig gemarkeerd', () => {
  const r = V.velocityBases({ dailyUnits: daily('2026-10-28', '2026-10-31', 2), historyStart: '2026-10-28', nowMs: NOW });
  assert.equal(r.bases[2].days, 4);
  assert.equal(r.bases[2].incomplete, true);
});

test('benodigd tempo: 400 stuks, verkopen t/m 28 feb', () => {
  const req = V.requiredRate({ stock: 400, today: '2026-11-01', targetDate: TARGET });
  assert.equal(req.remainingDays, 120); // 1 nov t/m 28 feb
  assert.equal(req.perDay, 400 / 120);
});

test('nul voorraad: uitverkocht', () => {
  const s = V.selloutStatus({ stock: 0, bases: [], today: '2026-11-01', targetDate: TARGET });
  assert.equal(s.status, 'OP_KOERS');
});

test('nul verkopen: geen uitverkoopdatum berekenbaar', () => {
  const f = V.forecast({ stock: 100, rate: 0, today: '2026-11-01', targetDate: TARGET });
  assert.equal(f.selloutDate, null);
  assert.equal(f.note, 'Geen uitverkoopdatum berekenbaar bij dit tempo');
  assert.equal(f.restAtTarget, 100);
});

test('verstreken doeldatum', () => {
  const s = V.selloutStatus({ stock: 20, bases: [], today: '2027-03-05', targetDate: TARGET });
  assert.equal(s.status, 'DOELDATUM_VERSTREKEN');
  assert.equal(s.rest, 20);
});

test('inkomende voorraad wordt pas vanaf ontvangstdatum verkocht', () => {
  const f = V.forecast({ stock: 10, rate: 5, incoming: [{ qty: 10, date: '2026-11-10' }], today: '2026-11-01' });
  assert.equal(f.selloutDate, '2026-11-02'); // eerst 10 st op na 2 dagen
  assert.ok(f.unfulfilledAfterSellout > 0); // tekort vóór de levering zichtbaar
  const req = V.requiredRate({ stock: 10, incoming: [{ qty: 10, date: '2026-11-10' }], today: '2026-11-01', targetDate: TARGET });
  assert.equal(req.toSellWithIncoming, 20);
});

test('te snel / op koers / te langzaam', () => {
  const mk = (perDay) => [{ label: 'Laatste 7 volledige dagen', days: 7, perDay, incomplete: false }];
  const base = { stock: 120, today: '2026-11-01', targetDate: TARGET, toleranceDays: 7 };
  assert.equal(V.selloutStatus({ ...base, bases: mk(3) }).status, 'TE_SNEL'); // op na 40 dagen
  assert.equal(V.selloutStatus({ ...base, bases: mk(1) }).status, 'OP_KOERS'); // op na 120 dagen
  assert.equal(V.selloutStatus({ ...base, bases: mk(0.5) }).status, 'TE_LANGZAAM');
});

test('onvoldoende historie: geen dwingend advies', () => {
  const s = V.selloutStatus({ stock: 100, today: '2026-11-01', targetDate: TARGET,
    bases: [{ label: 'Laatste 7 volledige dagen', days: 3, perDay: 9, incomplete: true }] });
  assert.equal(s.status, 'ONVOLDOENDE_GEGEVENS');
});

test('varianten worden afzonderlijk beoordeeld (groepsgemiddelde verbergt niets)', () => {
  const mk = (perDay) => [{ label: 'Laatste 7 volledige dagen', days: 7, perDay, incomplete: false }];
  const a = V.selloutStatus({ stock: 120, bases: mk(3), today: '2026-11-01', targetDate: TARGET });
  const b = V.selloutStatus({ stock: 120, bases: mk(0.3), today: '2026-11-01', targetDate: TARGET });
  assert.notEqual(a.status, b.status);
});

test('marge: ontbrekende kosten = onvolledig, niet nul', () => {
  const r = unitEconomics({ unitPriceIncl: 59.99, commission: 8, costs: { KOSTPRIJS: { amount: 18, basis: 'GEBOEKT' } } });
  assert.equal(r.complete, false);
  assert.equal(r.status, 'ONVOLLEDIG');
  assert.ok(r.missing.includes('Transport'));
  assert.ok(Math.abs(r.netRevenue - 59.99 / 1.21) < 1e-9);
  assert.equal(r.breakEvenPriceIncl, null);
});

test('marge: volledig met break-even', () => {
  const costs = Object.fromEntries(['KOSTPRIJS', 'TRANSPORT', 'FULFILMENT', 'VERZENDING', 'VERPAKKING'].map((k) => [k, { amount: 2, basis: 'GEBOEKT' }]));
  const r = unitEconomics({ unitPriceIncl: 60.5, commission: 6.05, costs });
  assert.equal(r.status, 'VOLLEDIG');
  assert.ok(Math.abs(r.contributionBeforeAds - (50 - 6.05 - 10)) < 1e-9);
  // break-even: 10 / (1/1,21 − 0,1)
  assert.ok(Math.abs(r.breakEvenPriceIncl - 10 / (1 / 1.21 - 0.1)) < 1e-9);
});
