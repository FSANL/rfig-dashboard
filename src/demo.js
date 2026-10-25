'use strict';
// Synthetische DEMODATA. Geen echte RFIG-cijfers. Alleen gebruikt zolang er geen bol-toegang is.
// Staat in een aparte database (rfig-demo.sqlite), zodat demo en live nooit door elkaar lopen.

const D = require('./calc/dates');
const { getMeta, setMeta, tx } = require('./db');

const DEMO_PRODUCTS = [
  { ean: '0000000000017', title: 'DEMO Verwarmingsdeken 160 × 200', variant: '160x200', group: 'Dekens', type: 'SEIZOEN', base: 3.2, price: [[-70, 64.99], [-40, 59.99], [-12, 62.99]], stock: 520 },
  { ean: '0000000000024', title: 'DEMO Verwarmingsdeken 200 × 220', variant: '200x220', group: 'Dekens', type: 'SEIZOEN', base: 1.1, price: [[-70, 74.99], [-25, 72.99]], stock: 380 },
  { ean: '0000000000031', title: 'DEMO Naaimachine', variant: null, group: 'Naaimachines', type: 'DOORLOPEND', base: 0.8, price: [[-70, 149.0]], stock: 90 },
  { ean: '0000000000048', title: 'DEMO Waterflosser', variant: null, group: 'Mondverzorging', type: 'DOORLOPEND', base: 2.0, price: [[-70, 39.95], [-5, 37.95]], stock: 60 },
];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function seedDemo(db, nowMs = Date.now()) {
  if (getMeta(db, 'demo_seeded')) return false;
  const rand = rng(42);
  const today = D.today(nowMs);
  const start = D.addDays(today, -70);
  tx(db, () => {
    const insP = db.prepare("INSERT INTO products(ean, title, variant, product_group, season_type, title_source, owner) VALUES (?,?,?,?,?, 'DEMO', 'Ivo')");
    const insPrice = db.prepare("INSERT INTO price_observations(ean, offer_id, observed_at, unit_price, exact_change, source) VALUES (?,?,?,?,?, 'DEMO')");
    const insStock = db.prepare("INSERT INTO stock_snapshots(ean, location, observed_at, amount, sellable, source) VALUES (?, 'BOL_FBR', ?, ?, ?, 'DEMO')");
    const insO = db.prepare('INSERT INTO orders(order_id, placed_at, country_code) VALUES (?,?,?)');
    const insI = db.prepare(`INSERT INTO order_items(order_item_id, order_id, ean, offer_id, quantity, quantity_shipped, quantity_cancelled, unit_price, total_price, commission, fulfilment_method, fulfilment_status, placed_at, latest_changed_at, detail_fetched)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'FBR', 'SHIPPED', ?, ?, 1)`);
    const insOffer = db.prepare("INSERT INTO offers(offer_id, ean, fulfilment_method, unit_price, stock_amount, corrected_stock, updated_at) VALUES (?,?, 'FBR', ?,?,?,?)");
    let oid = 1000, iid = 5000;
    for (const p of DEMO_PRODUCTS) {
      insP.run(p.ean, p.title, p.variant, p.group, p.type);
      const offer = `demo-${p.ean}`;
      let stock = p.stock;
      let lastPrice = null;
      for (const day of D.daysBetween(start, today)) {
        const off = D.diffDays(today, day);
        const price = p.price.filter(([o]) => o <= off).pop()[1];
        // prijsmetingen elke 3 uur tussen 08:00 en 23:00 ("pc staat 's nachts uit")
        for (let h = 8; h <= 23; h += 3) {
          const at = D.startOfDay(day) + h * 3600000;
          if (at > nowMs) break;
          const changedToday = lastPrice !== null && price !== lastPrice;
          if (changedToday && h === 8) insPrice.run(p.ean, offer, new Date(D.startOfDay(day) + 7.5 * 3600000).toISOString(), price, 1);
          insPrice.run(p.ean, offer, new Date(at).toISOString(), price, 0);
          insStock.run(p.ean, new Date(at).toISOString(), stock, stock);
          lastPrice = price;
        }
        // vraag: hoger bij lagere prijs, seizoen loopt op richting december
        const elasticity = Math.pow(p.price[0][1] / price, 3);
        const season = p.type === 'SEIZOEN' ? 0.7 + 0.6 * ((70 - off) / 70) : 1;
        const lambda = p.base * elasticity * season;
        let n = 0; let L = Math.exp(-lambda), k = 0, q = 1;
        do { k++; q *= rand(); } while (q > L); n = k - 1;
        if (stock <= 0) n = 0;
        for (let i = 0; i < n && stock > 0; i++) {
          const at = D.startOfDay(day) + Math.floor((8 + rand() * 15) * 3600000);
          if (at > nowMs) continue;
          const cancelled = rand() < 0.03 ? 1 : 0;
          oid++; iid++;
          insO.run(`DEMO-${oid}`, new Date(at).toISOString(), rand() < 0.2 ? 'BE' : 'NL');
          insI.run(`DEMO-${iid}`, `DEMO-${oid}`, p.ean, offer, 1, 1 - cancelled, cancelled, price, price, Math.round(price * 0.13 * 100) / 100 + 1,
            new Date(at).toISOString(), new Date(at).toISOString());
          stock -= 1 - cancelled;
        }
      }
      insOffer.run(offer, p.ean, p.price[p.price.length - 1][1], stock, stock, new Date(nowMs).toISOString());
    }
    // Kosten: bewust onvolledig voor één product, om de "onvolledig"-weergave te tonen.
    const insC = db.prepare("INSERT INTO costs(ean, cost_type, amount, valid_from, basis, source) VALUES (?,?,?,?,?, 'DEMO')");
    for (const [ean, k, a, b] of [
      ['0000000000017', 'KOSTPRIJS', 17.5, 'GEBOEKT'], ['0000000000017', 'TRANSPORT', 2.1, 'GESCHAT'], ['0000000000017', 'FULFILMENT', 1.8, 'GESCHAT'],
      ['0000000000017', 'VERZENDING', 4.1, 'GESCHAT'], ['0000000000017', 'VERPAKKING', 0.6, 'GESCHAT'], ['0000000000017', 'INVOERRECHTEN', 0.9, 'GESCHAT'],
      ['0000000000024', 'KOSTPRIJS', 22.0, 'GEBOEKT'],
      ['0000000000031', 'KOSTPRIJS', 61.0, 'GEBOEKT'], ['0000000000031', 'TRANSPORT', 6.0, 'GESCHAT'], ['0000000000031', 'FULFILMENT', 2.5, 'GESCHAT'],
      ['0000000000031', 'VERZENDING', 6.95, 'GESCHAT'], ['0000000000031', 'VERPAKKING', 1.2, 'GESCHAT'],
    ]) insC.run(ean, k, a, '2026-01-01', b);
    const insT = db.prepare('INSERT INTO targets(ean, target_date, end_stock, min_price, max_price, price_step, min_measure_days, tolerance_days) VALUES (?,?,?,?,?,?,?,?)');
    insT.run('GROEP:Dekens', '2027-03-01', 0, 49.99, 79.99, 2, 7, 7);
    db.prepare("INSERT INTO incoming_stock(ean, qty, expected_date, confirmed, note) VALUES ('0000000000024', 120, ?, 1, 'DEMO-levering')").run(D.addDays(today, 20));
    db.prepare("INSERT INTO workspace_items(kind, title, body, ean, owner, status, eval_date) VALUES ('HYPOTHESE','DEMO: prijs 62,99 verkoopt nog op koers','Na verhoging van 59,99 naar 62,99 blijft het tempo boven benodigd tempo.','0000000000017','Ivo','OPEN',?)").run(D.addDays(today, 7));
    db.prepare("INSERT INTO workspace_items(kind, title, body, priority, category, status, acceptance) VALUES ('WENS','Koppeling PackFeed-voorraad','Voorraad bij PackFeed automatisch ophalen in plaats van via import.','MIDDEN','Koppelingen','OPEN','Voorraad PackFeed staat dagelijks bijgewerkt in het dashboard.')").run();
    setMeta(db, 'orders_history_start', start);
    setMeta(db, 'price_registration_start', new Date(D.startOfDay(start) + 8 * 3600000).toISOString());
  });
  setMeta(db, 'demo_seeded', new Date(nowMs).toISOString());
  return true;
}

module.exports = { seedDemo };
