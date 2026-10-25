# PROJECT_CONTEXT — RFIG Dashboard

Lees dit eerst als je (Claude of een ontwikkelaar) aan dit project doorbouwt. De volledige opdracht staat in de projectprompt "RFIG Dashboard — projectprompt (opgeschoond)". Voortgang: `docs/voortgang.md`. Databronnen: `docs/datamatrix.md`.

## Architectuur
- **Lokaal** op de Windows-pc van Ivo; Node.js ≥ 22.13 (aanbevolen 24 LTS). **Geen npm-pakketten** (bewust: niets te installeren, geen native builds).
- Opslag: ingebouwde `node:sqlite`. Live: `data/rfig.sqlite`; demo: `data/rfig-demo.sqlite` (gescheiden).
- Server: `src/server.js` (http, alleen 127.0.0.1, Host/Origin-controle). Frontend: `public/` (vanilla JS, geen build). SheetJS via cdnjs voor Excel-import; CSV werkt offline.
- Hosting later: code is los van de pc op te zetten (Vercel + database); dan zijn authenticatie en rollen nodig (§28). Kosten eerst afstemmen.

```
src/
  config.js        .env lezen; geheimen nooit naar browser/logs
  db.js            schema + meta/log/transactie-hulpen
  bol/client.js    alleen-lezen bol-client (token-hergebruik, throttle 350 ms, retry/backoff)
  sync.js          synchronisatie per gegevenssoort, sync_runs, koppeltest
  analytics.js     centrale KPI's en productbeeld (gebruikt calc/*)
  calc/dates.js    Amsterdam-dagen, DST-veilig
  calc/pricePeriods.js  §12 prijsperioden
  calc/velocity.js §11/§14/§16 tempo, prognose, benodigd tempo, status
  calc/margin.js   §8 bijdrage per stuk, ontbrekend = onbekend
  importer.js      proefimport/vastleggen Excel/CSV
  backup.js        VACUUM INTO, bewaarschema 7/4/12, hersteltest
  demo.js          synthetische demodata
test/              node --test (27 tests)
```

## Datamodel (kern)
- `products` (EAN tekst, handmatige velden), `offers`, `price_observations` (elke meting + handmatige exacte wijzigingen), `stock_snapshots` (per locatie, per meting), `orders`/`order_items` (alleen landcode als persoonsgegeven), `costs` (per stuk excl. btw, geldig vanaf/tot, GEBOEKT/GESCHAT), `external_stock` (PackFeed-import), `incoming_stock`, `targets` (per EAN of `GROEP:<naam>`), `workspace_items`, `imports`, `sync_runs`, `change_log`, `meta`.
- `offer_changes`: automatisch waargenomen wijzigingen (vergelijking met vorige stand per synchronisatie; `src/changes.js`). Eerste synchronisatie = beginstand, geen wijzigingen. Wijzigingen in productcontent en advertenties zijn niet zichtbaar via deze koppeling.
- Waarnemingstool: er is geen handmatige invoer van prijswijzigingen (besluit Ivo 2026-10-25); wijzigingen worden door anderen in bol gedaan.
- Synchronisatie schrijft nooit in `costs`, `targets`, `workspace_items` of handmatige productvelden.

## KPI-definities
- **Verkochte stuks** = quantity − quantityCancelled, op **besteldatum** (Amsterdam).
- **Bestelwaarde incl. btw** = unitPrice × verkochte stuks. **Netto-omzet** = ÷ (1 + btw), standaard 21% (`VAT_RATE`).
- **Bijdrage vóór advertenties** = netto-omzet − commissie − kosten per stuk. Ontbrekende verplichte soort (KOSTPRIJS, TRANSPORT, FULFILMENT, VERZENDING, VERPAKKING, commissie) ⇒ status ONVOLLEDIG.
- **Commissie** = per stuk uit orders tegen dezelfde prijs (alleen niet-geannuleerde stuks), anders gemiddeld percentage × prijs. bol-commissie in orders is incl. btw (afgeleid 2026-10-25); bijdrage rekent excl. btw (`COMMISSION_INCLUDES_VAT`).
- **Gerealiseerde verkoopprijzen** uit orders worden apart getoond (ook vóór start prijsregistratie), maar tellen niet als meetperiode.
- Tempo's alleen over volledige dagen; vandaag apart.

## Prijsperioderegels (§12)
- Elke prijsmeting en elke handmatig vastgelegde exacte wijziging is een observatie.
- Wijziging gedetecteerd tussen twee metingen ⇒ alle Amsterdam-dagen die dat interval raken vallen weg. Exacte wijziging ⇒ alleen die dag (ook om 00:00).
- Startdag registratie valt weg. Meetgat > `PRICE_GAP_HOURS` (36 uur) zonder wijziging ⇒ geraakte dagen vallen weg ("meetgat").
- Huidige periode loopt tot en met gisteren. Samenvatting per prijsniveau is gewogen.
- Verkoop op uitgesloten dagen telt wél in totalen.

## Voorraad- en uitverkooplogica
- Verkoopbare voorraad = laatste meting per bol-locatie (correctedStock voor FBR) + laatste import per externe locatie.
- Doeldatum = voorraad nul bij aanvang; verkoopdagen = vandaag t/m dag vóór doeldatum.
- Status: basis = huidige prijs bij ≥ min. meetdagen, anders 7 dagen (moet volledig zijn), anders ONVOLDOENDE_GEGEVENS. TE_SNEL als uitverkocht > marge dagen vóór doel; TE_LANGZAAM als rest op doel > eindvoorraad en afwijking > marge.
- Inkomende voorraad (alleen bevestigd) telt vanaf ontvangstdatum (dag-simulatie). Voorraad nooit negatief; onvervulde vraag apart.
- Prijsaanwijzingen: één prijsstap, binnen min/max, altijd "onderzoeken", nooit automatisch wijzigen.

## Ontwerpkeuzes
- Alleen-lezen client: er bestaan geen schrijfmethoden naar bol in de code.
- Offers v10 is verouderd (stopt 1-2-2027) ⇒ Offers v11.
- Orders: elk uur `change-interval-minute=60`; bij gemiste periode/eerste start `latest-change-date` per dag (max. 3 maanden).
- Back-up via `VACUUM INTO` naar tijdelijke naam + rename (Drive ziet nooit een half bestand).

## Uitbreiden
1. Nieuwe tabel/kolom: toevoegen aan `SCHEMA` in `db.js` met `CREATE TABLE IF NOT EXISTS` / migratie op `schema_version`; nooit bestaande data droppen.
2. Nieuwe berekening: in `src/calc/`, met tests in `test/`, aanroepen via `analytics.js`.
3. Nieuwe bol-data: endpoint eerst verifiëren in de officiële documentatie, dan een aparte dataset in `sync.js` (eigen `sync_runs`-regel) en een regel in `docs/datamatrix.md`.
4. Werk `docs/voortgang.md` bij. Draai `npm test`.

## Openstaande punten
Zie `docs/voortgang.md`.
