'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPricePeriods, measurePeriods, summarizeByPrice } = require('../src/calc/pricePeriods');
const D = require('../src/calc/dates');

// Hulp: Amsterdam-lokale tijd -> instant (ms).
function ams(dateStr, hh = 0, mm = 0) { return D.startOfDay(dateStr) + (hh * 60 + mm) * 60000; }
// Uurlijkse metingen tussen twee momenten met een vaste prijs.
function hourly(fromMs, toMs, price) {
  const out = [];
  for (let t = fromMs; t <= toMs; t += 3600000) out.push({ at: t, price });
  return out;
}
const NOW = ams('2026-12-01', 12);

test('1. wijziging midden op de dag: meetperiode 11 t/m 17 november (7 dagen)', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 64.99 },
    { at: ams('2026-11-10', 14), price: 59.99, exact: true },
    { at: ams('2026-11-18', 9), price: 62.99, exact: true },
    { at: ams('2026-11-30', 9), price: 62.99 },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  const p5999 = p.find((x) => x.price === 59.99);
  assert.equal(p5999.firstValidDay, '2026-11-11');
  assert.equal(p5999.lastValidDay, '2026-11-17');
  assert.equal(p5999.validDays.length, 7);
  const p6299 = p.find((x) => x.price === 62.99);
  assert.equal(p6299.firstValidDay, '2026-11-19');
});

test('2. wijziging precies om middernacht: die dag valt weg, de dag ervoor niet', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 59.99 },
    { at: ams('2026-11-18', 0, 0), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  assert.equal(p[0].lastValidDay, '2026-11-17');
  assert.equal(p[1].firstValidDay, '2026-11-19');
  assert.ok(p[1].excludedDays.some((e) => e.day === '2026-11-18'));
  assert.ok(!p[0].excludedDays.some((e) => e.day === '2026-11-17'));
});

test('3. meerdere wijzigingen op één dag: tussenprijs heeft geen meetdagen', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 64.99 },
    { at: ams('2026-11-10', 9), price: 59.99, exact: true },
    { at: ams('2026-11-10', 15), price: 61.99, exact: true },
    { at: ams('2026-11-18', 9), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  const mid = p.find((x) => x.price === 59.99);
  assert.equal(mid.status, 'ONVOLDOENDE_MEETDAGEN');
  assert.equal(mid.message, 'Onvoldoende volledige meetdagen.');
  const after = p.find((x) => x.price === 61.99);
  assert.deepEqual([after.firstValidDay, after.lastValidDay], ['2026-11-11', '2026-11-17']);
  const before = p.find((x) => x.price === 64.99);
  assert.equal(before.lastValidDay, '2026-11-09');
});

test('4. wijzigingen op opeenvolgende dagen: geen volledige meetdag ertussen', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 64.99 },
    { at: ams('2026-11-10', 9), price: 59.99, exact: true },
    { at: ams('2026-11-11', 9), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  assert.equal(p.find((x) => x.price === 59.99).validDays.length, 0);
  assert.equal(p.find((x) => x.price === 62.99).firstValidDay, '2026-11-12');
});

test('5. lopende prijsperiode: meting tot en met gisteren, vandaag telt niet', () => {
  const now = ams('2026-11-25', 16);
  const obs = [
    { at: ams('2026-11-01', 9), price: 64.99 },
    { at: ams('2026-11-20', 11), price: 59.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: now, gapHours: 24 * 30 });
  const cur = p[p.length - 1];
  assert.equal(cur.isCurrent, true);
  assert.deepEqual([cur.firstValidDay, cur.lastValidDay, cur.validDays.length], ['2026-11-21', '2026-11-24', 4]);
});

test('6. terugkeer naar eerder prijsniveau: aparte perioden, samenvatting gewogen', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 59.99 },
    { at: ams('2026-11-05', 9), price: 62.99, exact: true },
    { at: ams('2026-11-15', 9), price: 59.99, exact: true },
    { at: ams('2026-11-20', 9), price: 64.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  assert.equal(p.filter((x) => x.price === 59.99).length, 2);
  const daily = {};
  for (const d of D.daysBetween('2026-11-01', '2026-11-30')) daily[d] = 2;
  daily['2026-11-16'] = 8; // uitschieter in tweede 59,99-periode
  const m = measurePeriods(p, daily);
  const s = summarizeByPrice(m).find((x) => x.price === 59.99);
  // Periode 1: 2–4 nov (3 dagen, 6 st). Periode 2: 16–19 nov (4 dagen, 8+2+2+2=14 st).
  assert.equal(s.days, 7);
  assert.equal(s.units, 20);
  assert.equal(s.perDay, 20 / 7); // gewogen, niet (2 + 3,5) / 2
});

