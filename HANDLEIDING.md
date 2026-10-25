# RFIG Dashboard — starten en dagelijks gebruik

## Eenmalig installeren (± 10 minuten)

1. **Node.js 24 LTS** installeren via https://nodejs.org (knop "LTS"). Standaardopties zijn goed.
2. De app-map staat al op je pc: `C:\Users\ivova\Documents\Documentenrfig-dashboard`.
3. Dubbelklik **`start.bat`**. De eerste keer maakt hij het bestand `.env` aan en start het dashboard in **demomodus** (paarse balk: synthetische cijfers).
4. Het dashboard opent in je browser op http://localhost:3010. Alleen jouw pc kan het bereiken.

## Live gaan met bol

1. Partnerdashboard bol → Instellingen → Diensten → **API-instellingen**. Vul zo nodig de technische contactgegevens in.
2. Maak twee **nieuwe** sets toegangsgegevens aan (bestaande koppelingen blijven dan werken):
   - Retailer API: "RFIG Dashboard Retailer"
   - Advertising API: "RFIG Dashboard Advertising"
3. Open `.env` in de app-map met Kladblok (rechtsklik → Openen met → Kladblok) en vul de vier waarden in:
   ```
   BOL_RETAILER_CLIENT_ID=...
   BOL_RETAILER_CLIENT_SECRET=...
   BOL_ADVERTISING_CLIENT_ID=...
   BOL_ADVERTISING_CLIENT_SECRET=...
   ```
   Zet deze waarden **nooit** in een chat, WhatsApp, e-mail of screenshot. Bewaar ze daarnaast in je wachtwoordmanager.
4. Sluit het zwarte venster en start `start.bat` opnieuw. De paarse balk verdwijnt.
5. Ga naar **Gegevens & instellingen → Koppeltest uitvoeren**. Controleer:
   - de accountnaam (is dit RFIG?);
   - per gegevenssoort: status "geslaagd" en het tijdstip;
   - een paar producten en orders: vergelijk ze met het partnerdashboard.

De eerste synchronisatie haalt orders van de afgelopen 3 maanden op. Dat kan enkele minuten duren.

## Automatisch starten bij inloggen

Dubbelklik **`autostart-installeren.bat`**. Daarna start het dashboard onzichtbaar zodra je inlogt op Windows.
- Gemiste synchronisaties (pc stond uit) worden bij het opstarten automatisch ingehaald. Orders kunnen tot 3 maanden terug worden ingehaald.
- Prijs en voorraad kunnen **niet** worden ingehaald: bol geeft alleen de huidige stand. Dagen zonder meting tellen niet mee in de prijsanalyse. Het dashboard verzint daar niets bij.
- Uitzetten kan met `autostart-verwijderen.bat`.
- Logboek: `data\server.log`.

## Back-up

- De database staat lokaal in `data\rfig.sqlite`. Dat is het werkbestand; dit bestand **niet** zelf in Drive zetten.
- De app maakt bij elke start, en daarna dagelijks, een kopie in de Drive-map `Project Dashboard\Backups`.
- Bewaarschema: 7 dagelijkse, 4 wekelijkse en 12 maandelijkse kopieën. Oudere kopieën worden automatisch opgeruimd.
- Eén keer per maand doet de app een **hersteltest**: de nieuwste kopie wordt los geopend en gecontroleerd. Het resultaat staat onder Gegevens → Back-up.
- **Terugzetten** (alleen bij een kapotte pc of database): stop het dashboard, kopieer de gewenste back-up naar `data\rfig.sqlite` en start opnieuw.

## Dagelijks gebruik

| Scherm | Waarvoor |
|---|---|
| Overzicht | Omzet, orders en stuks per periode, plus maximaal 5 aandachtspunten |
| Producten | Tabel met eigen kolommen, sortering, zoeken en CSV-export |
| Product (klik op een rij) | Tempo per berekeningsbasis, prijsperioden, uitverkoopprognose, bijdrage per stuk |
| Seizoensvoorraad | Ligt elke variant op koers voor de doeldatum? |
| Mijn werkruimte | Notities, hypotheses, inzichten, wensen en taken; een wens exporteren als Claude-opdracht |
| Gegevens & instellingen | Koppeltest, back-up, doelen, import, export |

**Prijs wijzigen:** dat doe je zelf in bol. Leg daarna in het dashboard (productpagina → "Bekende prijswijziging vastleggen") het exacte moment vast. Dat is nauwkeuriger dan de meting per uur.

**Kosten en voorraad PackFeed:** vul het Excel-importtemplate in (link op Gegevens → Import). Laat onbekende kosten leeg, niet op 0 zetten: het dashboard toont dan "onvolledig".
