'use strict';
// Bijdrage per stuk (§8). Ontbrekende kosten zijn ONBEKEND, niet nul.

const COST_TYPES = {
  KOSTPRIJS: 'Kostprijs (inkoop)',
  TRANSPORT: 'Transport',
  INVOERRECHTEN: 'Invoerrechten',
  FULFILMENT: 'Fulfilment',
  VERZENDING: 'Verzending',
  VERPAKKING: 'Verpakking',
  OPSLAG: 'Opslag',
  RETOUR: 'Retourkosten (gemiddeld per verkocht stuk)',
  OVERIG: 'Overige variabele kosten',
};

/** Kostensoorten die standaard nodig zijn voor een "volledige" bijdrage. Instelbaar. */
const DEFAULT_REQUIRED = ['KOSTPRIJS', 'TRANSPORT', 'FULFILMENT', 'VERZENDING', 'VERPAKKING'];

/**
 * @param {object} a
 * @param {number} a.unitPriceIncl verkoopprijs incl. btw
 * @param {number} a.vatRate bv. 0.21
 * @param {number|null} a.commission bol-commissie per stuk (excl. btw, zie aanname)
 * @param {Record<string, {amount:number, basis:string}>} a.costs kosten per stuk excl. btw, per soort
 * @param {string[]} a.required verplichte kostensoorten
 * @param {number|null} a.adsPerUnit advertentiekosten per stuk (null = niet gekoppeld)
 */
function unitEconomics({ unitPriceIncl, vatRate = 0.21, commission = null, costs = {}, required = DEFAULT_REQUIRED, adsPerUnit = null }) {
  const net = unitPriceIncl / (1 + vatRate);
  const lines = [{ key: 'NETTO_OMZET', label: 'Netto-omzet excl. btw', amount: net }];
  const missing = [];
  let known = 0;
  if (commission == null) missing.push('COMMISSIE');
  else { lines.push({ key: 'COMMISSIE', label: 'bol-commissie', amount: -commission, basis: 'BOL' }); known += commission; }
  for (const k of Object.keys(COST_TYPES)) {
    const c = costs[k];
    if (c && Number.isFinite(c.amount)) {
      lines.push({ key: k, label: COST_TYPES[k], amount: -c.amount, basis: c.basis || 'GESCHAT' });
      known += c.amount;
    } else if (required.includes(k)) missing.push(k);
  }
  const before = net - known;
  const complete = missing.length === 0;
  const after = adsPerUnit == null ? null : before - adsPerUnit;
  const commissionRate = commission != null && unitPriceIncl > 0 ? commission / unitPriceIncl : null;
  const otherCosts = known - (commission || 0);
  // Indicatieve break-evenprijs incl. btw, aanname: commissie schaalt proportioneel met de prijs.
  let breakEven = null;
  if (complete && commissionRate != null) {
    const denom = 1 / (1 + vatRate) - commissionRate;
    if (denom > 0) breakEven = otherCosts / denom;
  }
  return {
    netRevenue: net,
    lines,
    contributionBeforeAds: before,
    contributionAfterAds: after,
    marginPct: net > 0 ? before / net : null,
    complete,
    missing: missing.map((k) => (k === 'COMMISSIE' ? 'bol-commissie' : COST_TYPES[k])),
    status: complete ? (lines.some((l) => l.basis === 'GESCHAT') ? 'GESCHAT' : 'VOLLEDIG') : 'ONVOLLEDIG',
    breakEvenPriceIncl: breakEven,
    adsNote: adsPerUnit == null ? 'Advertentiedata nog niet gekoppeld' : null,
  };
}

/** Kosten die gelden op een datum (meest recente geldig_vanaf ≤ datum ≤ geldig_tot). */
function costsOn(rows, date) {
  const out = {};
  for (const r of rows) {
    if (r.valid_from && r.valid_from > date) continue;
    if (r.valid_to && r.valid_to < date) continue;
    const cur = out[r.cost_type];
    if (!cur || (r.valid_from || '') > (cur.valid_from || '')) out[r.cost_type] = { amount: r.amount, basis: r.basis, valid_from: r.valid_from };
  }
  return out;
}

module.exports = { unitEconomics, costsOn, COST_TYPES, DEFAULT_REQUIRED };