test('7. dagen met voorraadtekort: afzet per kalenderdag en per beschikbare dag', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 59.99 },
    { at: ams('2026-11-11', 9), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 30 });
  const daily = {};
  for (const d of D.daysBetween('2026-11-02', '2026-11-10')) daily[d] = 3;
  daily['2026-11-06'] = 0; daily['2026-11-07'] = 0;
  const m = measurePeriods(p, daily, new Set(['2026-11-06', '2026-11-07']))[0];
  assert.equal(m.validDayCount, 9);
  assert.equal(m.units, 21);
  assert.deepEqual(m.shortageDays, ['2026-11-06', '2026-11-07']);
  assert.equal(m.perDay, 21 / 9);
  assert.equal(m.perAvailableDay, 3);
});

test('8. onbekend exact wijzigingsmoment (pc uit): alle dagen in het onzekere interval vallen weg', () => {
  const obs = [
    ...hourly(ams('2026-11-01', 9), ams('2026-11-10', 22), 59.99),
    // pc uit van 10 nov 22:00 tot 12 nov 08:00; daarna blijkt de prijs veranderd
    ...hourly(ams('2026-11-12', 8), ams('2026-11-30', 22), 62.99),
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW });
  const after = p.find((x) => x.price === 62.99);
  assert.equal(after.startEvent.certainty, 'TUSSEN_METINGEN');
  for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) assert.ok(after.excludedDays.some((e) => e.day === d), d);
  assert.equal(p[0].lastValidDay, '2026-11-09');
  assert.equal(after.firstValidDay, '2026-11-13');
});

test('meetgat zonder prijswijziging: dagen zonder meting tellen niet mee', () => {
  const obs = [
    ...hourly(ams('2026-11-01', 9), ams('2026-11-05', 18), 59.99),
    ...hourly(ams('2026-11-09', 9), ams('2026-11-30', 18), 59.99), // 3,5 dag pc uit
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW }); // standaard 36 uur
  assert.equal(p.length, 1);
  for (const d of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) {
    assert.ok(!p[0].validDays.includes(d), d);
  }
  assert.ok(p[0].validDays.includes('2026-11-04'));
  assert.ok(p[0].validDays.includes('2026-11-10'));
});

test('zomer-/wintertijd: wijziging op 25 oktober 2026 (25-uursdag) sluit precies die dag uit', () => {
  const obs = [
    { at: ams('2026-10-20', 9), price: 59.99 },
    { at: ams('2026-10-25', 23, 30), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: NOW, gapHours: 24 * 60 });
  assert.equal(p[0].lastValidDay, '2026-10-24');
  assert.equal(p[1].firstValidDay, '2026-10-26');
  assert.equal(D.amsDate(ams('2026-10-25', 23, 30)), '2026-10-25');
  assert.equal(D.amsDate(D.startOfDay('2026-10-26') - 1), '2026-10-25');
});

test('verkopen op wijzigingsdagen blijven in totalen, alleen niet in de prijsperiode', () => {
  const obs = [
    { at: ams('2026-11-01', 9), price: 59.99 },
    { at: ams('2026-11-10', 14), price: 62.99, exact: true },
  ];
  const p = buildPricePeriods(obs, { nowMs: ams('2026-11-15', 12), gapHours: 24 * 30 });
  const daily = { '2026-11-09': 2, '2026-11-10': 5, '2026-11-11': 3 };
  const m = measurePeriods(p, daily);
  const inPeriods = m.reduce((s, x) => s + x.units, 0);
  const total = Object.values(daily).reduce((a, b) => a + b, 0);
  assert.equal(total, 10);
  assert.equal(inPeriods, 5); // 10 nov (5 st) is wijzigingsdag
});
