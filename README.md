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

Send filer, billeder og videoer i original kvalitet til en bestemt person via et link.

- **Sikkerhed:** Filerne krypteres i browseren (AES-256-GCM), før de sendes. Nøglen står kun i linket efter `#` og sendes aldrig til serveren. Med en ekstra kode skal modtageren også have koden.
- **Opbevaring:** Delingerne ligger midlertidigt i Cloudflare R2 og slettes, når tiden er gået (1 time–30 dage) eller når modtageren har hentet dem, hvis du har valgt det.
- **Server:** [`deling/worker/`](deling/worker/) er en Cloudflare Worker. Actionen [`.github/workflows/deling-worker.yml`](.github/workflows/deling-worker.yml) udgiver den og skriver adressen i `deling/config.json`. Den kræver hemmelighederne `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` og `DELING_KEY` (din afsenderkode).
- Kun den, der kender afsenderkoden, kan uploade. Modtagere skal ikke have noget.

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
