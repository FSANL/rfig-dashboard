'use strict';
// Synchronisatie tegen een nagebootste bol API (geen echte verbinding).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbm = require('../src/db');
const { makeSync, datasetStatus } = require('../src/sync');

function fakeBol() {
  const calls = [];
  let tokens = 0;
  const json = (status, body, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), accept: opts.headers && opts.headers.Accept, method: opts.method || 'GET' });
    if (u.host === 'login.bol.com') { tokens++; return json(200, { access_token: 'h.' + Buffer.from(JSON.stringify({ retailer_id: '123', exp: 1 })).toString('base64url') + '.s', expires_in: 299 }); }
    if (u.pathname === '/retailer/retailers/123') return json(200, { displayName: 'RFIG Products' });
    if (u.pathname === '/retailer/offers') return json(200, { offers: [{ offerId: 'o1', ean: '8712345678906', pricing: { bundlePrices: [{ quantity: 1, unitPrice: 59.99 }] }, fulfilment: { method: 'FBR' }, stock: { amount: 400, correctedStock: 398 }, countryAvailabilities: [{ countryCode: 'NL', forSale: true }] }], page: { nextCursor: null } });
    if (u.pathname === '/retailer/inventory') return json(200, { inventory: [] });
    if (u.pathname === '/retailer/orders') {
      if (u.searchParams.get('status') === 'OPEN' || u.searchParams.get('page') !== '1') return json(200, { orders: [] });
      const d = u.searchParams.get('latest-change-date');
      if (d && d !== '2026-10-20') return json(200, { orders: [] });
      return json(200, { orders: [{ orderId: 'A1', orderPlacedDateTime: '2026-10-20T14:00:00+02:00', orderItems: [{ orderItemId: 'i1', ean: '8712345678906', quantity: 2, quantityCancelled: 0, fulfilmentMethod: 'FBR', fulfilmentStatus: 'SHIPPED', latestChangedDateTime: '2026-10-20T15:00:00+02:00' }] }] });
    }
    if (u.pathname === '/retailer/orders/A1') return json(200, { orderId: 'A1', shipmentDetails: { countryCode: 'NL', firstName: 'Geheim', email: 'x@y' }, orderItems: [{ orderItemId: 'i1', unitPrice: 59.99, totalPrice: 119.98, commission: 15.2, offer: { offerId: 'o1' }, product: { ean: '8712345678906', title: 'Verwarmingsdeken' } }] });
    if (u.pathname === '/retailer/returns') return json(200, { returns: [] });
    return json(404, {});
  };
  return { fetchImpl, calls, tokenCount: () => tokens };
}

test('live-synchronisatie: alleen GET, token hergebruikt, gegevens vastgelegd, geen persoonsgegevens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfig-'));
  const db = dbm.open(path.join(dir, 'rfig.sqlite'));
  const config = { mode: 'LIVE', hasRetailer: true, hasAdvertising: false, historyDays: 10, credentials: { retailer: { id: 'id', secret: 'sec' }, advertising: {} } };
  const bol = fakeBol();
  const s = makeSync(db, config, { fetchImpl: bol.fetchImpl });
  const res = await s.syncAll({ includeTests: true });
  for (const r of res) assert.ok(r.ok, `${r.dataset}: ${r.message}`);

  assert.ok(bol.calls.filter((c) => c.path !== '/token').every((c) => c.method === 'GET'), 'alleen leesverzoeken');
  assert.equal(bol.tokenCount(), 1, 'token wordt hergebruikt');
  assert.ok(bol.calls.find((c) => c.path === '/retailer/offers').accept.includes('v11'));
  assert.ok(bol.calls.some((c) => c.q['latest-change-date']), 'historische import via latest-change-date');

  const it = db.prepare('SELECT * FROM order_items').get();
  assert.deepEqual([it.ean, it.quantity, it.unit_price, it.commission, it.detail_fetched], ['8712345678906', 2, 59.99, 15.2, 1]);
  const dump = JSON.stringify(db.prepare('SELECT * FROM orders').all());
  assert.ok(!dump.includes('Geheim') && !dump.includes('x@y'), 'geen namen of e-mail opgeslagen');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM price_observations').get().c, 1);
  assert.equal(db.prepare('SELECT title FROM products').get().title, 'Verwarmingsdeken');
  const st = datasetStatus(db);
  assert.match(st.find((x) => x.key === 'ACCOUNT').lastMessage, /RFIG Products/);

  // Tweede run binnen het uur: alleen wijzigingen van het laatste uur.
  bol.calls.length = 0;
  await s.syncAll();
  assert.ok(bol.calls.some((c) => c.q['change-interval-minute'] === '60'));
  assert.ok(!bol.calls.some((c) => c.q['latest-change-date']));
});
