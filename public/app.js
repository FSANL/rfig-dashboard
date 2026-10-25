'use strict';
/* RFIG Dashboard — frontend (zonder framework). Alle berekeningen gebeuren op de server. */

const $app = document.getElementById('app');
const nf = (d = 0) => new Intl.NumberFormat('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x) => (x == null || Number.isNaN(x) ? '<span class="muted">onbekend</span>' : eur.format(x));
const N = (x, d = 0) => (x == null || Number.isNaN(x) ? '<span class="muted">–</span>' : nf(d).format(x));
const P = (x) => (x == null ? '<span class="muted">–</span>' : nf(1).format(x * 100) + '%');
const dt = (iso) => (iso ? new Date(iso).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' }) : '–');
const dd = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } } };

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 4500); }

const STATUS = {
  TE_SNEL: ['t-info', 'Verkoopt te snel — prijsruimte onderzoeken'],
  OP_KOERS: ['t-good', 'Op koers'],
  TE_LANGZAAM: ['t-bad', 'Verkoopt te langzaam — actie nodig'],
  ONVOLDOENDE_GEGEVENS: ['t-muted', 'Onvoldoende gegevens'],
  DOELDATUM_VERSTREKEN: ['t-warn', 'Doeldatum verstreken'],
  GEEN_DOEL: ['t-muted', 'Geen doeldatum'],
};
const tagStatus = (s) => { const [c, l] = STATUS[s] || ['t-muted', s || '–']; return `<span class="tag ${c}">${esc(l)}</span>`; };
const ECON = { VOLLEDIG: ['t-good', 'volledig'], GESCHAT: ['t-warn', 'deels geschat'], ONVOLLEDIG: ['t-bad', 'onvolledig'], GEEN_PRIJS: ['t-muted', 'geen prijs'] };
const tagEcon = (s) => { const [c, l] = ECON[s] || ['t-muted', s]; return `<span class="tag ${c}">${l}</span>`; };

// ---------- Kop en modusbalk ----------
let STATUS_CACHE = null;
async function refreshHeader() {
  try {
    const s = await api('/api/status');
    STATUS_CACHE = s;
    const b = document.getElementById('modebanner');
    const lastOk = s.datasets.filter((d) => ['OFFERS', 'ORDERS'].includes(d.key)).map((d) => d.lastSuccessAt).filter(Boolean).sort()[0];
    if (s.config.mode === 'DEMO') b.innerHTML = '<div class="banner demo">DEMODATA — synthetische cijfers, geen echte RFIG-gegevens. Zet de bol-toegang in .env om live te gaan.</div>';
    else if (!lastOk || Date.now() - Date.parse(lastOk) > 24 * 3600e3) b.innerHTML = `<div class="banner stale">Let op: gegevens verouderd — laatste geslaagde synchronisatie ${lastOk ? dt(lastOk) : 'nog niet'}.</div>`;
    else b.innerHTML = '';
    document.getElementById('syncbadge').innerHTML = s.config.mode === 'DEMO' ? '<span class="tag t-demo">demo</span>' :
      `${s.syncRunning ? '<span class="tag t-info">synchroniseert…</span> ' : ''}Laatst bijgewerkt: ${dt(lastOk)}`;
  } catch (e) { document.getElementById('syncbadge').textContent = 'Server niet bereikbaar'; }
}

