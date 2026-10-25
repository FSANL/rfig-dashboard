'use strict';
// Automatische waarneming van wijzigingen per aanbieding (waarnemingstool: het dashboard wijzigt zelf niets
// en er hoeft niets handmatig gelogd te worden). Bij elke synchronisatie wordt de nieuwe stand vergeleken
// met de vorige meting. Het moment van een wijziging ligt tussen de vorige en de huidige meting.

const FIELDS = [
  { key: 'unit_price', label: 'Prijs', type: 'PRIJS', fmt: (v) => (v == null ? '–' : `€ ${Number(v).toFixed(2).replace('.', ',')}`) },
  { key: 'bundle_prices', label: 'Staffelprijzen (volumekorting)', type: 'PRIJS', fmt: fmtBundles },
  { key: 'on_hold', label: 'Gepauzeerd door verkoper', type: 'STATUS', fmt: yn },
  { key: 'for_sale_nl', label: 'Te koop in Nederland', type: 'STATUS', fmt: yn },
  { key: 'for_sale_be', label: 'Te koop in België', type: 'STATUS', fmt: yn },
  { key: 'fulfilment_method', label: 'Fulfilmentmethode', type: 'LOGISTIEK', fmt: (v) => v || '–' },
  { key: 'delivery', label: 'Levertijd / leverbelofte', type: 'LOGISTIEK', fmt: (v) => v || '–' },
  { key: 'reference', label: 'Eigen referentie', type: 'OVERIG', fmt: (v) => v || '–' },
  { key: 'stock_amount', label: 'Opgegeven voorraad', type: 'VOORRAAD', fmt: (v) => (v == null ? '–' : String(v)) },
];

function yn(v) { return v == null ? '–' : (Number(v) ? 'ja' : 'nee'); }
function fmtBundles(v) {
  if (!v) return '–';
  try { return JSON.parse(v).map((b) => `${b.quantity}+: € ${Number(b.unitPrice).toFixed(2).replace('.', ',')}`).join(' · '); } catch { return String(v); }
}
const same = (a, b) => (a == null && b == null) || String(a) === String(b);

/**
 * @param {object|null} prev vorige stand (rij uit offers) of null bij een nieuwe aanbieding
 * @param {object} next nieuwe stand (zelfde velden)
 * @param {object} ctx { firstRun: boolean }
 * @returns {Array<{field,label,type,old_value,new_value,old_text,new_text}>}
 */
function detectChanges(prev, next, { firstRun = false } = {}) {
  if (!prev) return firstRun ? [] : [{ field: 'offer', label: 'Nieuwe aanbieding', type: 'STATUS', old_value: null, new_value: next.offer_id, old_text: '–', new_text: 'aangemaakt' }];
  const out = [];
  for (const f of FIELDS) {
    if (!(f.key in next)) continue;
    // Staffelprijs met alleen 1 stuk is gelijk aan de gewone prijs: niet dubbel melden.
    if (f.key === 'bundle_prices' && onlySingle(prev.bundle_prices) && onlySingle(next.bundle_prices)) continue;
    if (!same(prev[f.key], next[f.key])) {
      out.push({ field: f.key, label: f.label, type: f.type, old_value: prev[f.key] ?? null, new_value: next[f.key] ?? null, old_text: f.fmt(prev[f.key]), new_text: f.fmt(next[f.key]) });
    }
  }
  // Verkoopbaarheid bij bol (correctedStock) naar 0 of terug.
  const was = prev.corrected_stock, is = next.corrected_stock;
  if (was != null && is != null && (was > 0) !== (is > 0)) {
    out.push({ field: 'sellable', label: is > 0 ? 'Weer verkoopbaar bij bol' : 'Uitverkocht bij bol (verkoopbare voorraad 0)', type: 'VOORRAAD', old_value: was, new_value: is, old_text: String(was), new_text: String(is) });
  }
  return out;
}

function onlySingle(v) {
  try { const a = JSON.parse(v || '[]'); return a.length <= 1; } catch { return true; }
}

function deliveryText(fulfilment) {
  if (!fulfilment) return null;
  const parts = [];
  if (fulfilment.schedule) parts.push(fulfilment.schedule);
  const dp = fulfilment.deliveryPromise;
  if (dp) parts.push(`${dp.minimumDaysToCustomer ?? '?'}-${dp.maximumDaysToCustomer ?? '?'} dagen${dp.ultimateOrderTime ? `, besteld vóór ${dp.ultimateOrderTime}` : ''}`);
  if (fulfilment.deliveryCode) parts.push(fulfilment.deliveryCode);
  return parts.length ? parts.join(' · ') : null;
}

module.exports = { detectChanges, deliveryText, FIELDS };
