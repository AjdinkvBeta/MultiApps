# MultiApps

Mine egne web-apps, udgivet med GitHub Pages: **https://ajdinkvbeta.github.io/MultiApps/**

| App | Adresse | Mappe |
| --- | --- | --- |
| Kursvagt | https://ajdinkvbeta.github.io/MultiApps/kursvagt/ | [`kursvagt/`](kursvagt/) |
| Tegnehjælp | https://ajdinkvbeta.github.io/MultiApps/tegn/ | [`tegn/`](tegn/) |
| Fil/Billede deling | https://ajdinkvbeta.github.io/MultiApps/deling/ | [`deling/`](deling/) |

## Tegnehjælp

Tegn efter en skitse med kameraet eller som lysbord. Skitsen fastgøres til papiret og følger med. Alt kører på telefonen; billeder og forløb gemmes kun i browseren. Bygget på tegnedelen af [Sporlys](https://github.com/AjdinkvBeta/sporlysWIP).

## Fil/Billede deling

Forbind to enheder med et link (eller en QR-kode), og send filer, billeder og videoer direkte imellem dem i original kvalitet, begge veje.

- **Direkte:** Filerne går direkte fra enhed til enhed med WebRTC og gemmes ingen steder undervejs. Begge skal have siden åben samtidig.
- **Formidling:** Den offentlige, gratis [PeerJS-server](https://peerjs.com) hjælper kun enhederne med at finde hinanden. Den ser aldrig filerne. Der skal ikke sættes noget op.
- **Sikkerhed:** WebRTC er krypteret. Derudover krypteres alt med AES-256-GCM med en nøgle, der kun står i linket efter `#`. Et forkert link kan ikke forbinde eller smide den rigtige modtager ud.
- **Begrænsning:** Uden en relæserver kan nogle mobilnet forhindre en direkte forbindelse. Samme wifi virker næsten altid.
- **Test:** Actionen `Deling – test` ([`.github/workflows/deling-test.yml`](.github/workflows/deling-test.yml)) forbinder to browsere via PeerJS og sender filer begge veje.

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
