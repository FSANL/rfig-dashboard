'use strict';
// Synchronisatie met bol (alleen lezen). Elke gegevenssoort wordt apart vastgelegd in sync_runs,
// zodat per module zichtbaar is wanneer de laatste geslaagde synchronisatie was.
// Mislukt een onderdeel, dan blijven de laatste goede gegevens staan.

const D = require('./calc/dates');
const { getMeta, setMeta, tx } = require('./db');
const { createClient, V10, V11 } = require('./bol/client');
const { detectChanges, deliveryText } = require('./changes');

const DATASETS = {
  ACCOUNT: 'Account (juiste RFIG-account?)',
  OFFERS: 'Producten en aanbiedingen (prijs, status, FBR-voorraad)',
  ORDERS: 'Orders en orderregels',
  ORDER_DETAILS: 'Orderdetails (verkoopprijs, commissie)',
  INVENTORY_FBB: 'Voorraad bij bol (FBB/LVB)',
  RETURNS: 'Retouren (alleen toegangstest)',
  ADVERTISING: 'Advertising API (alleen inlogtest)',
};

function makeSync(db, config, { fetchImpl } = {}) {
  const retailer = config.hasRetailer ? createClient(config.credentials.retailer, { fetchImpl, label: 'Retailer API' }) : null;
  const ads = config.hasAdvertising ? createClient(config.credentials.advertising, { fetchImpl, label: 'Advertising API' }) : null;
  let running = null;

  function record(dataset, fn) {
    const started = new Date().toISOString();
    const id = db.prepare('INSERT INTO sync_runs(dataset, started_at, status) VALUES (?, ?, ?)').run(dataset, started, 'BEZIG').lastInsertRowid;
    return Promise.resolve().then(fn).then((r) => {
      const n = typeof r === 'number' ? r : (r && r.records) || 0;
      const msg = r && r.message ? r.message : null;
      db.prepare('UPDATE sync_runs SET finished_at = ?, status = ?, records = ?, message = ? WHERE id = ?')
        .run(new Date().toISOString(), r && r.status ? r.status : 'GESLAAGD', n, msg, id);
      return { dataset, ok: true, records: n, message: msg };
    }).catch((e) => {
      db.prepare('UPDATE sync_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
        .run(new Date().toISOString(), 'MISLUKT', String(e.message).slice(0, 500), id);
      return { dataset, ok: false, message: e.message };
    });
  }

  // ---------- Account ----------
  async function syncAccount() {
    const info = await retailer.tokenInfo();
    const rid = Object.entries(info.claims).find(([k]) => /retailer.?id/i.test(k));
    let name = null;
    if (rid) {
      const r = await retailer.get(`/retailer/retailers/${encodeURIComponent(rid[1])}`, {}, V10).catch(() => null);
      if (r) name = r.displayName || r.retailerName || r.name || null;
    }
    const client = info.claims.clientname || info.claims.client_name || null;
    setMeta(db, 'account_check', JSON.stringify({ at: new Date().toISOString(), retailerId: rid ? rid[1] : null, name, clientName: client, claimKeys: Object.keys(info.claims) }));
    if (name) return { records: 1, message: `Gekoppeld account: ${name}${rid ? ` (id ${rid[1]})` : ''}` };
    return { records: 1, message: `Inloggen gelukt met toegangsgegevens "${client || 'onbekend'}". Accountnaam staat niet in het token: controleer via producten en orders of dit RFIG is.` };
  }

  // ---------- Aanbod (Offers v11) ----------
  async function syncOffers() {
    const now = new Date().toISOString();
    let cursor = null, n = 0, pages = 0;
    const seen = [];
    do {
      const r = await retailer.get('/retailer/offers', { 'page-size': 50, cursor }, V11);
      if (r == null) throw new Error('Offers v11-endpoint niet gevonden (404) — pad of versie controleren');
      const list = r.offers || r.items || r.content || null;
      if (!Array.isArray(list)) throw new Error(`Onverwacht antwoordformaat van Offers v11 (velden: ${Object.keys(r).join(', ')})`);
      seen.push(...list);
      cursor = (r.page && r.page.nextCursor) || null;
      pages++;
    } while (cursor && pages < 100);

    const firstRun = db.prepare('SELECT COUNT(*) c FROM offers').get().c === 0;
    let changes = 0;
    tx(db, () => {
      const upOffer = db.prepare(`INSERT INTO offers(offer_id, ean, reference, fulfilment_method, on_hold, for_sale_nl, for_sale_be, unit_price, stock_amount, corrected_stock, last_modified, updated_at, bundle_prices, delivery)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(offer_id) DO UPDATE SET ean=excluded.ean, reference=excluded.reference, fulfilment_method=excluded.fulfilment_method,
        on_hold=excluded.on_hold, for_sale_nl=excluded.for_sale_nl, for_sale_be=excluded.for_sale_be, unit_price=excluded.unit_price,
        stock_amount=excluded.stock_amount, corrected_stock=excluded.corrected_stock, last_modified=excluded.last_modified, updated_at=excluded.updated_at,
        bundle_prices=excluded.bundle_prices, delivery=excluded.delivery`);
      const getPrev = db.prepare('SELECT * FROM offers WHERE offer_id = ?');
      const insChange = db.prepare(`INSERT INTO offer_changes(ean, offer_id, detected_at, previous_observed_at, bol_modified_at, field, label, type, old_value, new_value, old_text, new_text)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insProd = db.prepare("INSERT INTO products(ean, title, title_source) VALUES (?, ?, 'BOL') ON CONFLICT(ean) DO NOTHING");
      const insPrice = db.prepare("INSERT INTO price_observations(ean, offer_id, observed_at, unit_price, source) VALUES (?,?,?,?, 'SYNC')");
      const insStock = db.prepare("INSERT INTO stock_snapshots(ean, location, observed_at, amount, sellable, source) VALUES (?,?,?,?,?, 'SYNC')");
      for (const o of seen) {
        const ean = String(o.ean || '').trim();
        if (!ean) continue;
        const bp = (o.pricing && o.pricing.bundlePrices) || [];
        const single = bp.find((b) => Number(b.quantity) === 1) || bp[0];
        const price = single ? Number(single.unitPrice ?? single.price) : null;
        const ca = o.countryAvailabilities || [];
        const fs = (cc) => { const c = ca.find((x) => x.countryCode === cc); return c ? (c.forSale ? 1 : 0) : null; };
        const method = (o.fulfilment && o.fulfilment.method) || null;
        const stock = o.stock || {};
        const next = {
          offer_id: o.offerId, unit_price: price, on_hold: o.onHoldByRetailer ? 1 : 0, for_sale_nl: fs('NL'), for_sale_be: fs('BE'),
          fulfilment_method: method, reference: o.reference ?? null, stock_amount: stock.amount ?? null, corrected_stock: stock.correctedStock ?? null,
          bundle_prices: JSON.stringify(bp.map((b) => ({ quantity: Number(b.quantity), unitPrice: Number(b.unitPrice ?? b.price) }))),
          delivery: deliveryText(o.fulfilment),
        };
        const prev = getPrev.get(o.offerId);
        // Kolommen die in een oudere versie nog niet bestonden, niet als wijziging melden.
        if (prev) for (const k of ['bundle_prices', 'delivery']) if (prev[k] == null) prev[k] = next[k];
        for (const c of detectChanges(prev, next, { firstRun })) {
          insChange.run(ean, o.offerId, now, prev ? prev.updated_at : null, o.lastModifiedDateTime ?? null, c.field, c.label, c.type,
            c.old_value == null ? null : String(c.old_value), c.new_value == null ? null : String(c.new_value), c.old_text, c.new_text);
          changes++;
        }
        upOffer.run(o.offerId, ean, o.reference ?? null, method, o.onHoldByRetailer ? 1 : 0, fs('NL'), fs('BE'), price,
          stock.amount ?? null, stock.correctedStock ?? null, o.lastModifiedDateTime ?? null, now, next.bundle_prices, next.delivery);
        insProd.run(ean, o.unknownProductTitle || null);
        if (Number.isFinite(price)) insPrice.run(ean, o.offerId, now, price);
        if (method === 'FBR') insStock.run(ean, 'BOL_FBR', now, stock.amount ?? null, stock.correctedStock ?? stock.amount ?? null);
        n++;
      }
      // Aanbiedingen die niet meer in de lijst staan.
      const seenIds = new Set(seen.map((o) => o.offerId));
      for (const old of db.prepare("SELECT * FROM offers WHERE updated_at IS NOT NULL AND (removed IS NULL OR removed = 0)").all()) {
        if (seenIds.has(old.offer_id)) continue;
        insChange.run(old.ean, old.offer_id, now, old.updated_at, null, 'offer', 'Aanbieding niet meer gevonden bij bol', 'STATUS', old.offer_id, null, 'actief', 'niet gevonden');
        db.prepare('UPDATE offers SET removed = 1 WHERE offer_id = ?').run(old.offer_id);
        changes++;
      }
      db.prepare(`UPDATE offers SET removed = 0 WHERE offer_id IN (${seen.map(() => '?').join(',') || "''"})`).run(...seen.map((o) => o.offerId));
    });
    if (!getMeta(db, 'price_registration_start') && n > 0) setMeta(db, 'price_registration_start', now);
    return { records: n, message: `${n} aanbiedingen; prijs- en voorraadmeting vastgelegd${firstRun ? ' (beginstand, nog geen wijzigingen)' : `; ${changes} wijziging(en) waargenomen`}` };
  }

  // ---------- Voorraad FBB ----------
  async function syncInventoryFbb() {
    const hasFbb = db.prepare("SELECT COUNT(*) c FROM offers WHERE fulfilment_method = 'FBB'").get().c > 0;
    const now = new Date().toISOString();
    const r = await retailer.get('/retailer/inventory', { page: 1 }, V10);
    const list = (r && (r.inventory || r.items)) || [];
    if (!hasFbb && list.length === 0) return { records: 0, status: 'NVT', message: 'Geen FBB-aanbiedingen; toegang werkt' };
    const ins = db.prepare("INSERT INTO stock_snapshots(ean, location, observed_at, amount, sellable, source) VALUES (?, 'BOL_FBB', ?, ?, ?, 'SYNC')");
    tx(db, () => { for (const i of list) ins.run(String(i.ean), now, (i.regularStock ?? 0) + (i.gradedStock ?? 0), i.regularStock ?? null); });
    return { records: list.length, message: `${list.length} EAN's met FBB-voorraad (veldnamen te verifiëren)` };
  }

  // ---------- Orders ----------
  async function fetchOrderPages(q) {
    const out = [];
    for (let page = 1; page <= 200; page++) {
      const r = await retailer.get('/retailer/orders', { ...q, page, 'fulfilment-method': 'ALL' }, V10);
      const list = (r && r.orders) || [];
      out.push(...list);
      if (list.length === 0 || list.length < 50) break;
    }
    return out;
  }

  function upsertOrders(orders) {
    const upO = db.prepare('INSERT INTO orders(order_id, placed_at) VALUES (?, ?) ON CONFLICT(order_id) DO UPDATE SET placed_at = COALESCE(orders.placed_at, excluded.placed_at)');
    const upI = db.prepare(`INSERT INTO order_items(order_item_id, order_id, ean, quantity, quantity_shipped, quantity_cancelled, fulfilment_method, fulfilment_status, placed_at, latest_changed_at, detail_fetched)
      VALUES (?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(order_item_id) DO UPDATE SET quantity=excluded.quantity, quantity_shipped=excluded.quantity_shipped,
      quantity_cancelled=excluded.quantity_cancelled, fulfilment_status=excluded.fulfilment_status, latest_changed_at=excluded.latest_changed_at,
      detail_fetched = CASE WHEN order_items.latest_changed_at IS excluded.latest_changed_at THEN order_items.detail_fetched ELSE 0 END`);
    let n = 0;
    tx(db, () => {
      for (const o of orders) {
        upO.run(String(o.orderId), o.orderPlacedDateTime || null);
        for (const it of o.orderItems || []) {
          upI.run(String(it.orderItemId), String(o.orderId), it.ean ? String(it.ean) : null, it.quantity ?? 0, it.quantityShipped ?? 0,
            it.quantityCancelled ?? 0, it.fulfilmentMethod || null, it.fulfilmentStatus || null, o.orderPlacedDateTime || null, it.latestChangedDateTime || null);
          n++;
        }
      }
    });
    return n;
  }

  async function syncOrders() {
    const last = getMeta(db, 'orders_last_success');
    const nowMs = Date.now();
    let mode, items = 0;
    // Altijd: openstaande orders.
    items += upsertOrders(await fetchOrderPages({ status: 'OPEN' }));
    if (last && nowMs - Date.parse(last) < 55 * 60000) {
      mode = 'wijzigingen laatste 60 minuten';
      items += upsertOrders(await fetchOrderPages({ status: 'ALL', 'change-interval-minute': 60 }));
    } else {
      const today = D.today(nowMs);
      const earliest = D.addDays(today, -(config.historyDays - 1));
      let from = last ? D.amsDate(Date.parse(last)) : earliest;
      if (from < earliest) from = earliest;
      const days = D.daysBetween(from, today);
      mode = last ? `inhalen gemiste periode (${days.length} dagen)` : `historische import (${days.length} dagen, max. 3 maanden)`;
      for (const d of days) items += upsertOrders(await fetchOrderPages({ status: 'ALL', 'latest-change-date': d }));
      if (!last) setMeta(db, 'orders_history_start', earliest);
    }
    setMeta(db, 'orders_last_success', new Date(nowMs).toISOString());
    return { records: items, message: `${items} orderregels verwerkt (${mode})` };
  }

  async function syncOrderDetails() {
    const pending = db.prepare('SELECT DISTINCT order_id FROM order_items WHERE detail_fetched = 0 LIMIT 300').all();
    const upItem = db.prepare(`UPDATE order_items SET unit_price = ?, total_price = ?, commission = ?, offer_id = ?, detail_fetched = 1 WHERE order_item_id = ?`);
    const upOrder = db.prepare('UPDATE orders SET country_code = ?, fetched_detail_at = ? WHERE order_id = ?');
    const insProd = db.prepare("INSERT INTO products(ean, title, title_source) VALUES (?, ?, 'BOL') ON CONFLICT(ean) DO UPDATE SET title = excluded.title WHERE products.title IS NULL OR products.title_source = 'BOL'");
    let n = 0;
    for (const { order_id } of pending) {
      const o = await retailer.get(`/retailer/orders/${encodeURIComponent(order_id)}`, {}, V10);
      if (!o) continue;
      tx(db, () => {
        // Alleen het land wordt bewaard; geen namen, adressen of e-mailadressen (minimale persoonsgegevens).
        upOrder.run((o.shipmentDetails && o.shipmentDetails.countryCode) || null, new Date().toISOString(), order_id);
        for (const it of o.orderItems || []) {
          upItem.run(it.unitPrice ?? null, it.totalPrice ?? null, it.commission ?? null, (it.offer && it.offer.offerId) || null, String(it.orderItemId));
          if (it.product && it.product.ean) insProd.run(String(it.product.ean), it.product.title || null);
          n++;
        }
      });
    }
    const left = db.prepare('SELECT COUNT(DISTINCT order_id) c FROM order_items WHERE detail_fetched = 0').get().c;
    return { records: n, message: `${n} orderregels aangevuld${left ? `; nog ${left} orders te doen bij volgende synchronisatie` : ''}` };
  }

  async function testReturns() {
    const r = await retailer.get('/retailer/returns', { page: 1 }, V10);
    const list = (r && r.returns) || [];
    return { records: list.length, message: `Toegang werkt; ${list.length} retouren op eerste pagina (verwerking volgt in stap 3)` };
  }

  async function testAdvertising() {
    if (!ads) return { records: 0, status: 'NVT', message: 'Advertising-gegevens niet ingevuld in .env' };
    await ads.getToken();
    return { records: 0, message: 'Inloggen gelukt. Rapportages worden gebouwd in stap 3 (endpoints nog te verifiëren).' };
  }

  async function syncAll({ includeTests = false } = {}) {
    if (config.mode !== 'LIVE') return [{ dataset: 'DEMO', ok: true, message: 'Demomodus: geen verbinding met bol' }];
    if (running) return running;
    running = (async () => {
      const results = [];
      if (includeTests || !getMeta(db, 'account_check')) results.push(await record('ACCOUNT', syncAccount));
      results.push(await record('OFFERS', syncOffers));
      results.push(await record('INVENTORY_FBB', syncInventoryFbb));
      const ord = await record('ORDERS', syncOrders);
      results.push(ord);
      if (ord.ok) results.push(await record('ORDER_DETAILS', syncOrderDetails));
      if (includeTests) {
        results.push(await record('RETURNS', testReturns));
        results.push(await record('ADVERTISING', testAdvertising));
      }
      setMeta(db, 'last_sync_attempt', new Date().toISOString());
      return results;
    })().finally(() => { running = null; });
    return running;
  }

  return { syncAll, isRunning: () => !!running };
}

/** Status per gegevenssoort voor de koppeltest en de waarschuwingen. */
function datasetStatus(db) {
  const rows = [];
  for (const [key, label] of Object.entries(DATASETS)) {
    const last = db.prepare('SELECT * FROM sync_runs WHERE dataset = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(key);
    const ok = db.prepare("SELECT finished_at, records, message FROM sync_runs WHERE dataset = ? AND status IN ('GESLAAGD','NVT') ORDER BY id DESC LIMIT 1").get(key);
    rows.push({
      key, label,
      lastStatus: last ? last.status : 'NOG_NIET_GEDRAAID',
      lastMessage: last ? last.message : null,
      lastAttemptAt: last ? last.finished_at : null,
      lastSuccessAt: ok ? ok.finished_at : null,
      lastSuccessRecords: ok ? ok.records : null,
    });
  }
  return rows;
}

module.exports = { makeSync, datasetStatus, DATASETS };
