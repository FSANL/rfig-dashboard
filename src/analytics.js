'use strict';
// Haalt brongegevens uit de database en past de centrale rekenregels toe.
// Alle KPI's komen hier vandaan, zodat dezelfde maatstaf overal dezelfde uitkomst heeft.

const D = require('./calc/dates');
const PP = require('./calc/pricePeriods');
const V = require('./calc/velocity');
const M = require('./calc/margin');
const { getMeta } = require('./db');

/** Verkochte stuks = besteld − geannuleerd, op besteldatum (Amsterdam). */
function dailyUnits(db, ean) {
  const out = {};
  for (const r of db.prepare('SELECT placed_at, quantity, quantity_cancelled FROM order_items WHERE ean = ? AND placed_at IS NOT NULL').all(ean)) {
    const d = D.amsDate(r.placed_at);
    out[d] = (out[d] || 0) + Math.max(0, (r.quantity || 0) - (r.quantity_cancelled || 0));
  }
  return out;
}

function historyStart(db) {
  return getMeta(db, 'orders_history_start') || (() => {
    const r = db.prepare('SELECT MIN(placed_at) m FROM order_items').get();
    return r && r.m ? D.amsDate(r.m) : null;
  })();
}

/** Actuele voorraad per locatie (laatste meting per locatie). */
function stockNow(db, ean) {
  const locs = db.prepare(`SELECT s.location, s.amount, s.sellable, s.observed_at FROM stock_snapshots s
    JOIN (SELECT location, MAX(observed_at) m FROM stock_snapshots WHERE ean = ? GROUP BY location) x
      ON x.location = s.location AND x.m = s.observed_at WHERE s.ean = ?`).all(ean, ean);
  const ext = db.prepare(`SELECT e.location, e.amount, e.as_of FROM external_stock e
    JOIN (SELECT location, MAX(as_of) m FROM external_stock WHERE ean = ? GROUP BY location) x
      ON x.location = e.location AND x.m = e.as_of WHERE e.ean = ?`).all(ean, ean);
  const parts = [
    ...locs.map((l) => ({ location: l.location, amount: l.amount, sellable: l.sellable ?? l.amount, asOf: l.observed_at, source: 'bol' })),
    ...ext.map((e) => ({ location: e.location, amount: e.amount, sellable: e.amount, asOf: e.as_of, source: 'import' })),
  ];
  const known = parts.length > 0;
  return {
    parts,
    sellable: known ? parts.reduce((s, p) => s + (p.sellable || 0), 0) : null,
    bolSellable: locs.length ? locs.reduce((s, l) => s + (l.sellable ?? l.amount ?? 0), 0) : null,
  };
}

/** Dagen waarop bij bol (deels) geen verkoopbare voorraad was. Precisie: per synchronisatiemoment. */
function shortageDays(db, ean) {
  const rows = db.prepare("SELECT observed_at, SUM(COALESCE(sellable, amount, 0)) s FROM stock_snapshots WHERE ean = ? AND location LIKE 'BOL_%' GROUP BY observed_at").all(ean);
  const set = new Set();
  for (const r of rows) if (r.s <= 0) set.add(D.amsDate(r.observed_at));
  return set;
}

function priceObservations(db, ean) {
  return db.prepare('SELECT observed_at AS at, unit_price AS price, exact_change AS exact FROM price_observations WHERE ean = ? ORDER BY observed_at').all(ean)
    .map((r) => ({ at: r.at, price: r.price, exact: !!r.exact }));
}

function target(db, ean, group) {
  return db.prepare('SELECT * FROM targets WHERE ean = ?').get(ean)
    || (group ? db.prepare('SELECT * FROM targets WHERE ean = ?').get(`GROEP:${group}`) : null)
    || null;
}

function incoming(db, ean, onlyConfirmed = true) {
  return db.prepare(`SELECT qty, expected_date AS date, confirmed FROM incoming_stock WHERE ean = ? ${onlyConfirmed ? 'AND confirmed = 1' : ''} AND expected_date >= ? ORDER BY expected_date`)
    .all(ean, D.today());
}

