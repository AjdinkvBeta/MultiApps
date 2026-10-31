# MultiApps

Mine egne web-apps, udgivet med GitHub Pages: **https://ajdinkvbeta.github.io/MultiApps/**

| App | Adresse | Mappe |
| --- | --- | --- |
| Kursvagt | https://ajdinkvbeta.github.io/MultiApps/kursvagt/ | [`kursvagt/`](kursvagt/) |
| Tegnehjælp | https://ajdinkvbeta.github.io/MultiApps/tegn/ | [`tegn/`](tegn/) |

## Tegnehjælp

Tegn efter en skitse med kameraet eller som lysbord. Skitsen fastgøres til papiret og følger med. Alt kører på telefonen; billeder og forløb gemmes kun i browseren. Bygget på tegnedelen af [Sporlys](https://github.com/AjdinkvBeta/sporlysWIP).

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
