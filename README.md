# MultiApps

Mine egne web-apps, udgivet med GitHub Pages: **https://ajdinkvbeta.github.io/MultiApps/**

| App | Adresse | Mappe |
| --- | --- | --- |
| Kursvagt | https://ajdinkvbeta.github.io/MultiApps/kursvagt/ | [`kursvagt/`](kursvagt/) |
| Tegnehjælp | https://ajdinkvbeta.github.io/MultiApps/tegn/ | [`tegn/`](tegn/) |
| Fil/Billede deling | https://ajdinkvbeta.github.io/MultiApps/deling/ | [`deling/`](deling/) |
| Barselsplan | https://ajdinkvbeta.github.io/MultiApps/barsel/ | [`barsel/`](barsel/) |

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
