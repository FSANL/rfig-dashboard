'use strict';
// Import van bedrijfsgegevens (Excel/CSV). De browser leest het bestand; hier wordt gevalideerd.
// Werkwijze: eerst een proefimport (voorbeeldweergave + fouten), daarna pas vastleggen.

const { tx, log } = require('./db');
const { COST_TYPES } = require('./calc/margin');

const KINDS = {
  PRODUCTEN: {
    label: 'Producten',
    fields: {
      ean: ['ean', 'ean-code', 'barcode'], sku: ['sku', 'artikelnummer', 'referentie'], title: ['titel', 'title', 'naam', 'productnaam'],
      variant: ['variant', 'maat', 'kleur'], product_group: ['productgroep', 'groep', 'categorie'],
      season_type: ['type', 'seizoen_of_doorlopend', 'assortimenttype'], owner: ['eigenaar', 'verantwoordelijke'], tags: ['tags', 'labels'],
    },
    required: ['ean'],
  },
  KOSTEN: {
    label: 'Kosten per stuk',
    fields: {
      ean: ['ean'], cost_type: ['kostensoort', 'soort', 'type'], amount: ['bedrag_per_stuk_ex_btw', 'bedrag', 'bedrag_ex_btw', 'kosten'],
      valid_from: ['geldig_vanaf', 'vanaf', 'ingangsdatum'], valid_to: ['geldig_tot', 'tot', 'einddatum'], basis: ['basis', 'geboekt_of_geschat'],
    },
    required: ['ean', 'cost_type', 'amount'],
  },
  VOORRAAD_EXTERN: {
    label: 'Voorraad extern (PackFeed e.d.)',
    fields: { ean: ['ean'], location: ['locatie', 'magazijn'], amount: ['aantal', 'voorraad'], as_of: ['peildatum', 'datum'] },
    required: ['ean', 'amount', 'as_of'],
  },
  INKOMEND: {
    label: 'Inkomende voorraad',
    fields: { ean: ['ean'], qty: ['aantal', 'hoeveelheid'], expected_date: ['verwachte_datum', 'leverdatum', 'datum'], confirmed: ['bevestigd'], note: ['opmerking', 'notitie'] },
    required: ['ean', 'qty', 'expected_date'],
  },
  DOELEN: {
    label: 'Doelen en prijsgrenzen',
    fields: {
      ean: ['ean', 'ean_of_groep'], target_date: ['doeldatum'], end_stock: ['eindvoorraad'], min_price: ['minimumprijs', 'min_prijs'],
      max_price: ['maximumprijs', 'max_prijs'], min_contribution: ['min_bijdrage_per_stuk', 'minimale_bijdrage'], price_step: ['prijsstap'],
      min_measure_days: ['min_meetdagen'], tolerance_days: ['marge_dagen', 'acceptabele_afwijking_dagen'],
    },
    required: ['ean'],
  },
};

const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/[\s\-./]+/g, '_').replace(/[()]/g, '');

function mapHeaders(kind, headers) {
  const spec = KINDS[kind];
  const map = {};
  for (const h of headers) {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(spec.fields)) {
      if (map[field]) continue;
      if (aliases.map(norm).includes(n) || norm(field) === n) map[field] = h;
    }
  }
  return map;
}

function asEan(v) {
  if (v == null || v === '') return null;
  let s = typeof v === 'number' ? BigInt(Math.round(v)).toString() : String(v).trim();
  if (/^GROEP:/i.test(s)) return 'GROEP:' + s.slice(6).trim();
  s = s.replace(/\s/g, '');
  if (/^\d{7,13}$/.test(s) && s.length < 13) s = s.padStart(13, '0');
  return s;
}
function asNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/€/g, '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function asDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { // Excel-serienummer
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'ONGELDIG';
}
const yes = (v) => /^(ja|j|yes|y|true|1|x)$/i.test(String(v ?? '').trim());