// ---------- Router ----------
const pages = { wijzigingen: pageChanges, overzicht: pageOverview, producten: pageProducts, product: pageProduct, seizoen: pageSeason, werkruimte: pageWorkspace, gegevens: pageData };
async function route() {
  const [, name = 'overzicht', arg] = (location.hash || '#/overzicht').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${name === 'product' ? 'producten' : name}`));
  $app.innerHTML = '<p class="muted">Laden…</p>';
  try { await (pages[name] || pageOverview)(decodeURIComponent(arg || '')); }
  catch (e) { $app.innerHTML = `<div class="note bad">Fout: ${esc(e.message)}</div>`; }
  $app.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', () => { refreshHeader(); route(); setInterval(refreshHeader, 60000); });

// ---------- Overzicht ----------
async function pageOverview() {
  const o = await api('/api/overview');
  const k = o.kpis;
  const card = (x) => `<div class="panel kpi"><div class="label">${esc(x.label)} ${x.partial ? '<span class="tag t-warn">onvolledig</span>' : `<span class="tag t-muted">${x.quality.toLowerCase()}</span>`}</div>
    <div class="big">${E(x.grossIncl)}</div><div class="small muted">bestelwaarde incl. btw</div>
    <dl><dt>Netto-omzet excl. btw</dt><dd>${E(x.netExcl)}</dd><dt>Bestellingen</dt><dd>${N(x.orders)}</dd><dt>Verkochte stuks</dt><dd>${N(x.units)}</dd>
    <dt>Geannuleerd (st)</dt><dd>${N(x.cancelledUnits)}</dd><dt>Gem. orderwaarde</dt><dd>${E(x.aov)}</dd>
    ${x.unitsWithoutPrice ? `<dt>Stuks zonder prijs</dt><dd>${N(x.unitsWithoutPrice)}</dd>` : ''}</dl></div>`;
  $app.innerHTML = `
    <h1>Managementoverzicht</h1>
    <p class="muted small">Omzet op besteldatum. Bijdrage na advertenties en bedrijfsresultaat volgen zodra advertentie- en vaste kosten zijn gekoppeld.</p>
    <div class="grid cards">${['gisteren', 'd7', 'd30', 'maand', 'vandaag'].map((x) => card(k[x])).join('')}</div>
    <div class="grid two" style="margin-top:14px">
      <section class="panel"><h2>Vandaag aandacht nodig</h2>
        ${o.attention.length ? `<ol class="attention">${o.attention.map((a) => `<li><strong><a href="${a.link}">${esc(a.title)}</a></strong> <span class="tag ${a.kind === 'FEIT' ? 't-muted' : 't-warn'}">${a.kind.toLowerCase()}</span><br>
          <span class="small">${esc(a.reason)}</span><br><span class="small muted">Impact: ${esc(a.impact)} · Vervolgstap: ${esc(a.next)}</span></li>`).join('')}</ol>` : '<p class="muted">Geen aandachtspunten.</p>'}
      </section>
      <section class="panel"><h2>Producten in één oogopslag</h2><div class="tablewrap"><table>
        <thead><tr><th>Product</th><th class="num">Prijs</th><th class="num">Voorraad</th><th class="num">St/dag (7d)</th><th>Bijdrage</th><th>Uitverkoopdoel</th></tr></thead>
        <tbody>${o.products.map((p) => `<tr class="click" onclick="location.hash='#/product/${p.ean}'"><td>${esc(p.title || p.ean)}<div class="small muted">${esc(p.variant || '')}</div></td>
          <td class="num">${E(p.price)}</td><td class="num">${N(p.stock)}</td><td class="num">${N(p.perDay7, 1)}</td>
          <td>${p.contribution != null ? E(p.contribution) + ' ' : ''}${tagEcon(p.economicsStatus)}</td><td>${p.target ? tagStatus(p.status && p.status.status) : '<span class="muted small">doorlopend</span>'}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`;
}

// ---------- Producten ----------
const PCOLS = [
  ['title', 'Product', (p) => `${esc(p.title || '(geen titel)')}<div class="small muted">${esc([p.variant, p.group].filter(Boolean).join(' · '))}</div>`],
  ['ean', 'EAN', (p) => `<span class="small">${esc(p.ean)}</span>`],
  ['sku', 'SKU', (p) => esc(p.sku || '–')],
  ['seasonType', 'Type', (p) => (p.seasonType === 'SEIZOEN' ? 'Seizoen' : 'Doorlopend')],
  ['price', 'Prijs', (p) => E(p.price), 'num'],
  ['units30', 'Stuks 30d', (p) => N(p.units30), 'num'],
  ['perDay7', 'St/dag 7d', (p) => N(p.perDay7, 1), 'num'],
  ['perDay30', 'St/dag 30d', (p) => N(p.perDay30, 1), 'num'],
  ['perDayPrice', 'St/dag huidige prijs', (p) => `${N(p.perDayPrice, 1)}<div class="small muted">${p.priceDays} meetdagen</div>`, 'num'],
  ['stock', 'Voorraad', (p) => N(p.stock), 'num'],
  ['incoming', 'Inkomend', (p) => N(p.incoming), 'num'],
  ['coverDays', 'Dekking (dagen)', (p) => N(p.coverDays), 'num'],
  ['contribution', 'Bijdrage/st', (p) => `${E(p.contribution)}<div>${tagEcon(p.economicsStatus)}</div>`, 'num'],
  ['marginPct', 'Marge', (p) => P(p.marginPct), 'num'],
  ['target', 'Doeldatum', (p) => dd(p.target)],
  ['status', 'Status', (p) => (p.target ? tagStatus(p.status && p.status.status) : '–')],
  ['firstSale', 'Eerste verkoop', (p) => dd(p.firstSale)],
  ['lastSale', 'Laatste verkoop', (p) => dd(p.lastSale)],
  ['owner', 'Eigenaar', (p) => esc(p.owner || '–')],
  ['tags', 'Tags', (p) => esc(p.tags || '')],
];
async function pageProducts() {
  const rows = await api('/api/products');
  let visible = store.get('pcols', ['title', 'price', 'units30', 'perDay7', 'perDayPrice', 'stock', 'coverDays', 'contribution', 'target', 'status']);
  let sort = store.get('psort', { key: 'title', dir: 1 });
  let q = '';
  const draw = () => {
    const cols = PCOLS.filter((c) => visible.includes(c[0]));
    const val = (p, k) => (k === 'status' ? (p.status && p.status.status) || '' : p[k]);
    const list = rows.filter((p) => !q || JSON.stringify([p.title, p.ean, p.sku, p.group, p.tags]).toLowerCase().includes(q))
      .sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    $app.querySelector('#ptable').innerHTML = `<thead><tr>${cols.map((c) => `<th class="sortable ${c[3] || ''}" data-k="${c[0]}">${c[1]}${sort.key === c[0] ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.map((p) => `<tr class="click" data-ean="${esc(p.ean)}">${cols.map((c) => `<td class="${c[3] || ''}">${c[2](p)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $app.querySelectorAll('th.sortable').forEach((th) => th.onclick = () => { sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : 1 }; store.set('psort', sort); draw(); });
    $app.querySelectorAll('tr[data-ean]').forEach((tr) => tr.onclick = () => (location.hash = `#/product/${tr.dataset.ean}`));
  };
  $app.innerHTML = `<h1>Producten</h1>
    <div class="row"><input id="pq" placeholder="Zoek op titel, EAN, SKU, groep of tag" style="min-width:280px"><span class="spacer"></span>
      <button id="pcolbtn">Kolommen</button><button id="pcsv">Export CSV</button></div>
    <div id="pcols" class="colpicker" hidden>${PCOLS.map((c) => `<label><input type="checkbox" value="${c[0]}" ${visible.includes(c[0]) ? 'checked' : ''}> ${c[1]}</label>`).join('')}</div>
    <div class="panel tablewrap" style="margin-top:10px"><table id="ptable"></table></div>
    <p class="small muted">Weergave (kolommen, sortering) wordt per browser onthouden.</p>`;
  $app.querySelector('#pq').oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  $app.querySelector('#pcolbtn').onclick = () => { const el = $app.querySelector('#pcols'); el.hidden = !el.hidden; };
  $app.querySelectorAll('#pcols input').forEach((cb) => cb.onchange = () => { visible = [...$app.querySelectorAll('#pcols input:checked')].map((x) => x.value); store.set('pcols', visible); draw(); });
  $app.querySelector('#pcsv').onclick = () => downloadCsv('rfig-producten.csv', rows.map((p) => ({ ean: p.ean, titel: p.title, sku: p.sku, variant: p.variant, groep: p.group, prijs: p.price, voorraad: p.stock, stuks_30d: p.units30, per_dag_7d: p.perDay7, per_dag_30d: p.perDay30, bijdrage_per_stuk: p.contribution, bijdrage_status: p.economicsStatus, doeldatum: p.target, status: p.status && p.status.status })));
  draw();
}

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (v) => (v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
  const csv = '﻿' + [keys.join(';'), ...rows.map((r) => keys.map((k) => cell(r[k])).join(';'))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
}

// ---------- Productdetail ----------
async function pageProduct(ean) {
  const v = await api(`/api/product?ean=${encodeURIComponent(ean)}`);
  const p = v.product;
  const s = v.season;
  const t = s ? s.target : null;
  const reg = v.dataNotes.priceRegistrationStart;
  $app.innerHTML = `
    <p><a href="#/producten">← Producten</a></p>
    <div class="row"><h1>${esc(p.title || p.ean)}</h1>${p.title_source === 'DEMO' ? '<span class="tag t-demo">demo</span>' : ''}</div>
    <p class="muted small">EAN ${esc(p.ean)}${p.sku ? ` · SKU ${esc(p.sku)}` : ''}${p.variant ? ` · ${esc(p.variant)}` : ''}${p.product_group ? ` · ${esc(p.product_group)}` : ''} · ${p.season_type === 'SEIZOEN' ? 'Seizoensvoorraad' : 'Doorlopend assortiment'}</p>
    <div class="grid cards">
      <div class="panel kpi"><div class="label">Huidige prijs</div><div class="big">${E(v.priceNow && v.priceNow.price)}</div><div class="small muted">gemeten ${dt(v.priceNow && v.priceNow.at)}</div></div>
      <div class="panel kpi"><div class="label">Verkoopbare voorraad</div><div class="big">${N(v.stock.sellable)}</div>
        <dl>${v.stock.parts.map((x) => `<dt>${esc(x.location)}</dt><dd>${N(x.sellable)} <span class="muted small">(${x.source === 'import' ? 'import ' + dd(x.asOf) : dt(x.asOf)})</span></dd>`).join('')}</dl></div>
      <div class="panel kpi"><div class="label">Vandaag tot nu (onvolledig)</div><div class="big">${N(v.velocity.todayUnits)} st</div><div class="small muted">telt niet mee in tempo's</div></div>
      ${t ? `<div class="panel kpi"><div class="label">Uitverkoopdoel</div><div class="big">${dd(t.target_date)}</div><div class="small muted">voorraad ${N(t.end_stock)} bij aanvang van deze dag (verkopen t/m dag ervoor)</div><div style="margin-top:6px">${tagStatus(s.status.status)}</div></div>` : ''}
    </div>

    ${s ? seasonBlock(v) : ''}

    <section class="panel" style="margin-top:14px"><h2>Verkoopsnelheid per berekeningsbasis</h2>
      <p class="small muted">Alleen volledige dagen. Afzet per beschikbare dag sluit dagen met voorraadtekort uit (precisie: per synchronisatiemoment).
      Verkoophistorie beschikbaar vanaf ${dd(v.dataNotes.orderHistoryStart)}.</p>
      <div class="tablewrap"><table><thead><tr><th>Basis</th><th>Meetperiode</th><th class="num">Dagen</th><th class="num">Stuks</th><th class="num">St/dag</th><th class="num">Per beschikbare dag</th><th class="num">Tekortdagen</th>${s ? '<th>Verwacht uitverkocht</th><th class="num">Afwijking (dagen)</th><th class="num">Rest op doeldatum</th>' : ''}</tr></thead>
      <tbody>${v.velocity.bases.map((b) => { const f = s && s.perMethod.find((m) => m.label === b.label); return `<tr><td>${esc(b.label)}${b.incomplete ? ' <span class="tag t-warn">korter dan gevraagd</span>' : ''}</td>
        <td class="small">${b.from ? `${dd(b.from)} – ${dd(b.to)}` : '–'}</td><td class="num">${N(b.days)}</td><td class="num">${N(b.units)}</td><td class="num">${N(b.perDay, 2)}</td>
        <td class="num">${N(b.perAvailableDay, 2)}</td><td class="num">${N(b.shortageDays)}</td>
        ${s ? `<td>${f ? (f.without.selloutDate ? dd(f.without.selloutDate) : esc(f.without.note || '–')) : '–'}</td><td class="num">${f ? N(f.without.deviationDays) : '–'}</td><td class="num">${f ? N(f.without.restAtTarget) : '–'}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Prijsperioden</h2>
      <div class="note">Wijzigingsdagen, de startdag van de registratie en meetgaten (te lang geen meting, bv. pc uit) tellen niet mee. Verkopen op die dagen tellen wel mee in totale omzet en verkoop.
      Prijshistorie geregistreerd vanaf ${dt(reg)}; daarvóór onbekend.</div>
      <div class="tablewrap"><table><thead><tr><th>Prijs</th><th>Wijzigingsmoment</th><th>Geldige meetdagen</th><th class="num">Aantal</th><th>Uitgesloten dagen</th><th class="num">Stuks</th><th class="num">St/dag</th><th class="num">Per beschikbare dag</th><th>Voorraadtekort</th></tr></thead>
      <tbody>${v.pricePeriods.map((pp) => `<tr><td><strong>${E(pp.price)}</strong>${pp.isCurrent ? ' <span class="tag t-info">huidig</span>' : ''}</td>
        <td class="small">${pp.startEvent.type === 'START_REGISTRATIE' ? 'start registratie' : pp.startEvent.certainty === 'EXACT' ? `exact: ${dt(pp.startEvent.from)}` : `tussen ${dt(pp.startEvent.from)} en ${dt(pp.startEvent.to)} <span class="tag t-warn">onzeker</span>`}</td>
        <td class="small">${pp.validDayCount ? `${dd(pp.firstValidDay)} – ${dd(pp.lastValidDay)}` : `<span class="tag t-muted">${esc(pp.message)}</span>`}</td><td class="num">${N(pp.validDayCount)}</td>
        <td class="small">${summDays(pp.excludedDays)}</td><td class="num">${N(pp.units)}</td><td class="num">${N(pp.perDay, 2)}</td><td class="num">${N(pp.perAvailableDay, 2)}</td><td class="small">${pp.shortageDays.length ? pp.shortageDays.length + ' dag(en)' : '–'}</td></tr>`).join('')}</tbody></table></div>
      ${v.priceSummary.length > 1 ? `<h3>Per prijsniveau (gewogen: totale stuks ÷ totale meetdagen)</h3><table><thead><tr><th>Prijs</th><th class="num">Perioden</th><th class="num">Meetdagen</th><th class="num">Stuks</th><th class="num">St/dag</th></tr></thead><tbody>
        ${v.priceSummary.map((x) => `<tr><td>${E(x.price)}</td><td class="num">${x.periods}</td><td class="num">${x.days}</td><td class="num">${x.units}</td><td class="num">${N(x.perDay, 2)}</td></tr>`).join('')}</tbody></table>
        <p class="small muted">Let op: een prijsverschil bewijst niet automatisch een prijseffect. Seizoen, advertenties, koopblok en beschikbaarheid spelen ook mee.</p>` : ''}
    </section>

    <section class="panel" style="margin-top:14px"><h2>Gerealiseerde verkoopprijzen (uit orders)</h2>
      <p class="small muted">Wat klanten werkelijk betaalden, ook vóór de start van de prijsregistratie (orderhistorie tot 3 maanden). Dit toont dat er prijzen of acties zijn geweest,
      maar níet het exacte moment van een wijziging. Daarom tellen deze reeksen niet als meetperiode in de prijsanalyse. Een afwijking van de aangeboden prijs kan ook door een actie of volumekorting komen.</p>
      ${v.realizedPrices.length ? `<div class="tablewrap"><table><thead><tr><th>Betaalde prijs per stuk</th><th>Eerste order</th><th>Laatste order</th><th class="num">Orderregels</th><th class="num">Stuks</th></tr></thead><tbody>
        ${v.realizedPrices.map((r) => `<tr><td>${E(r.price)}</td><td>${dd(r.from)}</td><td>${dd(r.to)}</td><td class="num">${r.lines}</td><td class="num">${r.units}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nog geen orders met prijs.</p>'}
    </section>

    <section class="panel" style="margin-top:14px"><h2>Waargenomen wijzigingen</h2>
      <p class="small muted">Automatisch vastgesteld bij elke synchronisatie door de nieuwe stand bij bol te vergelijken met de vorige meting. Het dashboard wijzigt zelf niets; handmatig loggen is niet nodig.
      Het werkelijke moment ligt tussen "vorige meting" en "waargenomen".</p>
      ${changesTable(v.changes, false)}
    </section>

    <section class="panel" style="margin-top:14px"><h2>Bijdrage per stuk ${v.economics ? tagEcon(v.economics.status) : ''}</h2>
      ${v.economics ? `<div class="grid two"><table><tbody>${v.economics.lines.map((l) => `<tr><td>${esc(l.label)} ${l.basis ? `<span class="tag ${l.basis === 'GESCHAT' ? 't-warn' : 't-muted'}">${l.basis.toLowerCase()}</span>` : ''}</td><td class="num">${E(l.amount)}</td></tr>`).join('')}
        <tr><th>Bijdrage vóór advertenties</th><th class="num">${E(v.economics.contributionBeforeAds)}${v.economics.complete ? '' : ' <span class="tag t-bad">onvolledig</span>'}</th></tr>
        <tr><td>Bijdrage na advertenties</td><td class="num muted">${esc(v.economics.adsNote || '')}</td></tr></tbody></table>
        <div>${v.economics.missing.length ? `<div class="note bad">Ontbrekende kosten (tellen als onbekend, niet als nul): ${esc(v.economics.missing.join(', '))}.</div>` : ''}
          <p>Marge vóór advertenties: <strong>${P(v.economics.marginPct)}</strong></p>
          <p>Indicatieve break-evenprijs (incl. btw): <strong>${E(v.economics.breakEvenPriceIncl)}</strong><br><span class="small muted">Aanname: commissie schaalt mee met de prijs. Commissie in bol-orders is incl. btw (afgeleid uit RFIG-orders: (€ 0,95 + 8%) × 1,21); hier excl. btw, omdat die btw verrekenbaar is. Bevestigen met een factuurspecificatie.</span></p></div></div>`
        : '<p class="muted">Geen actuele prijs bekend.</p>'}
    </section>

    <section class="panel" style="margin-top:14px"><h2>Productgegevens</h2>
      <form id="pform" class="form">
        <label class="f">Titel<input name="title" value="${esc(p.title || '')}"></label><label class="f">SKU<input name="sku" value="${esc(p.sku || '')}"></label>
        <label class="f">Variant<input name="variant" value="${esc(p.variant || '')}"></label><label class="f">Productgroep<input name="product_group" value="${esc(p.product_group || '')}"></label>
        <label class="f">Type<select name="season_type"><option value="SEIZOEN" ${p.season_type === 'SEIZOEN' ? 'selected' : ''}>Seizoen</option><option value="DOORLOPEND" ${p.season_type === 'DOORLOPEND' ? 'selected' : ''}>Doorlopend</option></select></label>
        <label class="f">Eigenaar<input name="owner" value="${esc(p.owner || '')}"></label><label class="f">Tags<input name="tags" value="${esc(p.tags || '')}"></label>
        <button class="primary">Opslaan</button></form>
      <p class="small muted">Handmatige gegevens worden nooit door de synchronisatie overschreven.</p>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Notities en hypotheses bij dit product</h2>
      ${v.notes.length ? `<ul>${v.notes.map((n) => `<li><span class="tag t-muted">${n.kind.toLowerCase()}</span> <strong>${esc(n.title)}</strong> — ${esc(n.body || '')} <span class="small muted">(${esc(n.status)}${n.eval_date ? ', evaluatie ' + dd(n.eval_date) : ''})</span></li>`).join('')}</ul>` : '<p class="muted">Nog geen notities.</p>'}
      <a class="btn" href="#/werkruimte">Naar Mijn werkruimte</a>
      ${v.timeline.length ? `<h3>Tijdlijn van wijzigingen</h3><ul class="small">${v.timeline.map((x) => `<li>${dt(x.at.replace(' ', 'T') + 'Z')} — ${esc(x.action)}</li>`).join('')}</ul>` : ''}
    </section>`;

  $app.querySelector('#pform').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await api('/api/product', { ean, ...f }); toast('Opgeslagen'); route(); } catch (err) { toast(err.message); }
  };
}

const CTYPE = { PRIJS: 't-info', STATUS: 't-warn', VOORRAAD: 't-muted', LOGISTIEK: 't-muted', OVERIG: 't-muted' };
function changesTable(rows, withProduct) {
  if (!rows.length) return '<p class="muted">Nog geen wijzigingen waargenomen. De eerste synchronisatie legt de beginstand vast; wijzigingen daarna verschijnen hier.</p>';
  return `<div class="tablewrap"><table><thead><tr><th>Waargenomen</th><th>Vorige meting</th>${withProduct ? '<th>Product</th>' : ''}<th>Soort</th><th>Wat</th><th>Was</th><th>Wordt</th><th>Laatst gewijzigd volgens bol</th></tr></thead><tbody>
    ${rows.map((c) => `<tr${withProduct ? ` class="click" onclick="location.hash='#/product/${c.ean}'"` : ''}><td>${dt(c.detected_at)}</td><td class="small">${dt(c.previous_observed_at)}${c.previous_observed_at && Date.parse(c.detected_at) - Date.parse(c.previous_observed_at) > 6 * 3600e3 ? ' <span class="tag t-warn">lange tussenpoos</span>' : ''}</td>
      ${withProduct ? `<td>${esc(c.title || c.ean)}</td>` : ''}<td><span class="tag ${CTYPE[c.type] || 't-muted'}">${esc((c.type || '').toLowerCase())}</span></td><td>${esc(c.label)}</td><td>${esc(c.old_text)}</td><td><strong>${esc(c.new_text)}</strong></td><td class="small">${dt(c.bol_modified_at)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pageChanges() {
  const d = await api('/api/changes?days=365');
  let type = store.get('chtype', '');
  const draw = () => { $app.querySelector('#chlist').innerHTML = changesTable(d.rows.filter((r) => !type || r.type === type), true); };
  $app.innerHTML = `<h1>Waargenomen wijzigingen</h1>
    <p class="muted small">Alle wijzigingen die het dashboard bij bol heeft gezien: prijs, staffelprijs, te koop NL/BE, pauze, fulfilment, levertijd, opgegeven voorraad en uitverkocht/weer verkoopbaar.
    Waarneming sinds ${dt(d.since)}. Wijzigingen terwijl de pc uit stond worden bij de eerstvolgende synchronisatie gezien; het exacte moment is dan onbekend (tussen "vorige meting" en "waargenomen").
    Niet zichtbaar via de koppeling: wijzigingen in productcontent (titel, beschrijving, afbeeldingen) en advertenties.</p>
    <div class="row"><label class="f">Soort<select id="chtype"><option value="">Alles</option>${Object.keys(CTYPE).map((k) => `<option value="${k}" ${type === k ? 'selected' : ''}>${k.toLowerCase()}</option>`).join('')}</select></label><span class="spacer"></span><button id="chcsv">Export CSV</button></div>
    <div class="panel" style="margin-top:10px" id="chlist"></div>`;
  $app.querySelector('#chtype').onchange = (e) => { type = e.target.value; store.set('chtype', type); draw(); };
  $app.querySelector('#chcsv').onclick = () => downloadCsv('rfig-wijzigingen.csv', d.rows.map((r) => ({ waargenomen: r.detected_at, vorige_meting: r.previous_observed_at, ean: r.ean, product: r.title, soort: r.type, wat: r.label, was: r.old_text, wordt: r.new_text, bol_gewijzigd: r.bol_modified_at })));
  draw();
}

function summDays(list) {
  if (!list.length) return '–';
  const by = {};
  for (const x of list) (by[x.reason] = by[x.reason] || []).push(x.day);
  const lbl = { WIJZIGINGSDAG: 'wijziging', START_REGISTRATIE: 'start', MEETGAT: 'meetgat' };
  return Object.entries(by).map(([r, ds]) => `${lbl[r] || r}: ${ds.length > 3 ? `${dd(ds[0])} … ${dd(ds[ds.length - 1])} (${ds.length})` : ds.map(dd).join(', ')}`).join('<br>');
}

function seasonBlock(v) {
  const s = v.season, st = s.status, req = s.required;
  const advice = adviceText(v);
  return `<section class="panel" style="margin-top:14px"><h2>Uitverkocht op doeldatum</h2>
    <div class="grid two"><div>
      <table><tbody>
        <tr><td>Doeldatum (door jou bepaald)</td><td class="num">${dd(s.target.target_date)}</td></tr>
        <tr><td>Resterende verkoopdagen (vandaag t/m dag vóór doeldatum)</td><td class="num">${req.expired ? '<span class="tag t-warn">verstreken</span>' : N(req.remainingDays)}</td></tr>
        <tr><td>Nog te verkopen (zonder inkomende voorraad)</td><td class="num">${N(req.toSell)}</td></tr>
        <tr><td>Benodigd tempo</td><td class="num">${N(req.perDay, 2)} st/dag · ${N(req.perWeek, 1)} st/week</td></tr>
        ${req.toSellWithIncoming != null && req.toSellWithIncoming !== req.toSell ? `<tr><td>Benodigd tempo incl. bevestigde leveringen</td><td class="num">${N(req.perDayWithIncoming, 2)} st/dag</td></tr>` : ''}
        <tr><td>Gekozen basis voor status</td><td class="num">${esc(st.basisLabel || '–')} ${st.basisPerDay != null ? `(${N(st.basisPerDay, 2)} st/dag)` : ''}</td></tr>
        <tr><td>Verwachte uitverkoopdatum (berekend)</td><td class="num">${st.forecast ? (st.forecast.selloutDate ? dd(st.forecast.selloutDate) : esc(st.forecast.note)) : '–'}</td></tr>
        <tr><td>Verwachte restvoorraad op doeldatum</td><td class="num">${st.forecast ? N(st.forecast.restAtTarget) : '–'}</td></tr>
      </tbody></table>
      <p class="small muted">De doeldatum wordt nooit automatisch aangepast. Grenzen: min ${E(s.target.min_price)}, max ${E(s.target.max_price)}, prijsstap ${s.target.price_step ? E(s.target.price_step) : '–'}, min. ${s.target.min_measure_days} meetdagen, marge ±${s.target.tolerance_days} dagen.</p>
      <div class="note ${st.status === 'TE_LANGZAAM' ? 'bad' : st.status === 'TE_SNEL' ? '' : 'warn'}"><strong>Aanwijzing (geen bewezen oorzaak):</strong> ${esc(advice)}</div>
    </div><div>${stockChart(v)}</div></div></section>`;
}

function adviceText(v) {
  const s = v.season, st = s.status, t = s.target, price = v.priceNow && v.priceNow.price;
  const step = t.price_step || null;
  if (st.status === 'ONVOLDOENDE_GEGEVENS') return `Nog te weinig volledige meetdagen (minimaal ${t.min_measure_days}). Wacht met een prijsbesluit en evalueer opnieuw.`;
  if (st.status === 'DOELDATUM_VERSTREKEN') return 'De doeldatum is verstreken. Besluit wat er met de restvoorraad gebeurt.';
  if (st.status === 'TE_SNEL') {
    const np = price && step ? price + step : null;
    const capped = np && t.max_price && np > t.max_price;
    return `Bij dit tempo is de voorraad ruim vóór de doeldatum op. Onderzoek een beheersbare prijsverhoging${np ? ` (bv. naar ${eur.format(capped ? t.max_price : np)}${capped ? ', begrensd door maximumprijs' : ''})` : ''} en evalueer na ${t.min_measure_days} volledige meetdagen. Wijzig de prijs zelf in bol en leg het moment hier vast.`;
  }
  if (st.status === 'TE_LANGZAAM') {
    const np = price && step ? price - step : null;
    const below = np && t.min_price && np < t.min_price;
    return `Bij dit tempo blijft er voorraad over op de doeldatum. Onderzoek een lagere prijs${np ? ` (bv. ${eur.format(below ? t.min_price : np)}${below ? ', begrensd door minimumprijs' : ''})` : ''} of andere verkoopmaatregelen (advertenties, koopblok, levertijd). Evalueer na ${t.min_measure_days} volledige meetdagen.`;
  }
  return 'Het tempo past bij de doeldatum. Prijs voorlopig gelijk houden en blijven meten.';
}

function stockChart(v) {
  const s = v.season; if (!s) return '';
  const hist = v.stockSeries; const today = v.velocity.today; const target = s.target.target_date;
  if (!hist.length || v.stock.sellable == null) return '<p class="muted">Nog geen voorraadmetingen voor een grafiek.</p>';
  const start = hist[0].day;
  const day = (d) => (Date.parse(d + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 864e5;
  const xMax = Math.max(day(target), day(today) + 1);
  const yMax = Math.max(...hist.map((h) => h.stock), v.stock.sellable, 1) * 1.08;
  const W = 640, H = 260, L = 44, R = 10, T = 10, B = 28;
  const X = (d) => L + (d / xMax) * (W - L - R), Y = (n) => T + (1 - n / yMax) * (H - T - B);
  const line = (pts, color, dash = '') => `<polyline fill="none" stroke="${color}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(Math.max(0, y)).toFixed(1)}`).join(' ')}"/>`;
  const t0 = day(today), tT = day(target);
  const fc = (rate) => (rate ? [[t0, v.stock.sellable], [Math.min(tT, t0 + v.stock.sellable / rate), Math.max(0, v.stock.sellable - rate * (tT - t0))]] : null);
  const b7 = v.velocity.bases.find((b) => b.label === 'Laatste 7 volledige dagen'), b30 = v.velocity.bases.find((b) => b.label === 'Laatste 30 volledige dagen');
  const bp = v.velocity.bases.find((b) => b.isPriceBasis && b.label.startsWith('Huidige'));
  const series = [
    ['var(--ink)', '', 'Werkelijke voorraad (bol)', hist.map((h) => [day(h.day), h.stock])],
    ['var(--muted)', '6 4', 'Gewenst verloop naar doel', [[t0, v.stock.sellable], [tT, s.target.end_stock || 0]]],
    ['var(--info)', '', 'Prognose 7 dagen', fc(b7 && b7.perDay)],
    ['var(--warn)', '', 'Prognose 30 dagen', fc(b30 && b30.perDay)],
    ['var(--good)', '', 'Prognose huidige prijs', fc(bp && bp.days ? bp.perDay : null)],
  ].filter((x) => x[3]);
  const months = []; for (let d = new Date(start + 'T00:00:00Z'); day(d.toISOString().slice(0, 10)) <= xMax; d.setUTCMonth(d.getUTCMonth() + 1, 1)) months.push(d.toISOString().slice(0, 10));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Voorraadverloop en prognoses">
    <line x1="${L}" y1="${Y(0)}" x2="${W - R}" y2="${Y(0)}" stroke="var(--line)"/>
    ${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${Y(yMax * f / 1.08)}" y2="${Y(yMax * f / 1.08)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(yMax * f / 1.08) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(yMax * f / 1.08)}</text>`).join('')}
    ${months.map((m) => `<text x="${X(day(m))}" y="${H - 8}" font-size="11" fill="var(--muted)">${new Date(m + 'T12:00:00Z').toLocaleDateString('nl-NL', { month: 'short' })}</text>`).join('')}
    <line x1="${X(t0)}" x2="${X(t0)}" y1="${T}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="2 3"/>
    <line x1="${X(tT)}" x2="${X(tT)}" y1="${T}" y2="${Y(0)}" stroke="var(--bad)" stroke-dasharray="3 3"/><text x="${X(tT) - 4}" y="${T + 10}" text-anchor="end" font-size="11" fill="var(--bad)">doeldatum</text>
    ${series.map(([c, dsh, , pts]) => line(pts, c, dsh)).join('')}</svg>
    <div class="legend">${series.map(([c, dsh, l]) => `<span><i style="background:${c}${dsh ? ';opacity:.6' : ''}"></i>${l}</span>`).join('')}</div>
    <p class="small muted">Prognoses zijn lineair bij een vast tempo; voorspelde voorraad wordt nooit negatief.</p>`;
}

// ---------- Seizoensvoorraad op koers ----------
async function pageSeason() {
  const rows = await api('/api/season');
  $app.innerHTML = `<h1>Seizoensvoorraad op koers</h1>
    <p class="muted small">Elke variant apart beoordeeld. Status op basis van tempo bij huidige prijs (bij voldoende meetdagen), anders 7 dagen. Geen dwingend advies op basis van één uitzonderlijke dag.</p>
    <div class="panel tablewrap"><table><thead><tr><th>Product</th><th>Status en actie</th><th class="num">Prijs</th><th class="num">Voorraad</th><th class="num">Inkomend</th><th>Doeldatum</th>
      <th class="num">Nodig/dag</th><th>Tempo st/dag</th><th>Verwacht uitverkocht</th><th class="num">Rest op doel</th></tr></thead>
    <tbody>${rows.map((r) => { const s = r.season; if (!s) return `<tr><td>${esc(r.title)}</td><td colspan="9" class="muted">Geen doeldatum ingesteld (Gegevens → Doelen)</td></tr>`;
      const pm = (l) => s.perMethod.find((m) => m.label === l);
      const cur = s.perMethod.find((m) => m.label.startsWith('Huidige'));
      const so = (m) => (m ? (m.without.selloutDate ? dd(m.without.selloutDate) : '–') : '–');
      return `<tr class="click" onclick="location.hash='#/product/${r.ean}'"><td>${esc(r.title)}<div class="small muted">${esc(r.variant || '')}</div></td>
        <td>${tagStatus(s.status.status)}<div class="small muted">${esc(shortAdvice(s.status.status))}${s.status.basisLabel ? ` · basis: ${esc(s.status.basisLabel)}` : ''}</div></td>
        <td class="num">${E(r.price)}</td><td class="num">${N(r.stock)}</td><td class="num">${N(r.incoming)}</td>
        <td>${dd(s.target.target_date)}<div class="small muted">${s.required.expired ? 'verstreken' : `${N(s.required.remainingDays)} dagen`}</div></td><td class="num">${N(s.required.perDay, 2)}</td>
        <td><div class="tempo"><span>1 dag</span><span>${N(r.perDay1, 1)}</span><span>7 dagen</span><span>${N(r.perDay7, 2)}</span><span>30 dagen</span><span>${N(r.perDay30, 2)}</span><span>totaal</span><span>${N(r.perDayAll, 2)}</span><span>huidige prijs</span><span>${N(r.perDayPrice, 2)} (${r.priceDays} d)</span></div></td>
        <td><div class="tempo"><span>7d</span><span>${so(pm('Laatste 7 volledige dagen'))}</span><span>30d</span><span>${so(pm('Laatste 30 volledige dagen'))}</span><span>prijs</span><span>${so(cur)}</span></div></td>
        <td class="num">${N(s.status.forecast && s.status.forecast.restAtTarget)}</td></tr>`; }).join('')}</tbody></table></div>`;
}
const shortAdvice = (s) => ({ TE_SNEL: 'Prijsverhoging onderzoeken', TE_LANGZAAM: 'Lagere prijs / maatregel onderzoeken', OP_KOERS: 'Gelijk houden, blijven meten', ONVOLDOENDE_GEGEVENS: 'Meetdagen afwachten', DOELDATUM_VERSTREKEN: 'Besluit restvoorraad' }[s] || '');

// ---------- Mijn werkruimte ----------
const KINDS = { NOTITIE: 'Notitie', OBSERVATIE: 'Observatie', HYPOTHESE: 'Hypothese', INZICHT: 'Aangetoond resultaat / inzicht', WENS: 'Wens / verbetering', TAAK: 'Taak' };
async function pageWorkspace() {
  const [items, products] = await Promise.all([api('/api/workspace'), api('/api/products')]);
  let filter = store.get('wsfilter', '');
  const prodOpts = (sel) => `<option value="">— geen —</option>${products.map((p) => `<option value="${esc(p.ean)}" ${sel === p.ean ? 'selected' : ''}>${esc(p.title || p.ean)}</option>`).join('')}`;
  const form = (w = {}) => `<form class="form" id="wsform"><input type="hidden" name="id" value="${w.id || ''}">
    <label class="f">Soort<select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${w.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Titel<input name="title" required value="${esc(w.title || '')}"></label>
    <label class="f">Product<select name="ean">${prodOpts(w.ean)}</select></label>
    <label class="f">Eigenaar<input name="owner" value="${esc(w.owner || '')}"></label>
    <label class="f">Status<select name="status">${['OPEN', 'BEZIG', 'AFGEROND', 'GEÏMPLEMENTEERD', 'VERWORPEN'].map((s) => `<option ${w.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="f">Prioriteit<select name="priority">${['', 'HOOG', 'MIDDEN', 'LAAG'].map((s) => `<option ${w.priority === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="f">Categorie<input name="category" value="${esc(w.category || '')}" placeholder="bv. Rapportage, Koppeling"></label>
    <label class="f">Evaluatiedatum<input type="date" name="eval_date" value="${esc(w.eval_date || '')}"></label>
    <label class="f" style="grid-column:1/-1">Toelichting<textarea name="body">${esc(w.body || '')}</textarea></label>
    <label class="f" style="grid-column:1/-1">Verwacht effect (hypothese)<input name="expected_effect" value="${esc(w.expected_effect || '')}"></label>
    <label class="f" style="grid-column:1/-1">Acceptatiecriteria (wens)<textarea name="acceptance">${esc(w.acceptance || '')}</textarea></label>
    <label class="f" style="grid-column:1/-1">Conclusie<input name="conclusion" value="${esc(w.conclusion || '')}"></label>
    <div class="row"><button class="primary">${w.id ? 'Bijwerken' : 'Toevoegen'}</button>${w.id ? '<button type="button" id="wscancel">Annuleren</button>' : ''}</div></form>`;
  const draw = () => {
    const list = items.filter((w) => !filter || w.kind === filter);
    $app.querySelector('#wslist').innerHTML = list.length ? list.map((w) => `<div class="panel" style="margin-bottom:10px"><div class="row"><span class="tag t-muted">${esc(KINDS[w.kind] || w.kind)}</span><strong>${esc(w.title)}</strong>
      <span class="tag ${w.status === 'GEÏMPLEMENTEERD' || w.status === 'AFGEROND' ? 't-good' : 't-info'}">${esc(w.status || '')}</span><span class="spacer"></span>
      ${w.kind === 'WENS' ? `<button data-exp="${w.id}">Als Claude-opdracht</button>` : ''}<button data-edit="${w.id}">Bewerken</button><button data-del="${w.id}">Verwijderen</button></div>
      <div class="small">${esc(w.body || '')}</div><div class="small muted">${[w.ean && `product ${w.ean}`, w.owner && `eigenaar ${w.owner}`, w.eval_date && `evaluatie ${dd(w.eval_date)}`, w.expected_effect && `verwacht effect: ${w.expected_effect}`, w.conclusion && `conclusie: ${w.conclusion}`].filter(Boolean).map(esc).join(' · ')}</div></div>`).join('') : '<p class="muted">Nog niets vastgelegd.</p>';
    $app.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { $app.querySelector('#wsformwrap').innerHTML = form(items.find((w) => w.id == b.dataset.edit)); bindForm(); window.scrollTo(0, 0); });
    $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (!confirmDelete()) return; await api('/api/workspace/delete', { id: Number(b.dataset.del) }); route(); });
    $app.querySelectorAll('[data-exp]').forEach((b) => b.onclick = async () => { const r = await api(`/api/workspace/export?id=${b.dataset.exp}`); $app.querySelector('#wsexport').innerHTML = `<h3>Ontwikkelopdracht (kopieer naar een nieuwe Claude-sessie)</h3><pre>${esc(r.markdown)}</pre>`; navigator.clipboard && navigator.clipboard.writeText(r.markdown).then(() => toast('Gekopieerd naar klembord'), () => {}); });
  };
  const bindForm = () => {
    $app.querySelector('#wsform').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.id) delete f.id; else f.id = Number(f.id); try { await api('/api/workspace', f); toast('Opgeslagen'); route(); } catch (err) { toast(err.message); } };
    const c = $app.querySelector('#wscancel'); if (c) c.onclick = () => route();
  };
  $app.innerHTML = `<h1>Mijn werkruimte</h1>
    <p class="muted small">Notities, observaties, hypotheses, inzichten, wensen en taken. Een opgeslagen wens is nog geen gebouwde functie: zet de status pas op "geïmplementeerd" als het echt werkt.</p>
    <div class="grid two"><section class="panel"><h2>Nieuw / bewerken</h2><div id="wsformwrap">${form()}</div><div id="wsexport"></div></section>
    <section><div class="row" style="margin-bottom:10px"><label class="f">Filter<select id="wsfilter"><option value="">Alles</option>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div><div id="wslist"></div></section></div>
    <p class="small muted">Eigen widgets, versleepbare dashboards en de KPI-formulebouwer staan gepland (zie voortgang).</p>`;
  $app.querySelector('#wsfilter').onchange = (e) => { filter = e.target.value; store.set('wsfilter', filter); draw(); };
  bindForm(); draw();
}
function confirmDelete() { return window.confirm('Weet je zeker dat je dit wilt verwijderen?'); }

// ---------- Gegevens, imports en instellingen ----------
async function pageData() {
  const [s, targets, imports] = await Promise.all([api('/api/status'), api('/api/targets'), api('/api/imports')]);
  const c = s.config;
  const lab = { GESLAAGD: 't-good', MISLUKT: 't-bad', BEZIG: 't-info', NVT: 't-muted', NOG_NIET_GEDRAAID: 't-muted' };
  $app.innerHTML = `<h1>Gegevens, imports en instellingen</h1>
    <section class="panel"><div class="row"><h2>Koppeltest en synchronisatie</h2><span class="spacer"></span>
      <button id="btnTest" class="primary" ${c.mode === 'DEMO' ? 'disabled' : ''}>Koppeltest uitvoeren</button><button id="btnSync" ${c.mode === 'DEMO' ? 'disabled' : ''}>Nu synchroniseren</button></div>
      <p class="small">Modus: <strong>${c.mode === 'DEMO' ? 'DEMO (synthetische gegevens)' : 'LIVE'}</strong> · Retailer-toegang: ${esc(c.retailerCredentials)} · Advertising-toegang: ${esc(c.advertisingCredentials)} · synchronisatie elke ${c.syncIntervalMinutes} min zolang de app draait, gemiste periode wordt bij opstarten ingehaald (orders tot 3 maanden terug).</p>
      ${c.mode === 'DEMO' ? '<div class="note warn">Nog geen bol-toegang ingesteld. Vul de vier waarden in het bestand <code>.env</code> in de app-map in (zie HANDLEIDING.md) en herstart de app. Plak ze nooit in een chat.</div>' : ''}
      ${s.account ? `<div class="note">Accountcontrole (${dt(s.account.at)}): ${s.account.name ? `<strong>${esc(s.account.name)}</strong>` : `naam niet beschikbaar${s.account.clientName ? ` · toegangsgegevens "<strong>${esc(s.account.clientName)}</strong>"` : ''}`}${s.account.retailerId ? ` · retailer-id ${esc(s.account.retailerId)}` : ''}. Controleer of dit het RFIG-account is en vergelijk een paar producten en orders met het partnerdashboard.</div>` : ''}
      <div class="tablewrap"><table><thead><tr><th>Gegevenssoort</th><th>Status</th><th>Laatst geslaagd</th><th class="num">Records</th><th>Melding</th></tr></thead><tbody>
      ${s.datasets.map((d) => `<tr><td>${esc(d.label)}</td><td><span class="tag ${lab[d.lastStatus] || 't-muted'}">${esc(d.lastStatus.replace(/_/g, ' ').toLowerCase())}</span></td><td>${dt(d.lastSuccessAt)}</td><td class="num">${N(d.lastSuccessRecords)}</td><td class="small">${esc(d.lastMessage || '')}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Prijshistorie geregistreerd vanaf: ${dt(s.priceRegistrationStart)} · Verkoophistorie vanaf: ${dd(s.orderHistoryStart)} · <a href="/docs/datamatrix.md" target="_blank">Datamatrix</a></p>
    </section>

    <section class="panel" style="margin-top:14px"><div class="row"><h2>Back-up</h2><span class="spacer"></span><button id="btnBackup" ${s.backup.dirExists ? '' : 'disabled'}>Nu back-up maken</button><button id="btnRestore" ${s.backup.backups.length ? '' : 'disabled'}>Hersteltest uitvoeren</button></div>
      ${!s.backup.configured ? '<div class="note bad">Geen back-upmap ingesteld (BACKUP_DIR in .env).</div>' : !s.backup.dirExists ? `<div class="note bad">Back-upmap niet gevonden: ${esc(c.backupDir)}. Staat Google Drive voor Desktop aan?</div>` : ''}
      ${s.backup.lastBackupError ? `<div class="note warn">Laatste fout: ${esc(s.backup.lastBackupError)}</div>` : ''}
      <p class="small">Map: <code>${esc(s.backup.dir || '–')}</code><br>Laatste back-up: <strong>${dt(s.backup.lastBackupAt)}</strong> · bewaarschema 7 dagelijks, 4 wekelijks, 12 maandelijks.
      Laatste hersteltest: ${s.backup.lastRestoreTest ? `${dt(s.backup.lastRestoreTest.at)} ${s.backup.lastRestoreTest.ok ? '<span class="tag t-good">geslaagd</span>' : '<span class="tag t-bad">mislukt</span>'}` : 'nog niet'}</p>
      <details><summary class="small">Aanwezige back-ups (${s.backup.backups.length})</summary><ul class="small">${s.backup.backups.map((b) => `<li>${esc(b.name)} — ${Math.round(b.bytes / 1024)} kB</li>`).join('')}</ul></details>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Agent-export</h2>
      <p class="small">Na elke synchronisatie zet het dashboard <code>RFIG agent-export.xlsx</code> in <code>${esc((s.agentExport && s.agentExport.dir) || '–')}</code>, zodat de agents (zoals Ralph) de bol-gegevens kunnen lezen. Geen klantgegevens, geen geheimen.<br>
      Laatst bijgewerkt: <strong>${dt(s.agentExport && s.agentExport.at)}</strong>${s.agentExport && s.agentExport.error ? ` <span class="tag t-bad">fout</span> <span class="small">${esc(s.agentExport.error)}</span>` : ''}</p>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Doelen en prijsgrenzen</h2>
      <p class="small muted">Per EAN, of per productgroep met <code>GROEP:&lt;naam&gt;</code> (bv. GROEP:Dekens). Een doel per EAN gaat vóór het groepsdoel.</p>
      <div class="tablewrap"><table><thead><tr><th>EAN / groep</th><th>Doeldatum</th><th class="num">Eindvoorraad</th><th class="num">Min. prijs</th><th class="num">Max. prijs</th><th class="num">Prijsstap</th><th class="num">Min. meetdagen</th><th class="num">Marge (dagen)</th></tr></thead>
      <tbody>${targets.map((t) => `<tr><td>${esc(t.ean)}</td><td>${dd(t.target_date)}</td><td class="num">${N(t.end_stock)}</td><td class="num">${E(t.min_price)}</td><td class="num">${E(t.max_price)}</td><td class="num">${E(t.price_step)}</td><td class="num">${N(t.min_measure_days)}</td><td class="num">${N(t.tolerance_days)}</td></tr>`).join('')}</tbody></table></div>
      <form id="tform" class="form" style="margin-top:10px"><label class="f">EAN of GROEP:naam<input name="ean" required placeholder="GROEP:Dekens"></label><label class="f">Doeldatum<input type="date" name="target_date" required value="2027-03-01"></label>
        <label class="f">Eindvoorraad<input name="end_stock" value="0"></label><label class="f">Min. prijs<input name="min_price"></label><label class="f">Max. prijs<input name="max_price"></label>
        <label class="f">Prijsstap (€)<input name="price_step"></label><label class="f">Min. meetdagen<input name="min_measure_days" value="7"></label><label class="f">Marge (dagen)<input name="tolerance_days" value="7"></label><button class="primary">Opslaan</button></form>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Import (Excel of CSV)</h2>
      <p class="small">Download het <a href="/templates/RFIG-importtemplate.xlsx">Excel-importtemplate</a>. Eén tabblad per soort. Eerst volgt een proefimport met controle; pas daarna leg je vast. EAN's worden als tekst bewaard.</p>
      <div class="form"><label class="f">Soort<select id="ikind"><option value="PRODUCTEN">Producten</option><option value="KOSTEN">Kosten per stuk</option><option value="VOORRAAD_EXTERN">Voorraad extern (PackFeed)</option><option value="INKOMEND">Inkomende voorraad</option><option value="DOELEN">Doelen en prijsgrenzen</option></select></label>
        <label class="f">Bestand<input type="file" id="ifile" accept=".xlsx,.xls,.csv"></label><label class="f">Tabblad<select id="isheet" disabled></select></label>
        <label class="f"><span><input type="checkbox" id="iover"> bestaande records bijwerken</span></label><button id="ipreview" class="primary">Proefimport</button></div>
      <div id="iresult"></div>
      <h3>Importhistorie</h3><table><thead><tr><th>Datum</th><th>Soort</th><th>Bestand</th><th class="num">Regels</th><th class="num">Vastgelegd</th><th class="num">Overgeslagen</th><th class="num">Fouten</th></tr></thead>
      <tbody>${imports.map((i) => `<tr><td>${dt(i.imported_at.replace(' ', 'T') + 'Z')}</td><td>${esc(i.kind)}</td><td>${esc(i.filename || '')}</td><td class="num">${i.rows_total}</td><td class="num">${i.rows_ok ?? ''}</td><td class="num">${i.rows_skipped ?? ''}</td><td class="num">${i.rows_error ?? ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nog geen imports.</td></tr>'}</tbody></table>
    </section>

    <section class="panel" style="margin-top:14px"><h2>Export eigen gegevens</h2><p class="small">Producten, kosten, doelen, voorraad-imports, werkruimte en prijshistorie als JSON.</p><button id="btnExport">Download export</button></section>`;

  const busy = (btn, fn) => async () => { btn.disabled = true; const t = btn.textContent; btn.textContent = 'Bezig…'; try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = t; } };
  const bt = $app.querySelector('#btnTest'), bs = $app.querySelector('#btnSync');
  bt.onclick = busy(bt, async () => { await api('/api/sync', { koppeltest: true }); toast('Koppeltest klaar'); refreshHeader(); route(); });
  bs.onclick = busy(bs, async () => { await api('/api/sync', {}); toast('Synchronisatie klaar'); refreshHeader(); route(); });
  const bb = $app.querySelector('#btnBackup'); bb.onclick = busy(bb, async () => { const r = await api('/api/backup', {}); toast(`Back-up gemaakt: ${r.result.file}`); route(); });
  const br = $app.querySelector('#btnRestore'); br.onclick = busy(br, async () => { const r = await api('/api/restore-test', {}); toast(r.result.ok ? 'Hersteltest geslaagd' : 'Hersteltest MISLUKT'); route(); });
  $app.querySelector('#btnExport').onclick = async () => { const j = await api('/api/export'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' })); a.download = `rfig-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
  $app.querySelector('#tform').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const num = (x) => (x === '' ? null : Number(String(x).replace(',', '.')));
    try { await api('/api/targets', { ean: f.ean.trim(), target_date: f.target_date, end_stock: num(f.end_stock) ?? 0, min_price: num(f.min_price), max_price: num(f.max_price), price_step: num(f.price_step), min_measure_days: num(f.min_measure_days) ?? 7, tolerance_days: num(f.tolerance_days) ?? 7 }); toast('Doel opgeslagen'); route(); } catch (err) { toast(err.message); }
  };
  setupImport();
}

const SHEET_FOR = { PRODUCTEN: 'Producten', KOSTEN: 'Kosten', VOORRAAD_EXTERN: 'Voorraad extern', INKOMEND: 'Inkomend', DOELEN: 'Doelen' };
function setupImport() {
  let wb = null, csvRows = null, fname = null;
  const kindSel = $app.querySelector('#ikind'), sheetSel = $app.querySelector('#isheet');
  const pickSheet = () => { if (!wb) return; const want = SHEET_FOR[kindSel.value]; const m = wb.SheetNames.find((n) => n.toLowerCase() === want.toLowerCase()); if (m) sheetSel.value = m; };
  kindSel.onchange = pickSheet;
  $app.querySelector('#ifile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; fname = f.name; wb = null; csvRows = null;
    if (/\.csv$/i.test(f.name)) { csvRows = parseCsv(await f.text()); sheetSel.disabled = true; sheetSel.innerHTML = ''; return; }
    if (!window.XLSX) { toast('Excel-lezer niet geladen (geen internet?). Sla het bestand op als CSV en probeer opnieuw.'); return; }
    wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    sheetSel.disabled = false; sheetSel.innerHTML = wb.SheetNames.filter((n) => !/^uitleg/i.test(n)).map((n) => `<option>${esc(n)}</option>`).join(''); pickSheet();
  };
  const rowsNow = () => (csvRows || (wb ? XLSX.utils.sheet_to_json(wb.Sheets[sheetSel.value], { defval: null, raw: true }) : []))
    .filter((r) => Object.values(r).some((v) => v !== null && v !== ''));
  $app.querySelector('#ipreview').onclick = async () => {
    const rows = rowsNow(); if (!rows.length) return toast('Kies eerst een bestand met gegevens');
    try {
      const pv = await api('/api/import/preview', { kind: kindSel.value, rows });
      const cnt = (s) => pv.rows.filter((r) => r.status === s).length;
      const lab = { NIEUW: 't-good', BIJWERKEN: 't-good', BESTAAT_AL: 't-info', DUBBEL_IN_BESTAND: 't-warn', FOUT: 't-bad' };
      $app.querySelector('#iresult').innerHTML = `<h3>Proefimport: ${esc(pv.label)}</h3>
        <p class="small">Kolomherkenning: ${Object.entries(pv.mapping).map(([k, v]) => `<code>${esc(v)}</code> → ${esc(k)}`).join(', ') || 'geen'}${pv.unmappedHeaders.length ? ` · niet gebruikt: ${pv.unmappedHeaders.map(esc).join(', ')}` : ''}</p>
        ${pv.missingRequired.length ? `<div class="note bad">Verplichte kolommen ontbreken: ${pv.missingRequired.join(', ')}</div>` : ''}
        <p>${cnt('NIEUW')} nieuw · ${cnt('BIJWERKEN') ? cnt('BIJWERKEN') + ' bijwerken · ' : ''}${cnt('BESTAAT_AL')} bestaat al · ${cnt('DUBBEL_IN_BESTAND')} dubbel in bestand · <strong>${cnt('FOUT')} fout</strong></p>
        <div class="tablewrap" style="max-height:340px;overflow:auto"><table><thead><tr><th>Regel</th><th>Status</th><th>Gegevens</th><th>Fouten</th></tr></thead><tbody>
        ${pv.rows.slice(0, 300).map((r) => `<tr><td>${r.line}</td><td><span class="tag ${lab[r.status]}">${r.status.replace(/_/g, ' ').toLowerCase()}</span></td><td class="small">${esc(Object.entries(r.data).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · '))}</td><td class="small">${esc(r.errors.join('; '))}</td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:10px"><button id="icommit" class="primary" ${pv.missingRequired.length ? 'disabled' : ''}>Vastleggen</button><span class="small muted">Regels met fouten en dubbele regels worden overgeslagen${$app.querySelector('#iover').checked ? '' : ', bestaande records ook (vink "bijwerken" aan om te overschrijven)'}.</span></div>`;
      $app.querySelector('#icommit').onclick = async () => {
        try { const r = await api('/api/import/commit', { kind: kindSel.value, rows, filename: fname, overwrite: $app.querySelector('#iover').checked }); toast(`Vastgelegd: ${r.ok}, overgeslagen: ${r.skipped}, fouten: ${r.errors}`); route(); } catch (err) { toast(err.message); }
      };
    } catch (err) { toast(err.message); }
  };
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...data] = rows;
  return data.map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), r[i] === undefined || r[i] === '' ? null : r[i]])));
}
