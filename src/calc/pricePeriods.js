'use strict';
// Prijsperioden volgens §12 van de projectprompt:
// - de dag waarop een prijswijziging plaatsvindt telt niet mee (ook bij meerdere wijzigingen op één dag
//   en bij een wijziging precies om middernacht);
// - meting begint de dag ná de wijziging en eindigt de dag vóór de volgende wijziging;
// - voor de huidige prijs loopt de meting tot en met gisteren;
// - is het wijzigingsmoment onzeker (gedetecteerd tussen twee metingen), dan vallen alle dagen
//   die dat onzekere interval raken weg;
// - meetgaten (te lang geen meting, bv. pc uit) tellen niet mee: de prijs was toen niet vastgesteld.

const D = require('./dates');

const DEFAULT_GAP_HOURS = 36;

/**
 * @param {Array<{at: string|number, price: number, exact?: boolean}>} observations
 *   Prijsmetingen (uit synchronisatie) en handmatig vastgelegde wijzigingen (exact: true).
 * @param {object} opts { nowMs, gapHours }
 * @returns {Array<object>} prijsperioden in tijdsvolgorde
 */
function buildPricePeriods(observations, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const gapMs = (opts.gapHours ?? DEFAULT_GAP_HOURS) * 3600000;
  const yesterday = D.yesterday(nowMs);

  const pts = observations
    .map((o) => ({ at: D.toMs(o.at), price: round2(o.price), exact: !!o.exact }))
    .filter((o) => o.at <= nowMs && Number.isFinite(o.price))
    .sort((a, b) => a.at - b.at || (b.exact - a.exact));
  if (pts.length === 0) return [];

  // 1) Gebeurtenissen: start van registratie, prijswijzigingen, meetgaten.
  const periods = [];
  let cur = null;
  const startPeriod = (price, event) => {
    cur = { price, startEvent: event, gaps: [] };
    periods.push(cur);
  };

  startPeriod(pts[0].price, {
    type: 'START_REGISTRATIE',
    from: null, to: pts[0].at,
    certainty: 'ONBEKEND_DAARVOOR',
    excludedDays: [D.amsDate(pts[0].at)],
  });

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const p = pts[i];
    if (p.exact && p.price !== cur.price) {
      startPeriod(p.price, { type: 'WIJZIGING', from: p.at, to: p.at, certainty: 'EXACT', excludedDays: [D.amsDate(p.at)] });
    } else if (p.price !== cur.price) {
      startPeriod(p.price, {
        type: 'WIJZIGING', from: prev.at, to: p.at,
        certainty: 'TUSSEN_METINGEN',
        excludedDays: D.daysTouched(prev.at, p.at),
      });
    } else if (p.at - prev.at > gapMs) {
      cur.gaps.push({ from: prev.at, to: p.at, days: D.daysTouched(prev.at, p.at) });
    }
  }

  // 2) Geldige meetdagen per periode.
  return periods.map((per, idx) => {
    const next = periods[idx + 1];
    const startExcl = per.startEvent.excludedDays;
    const first = D.addDays(startExcl[startExcl.length - 1], 1);
    const isCurrent = !next;
    const last = isCurrent ? yesterday : D.addDays(next.startEvent.excludedDays[0], -1);

    const excluded = new Map();
    for (const d of startExcl) excluded.set(d, per.startEvent.type === 'START_REGISTRATIE' ? 'START_REGISTRATIE' : 'WIJZIGINGSDAG');
    if (next) for (const d of next.startEvent.excludedDays) excluded.set(d, 'WIJZIGINGSDAG');
    for (const g of per.gaps) for (const d of g.days) if (d >= first && d <= last) excluded.set(d, 'MEETGAT');

    const validDays = first <= last ? D.daysBetween(first, last).filter((d) => !excluded.has(d)) : [];
    return {
      price: per.price,
      startEvent: { type: per.startEvent.type, certainty: per.startEvent.certainty, from: iso(per.startEvent.from), to: iso(per.startEvent.to) },
      isCurrent,
      firstValidDay: validDays[0] ?? null,
      lastValidDay: validDays[validDays.length - 1] ?? null,
      validDays,
      excludedDays: [...excluded.entries()].sort().map(([day, reason]) => ({ day, reason })),
      status: validDays.length > 0 ? 'OK' : 'ONVOLDOENDE_MEETDAGEN',
      message: validDays.length > 0 ? null : 'Onvoldoende volledige meetdagen.',
    };
  });
}

/**
 * Koppelt verkoop en beschikbaarheid aan de prijsperioden.
 * @param periods resultaat van buildPricePeriods
 * @param {Record<string, number>} dailyUnits verkochte stuks per Amsterdam-dag
 * @param {Set<string>} shortageDays dagen met (deels) geen verkoopbare voorraad
 */
function measurePeriods(periods, dailyUnits, shortageDays = new Set()) {
  return periods.map((p) => {
    const units = p.validDays.reduce((s, d) => s + (dailyUnits[d] || 0), 0);
    const shortage = p.validDays.filter((d) => shortageDays.has(d));
    const availableDays = p.validDays.length - shortage.length;
    const unitsAvailable = p.validDays.filter((d) => !shortageDays.has(d)).reduce((s, d) => s + (dailyUnits[d] || 0), 0);
    return {
      ...p,
      validDayCount: p.validDays.length,
      units,
      perDay: p.validDays.length ? units / p.validDays.length : null,
      shortageDays: shortage,
      availableDays,
      perAvailableDay: availableDays > 0 ? unitsAvailable / availableDays : null,
    };
  });
}

/** Samenvatting per gelijk prijsniveau: totale stuks / totale geldige meetdagen (gewogen). */
function summarizeByPrice(measured) {
  const by = new Map();
  for (const p of measured) {
    const k = p.price.toFixed(2);
    const s = by.get(k) || { price: p.price, periods: 0, days: 0, units: 0 };
    s.periods += 1; s.days += p.validDayCount; s.units += p.units;
    by.set(k, s);
  }
  return [...by.values()].map((s) => ({ ...s, perDay: s.days ? s.units / s.days : null }))
    .sort((a, b) => a.price - b.price);
}

function round2(x) { return Math.round(Number(x) * 100) / 100; }
function iso(ms) { return ms == null ? null : new Date(ms).toISOString(); }

module.exports = { buildPricePeriods, measurePeriods, summarizeByPrice, DEFAULT_GAP_HOURS };