function validateRow(kind, raw, map) {
  const get = (f) => (map[f] ? raw[map[f]] : undefined);
  const e = [];
  const r = {};
  r.ean = asEan(get('ean'));
  if (!r.ean) e.push('EAN ontbreekt');
  else if (!/^(\d{8}|\d{12,14}|GROEP:.+)$/.test(r.ean)) e.push(`EAN "${r.ean}" is geen geldig nummer`);

  const num = (f, label, { req = false, min = null, int = false } = {}) => {
    const v = asNum(get(f));
    if (v == null) { if (req) e.push(`${label} ontbreekt`); r[f] = null; return; }
    if (Number.isNaN(v)) { e.push(`${label} is geen getal`); return; }
    if (min != null && v < min) e.push(`${label} mag niet kleiner zijn dan ${min}`);
    r[f] = int ? Math.round(v) : v;
  };
  const date = (f, label, req = false) => {
    const v = asDate(get(f));
    if (v == null) { if (req) e.push(`${label} ontbreekt`); r[f] = null; return; }
    if (v === 'ONGELDIG') e.push(`${label} is geen geldige datum (gebruik JJJJ-MM-DD of DD-MM-JJJJ)`);
    r[f] = v;
  };
  const txt = (f) => { const v = get(f); r[f] = v == null || v === '' ? null : String(v).trim(); };

  if (kind === 'PRODUCTEN') {
    ['sku', 'title', 'variant', 'product_group', 'owner', 'tags'].forEach(txt);
    const t = String(get('season_type') ?? '').toLowerCase();
    r.season_type = t.startsWith('door') ? 'DOORLOPEND' : (t ? 'SEIZOEN' : null);
  } else if (kind === 'KOSTEN') {
    const ct = String(get('cost_type') ?? '').toUpperCase().trim().replace(/\s+/g, '_');
    const match = Object.keys(COST_TYPES).find((k) => k === ct || norm(COST_TYPES[k]).startsWith(norm(ct)));
    if (!match) e.push(`Onbekende kostensoort "${get('cost_type')}" (kies uit: ${Object.keys(COST_TYPES).join(', ')})`);
    r.cost_type = match || ct;
    num('amount', 'Bedrag', { req: true, min: 0 });
    date('valid_from', 'Geldig vanaf'); date('valid_to', 'Geldig tot');
    r.basis = /geboekt/i.test(String(get('basis') ?? '')) ? 'GEBOEKT' : 'GESCHAT';
  } else if (kind === 'VOORRAAD_EXTERN') {
    r.location = String(get('location') ?? 'PACKFEED').trim().toUpperCase() || 'PACKFEED';
    num('amount', 'Aantal', { req: true, min: 0, int: true });
    date('as_of', 'Peildatum', true);
  } else if (kind === 'INKOMEND') {
    num('qty', 'Aantal', { req: true, min: 1, int: true });
    date('expected_date', 'Verwachte datum', true);
    r.confirmed = yes(get('confirmed')) ? 1 : 0;
    txt('note');
  } else if (kind === 'DOELEN') {
    date('target_date', 'Doeldatum');
    num('end_stock', 'Eindvoorraad', { min: 0, int: true });
    num('min_price', 'Minimumprijs', { min: 1 }); num('max_price', 'Maximumprijs', { min: 1 });
    num('min_contribution', 'Minimale bijdrage'); num('price_step', 'Prijsstap', { min: 0 });
    num('min_measure_days', 'Minimaal aantal meetdagen', { min: 1, int: true });
    num('tolerance_days', 'Acceptabele afwijking', { min: 0, int: true });
    if (r.min_price != null && r.max_price != null && r.min_price > r.max_price) e.push('Minimumprijs is hoger dan maximumprijs');
  }
  return { data: r, errors: e };
}

function keyOf(kind, r) {
  switch (kind) {
    case 'KOSTEN': return `${r.ean}|${r.cost_type}|${r.valid_from || ''}`;
    case 'VOORRAAD_EXTERN': return `${r.ean}|${r.location}|${r.as_of}`;
    case 'INKOMEND': return `${r.ean}|${r.expected_date}|${r.qty}`;
    default: return r.ean;
  }
}

function existing(db, kind, r) {
  switch (kind) {
    case 'PRODUCTEN': return db.prepare('SELECT * FROM products WHERE ean = ?').get(r.ean);
    case 'KOSTEN': return db.prepare('SELECT * FROM costs WHERE ean = ? AND cost_type = ? AND valid_from IS ?').get(r.ean, r.cost_type, r.valid_from);
    case 'VOORRAAD_EXTERN': return db.prepare('SELECT * FROM external_stock WHERE ean = ? AND location = ? AND as_of = ?').get(r.ean, r.location, r.as_of);
    case 'INKOMEND': return db.prepare('SELECT * FROM incoming_stock WHERE ean = ? AND expected_date = ? AND qty = ?').get(r.ean, r.expected_date, r.qty);
    case 'DOELEN': return db.prepare('SELECT * FROM targets WHERE ean = ?').get(r.ean);
    default: return null;
  }
}

/** Proefimport: geeft per regel status en fouten, wijzigt niets. */
function preview(db, kind, rows) {
  if (!KINDS[kind]) throw new Error(`Onbekend importtype: ${kind}`);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const map = mapHeaders(kind, headers);
  const missingRequired = KINDS[kind].required.filter((f) => !map[f]);
  const seen = new Set();
  const out = rows.map((raw, i) => {
    const { data, errors } = validateRow(kind, raw, map);
    let status = errors.length ? 'FOUT' : 'NIEUW';
    if (!errors.length) {
      const k = keyOf(kind, data);
      if (seen.has(k)) status = 'DUBBEL_IN_BESTAND';
      else if (existing(db, kind, data)) status = kind === 'PRODUCTEN' ? 'BIJWERKEN' : 'BESTAAT_AL';
      seen.add(k);
    }
    return { line: i + 2, status, errors, data };
  });
  return { kind, label: KINDS[kind].label, mapping: map, unmappedHeaders: headers.filter((h) => !Object.values(map).includes(h)), missingRequired, rows: out };
}