function commissionPerUnit(db, ean) {
  const r = db.prepare(`SELECT SUM(commission) c, SUM(quantity - quantity_cancelled) q FROM order_items
    WHERE ean = ? AND commission IS NOT NULL AND placed_at >= ?`).get(ean, new Date(Date.now() - 60 * 86400000).toISOString());
  return r && r.q > 0 ? r.c / r.q : null;
}

function currentPrice(db, ean) {
  const r = db.prepare('SELECT unit_price, observed_at FROM price_observations WHERE ean = ? ORDER BY observed_at DESC LIMIT 1').get(ean);
  return r ? { price: r.unit_price, at: r.observed_at } : null;
}

/** Volledig productbeeld (detailpagina en seizoenstabel). */
function productView(db, config, ean, nowMs = Date.now()) {
  const p = db.prepare('SELECT * FROM products WHERE ean = ?').get(ean);
  if (!p) return null;
  const du = dailyUnits(db, ean);
  // "Totale historie sinds introductie": vanaf de eerste verkoop van dit product,
  // maar nooit vóór het begin van de beschikbare orderhistorie.
  const globalStart = historyStart(db);
  const firstSale = Object.keys(du).filter((d) => du[d] > 0).sort()[0] || null;
  const hs = firstSale && (!globalStart || firstSale > globalStart) ? firstSale : globalStart;
  const short = shortageDays(db, ean);
  const periods = PP.measurePeriods(PP.buildPricePeriods(priceObservations(db, ean), { nowMs, gapHours: config.priceGapHours }), du, short);
  const cur = periods.find((x) => x.isCurrent) || null;
  const prev = periods.filter((x) => !x.isCurrent);
  const vel = V.velocityBases({ dailyUnits: du, historyStart: hs, currentPeriod: cur, previousPeriods: prev.slice(-3), shortageDays: short, nowMs });
  const stock = stockNow(db, ean);
  const t = target(db, ean, p.product_group);
  const inc = incoming(db, ean, true);
  const today = D.today(nowMs);

  let season = null;
  if (t && t.target_date && p.season_type === 'SEIZOEN') {
    const status = V.selloutStatus({
      stock: stock.sellable, bases: vel.bases, today, targetDate: t.target_date, incoming: inc,
      endStock: t.end_stock || 0, minMeasureDays: t.min_measure_days || 7, toleranceDays: t.tolerance_days || 7,
    });
    const perMethod = vel.bases.filter((b) => b.days > 0).map((b) => ({
      label: b.label, perDay: b.perDay, days: b.days,
      without: V.forecast({ stock: stock.sellable, rate: b.perDay, today, targetDate: t.target_date }),
      with: inc.length ? V.forecast({ stock: stock.sellable, rate: b.perDay, incoming: inc, today, targetDate: t.target_date }) : null,
    }));
    season = { target: t, status, perMethod, required: V.requiredRate({ stock: stock.sellable ?? 0, incoming: inc, today, targetDate: t.target_date, endStock: t.end_stock || 0 }) };
  }

  const priceNow = currentPrice(db, ean);
  const costRows = db.prepare('SELECT * FROM costs WHERE ean = ?').all(ean);
  const economics = priceNow ? M.unitEconomics({
    unitPriceIncl: priceNow.price, vatRate: config.vatRate, commission: commissionPerUnit(db, ean),
    costs: M.costsOn(costRows, today),
  }) : null;

  const regStart = getMeta(db, 'price_registration_start');
  return {
    product: p,
    priceNow, economics,
    stock, incoming: inc, incomingAll: incoming(db, ean, false),
    velocity: vel, season,
    pricePeriods: periods,
    priceSummary: PP.summarizeByPrice(periods),
    dataNotes: {
      priceRegistrationStart: regStart,
      orderHistoryStart: hs,
      shortageDays: [...short].sort(),
    },
    series: dailySeries(du, short, hs, today),
    stockSeries: stockSeries(db, ean),
  };
}

