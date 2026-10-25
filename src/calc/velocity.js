'use strict';
// Verkoopsnelheid (§11), benodigd tempo (§14) en uitverkoopstatus (§16).
// Alle tempo's zijn stuks per dag. Vandaag telt nooit mee in een tempo (onvolledige dag).

const D = require('./dates');

/**
 * Tempo over een reeks volledige dagen.
 * @param {Record<string, number>} dailyUnits
 * @param {string[]} days
 * @param {Set<string>} shortageDays
 */
function rateOver(dailyUnits, days, shortageDays = new Set(), label = '') {
  const units = days.reduce((s, d) => s + (dailyUnits[d] || 0), 0);
  const avail = days.filter((d) => !shortageDays.has(d));
  const unitsAvail = avail.reduce((s, d) => s + (dailyUnits[d] || 0), 0);
  return {
    label,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    days: days.length,
    units,
    perDay: days.length ? units / days.length : null,
    shortageDays: days.length - avail.length,
    perAvailableDay: avail.length ? unitsAvail / avail.length : null,
  };
}

/**
 * Alle berekeningsbases naast elkaar.
 * @param {object} a
 * @param {Record<string, number>} a.dailyUnits
 * @param {string|null} a.historyStart eerste dag waarvoor verkoopdata beschikbaar is
 * @param {object|null} a.currentPeriod gemeten huidige prijsperiode (measurePeriods)
 * @param {object[]} a.previousPeriods eerdere gemeten prijsperioden
 */
function velocityBases({ dailyUnits, historyStart, currentPeriod, previousPeriods = [], shortageDays = new Set(), nowMs = Date.now() }) {
  const y = D.yesterday(nowMs);
  const t = D.today(nowMs);
  const window = (n) => {
    let from = D.addDays(y, -(n - 1));
    if (historyStart && from < historyStart) from = historyStart;
    return from <= y ? D.daysBetween(from, y) : [];
  };
  const out = [
    rateOver(dailyUnits, window(1), shortageDays, 'Laatste volledige dag'),
    rateOver(dailyUnits, window(7), shortageDays, 'Laatste 7 volledige dagen'),
    rateOver(dailyUnits, window(30), shortageDays, 'Laatste 30 volledige dagen'),
    rateOver(dailyUnits, historyStart && historyStart <= y ? D.daysBetween(historyStart, y) : [], shortageDays, 'Totale beschikbare historie'),
  ];
  // Markeer vensters die korter zijn dan gevraagd (historie begint later).
  [1, 7, 30].forEach((n, i) => { out[i].requestedDays = n; out[i].incomplete = out[i].days < n; });

  if (currentPeriod) {
    out.push({
      label: `Huidige prijs (€ ${currentPeriod.price.toFixed(2).replace('.', ',')})`,
      from: currentPeriod.firstValidDay, to: currentPeriod.lastValidDay,
      days: currentPeriod.validDayCount, units: currentPeriod.units, perDay: currentPeriod.perDay,
      shortageDays: currentPeriod.shortageDays.length, perAvailableDay: currentPeriod.perAvailableDay,
      isPriceBasis: true,
    });
  }
  for (const p of previousPeriods) {
    out.push({
      label: `Eerdere prijs € ${p.price.toFixed(2).replace('.', ',')}`,
      from: p.firstValidDay, to: p.lastValidDay, days: p.validDayCount, units: p.units, perDay: p.perDay,
      shortageDays: p.shortageDays.length, perAvailableDay: p.perAvailableDay, isPriceBasis: true,
    });
  }
  return { today: t, todayUnits: dailyUnits[t] || 0, bases: out };
}

/**
 * Simuleert dag voor dag de voorraad bij een vast tempo.
 * @param {object} a
 * @param {number} a.stock verkoopbare voorraad nu
 * @param {number|null} a.rate stuks per dag
 * @param {Array<{qty:number,date:string}>} a.incoming bevestigde leveringen (beschikbaar vanaf date)
 * @param {string} a.today
 * @param {string|null} a.targetDate doeldatum (voorraad nul bij aanvang van deze dag)
 * @param {number} a.endStock gewenste eindvoorraad
 */