/** Vastleggen. Bestaande records worden alleen bijgewerkt als overwrite = true. Dubbele regels en fouten worden overgeslagen. */
function commit(db, kind, rows, { filename = null, overwrite = false } = {}) {
  const pv = preview(db, kind, rows);
  if (pv.missingRequired.length) throw new Error(`Verplichte kolommen ontbreken: ${pv.missingRequired.join(', ')}`);
  return tx(db, () => {
    const imp = db.prepare('INSERT INTO imports(filename, kind, rows_total) VALUES (?, ?, ?)').run(filename, kind, rows.length).lastInsertRowid;
    let ok = 0, skipped = 0, err = 0;
    for (const r of pv.rows) {
      if (r.status === 'FOUT') { err++; continue; }
      if (r.status === 'DUBBEL_IN_BESTAND' || (r.status === 'BESTAAT_AL' && !overwrite)) { skipped++; continue; }
      // Producten: altijd bijwerken; lege cellen laten bestaande waarden staan.
      write(db, kind, r.data, imp);
      ok++;
    }
    db.prepare('UPDATE imports SET rows_ok = ?, rows_skipped = ?, rows_error = ? WHERE id = ?').run(ok, skipped, err, imp);
    log(db, 'import', imp, kind, { filename, ok, skipped, err });
    return { importId: Number(imp), ok, skipped, errors: err };
  });
}

function write(db, kind, d, imp) {
  switch (kind) {
    case 'PRODUCTEN':
      db.prepare(`INSERT INTO products(ean, title, sku, variant, product_group, season_type, owner, tags, title_source)
        VALUES (?,?,?,?,?,COALESCE(?, 'SEIZOEN'),?,?, CASE WHEN ? IS NULL THEN NULL ELSE 'HANDMATIG' END)
        ON CONFLICT(ean) DO UPDATE SET title = COALESCE(excluded.title, products.title), sku = COALESCE(excluded.sku, products.sku),
        variant = COALESCE(excluded.variant, products.variant), product_group = COALESCE(excluded.product_group, products.product_group),
        season_type = COALESCE(?, products.season_type), owner = COALESCE(excluded.owner, products.owner), tags = COALESCE(excluded.tags, products.tags),
        title_source = CASE WHEN excluded.title IS NOT NULL THEN 'HANDMATIG' ELSE products.title_source END`)
        .run(d.ean, d.title, d.sku, d.variant, d.product_group, d.season_type, d.owner, d.tags, d.title, d.season_type);
      break;
    case 'KOSTEN':
      db.prepare(`INSERT INTO costs(ean, cost_type, amount, valid_from, valid_to, basis, source, import_id) VALUES (?,?,?,?,?,?, 'IMPORT', ?)
        ON CONFLICT(ean, cost_type, valid_from) DO UPDATE SET amount = excluded.amount, valid_to = excluded.valid_to, basis = excluded.basis, import_id = excluded.import_id`)
        .run(d.ean, d.cost_type, d.amount, d.valid_from, d.valid_to, d.basis, imp);
      break;
    case 'VOORRAAD_EXTERN':
      db.prepare(`INSERT INTO external_stock(ean, location, amount, as_of, import_id) VALUES (?,?,?,?,?)
        ON CONFLICT(ean, location, as_of) DO UPDATE SET amount = excluded.amount, import_id = excluded.import_id`).run(d.ean, d.location, d.amount, d.as_of, imp);
      break;
    case 'INKOMEND':
      db.prepare(`INSERT INTO incoming_stock(ean, qty, expected_date, confirmed, note, import_id) VALUES (?,?,?,?,?,?)
        ON CONFLICT(ean, expected_date, qty) DO UPDATE SET confirmed = excluded.confirmed, note = excluded.note`).run(d.ean, d.qty, d.expected_date, d.confirmed, d.note, imp);
      break;
    case 'DOELEN':
      upsertTarget(db, d);
      break;
  }
}

function upsertTarget(db, d) {
  db.prepare(`INSERT INTO targets(ean, target_date, end_stock, min_price, max_price, min_contribution, price_step, min_measure_days, tolerance_days, updated_at)
    VALUES (?,?,COALESCE(?,0),?,?,?,?,COALESCE(?,7),COALESCE(?,7), datetime('now'))
    ON CONFLICT(ean) DO UPDATE SET target_date = excluded.target_date, end_stock = excluded.end_stock, min_price = excluded.min_price,
    max_price = excluded.max_price, min_contribution = excluded.min_contribution, price_step = excluded.price_step,
    min_measure_days = excluded.min_measure_days, tolerance_days = excluded.tolerance_days, updated_at = excluded.updated_at`)
    .run(d.ean, d.target_date, d.end_stock, d.min_price, d.max_price, d.min_contribution, d.price_step, d.min_measure_days, d.tolerance_days);
  log(db, 'target', d.ean, 'UPSERT', d);
}

module.exports = { KINDS, preview, commit, upsertTarget, validateRow, mapHeaders };
