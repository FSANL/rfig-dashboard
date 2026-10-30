# Voortgang — RFIG Dashboard

Stand: 25 oktober 2026 (versie 0.1). Legenda: ✅ werkt en getest · 🟡 werkt, nog te verifiëren met echte bol-data · ⏳ gepland · ❌ niet mogelijk via bol-koppeling.

## Stap 1 — kleine echte koppeling testen
| Onderdeel | Status | Toelichting |
|---|---|---|
| Inloggen Retailer API (token hergebruik, rate limit, retries) | 🟡 | Getest tegen nagebootste bol; echte test na invullen `.env` |
| Accountcontrole (juiste RFIG-account) | 🟡 | Naam via token/retailer-endpoint; claimnamen te verifiëren |
| Producten en aanbiedingen (Offers v11) | 🟡 | Pad en antwoordformaat te verifiëren in koppeltest |
| Orders + detail (prijs, commissie) | 🟡 | Historische import max. 3 maanden |
| Voorraad FBR / FBB | 🟡 | FBB-velden te verifiëren |
| Retouren | 🟡 | Alleen toegangstest |
| Advertising API | 🟡 | Alleen inlogtest; rapportages in stap 3 |
| Laatste update per gegevenssoort, ontbrekend ≠ nul | ✅ | |
| Demodata duidelijk gelabeld, aparte database | ✅ | |

## Stap 2 — werkende basis
| Onderdeel | Status |
|---|---|
| Managementoverzicht (KPI's per periode, onvolledige perioden gemarkeerd, max. 5 aandachtspunten) | ✅ |
| Producttabel (kolommen, sorteren, zoeken, opgeslagen weergave, CSV-export) | ✅ |
| Productdetail (tempo, prijsperioden, bijdrage, voorraad, notities, tijdlijn) | ✅ |
| Transparante margecalculatie, ontbrekende kosten = onvolledig | ✅ |
| Voorraad per locatie (bol + import PackFeed) | ✅ |
| Vaste uitverkoopdoeldatum, nooit automatisch aangepast | ✅ |
| Prognoses op meerdere tempo's (1/7/30 dagen, totaal, huidige en eerdere prijs) | ✅ |
| Prijshistorie vanaf start registratie | ✅ |
| Prijsanalyse over volledige dagen, wijzigingsdagen en meetgaten uitgesloten (8 testgevallen + DST) | ✅ |
| Benodigd tempo, status "op koers", prijsaanwijzing binnen grenzen | ✅ |
| Import met proefimport, kolomherkenning, validatie, dubbelcontrole, historie | ✅ |
| Mijn werkruimte: notities, hypotheses, inzichten, wensen → Claude-opdracht | ✅ |
| Duurzame opslag (SQLite) + back-up naar Drive + maandelijkse hersteltest | ✅ |
| Autostart bij inloggen + inhalen gemiste orders | ✅ |
| Automatische waarneming van wijzigingen per product (prijs, staffel, status NL/BE, pauze, fulfilment, levertijd, voorraad, uitverkocht, aanbieding verdwenen) | ✅ |
| Geen handmatige invoer van prijswijzigingen nodig (waarnemingstool) | ✅ |
| Agent-export (RFIG agent-export.xlsx in Drive, na elke synchronisatie) voor de RFIG-agents | ✅ |
| Pagina Acties: actielijst van Linda, gesorteerd op belang, afvinken (lokaal bewaard, terug via agent-export) | 🟡 getest met voorbeelddata; wacht op eerste echte lijst van Linda |
| Eigen dashboards met versleepbare widgets | ⏳ |
| Formulebouwer eigen KPI's | ⏳ |
| Eigen regels ("als … dan voorstel …") | ⏳ |

## Stap 3 — uitbreiden
| Onderdeel | Status |
|---|---|
| Advertentiemodule (ROAS, ACoS, TACoS) | ⏳ |
| Retouranalyse (cohorten, redenen) | ⏳ |
| Financiële aansluiting en uitbetalingen, kasstroom | ⏳ |
| Productbezoeken en koopblok% (insights, 730 dagen historie) | ⏳ |
| Voorraad- en inkoopadvies (doorlopend assortiment) | ⏳ |
| Jaarprognose en scenario's | ⏳ |
| Signalen met afhandelen/uitstellen | ⏳ |
| Rollen en inloggen (pas nodig bij hosting buiten deze pc) | ⏳ |
| Concurrentie, zoekposities | ❌ niet via bol-API (MarktMentor) |

## Acceptatiechecklist (samen met Floyd, met echte producten)
- [ ] Kloppen omzet, aantallen en voorraad met het partnerdashboard (3 producten, 5 orders)?
- [ ] Zijn kosten compleet, of duidelijk gemarkeerd als onvolledig?
- [ ] Zijn de uitverkoopprognoses voor de dekens begrijpelijk?
- [ ] Worden prijswijzigingen automatisch waargenomen en wijzigingsdagen correct uitgesloten (test: laat iemand de prijs in bol wijzigen)?
- [ ] Blijven doelen, notities en wensen bewaard na herstart?
- [ ] Is zichtbaar wanneer gegevens verouderd zijn (pc een dag uit laten)?
- [ ] Is commissie in bol excl. of incl. btw? (vergelijk met factuurspecificatie)

## Openstaande punten
- Test `live-synchronisatie` in test/sync.test.js faalt sinds eind oktober: vaste testdatum 2026-10-20 valt buiten het venster van 10 dagen (datumafhankelijke test, geen fout in de app). Testdatum relatief maken.
- Offers v11: exact pad/antwoordformaat bevestigen in de koppeltest.
- Btw-behandeling bol-commissie: uit RFIG-orders afgeleid dat commissie incl. 21% btw is ((€ 0,95 + 8%) × 1,21, klopt op elke prijs). Dashboard rekent nu excl. btw. Nog bevestigen met een factuurspecificatie.
- `data\server.log` groeit; rotatie toevoegen.
- Afsluiten van het venster maakt geen extra back-up (Windows geeft geen betrouwbaar afsluitsignaal); dagelijkse en opstart-back-up dekken dit.
