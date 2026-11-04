# MultiApps

Mine egne web-apps, udgivet med GitHub Pages: **https://ajdinkvbeta.github.io/MultiApps/**

| App | Adresse | Mappe |
| --- | --- | --- |
| Kursvagt | https://ajdinkvbeta.github.io/MultiApps/kursvagt/ | [`kursvagt/`](kursvagt/) |
| Tegnehjælp | https://ajdinkvbeta.github.io/MultiApps/tegn/ | [`tegn/`](tegn/) |
| Fil/Billede deling | https://ajdinkvbeta.github.io/MultiApps/deling/ | [`deling/`](deling/) |
| Barselsplan | https://ajdinkvbeta.github.io/MultiApps/barsel/ | [`barsel/`](barsel/) |
| Begivenheder | https://ajdinkvbeta.github.io/MultiApps/begivenheder/ | [`begivenheder/`](begivenheder/) |

## Tegnehjælp

Tegn efter en skitse med kameraet eller som lysbord. Skitsen fastgøres til papiret og følger med. Alt kører på telefonen; billeder og forløb gemmes kun i browseren. Bygget på tegnedelen af [Sporlys](https://github.com/AjdinkvBeta/sporlysWIP).

## Fælles regler for alle apps

- **Data slettes ikke udefra:** Alle sider indlæser [`persist.js`](persist.js), som beder browseren om permanent lager (`navigator.storage.persist()`). Så rydder browseren ikke billeder, planer og indstillinger ved pladsmangel eller inaktivitet. **Nye apps skal også indlæse `persist.js`.** Forsiden viser, om lageret er beskyttet, og hvor meget der bruges.
- Personlige data lægges aldrig i repoet (det er offentligt) – kun i browseren.

## Fil/Billede deling

Send filer, billeder og videoer direkte mellem enheder i original kvalitet, og hold app-data ens på alle dine enheder.

- **Enheder:** Par to enheder med en 6-cifret kode (godkendes på den enhed, der viser koden). Gemte enheder forbindes af sig selv – alle med alle – når de har appen åben, også efter genåbning. En enhed, der er parret med to andre, introducerer dem for hinanden.
- **Send:** Til alle forbundne eller én bestemt. Filer forsvinder fra listen, når modtagerne har dem. "Hent og gem" gemmer billeder/video i Fotos og andre filer i Filer.
- **Synkronisering:** Tegnehjælp (billeder og motiver), Barselsplan og evt. Kursvagt holdes ens på alle gemte enheder, der har appen åben. Nyeste ændring vinder; sletninger huskes. En **backup-enhed** (fx en PC) sletter aldrig noget.
- **Direkte og krypteret:** WebRTC; den offentlige [PeerJS-server](https://peerjs.com) formidler kun kontakten. Alt er desuden krypteret med AES-256-GCM med en nøgle, kun enhederne kender. Link/QR er til en, der ikke har appen.
- **Test:** Actionen `Deling – test` ([`.github/workflows/deling-test.yml`](.github/workflows/deling-test.yml)) kører tre browsere mod den rigtige PeerJS-server.

## Begivenheder

Flyt og zoom kortet til området, og vælg en periode, der starter i dag. Listen under kortet viser begivenhederne i det, man kan se på kortet; samme begivenhed fra flere kilder vises én gang. Tryk på en prik eller klynge for en popup med begivenhederne.

- **Ticketmaster:** Søges direkte fra browseren for kortudsnittet, i hele verden. Kræver en gratis nøgle, som indtastes på siden og kun gemmes i browseren. Over 1.000 resultater deles perioden automatisk op, så intet falder fra.
- **Kalendere (iCal):** Links i [`begivenheder/kilder.json`](begivenheder/kilder.json). Hentes hver 3. time af GitHub Actionen; gentagelser udfoldes et år frem, og steder slås op i OpenStreetMap.
- **Google:** Googles begivenhedssøgning via [SerpApi](https://serpapi.com) (kræver hemmeligheden `SERPAPI_KEY`). Med `heleLandet` søges hovedbyen i alle kommuner på skift; byerne i `steder` prioriteres og opdateres oftest. Indsamleren spørger SerpApi, hvor mange søgninger der er tilbage, og fordeler dem jævnt over resten af måneden.
- **Kortet:** Én prik pr. sted (med antal, hvis der er flere). Tryk på en prik for at se begivenhederne dér under kortet.
- Kalendere og byer kan tilføjes fra siden med en GitHub-nøgle (samme som i Kursvagt); siden gemmer `kilder.json` og starter Actionen.
- Indsamleren: [`begivenheder/collector/collect.mjs`](begivenheder/collector/collect.mjs). Data ligger i grenen `begivenheder-data`.
- **OpdagDanmark:** Alle begivenheder i Danmark fra [OpdagDanmark](https://udforsk.opdagdanmark.dk/?kategori=begivenheder), som bl.a. samler KultuNaut. Hentes hver 6. time (ét kald for listen; billeder og links kun for nye begivenheder).
- **Kortet** viser alle begivenheder i perioden i hele landet, samlet i klynger; listen viser dem i kortudsnittet.
- **Gemte:** Stjernen ved en begivenhed gemmer den på enheden (gul markering). Knappen *Gemte* under kortet filtrerer til kun dem; ellers er de markeret.
- **Søgning og datoer:** Søgefeltet filtrerer begivenhederne (titel, sted, beskrivelse). Datoen vælges med genveje eller i en kalender (tryk første og sidste dag).
- **Liste og hjemmesider:** Tryk på en begivenhed i listen, så flytter kortet sig dertil og viser stedets popup; tryk i popuppen åbner hjemmesiden i en popup oven på appen.
- **Filtre:** Kategorierne (Musik, Børn & familie, Marked …) dannes ud fra de begivenheder, man kan se, med antal; kildens egne kategorier og ord i titlen bruges.
- **Facebook:** Har ingen åben søgning; siden viser en genvej til områdets begivenheder.

## Barselsplan

Orlov, ferie, tidslinje og kalender for barslen. Repoet er offentligt, så de rigtige datoer står ikke i filen. Planen hentes fra et privat link (`…/barsel/#plan=…`) og gemmes kun i browseren.

## Kursvagt

Aktie- og kryptoanalyse med fair værdi, signaler, risiko, dansk skat og handelssimulator.

- **Data:** En GitHub Action ([`.github/workflows/kursvagt.yml`](.github/workflows/kursvagt.yml)) kører ca. hver halve time. Den henter aktiekurser, valuta, regnskabstal, nøgletal og kursmål fra Yahoo Finance og kryptokurser fra CoinPaprika. Nye kryptovalutaer får kurshistorik fra Kraken, indtil der er 100.
  - Data gemmes i grenen `kursvagt-data`, kun seneste version, så repoet ikke vokser.
  - Siden udgives på ny efter hver kørsel.
- **Dine egne data:** Portefølje, favoritter, alarmer og simulering gemmes kun i din browser (localStorage), aldrig i repoet, fordi repoet er offentligt. Under **Metode → Opdatering** kan du eksportere og importere dem.
- **Opdatér nu:** ↻ i appen henter de nyeste data og kryptokurser direkte. Gem en GitHub-nøgle under **Metode → Opdatering**, så starter ↻ også Actionen med det samme.
- **Kode:**
  - `kursvagt/src/` indeholder appen (`app.js`, `engine.js`, `shim.js`, `page.css`, `body.html`). `node kursvagt/build.mjs` bygger `kursvagt/index.html`, og Actionen gør det også selv ved hver kørsel.
  - `kursvagt/updater/` indeholder dataopdateringen (`update.mjs`, `fundamentals.mjs`) og startdata (`seed/`).

Signaler er modelberegninger, ikke personlig investeringsrådgivning.