/** Voorraad (verkoopbaar bij bol) aan het eind van elke dag met een meting. */
function stockSeries(db, ean) {
  const rows = db.prepare("SELECT observed_at, location, COALESCE(sellable, amount) s FROM stock_snapshots WHERE ean = ? AND location LIKE 'BOL_%' ORDER BY observed_at").all(ean);
  const byDay = new Map();
  const lastLoc = {};
  for (const r of rows) {
    lastLoc[r.location] = r.s ?? 0;
    byDay.set(D.amsDate(r.observed_at), Object.values(lastLoc).reduce((a, b) => a + b, 0));
  }
  return [...byDay.entries()].map(([day, stock]) => ({ day, stock }));
}

function dailySeries(du, short, hs, today) {
  const from = hs || Object.keys(du).sort()[0] || today;
  return D.daysBetween(from, today).map((d) => ({ day: d, units: du[d] || 0, shortage: short.has(d) }));
}

/** KPI's voor het managementoverzicht. Omzet op besteldatum. */
function kpis(db, config, nowMs = Date.now()) {
  const today = D.today(nowMs);
  const items = db.prepare('SELECT order_id, ean, placed_at, quantity, quantity_cancelled, unit_price, commission, detail_fetched FROM order_items WHERE placed_at IS NOT NULL').all();
  const ranges = {
    vandaag: { from: today, to: today, label: 'Vandaag tot nu (onvolledig)', partial: true },
    gisteren: { from: D.addDays(today, -1), to: D.addDays(today, -1), label: 'Gisteren' },
    d7: { from: D.addDays(today, -7), to: D.addDays(today, -1), label: 'Laatste 7 volledige dagen' },
    d30: { from: D.addDays(today, -30), to: D.addDays(today, -1), label: 'Laatste 30 volledige dagen' },
    maand: { from: today.slice(0, 8) + '01', to: today, label: 'Deze maand tot nu (onvolledig)', partial: true },
  };
  const out = {};
  for (const [k, r] of Object.entries(ranges)) {
    let gross = 0, units = 0, cancelled = 0, priceUnknown = 0, commission = 0;
    const orders = new Set();
    for (const it of items) {
      const d = D.amsDate(it.placed_at);
      if (d < r.from || d > r.to) continue;
      const q = Math.max(0, (it.quantity || 0) - (it.quantity_cancelled || 0));
      units += q; cancelled += it.quantity_cancelled || 0;
      if (q > 0) orders.add(it.order_id);
      if (it.unit_price == null) { if (q > 0) priceUnknown += q; } else gross += it.unit_price * q;
      if (it.commission != null) commission += it.commission;
    }
    out[k] = {
      ...r, units, orders: orders.size, cancelledUnits: cancelled,
      grossIncl: gross, netExcl: gross / (1 + config.vatRate), commission,
      aov: orders.size ? gross / orders.size : null,
      unitsWithoutPrice: priceUnknown,
      quality: r.partial ? 'VOORLOPIG' : (priceUnknown > 0 ? 'ONVOLLEDIG' : 'VOORLOPIG'),
    };
  }
  return out;
}