function forecast({ stock, rate, incoming = [], today, targetDate = null, endStock = 0 }) {
  const res = { selloutDate: null, restAtTarget: null, deviationDays: null, unfulfilledAfterSellout: null, note: null };
  if (stock == null) { res.note = 'Voorraad onbekend'; return res; }
  if (rate == null) { res.note = 'Onvoldoende gegevens'; return res; }
  if (rate <= 0) {
    res.note = 'Geen uitverkoopdatum berekenbaar bij dit tempo';
    if (targetDate) res.restAtTarget = stock + incoming.filter((i) => i.date < targetDate).reduce((s, i) => s + i.qty, 0);
    return res;
  }
  let avail = stock;
  let unfulfilled = 0;
  const arrivals = {};
  for (const i of incoming) arrivals[i.date] = (arrivals[i.date] || 0) + i.qty;
  const lastArrival = incoming.reduce((m, i) => (i.date > m ? i.date : m), today);
  for (let k = 0, d = today; k < 3650; k++, d = D.addDays(d, 1)) {
    avail += arrivals[d] || 0;
    if (targetDate && d === targetDate) res.restAtTarget = Math.max(0, Math.round(avail * 10) / 10);
    const sold = Math.min(rate, avail);
    avail -= sold;
    if (sold < rate && res.selloutDate) unfulfilled += rate - sold;
    if (avail <= 1e-9 && !res.selloutDate) res.selloutDate = d;
    if (res.selloutDate && d >= lastArrival && avail <= 1e-9 && (!targetDate || d >= targetDate)) break;
  }
  if (targetDate && res.restAtTarget == null) res.restAtTarget = 0;
  if (targetDate && res.selloutDate) res.deviationDays = D.diffDays(D.addDays(targetDate, -1), res.selloutDate);
  res.unfulfilledAfterSellout = Math.round(unfulfilled);
  return res;
}

/** Benodigd tempo om de doeldatum te halen (§14). */
function requiredRate({ stock, incoming = [], today, targetDate, endStock = 0 }) {
  const remainingDays = D.diffDays(today, targetDate); // vandaag t/m dag vóór doeldatum
  if (remainingDays <= 0) return { remainingDays, expired: true, perDay: null, perWeek: null, toSell: stock };
  const inc = incoming.filter((i) => i.date < targetDate).reduce((s, i) => s + i.qty, 0);
  const toSellWithout = Math.max(0, stock - endStock);
  const toSellWith = Math.max(0, stock + inc - endStock);
  return {
    remainingDays, expired: false,
    toSell: toSellWithout, perDay: toSellWithout / remainingDays, perWeek: (toSellWithout / remainingDays) * 7,
    toSellWithIncoming: toSellWith, perDayWithIncoming: toSellWith / remainingDays,
  };
}

/**
 * Status "Seizoensvoorraad op koers" (§16).
 * Basis: tempo bij huidige prijs als er genoeg meetdagen zijn, anders 7 dagen; met de gekozen basis zichtbaar.
 */
function selloutStatus({ stock, bases, today, targetDate, incoming = [], endStock = 0, minMeasureDays = 7, toleranceDays = 7 }) {
  if (!targetDate) return { status: 'GEEN_DOEL', label: 'Geen doeldatum ingesteld' };
  const req = requiredRate({ stock, incoming, today, targetDate, endStock });
  if (req.expired) {
    return { status: 'DOELDATUM_VERSTREKEN', label: 'Doeldatum verstreken', rest: stock, required: req };
  }
  if (stock != null && stock <= endStock) return { status: 'OP_KOERS', label: 'Uitverkocht / op eindvoorraad', required: req };
  const cur = bases.find((b) => b.isPriceBasis && b.label.startsWith('Huidige'));
  const seven = bases.find((b) => b.label === 'Laatste 7 volledige dagen');
  let basis = null;
  if (cur && cur.days >= minMeasureDays) basis = cur;
  else if (seven && seven.days >= Math.min(7, minMeasureDays) && !seven.incomplete) basis = seven;
  if (!basis || stock == null) {
    return { status: 'ONVOLDOENDE_GEGEVENS', label: 'Onvoldoende gegevens', required: req, basisLabel: null };
  }
  const fc = forecast({ stock, rate: basis.perDay, incoming, today, targetDate, endStock });
  let status;
  if (!fc.selloutDate || (fc.restAtTarget ?? 0) > endStock) {
    status = fc.deviationDays != null && fc.deviationDays <= toleranceDays ? 'OP_KOERS' : 'TE_LANGZAAM';
  } else if (fc.deviationDays != null && fc.deviationDays < -toleranceDays) status = 'TE_SNEL';
  else status = 'OP_KOERS';
  const labels = {
    TE_SNEL: 'Verkoopt te snel — prijsruimte onderzoeken',
    OP_KOERS: 'Op koers',
    TE_LANGZAAM: 'Verkoopt te langzaam — actie nodig',
  };
  return { status, label: labels[status], basisLabel: basis.label, basisPerDay: basis.perDay, forecast: fc, required: req };
}

module.exports = { rateOver, velocityBases, forecast, requiredRate, selloutStatus };
