# Datamatrix — RFIG Dashboard

Stand: 25 oktober 2026. Bron: officiële bol-documentatie (api.bol.com). Alles wat met **te verifiëren** is gemarkeerd, controleren we in de koppeltest met het echte RFIG-account.

Algemeen (feit):
- Inloggen: `POST https://login.bol.com/token`, `grant_type=client_credentials`, Basic-auth met ID:secret. Token is ca. 5 minuten geldig en moet hergebruikt worden (te vaak opvragen geeft een IP-blokkade).
- Retailer API: v10 is actueel, behalve **Offers: v10 is verouderd en verdwijnt op 1 februari 2027 → we gebruiken Offers v11**.
- Advertising API: v11, zelfde manier van inloggen, met aparte toegangsgegevens.
- Rate limit: richtwaarde 4 verzoeken per seconde. De app houdt zelf ruim minder aan en wacht bij een 429.

| Dataset | Bron / endpoint | Toegang | Belangrijkste velden | Detailniveau | Historie | Vertraging | Synchronisatie | Beperkingen | Alternatief |
|---|---|---|---|---|---|---|---|---|---|
| Aanbod (prijs, status) | Offers v11 `GET /retailer/offers` | Retailer | offerId, ean, bundlePrices.unitPrice, fulfilment.method, onHoldByRetailer, countryAvailabilities.forSale | per aanbieding | **geen prijshistorie** — alleen huidige stand | direct | elk uur (snapshot) | pad en antwoordformaat **te verifiëren** | handmatige invoer van bekende prijswijzigingen |
| Voorraad FBR | Offers v11 `stock.amount`, `stock.correctedStock` | Retailer | amount, correctedStock | per aanbieding | geen historie | direct | elk uur | correctedStock is berekend door bol | import PackFeed |
| Voorraad FBB (LVB) | `GET /retailer/inventory` (v10) | Retailer | ean, voorraad bij bol | per EAN | geen historie | onbekend | elk uur | alleen bij FBB; velden **te verifiëren** | — |
| Voorraad PackFeed | geen koppeling | — | ean, aantal, peildatum | per EAN | vanaf import | handmatig | per import | handwerk | Excel-import |
| Orders en orderregels | `GET /retailer/orders` + `GET /retailer/orders/{id}` | Retailer | orderItemId, ean, quantity, quantityCancelled, unitPrice, commission, orderPlacedDateTime | per orderregel | **max. 3 maanden terug** (`latest-change-date`, "alleen voor noodgevallen") | minuten | elk uur via `change-interval-minute` (max 60) | prijs/commissie alleen in detail per order | partnerdashboard-export voor oudere historie |
| Annuleringen | in orderregels (`quantityCancelled`) | Retailer | quantityCancelled | per orderregel | idem orders | minuten | met orders | — | — |
| Retouren | `GET /retailer/returns` | Retailer | **te verifiëren** | per retour | onbekend | onbekend | gepland (stap 3) | — | — |
| Commissies | in orderregel `commission`; `GET /retailer/commission/{ean}` | Retailer | commission | per orderregel | idem orders | — | met orders | btw-behandeling **te verifiëren** met factuurspecificatie | factuurspecificatie |
| Facturen / specificaties | `GET /retailer/invoices`, `.../specification` | Retailer | factuurregels | per factuur | onbekend | per factuurperiode | gepland (stap 3) | — | — |
| Productbezoeken, koopblok% | `GET /retailer/insights/offer` | Retailer | PRODUCT_VISITS, BUY_BOX_PERCENTAGE | per dag/week/maand | 730 dagen / 104 weken / 24 maanden | onbekend | gepland | — | — |
| Verkoopvoorspelling bol | `GET /retailer/insights/sales-forecast` | Retailer | bol-forecast | per aanbieding | n.v.t. | — | gepland | is bol's eigen model, geen meting | — |
| Zoektermen | `GET /retailer/insights/search-terms` | Retailer | zoekvolume | per term | onbekend | — | gepland | — | — |
| Prestatie-indicatoren | `GET /retailer/insights/performance/indicator` | Retailer | servicenormen | per week | onbekend | — | gepland (stap 3) | — | — |
| Accountgegevens | `GET /retailer/retailers/{retailer-id}` | Retailer | naam, id | account | n.v.t. | — | bij koppeltest | — | — |
| Advertenties | Advertising API v11 (prestatierapporten) | Advertising | uitgaven, vertoningen, klikken, conversies, omzet | campagne/advertentie | **te verifiëren** | **te verifiëren** | stap 3 | endpointpaden nog niet geverifieerd; koppeltest checkt nu alleen de inlog | export uit advertentieomgeving |
| Kostprijzen en kosten | Excel/CSV-import | — | kostensoort, bedrag ex btw, geldig vanaf/tot, geboekt/geschat | per EAN | vanaf import | handmatig | per import | handwerk | — |
| Doelen en prijsgrenzen | invoer in de app / import | — | doeldatum, eindvoorraad, min/max prijs | per EAN of groep | n.v.t. | — | — | — | — |
| Concurrentie, zoekposities | niet beschikbaar via deze koppeling | — | — | — | — | — | — | Niet beschikbaar via de huidige koppeling | MarktMentor (handmatig) |

## Wat dit betekent voor de berekeningen

- **Prijshistorie** start op de dag van de eerste synchronisatie. Daarvóór is de aangeboden prijs onbekend. De gerealiseerde verkoopprijs per orderregel is wél tot 3 maanden terug beschikbaar, maar dat is iets anders dan het moment van een prijswijziging.
- **Meetgaten** (pc uit, synchronisatie mislukt) worden niet ingevuld. Dagen zonder voldoende zekerheid over de prijs tellen niet mee in de prijsperiodeanalyse.
- **Verkoophistorie** gaat maximaal 3 maanden terug via de API. Voor "totale historie sinds introductie" is een export uit het partnerdashboard nodig als de dekens langer verkocht worden.