/** "Vandaag aandacht nodig": maximaal vijf punten, belangrijkste eerst. */
function attention(db, config, products, syncRows, nowMs = Date.now()) {
  const items = [];
  const push = (prio, a) => items.push({ prio, ...a });
  if (config.mode === 'LIVE') {
    const lastOk = syncRows.filter((r) => ['OFFERS', 'ORDERS'].includes(r.key)).map((r) => r.lastSuccessAt).filter(Boolean).sort()[0];
    if (!lastOk || nowMs - Date.parse(lastOk) > 24 * 3600000) {
      push(1, { title: 'Gegevens verouderd', reason: lastOk ? `Laatste geslaagde synchronisatie: ${new Date(lastOk).toLocaleString('nl-NL', { timeZone: D.TZ })}` : 'Nog geen geslaagde synchronisatie',
        impact: 'Tempo, prognoses en prijsperioden missen recente dagen', next: 'Open Gegevens en start een synchronisatie', kind: 'FEIT', link: '#/gegevens' });
    }
    const failed = syncRows.filter((r) => r.lastStatus === 'MISLUKT');
    if (failed.length) push(2, { title: 'Synchronisatie mislukt', reason: failed.map((f) => `${f.label}: ${f.lastMessage}`).join(' · '), impact: 'Laatste goede gegevens blijven zichtbaar', next: 'Controleer de koppeltest', kind: 'FEIT', link: '#/gegevens' });
  }
  for (const v of products) {
    const name = v.product.title || v.product.ean;
    const s = v.season && v.season.status;
    if (s && s.status === 'TE_LANGZAAM') push(3, { title: `${name}: verkoopt te langzaam`, reason: `Basis: ${s.basisLabel}, ${fmt(s.basisPerDay)} st/dag; nodig ${fmt(s.required.perDay)} st/dag`, impact: `Verwachte restvoorraad op doeldatum: ${s.forecast ? s.forecast.restAtTarget : '?'} st`, next: 'Onderzoek een lagere prijs of andere verkoopmaatregel; plan evaluatie', kind: 'SCHATTING', link: `#/product/${v.product.ean}` });
    if (s && s.status === 'TE_SNEL') push(4, { title: `${name}: verkoopt te snel`, reason: `Basis: ${s.basisLabel}; verwacht uitverkocht ${s.forecast.selloutDate}`, impact: 'Mogelijk ruimte voor een hogere prijs', next: 'Onderzoek een beheersbare prijsverhoging', kind: 'SCHATTING', link: `#/product/${v.product.ean}` });
    if (s && s.status === 'DOELDATUM_VERSTREKEN') push(2, { title: `${name}: doeldatum verstreken`, reason: `Resterende voorraad: ${s.rest}`, impact: 'Restvoorraad', next: 'Besluit over restvoorraad', kind: 'FEIT', link: `#/product/${v.product.ean}` });
    if (v.economics && !v.economics.complete) push(5, { title: `${name}: kosten onvolledig`, reason: `Ontbreekt: ${v.economics.missing.join(', ')}`, impact: 'Bijdrage en marge worden als onvolledig getoond', next: 'Vul het importtemplate aan (tabblad Kosten)', kind: 'FEIT', link: '#/gegevens' });
    if (v.product.season_type === 'DOORLOPEND' && v.stock.sellable != null) {
      const r30 = v.velocity.bases.find((b) => b.label === 'Laatste 30 volledige dagen');
      const cover = r30 && r30.perDay ? v.stock.sellable / r30.perDay : null;
      if (v.stock.sellable <= 0) push(2, { title: `${name}: niet op voorraad`, reason: 'Verkoopbare voorraad is 0', impact: 'Gemiste verkoop; nul verkopen betekent nu niet automatisch nul vraag', next: 'Controleer aanvulling en inkomende leveringen', kind: 'FEIT', link: `#/product/${v.product.ean}` });
      else if (cover != null && cover < 30) push(3, { title: `${name}: dreigend voorraadtekort`, reason: `Dekking ca. ${fmt(cover)} dagen bij 30-dagentempo`, impact: 'Risico op uitverkocht raken vóór aanvulling', next: 'Controleer levertijd en bestelpunt', kind: 'SCHATTING', link: `#/product/${v.product.ean}` });
    }
    if (v.stock.sellable == null) push(5, { title: `${name}: voorraad onbekend`, reason: 'Geen voorraadmeting', impact: 'Geen uitverkoopprognose', next: 'Synchroniseer of importeer voorraad', kind: 'FEIT', link: '#/gegevens' });
  }
  return items.sort((a, b) => a.prio - b.prio).slice(0, 5);
}

function fmt(x) { return x == null ? '?' : x.toLocaleString('nl-NL', { maximumFractionDigits: 1 }); }

module.exports = { productView, kpis, attention, dailyUnits, stockNow };
