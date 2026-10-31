(function () {
  "use strict";
  var E = Engine;
  var TODAY = new Date().toISOString().slice(0, 10);
  var YEAR = +TODAY.slice(0, 4);
  var ACCTS = { frit: "Frit depot", ask: "Aktiesparekonto", pension: "Pension", boerne: "Børneopsparing" };
  var COUNTRY = { DK: "Danmark", US: "USA", NL: "Holland", DE: "Tyskland", SE: "Sverige", NO: "Norge", FI: "Finland", CH: "Schweiz", FR: "Frankrig", UK: "Storbritannien", CA: "Canada", IE: "Irland" };
  var REC_ORDER = { koeb: 0, akk: 1, hold: 2, red: 3, saelg: 4 };
  var SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];
  var EMPTY = { lots: [], sales: [], watch: [], settings: { cash: 0, married: false }, lossCarry: 0 };
  var EXAMPLE = {
    lots: [
      { id: "x1", stockId: "NOVO", account: "frit", date: "2025-03-10", qty: 40, price: 420, currency: "DKK", fx: 1, fee: 25 },
      { id: "x2", stockId: "DSV", account: "ask", date: "2025-04-14", qty: 12, price: 1390, currency: "DKK", fx: 1, fee: 25 },
      { id: "x3", stockId: "DANSKE", account: "frit", date: "2025-02-20", qty: 60, price: 230, currency: "DKK", fx: 1, fee: 25 },
      { id: "x4", stockId: "MSFT", account: "frit", date: "2025-04-03", qty: 10, price: 395, currency: "USD", fx: 6.85, fee: 60 },
      { id: "x5", stockId: "ASML", account: "ask", date: "2025-05-12", qty: 4, price: 640, currency: "EUR", fx: 7.46, fee: 40 },
      { id: "x6", stockId: "TRYG", account: "pension", date: "2024-11-05", qty: 150, price: 158, currency: "DKK", fx: 1, fee: 25 }
    ],
    sales: [{ id: "y1", stockId: "DANSKE", account: "frit", date: "2026-08-14", qty: 20, price: 350, currency: "DKK", fx: 1, fee: 25 }],
    watch: [], settings: { cash: 50000, married: false }, lossCarry: 0
  };
  var SUBS = {
    overview: [["alerts", "Opmærksomhed"], ["stocks", "Aktier"], ["watch", "Overvåg"]],
    profile: [["oversigt", "Nøgletal"], ["fordeling", "Fordeling"], ["udvikling", "Udvikling"], ["beholdning", "Beholdning"], ["handler", "Handler"], ["indstillinger", "Indstillinger"]],
    tax: [["overblik", "Overblik"], ["todo", "Gør dette"], ["salg", "Salg"], ["aarsopg", "Årsopgørelse"], ["frister", "Frister"], ["regler", "Regler"]],
    sim: [["oversigt", "Oversigt"], ["handl", "Handl"], ["ordrer", "Ordrer"], ["beholdning", "Beholdning"], ["regnskab", "Skat og regnskab"]],
    method: [["opdatering", "Opdatering"], ["signaler", "Signaler"], ["modeller", "Modeller"], ["ordbog", "Ordbog"], ["indstillinger", "Indstillinger"], ["kilder", "Kilder"]],
    detail: [["konklusion", "Konklusion"], ["hvorfor", "Hvorfor"], ["risiko", "Risiko"], ["kurs", "Kurs"], ["tal", "Tal"], ["vaerdi", "Værdi"], ["nyheder", "Nyheder"]]
  };

  var S = {
    db: null, user: null, dl: null, uid: null, dbState: "loading",
    stocks: {}, meta: null, rules: null, macro: null, pf: null, example: true,
    A: {}, port: null, tax: null, alerts: [],
    tab: "overview", detail: null, range: "5y",
    sub: { overview: "alerts", profile: "oversigt", tax: "overblik", sim: "oversigt", method: "opdatering", detail: "konklusion" },
    sim: (function () { try { var x = JSON.parse(load("kv-sim") || "null"); return x && x.start && Array.isArray(x.orders) ? x : null; } catch (e) { return null; } })(), simB: null, ticket: null,
    seg: {},
    f: { sig: "alle", cls: "alle", region: "alle", sort: "signal", rev: false, q: "", view: load("kv-view") || "liste", color: "upside", axes: "pot", sel: null },
    prefs: readPrefs(load("kv-prefs")), cmp: readList(load("kv-cmp")), cmpOpen: false, cmpRange: "1y", nav: [], calc: {},
    pf_f: { acct: "alle", group: "sector", sel: null, gl: "alle", q: "", sort: "value" },
    ov: {}, confirmDel: null, tradeType: "buy", subChosen: false
  };

  // ---------- formatting ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fin(x) { return typeof x === "number" && isFinite(x); }
  function curL(c) { return c === "DKK" ? "kr." : c; }
  function pdig(a) { return a >= 10000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : a > 0 ? Math.min(12, Math.ceil(-Math.log10(a)) + 2) : 2; }
  function px(x, c) { if (!fin(x)) return "–"; var a = Math.abs(x), d = pdig(a); return x.toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−") + " " + curL(c); }
  function kr(x) { return fin(x) ? Math.round(x).toLocaleString("da-DK").replace("-", "−") + " kr." : "–"; }
  function krs(x) { return fin(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(Math.round(x)).toLocaleString("da-DK") + " kr." : "–"; }
  function nf(x, d) { return fin(x) ? x.toLocaleString("da-DK", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).replace("-", "−") : "–"; }
  function pc(x, d) { return E.pct(x, d); }
  function spc(x, d) { return E.sgnPct(x, d); }
  function dk(s) { if (!s) return "–"; var d = new Date(s.slice(0, 10) + "T12:00:00"); if (isNaN(d)) return s; return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }) + (d.getFullYear() !== YEAR ? " " + d.getFullYear() : ""); }
  function dkt(s) { if (!s) return "–"; var d = new Date(s); if (isNaN(d)) return s; return d.toLocaleDateString("da-DK", { day: "numeric", month: "short" }) + " kl. " + d.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }); }
  function cls(x) { return x > 0 ? "up" : x < 0 ? "down" : ""; }
  function pill(rec, big) { return '<span class="pill ' + rec.key + (big ? " big" : "") + '">' + esc(rec.label) + "</span>"; }
  function $(id) { return document.getElementById(id); }
  function tidy(h) { return h.replace(/kr\.\./g, "kr."); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600); }
  function fxOf(cur) { return (S.macro && S.macro.fx && S.macro.fx[cur]) || 1; }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function card(title, body, aside) { return '<div class="card"><div class="card-h"><h3>' + title + "</h3>" + (aside || "") + "</div>" + body + "</div>"; }
  function kvList(rows) { return '<div class="kv2">' + rows.map(function (x) { return "<div><span>" + esc(x[0]) + "</span><span" + (x[2] ? ' class="' + x[2] + '"' : "") + ">" + esc(x[1]) + "</span></div>"; }).join("") + "</div>"; }
  function stat(v, label, c, left) { return '<span class="stat' + (left ? " l" : "") + '"><b class="' + (c || "") + '">' + esc(v) + "</b><small>" + esc(label) + "</small></span>"; }
  function readPrefs(raw) { var p = null; try { p = JSON.parse(raw || "null"); } catch (e) {} p = p || {}; return { fav: Array.isArray(p.fav) ? p.fav : [], alarms: Array.isArray(p.alarms) ? p.alarms : [] }; }
  function readList(raw) { try { var x = JSON.parse(raw || "[]"); return Array.isArray(x) ? x.slice(0, 3) : []; } catch (e) { return []; } }
  var SHORT = { koeb: "Køb", akk: "Akk.", hold: "Hold", red: "Red.", saelg: "Sælg" };
  function pxs(x) { return fin(x) ? nf(x, Math.abs(x) >= 1000 ? 0 : pdig(Math.abs(x))) : "–"; }
  function marks(id) { return (heldQty(id) > 0 ? '<span class="mine">Ejer</span>' : "") + (isFav(id) ? '<span class="star" title="Favorit">★</span>' : ""); }
  function isCrypto(id) { var s = S.stocks[id]; return !!s && s.model === "crypto"; }
  function isFav(id) { return S.prefs.fav.indexOf(id) >= 0; }
  function alarmsFor(id) { return S.prefs.alarms.filter(function (x) { return x.stockId === id; }); }
  function alarmHit(al, st) { return !!st && (al.dir === "under" ? st.price <= al.price : st.price >= al.price); }
  var ICON = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    cmp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M17 4v16M3 8h8M13 16h8"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
  };
  // in-card segmented switch; remembers the choice per key
  function segv(key, items) { var v = S.seg[key]; if (!items.some(function (x) { return x[0] === v; })) v = items[0][0]; S.seg[key] = v; return v; }
  function segs(key, items) {
    var cur = segv(key, items);
    return '<div class="seg segw" role="tablist">' + items.map(function (x) { return '<button type="button" role="tab" data-act="seg" data-k="' + key + '" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' + esc(x[1]) + "</button>"; }).join("") + "</div>";
  }

  // ---------- glossary: tappable explanations of investment terms ----------
  var GLOSS = {
    pe: { t: "P/E (kurs/indtjening)", a: ["P/E"], d: "Price/Earnings: aktiekursen divideret med indtjeningen pr. aktie de seneste 12 måneder. Viser, hvor mange års overskud kursen svarer til. Lav P/E kan betyde en billig aktie – eller at markedet venter faldende indtjening.", f: "P/E = kurs ÷ EPS. Kurs 300 kr. og EPS 15 kr. giver P/E 20.", r: ["fpe", "eps"] },
    fpe: { t: "Forward P/E", a: ["Forward P/E", "forward P/E"], d: "Som P/E, men med analytikernes forventede indtjening de næste 12 måneder. Mere fremadskuende, men afhænger af, om prognoserne holder.", r: ["pe", "eps"] },
    pb: { t: "P/B (kurs/indre værdi)", a: ["P/B", "kurs/indre værdi", "Kurs/indre værdi"], d: "Price/Book: kursen divideret med egenkapitalen pr. aktie. Bruges især til banker og forsikring. Under 1 betyder, at aktien handles under den bogførte egenkapital.", r: ["roe", "rim"] },
    evebitda: { t: "EV/EBITDA", a: ["EV/EBITDA"], d: "Selskabets samlede værdi (markedsværdi plus nettogæld) divideret med driftsresultatet før af- og nedskrivninger. Gør selskaber med forskellig gæld sammenlignelige.", r: ["mcap", "netcash"] },
    eps: { t: "EPS (indtjening pr. aktie)", a: ["EPS"], d: "Earnings Per Share: årets nettoresultat divideret med antallet af aktier.", r: ["pe"] },
    roe: { t: "ROE (egenkapitalforrentning)", a: ["ROE", "egenkapitalforrentning", "Egenkapitalforrentning"], d: "Return on Equity: overskud i procent af egenkapitalen – hvor meget selskabet tjener pr. krone, aktionærerne har i det. Over afkastkravet (typisk 7–10 %) skaber værdi.", r: ["roic", "r"] },
    roic: { t: "ROIC (afkast på investeret kapital)", a: ["ROIC"], d: "Return on Invested Capital: driftsoverskud efter skat i procent af al investeret kapital (egenkapital plus rentebærende gæld). Vækst skaber kun værdi, når ROIC er over kapitalomkostningen.", r: ["roe", "dcf"] },
    dcf: { t: "DCF (diskonteret pengestrøm)", a: ["DCF"], d: "Discounted Cash Flow: værdien af en aktie er summen af alle fremtidige frie pengestrømme til aktionærerne, tilbagediskonteret med afkastkravet. Kursvagt bruger value driver-varianten, hvor vækst kræver geninvestering.", f: "FCFE = E · (1 − g / ROIC)", r: ["fcf", "r", "gT"] },
    ddm: { t: "DDM (udbyttemodel)", a: ["DDM", "udbyttemodellen", "Udbyttemodel", "udbyttemodel"], d: "Dividend Discount Model: værdien er nutidsværdien af alle fremtidige udbytter. Passer til forsikringsselskaber og stabile udbyttebetalere.", r: ["div", "payout"] },
    rim: { t: "RIM (residualindkomst)", a: ["RIM", "residualindkomst", "Residualindkomst", "Residualindkomstmodel"], d: "Residual Income Model (Ohlson): egenkapitalen plus nutidsværdien af det overskud, der ligger over afkastkravet. Standardmetoden til banker, hvor pengestrømme ikke giver mening.", f: "V₀ = B₀ + Σ (ROE − r) · B / (1+r)ᵗ", r: ["roe", "pb"] },
    epv: { t: "EPV (normaliseret indtjening)", a: ["EPV", "Earnings Power Value"], d: "Earnings Power Value (Greenwald): værdien af en normal indtjening over hele konjunkturcyklussen. Bruges til cykliske selskaber, hvor ét års tal er misvisende.", r: ["nm", "cyc"] },
    rnpv: { t: "rNPV (risikojusteret nutidsværdi)", a: ["rNPV"], d: "Hvert lægemiddel i udvikling værdisættes og ganges med sandsynligheden for, at det når markedet. Bruges til biotek uden stabil indtjening. Kursvagt bruger analytikernes kursmål, som bygger på sådanne modeller.", r: ["target"] },
    capm: { t: "CAPM", a: ["CAPM"], d: "Capital Asset Pricing Model: afkastkrav = risikofri rente + beta × aktiepræmie. Jo mere en aktie svinger med markedet, jo højere afkast skal man kræve.", f: "r = rf + β · ERP", r: ["beta", "erp", "rf"] },
    beta: { t: "Beta (β)", a: ["Beta", "beta", "β"], d: "Hvor meget aktien svinger med markedet. Beta 1 = som markedet, 1,5 = 50 % mere, 0,5 = halvt så meget. Kursvagt trækker beta mod 1 (Blume) og bruger mindst 0,8.", r: ["capm", "vol"] },
    erp: { t: "Aktiepræmie (ERP)", a: ["ERP", "Aktiepræmie", "aktiepræmie", "aktiepræmien"], d: "Equity Risk Premium: det ekstra afkast, investorer kræver for at eje aktier frem for sikre statsobligationer. Typisk 4–5 % om året.", r: ["capm", "rf"] },
    rf: { t: "Risikofri rente", a: ["Risikofri rente", "risikofri rente", "risikofrie rente"], d: "Renten på en 10-årig statsobligation i aktiens valuta. Grundstenen i afkastkravet – stiger renten, falder værdien af aktier.", r: ["capm", "r"] },
    r: { t: "Afkastkrav", a: ["Afkastkrav", "afkastkrav", "afkastkravet", "Afkastkravet"], d: "Det årlige afkast, man mindst bør kræve for risikoen (kapitalomkostningen). Fremtidige penge diskonteres med det, så et højere afkastkrav giver en lavere fair værdi.", r: ["capm", "fv"] },
    gT: { t: "Evig vækst", a: ["Evig vækst", "evig vækst", "Vækst i al evighed"], d: "Den årlige vækst, modellen antager efter 10 år og for altid. Sættes tæt på inflation plus realvækst – ca. 2,5 % i kroner.", r: ["dcf"] },
    fv: { t: "Fair værdi", a: ["Fair værdi", "fair værdi"], d: "Kursvagts bud på, hvad aktien er værd: den værdiansættelsesmodel, der passer til aktietypen, kombineret med analytikernes kursmål (nedjusteret 10 %). Det er et skøn – se også 90 %-intervallet.", r: ["pot", "mos"] },
    pot: { t: "Potentiale", a: ["Potentiale", "potentiale"], d: "Hvor mange procent fair værdi ligger over (+) eller under (−) kursen nu. Ikke det samme som forventet afkast – kursen når sjældent fair værdi på ét år.", r: ["fv", "mu"] },
    mu: { t: "Forventet afkast (μ)", a: ["Forv. afkast", "Forventet afkast", "forventet afkast", "μ"], d: "Gennemsnitligt forventet afkast inkl. udbytte over 12 måneder. Starter i CAPM-kravet og lukker gradvist afstanden til fair værdi (halveringstid 3 år).", r: ["capm", "ploss"] },
    ploss: { t: "Tab-risiko", a: ["Tab-risiko", "tab-risiko", "Risiko for tab", "risiko for tab"], d: "Sandsynligheden for, at aktien står i minus om 12 måneder, beregnet med en lognormal model ud fra forventet afkast og volatilitet. 35–50 % er normalt for en enkeltaktie – derfor spreder man.", r: ["vol", "mu"] },
    dd20: { t: "Fald på 20 % undervejs", a: ["Fald på 20 % undervejs", "Fald 20 % undervejs"], d: "Sandsynligheden for, at kursen på et tidspunkt inden for 12 måneder er mindst 20 % under i dag – også selvom den kommer op igen bagefter.", r: ["vol", "maxdd"] },
    vol: { t: "Volatilitet (σ)", a: ["Volatilitet", "volatilitet", "volatiliteten", "Udsving (σ)", "σ"], d: "Hvor meget kursen typisk svinger på et år (standardafvigelsen af afkastet). 20 % betyder, at kursen i ca. 2 ud af 3 år ender inden for ±20 % af det forventede.", r: ["beta", "ploss"] },
    cvar: { t: "CVaR 95 %", a: ["CVaR", "Dårligste 5 % af årene"], d: "Conditional Value at Risk: det gennemsnitlige tab i de værste 5 % af udfaldene. Viser, hvor slemt det kan gå, når det går galt.", r: ["vol"] },
    mos: { t: "Sikkerhedsmargin", a: ["Sikkerhedsmargin", "sikkerhedsmargin"], d: "Rabatten i forhold til fair værdi, man køber med, så der er plads til fejl i skønnet (Benjamin Graham). Kursvagt bruger 10–35 % afhængigt af volatiliteten.", r: ["buy", "fv"] },
    buy: { t: "Købsgrænse", a: ["Købsgrænse", "købsgrænse", "købsgrænsen", "Køb under"], d: "Fair værdi minus sikkerhedsmarginen. Under denne kurs er aktien billig nok til at købe ifølge modellen.", r: ["mos", "sell"] },
    sell: { t: "Salgsgrænse", a: ["Salgsgrænse", "salgsgrænse", "salgsgrænsen", "Sælg over", "Overvej salg over"], d: "Fair værdi plus 15 %. Over denne kurs er aktien dyr, og det kan være klogt at tage gevinst.", r: ["buy", "fv"] },
    stop: { t: "Stop-niveau", a: ["Stop-niveauet", "Stop-niveau", "stop-niveau", "Risikostop"], d: "En kurs, der kun brydes i ca. 5 % af kvartalerne ved normale udsving. Falder kursen herunder, er noget sandsynligvis ændret – overvej at sælge eller reducere.", r: ["vol"] },
    akk: { t: "Akkumulér", a: ["Akkumulér"], d: "Signal: aktien ser attraktiv ud, men signalerne er ikke entydige. Køb gradvist i 2–3 portioner frem for alt på én gang.", r: ["red"] },
    red: { t: "Reducér", a: ["Reducér"], d: "Signal: prisen eller risikoen er for høj i forhold til potentialet. Sælg en del af positionen.", r: ["akk"] },
    sma: { t: "10-måneders gennemsnit", a: ["10-måneders gennemsnittet", "10-måneders gennemsnit", "10-mdr. gns.", "10-mdr. gennemsnit"], d: "Gennemsnittet af de seneste 10 månedskurser. Over gennemsnittet er optrend, under er nedtrend (Faber 2007). En enkel måde at undgå at købe ind i et langt fald.", r: ["mom"] },
    mom: { t: "Momentum 12-1", a: ["Momentum 12-1 mdr.", "Momentum 12-1", "momentum"], d: "Kursudviklingen de seneste 12 måneder minus den sidste måned. Aktier, der er steget, har historisk haft tendens til at fortsætte en tid (Jegadeesh & Titman 1993).", r: ["sma"] },
    rsi: { t: "RSI (14)", a: ["RSI(14)", "RSI"], d: "Relative Strength Index: måler de seneste 14 dages op- og nedgange på en skala fra 0 til 100. Under 30 = oversolgt (ofte en god indgang), over 70 = overkøbt.", r: ["macd"] },
    macd: { t: "MACD", a: ["MACD"], d: "Moving Average Convergence Divergence: forskellen mellem et kort og et langt glidende gennemsnit. Peger op, når den korte trend er stærkere end den lange.", r: ["rsi"] },
    pio: { t: "Piotroski F-score", a: ["Piotroski F-score", "F-score", "Piotroski"], d: "Ni ja/nej-tests af regnskabet (indtjening, pengestrøm, gæld, marginer og mere). 7–9 er en stærk og forbedret økonomi, 0–3 er svag.", r: ["altman"] },
    altman: { t: "Altman Z-score", a: ["Altman Z-score", "Altman Z", "Z-score"], d: "Mål for konkursrisiko ud fra fem regnskabstal. Over 3 = sikker zone, 1,8–3 = gråzone, under 1,8 = nødzone. Gælder ikke banker og forsikring.", r: ["pio"] },
    kelly: { t: "Kelly-kriteriet", a: ["Kelly-kriteriet", "Kelly-brøk", "Kelly"], d: "Formel for, hvor stor en del af formuen man bør placere, når forventet afkast og risiko er kendt. Fuld Kelly er for aggressiv, når tallene er skøn, så Kursvagt bruger en brøkdel (standard 0,25).", f: "andel = brøk × (μ − kontantrente) / σ²", r: ["mu", "vol"] },
    div: { t: "Udbytteafkast", a: ["Udbytteafkast", "udbytteafkast"], d: "Årets udbytte pr. aktie i procent af kursen.", r: ["payout", "exdiv"] },
    payout: { t: "Udbyttegrad", a: ["Udbyttegrad", "udbyttegrad"], d: "Hvor stor en del af overskuddet der udbetales som udbytte. Over 100 % kan ikke holde i længden.", r: ["div"] },
    exdiv: { t: "Ex-udbytte", a: ["Ex-udbytte", "ex-udbytte", "Ex-dato", "ex-dato"], d: "Den første handelsdag, hvor aktien handles uden ret til det kommende udbytte. Du skal eje aktien senest dagen før. Kursen falder typisk med udbyttet den dag.", r: ["div", "kildeskat"] },
    gak: { t: "GAK", a: ["GAK"], d: "Gennemsnitlig anskaffelseskurs: den gennemsnitlige pris, du har betalt pr. aktie inkl. kurtage. Skatten af et salg beregnes ud fra den (gennemsnitsmetoden).", r: ["kurtage", "aktieindk"] },
    kurtage: { t: "Kurtage", a: ["Kurtage", "kurtage", "Kurtagen", "kurtagen"], d: "Gebyret pr. handel hos Nordnet: danske og nordiske aktier 0,1 % (min. 25 kr.), USA og Tyskland 0,15 % (min. 25 kr.). Udenlandske aktier koster desuden ca. 0,25 % i valutaveksling.", r: ["limit"] },
    limit: { t: "Limitordre", a: ["Limitordre", "limitordre", "Limitkurs", "limitkurs"], d: "En ordre med en højeste købskurs (eller laveste salgskurs). Beskytter mod at handle til en dårlig pris, når kursen bevæger sig hurtigt.", r: ["kurtage"] },
    ask: { t: "Aktiesparekonto (ASK)", a: ["Aktiesparekonto", "aktiesparekonto", "ASK"], d: "Særlig konto, hvor årets afkast beskattes med 17 % (lagerbeskatning), uanset om du sælger. Indskud er begrænset af et loft (174.200 kr. i 2026). Banken afregner skatten automatisk.", r: ["lager", "aktieindk"] },
    lager: { t: "Lagerbeskatning", a: ["Lagerbeskatning", "lagerbeskatning", "lagerbeskattes"], d: "Skat af årets værdistigning – også selvom du ikke har solgt. Bruges på aktiesparekonto, pension og visse ETF'er. Frit depot beskattes i stedet først ved salg.", r: ["ask", "real"] },
    real: { t: "Realiseret", a: ["Realiseret", "realiseret", "Realiserede", "realiserede"], d: "Gevinst eller tab på aktier, du har solgt. I frit depot indgår det i årets aktieindkomst.", r: ["unreal", "aktieindk"] },
    unreal: { t: "Urealiseret", a: ["Urealiseret", "urealiseret", "Urealiserede", "urealiserede"], d: "Gevinst eller tab på aktier, du stadig ejer. I frit depot beskattes det først, når du sælger.", r: ["real"] },
    aktieindk: { t: "Aktieindkomst", a: ["Aktieindkomst", "aktieindkomst"], d: "Gevinster, tab og udbytter fra aktier i frit depot. Beskattes med 27 % op til progressionsgrænsen og 42 % over.", r: ["prog", "restskat"] },
    prog: { t: "Progressionsgrænse", a: ["Progressionsgrænse", "progressionsgrænse", "progressionsgrænsen", "27 %-trinnet"], d: "Grænsen mellem 27 % og 42 % skat på aktieindkomst: 79.400 kr. i 2026 (158.800 kr. for gifte, der deler grænsen).", r: ["aktieindk"] },
    restskat: { t: "Restskat", a: ["Restskat", "restskat"], d: "Skat, du mangler at betale efter årsopgørelsen. Der lægges rente på. Undgås ved at rette forskudsopgørelsen eller lave en frivillig indbetaling inden nytår.", r: ["forskud"] },
    forskud: { t: "Forskudsopgørelse", a: ["Forskudsopgørelse", "forskudsopgørelse", "forskudsopgørelsen"], d: "Skattestyrelsens forventning til din indkomst i år. Ret din forventede aktieindkomst i TastSelv, så der trækkes nok skat løbende.", r: ["restskat"] },
    kildeskat: { t: "Kildeskat på udbytte", a: ["Kildeskat", "kildeskat", "Udbytteskat", "udbytteskat"], d: "Skat, der trækkes i aktiens hjemland, før udbyttet udbetales. Danmark godskriver højst 15 %; det overskydende (fx i Tyskland, Norge og Schweiz) skal søges tilbage i landet.", r: ["exdiv"] },
    pal: { t: "PAL-skat", a: ["PAL-skat", "PAL"], d: "Pensionsafkastskat på 15,3 % af årets afkast på pensionsopsparing. Trækkes automatisk af pensionsselskabet eller banken.", r: ["lager"] },
    etf: { t: "ETF", a: ["ETF'er", "ETF"], d: "Børshandlet fond, der følger et indeks. Aktiebaserede ETF'er på Skattestyrelsens positivliste lagerbeskattes som aktieindkomst.", r: ["lager"] },
    ttm: { t: "TTM", a: ["TTM"], d: "Trailing Twelve Months: de seneste 12 måneder, uanset hvornår regnskabsåret slutter." },
    cons: { t: "Konsensus", a: ["Konsensus", "konsensus"], d: "Analytikernes samlede anbefaling, fx Køb, Hold eller Sælg.", r: ["target"] },
    target: { t: "Kursmål", a: ["Kursmål", "kursmål", "kursmålet"], d: "Analytikernes gennemsnitlige bud på kursen om 12 måneder. Kursmål har historisk været for optimistiske, så Kursvagt trækker 10 % fra.", r: ["cons", "fv"] },
    mcap: { t: "Markedsværdi", a: ["Markedsværdi", "markedsværdi"], d: "Kurs gange antal aktier: hvad hele selskabet koster på børsen." },
    netcash: { t: "Nettokontant", a: ["Nettokontant", "nettokontant", "Nettogæld", "nettogæld"], d: "Kontanter minus rentebærende gæld. Et negativt tal betyder, at selskabet har nettogæld.", r: ["de"] },
    de: { t: "Gæld/egenkapital", a: ["Gæld/egenkapital"], d: "Rentebærende gæld i forhold til egenkapitalen. Over 1 betyder mere gæld end egenkapital.", r: ["netcash"] },
    opm: { t: "Driftsmargin", a: ["Driftsmargin", "driftsmargin"], d: "Driftsresultatet (EBIT) i procent af omsætningen.", r: ["nm"] },
    nm: { t: "Nettomargin", a: ["Nettomargin", "nettomargin", "Margin"], d: "Årets nettoresultat i procent af omsætningen.", r: ["opm", "epv"] },
    fcf: { t: "Fri pengestrøm (FCF)", a: ["FCF", "Fri pengestrøm", "fri pengestrøm", "frie pengestrømme"], d: "Pengestrømmen fra driften minus investeringer – de penge, der reelt kan udbetales til ejerne eller bruges til at betale gæld.", r: ["dcf"] },
    pa: { t: "p.a. (pr. år)", a: ["p.a."], d: "Per annum: gennemsnitligt årligt afkast med rentes rente over perioden." },
    maxdd: { t: "Største fald", a: ["Største fald på 5 år", "Største fald 5 år", "Største fald"], d: "Det største fald fra en top til en efterfølgende bund i perioden (maximum drawdown).", r: ["dd20"] },
    hi52: { t: "52-ugers top", a: ["52-ugers top"], d: "Den højeste kurs det seneste år." },
    split: { t: "Aktiesplit", a: ["Splittet", "splittet"], d: "Selskabet deler hver aktie i flere, fx 10:1. Kursen falder tilsvarende, men din samlede værdi er den samme." },
    idx: { t: "Indekseret (start = 100)", a: ["start = 100"], d: "Kurserne er omregnet, så alle starter i 100. Så kan aktier med forskellig kurs sammenlignes direkte: 120 betyder +20 %." },
    cyc: { t: "Cyklisk tillæg", a: ["Cyklisk tillæg", "cyklisk risikotillæg", "cyklisk tillæg"], d: "Ekstra 1,5 % på afkastkravet for selskaber, hvis indtjening svinger kraftigt med konjunkturen.", r: ["r", "epv"] },
    settle: { t: "Afvikling (T+2)", a: ["Afvikling", "afvikling", "Afviklingsdag", "T+2"], d: "Dagen hvor handlen endeligt gennemføres, og pengene og aktierne skifter ejer. I Europa sker det 2 handelsdage efter handlen (T+2), i USA 1 dag efter (T+1). Hos Nordnet kan du handle videre for pengene med det samme, men først hæve dem efter afvikling.", r: ["limit"] },
    spread: { t: "Spread (bid/ask)", a: ["Spread", "spread", "Skjult spread"], d: "Forskellen mellem den højeste købspris (bid) og laveste salgspris (ask) i ordrebogen. Køber du til bedste pris, betaler du ask; sælger du, får du bid. Det er en skjult omkostning – lille for store selskaber, større for små selskaber og krypto.", r: ["kurtage", "market"] },
    market: { t: "Bedste pris (markedsordre)", a: ["Bedste pris"], d: "En ordre uden kursgrænse, som udføres til den bedste pris i markedet. Hurtig, men du kender ikke den præcise kurs på forhånd. En limitordre beskytter mod det.", r: ["limit", "spread"] },
    short: { t: "Short-salg", a: ["Short-salg", "short-salg"], d: "At sælge aktier, man ikke ejer, for at købe dem tilbage billigere. Kræver lån af aktier og er ikke muligt for almindelige kunder i Nordnets depoter – derfor heller ikke i simuleringen." },
    fifo: { t: "FIFO", a: ["FIFO"], d: "First In, First Out: ved salg anses de først købte enheder for solgt først. Bruges til kryptovaluta i Danmark. Aktier opgøres i stedet efter gennemsnitsmetoden (GAK).", r: ["gak", "personal"] },
    personal: { t: "Personlig indkomst (krypto)", a: ["personlig indkomst", "Personlig indkomst"], d: "Gevinst på kryptovaluta beskattes i Danmark normalt som personlig indkomst – ca. 37–53 % afhængigt af din øvrige indkomst – og skal selv indberettes (rubrik 20). Tab giver kun et fradrag på ca. 26 % (rubrik 58).", r: ["fifo"] },
    carry: { t: "Fremført tab", a: ["Fremført tab", "fremført tab"], d: "Nettotab på aktier, som ikke kunne modregnes i årets gevinster og udbytter, overføres til de følgende år (eller til en ægtefælle).", r: ["aktieindk"] }
  };
  var GL_RE = null, GL_MAP = {};
  (function buildGloss() {
    var al = [];
    Object.keys(GLOSS).forEach(function (k) { GLOSS[k].a.forEach(function (x) { GL_MAP[x] = k; al.push(x); }); });
    al.sort(function (x, y) { return y.length - x.length; });
    var rx = function (x) { return x.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&").replace(/ /g, "[ \\u00a0]"); };
    GL_RE = new RegExp("(" + al.map(rx).join("|") + ")", "g"); // word boundaries are checked by hand (works without regex lookbehind on older Safari)
  })();
  var GL_WORD = /[A-Za-z0-9À-ɏͰ-Ͽ]/;
  function glossOn() { return load("kv-gloss") !== "off"; }
  // wrap the first occurrence of each known term in a rendered region with a tappable span
  function glossify(root) {
    if (!root || !GL_RE || !glossOn()) return;
    var seen = {}, nodes = [];
    var skip = "button,a,select,option,textarea,input,label,svg,script,style,[data-act],[data-nogl],.gl,.tip,.pill,.sdot,.formula,.kpi .v,.num";
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { var p = n.parentElement; return p && /\S/.test(n.nodeValue) && !p.closest(skip) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
    while (tw.nextNode()) nodes.push(tw.currentNode);
    nodes.forEach(function (n) {
      var txt = n.nodeValue, m, last = 0, frag = null; GL_RE.lastIndex = 0;
      while ((m = GL_RE.exec(txt))) {
        var key = GL_MAP[m[1].replace(/\u00a0/g, " ")];
        var pre = m.index > 0 ? txt.charAt(m.index - 1) : "", post = txt.charAt(m.index + m[1].length);
        if (!key || seen[key] || (pre && GL_WORD.test(pre)) || (post && GL_WORD.test(post))) continue;
        seen[key] = 1; frag = frag || document.createDocumentFragment();
        if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
        var sp = document.createElement("span"); sp.className = "gl"; sp.setAttribute("role", "button"); sp.tabIndex = 0; sp.dataset.act = "gloss"; sp.dataset.k = key; sp.textContent = m[1];
        frag.appendChild(sp); last = m.index + m[1].length;
      }
      if (frag) { if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last))); n.parentNode.replaceChild(frag, n); }
    });
  }
  function showGloss(k, anchor) {
    var g = GLOSS[k], el = $("gpop"); if (!g || !el) return;
    var inPop = anchor && anchor.closest && anchor.closest("#gpop");
    el.innerHTML = '<div class="gh"><b>' + esc(g.t) + '</b><button type="button" class="xbtn" data-act="glclose" aria-label="Luk forklaring">✕</button></div><p>' + esc(g.d) + "</p>" + (g.f ? '<div class="formula">' + esc(g.f) + "</div>" : "") +
      ((g.r || []).length ? '<div class="grel"><span class="tiny muted">Se også</span>' + g.r.filter(function (x) { return GLOSS[x]; }).map(function (x) { return '<button type="button" class="chip" data-act="gloss" data-k="' + x + '">' + esc(GLOSS[x].t.split(" (")[0]) + "</button>"; }).join("") + "</div>" : "");
    el.hidden = false;
    var vw = window.innerWidth, vh = window.innerHeight, w = Math.min(340, vw - 24); el.style.width = w + "px";
    var h = el.offsetHeight, r = anchor && anchor.getBoundingClientRect && !inPop ? anchor.getBoundingClientRect() : null, left, top;
    if (r) { left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2)); top = r.bottom + 8; if (top + h > vh - 64 && r.top - h - 8 > 8) top = r.top - h - 8; }
    else { left = parseFloat(el.style.left) || (vw - w) / 2; top = parseFloat(el.style.top) || vh * 0.25; }
    top = Math.max(8, Math.min(top, vh - h - 8));
    el.style.left = left + "px"; el.style.top = top + "px";
    if (!inPop) { var x = el.querySelector(".xbtn"); if (x && anchor && anchor.matches && anchor.matches(":focus-visible")) x.focus(); }
  }
  function hideGloss() { var el = $("gpop"); if (el && !el.hidden) el.hidden = true; }
  function glossaryView() {
    var q = (S.glq || "").toLowerCase();
    var keys = Object.keys(GLOSS).sort(function (x, y) { return GLOSS[x].t.localeCompare(GLOSS[y].t, "da"); }).filter(function (k) { var g = GLOSS[k]; return !q || (g.t + " " + g.a.join(" ") + " " + g.d).toLowerCase().indexOf(q) >= 0; });
    return '<div class="card"><div class="card-h"><h3>Ordbog</h3><span class="tiny muted">' + Object.keys(GLOSS).length + ' begreber</span></div><input class="search" id="glq" type="search" placeholder="Søg fx P/E, ASK eller volatilitet" value="' + esc(S.glq || "") + '" style="width:100%"><div class="glist" data-nogl>' +
      (keys.length ? keys.map(function (k) { var g = GLOSS[k]; return '<div class="gitem"><b>' + esc(g.t) + "</b><p>" + esc(g.d) + "</p>" + (g.f ? '<div class="formula">' + esc(g.f) + "</div>" : "") + "</div>"; }).join("") : '<div class="empty">Intet fundet.</div>') +
      '</div><p class="tiny muted" style="margin-top:10px">Tip: de fleste begreber er understreget med prikker rundt i appen – tryk på dem for en kort forklaring. Det kan slås fra under Indstillinger.</p></div>';
  }

  // ---------- simulator (paper trading) ----------
  var simT = 0, simSaving = false, simAgain = false;
  function saveSim() { store("kv-sim", JSON.stringify(S.sim)); clearTimeout(simT); simT = setTimeout(flushSim, 300); }
  function flushSim() {
    if (!(S.db && S.uid) || !S.sim) return;
    if (simSaving) { simAgain = true; return; }
    simSaving = true;
    var body = clone(S.sim); body.updatedAt = new Date().toISOString();
    var done = function () { simSaving = false; if (simAgain) { simAgain = false; flushSim(); } };
    S.db.doc("data/users/" + S.uid + "/sim").set(body).then(done, function () { toast("Kunne ikke gemme simuleringen."); done(); });
  }
  // run order matching, expiry and dividends; called from compute()
  function simTick() {
    if (!S.sim || !S.macro || !Object.keys(S.stocks).length) { S.simB = null; return; }
    var now = new Date(), ev = E.simProcess(S.sim, S.stocks, S.macro, S.rules, now), changed = ev.length > 0;
    S.simB = E.simBook(S.sim, S.stocks, S.macro);
    var today = TODAY, snaps = S.sim.snaps || (S.sim.snaps = []), last = snaps[snaps.length - 1];
    if (!last || last.d !== today) { snaps.push({ d: today, v: Math.round(S.simB.total) }); changed = true; }
    else if (Math.abs(last.v - S.simB.total) >= 1) { last.v = Math.round(S.simB.total); changed = true; }
    if (changed) saveSim();
    ev.forEach(function (e) {
      if (e.kind === "fill") toast("Udført: " + (e.order.side === "buy" ? "køb " : "salg ") + fmtQty(e.order) + " " + e.order.ticker + " à " + px(e.order.fill.price, e.order.fill.currency));
      else if (e.kind === "expired") toast("Ordre udløbet: " + e.order.ticker);
      else if (e.kind === "div") toast("Udbytte modtaget: " + kr(e.amount));
    });
  }
  function fmtQty(o) { return o.crypto ? nf(o.qty, o.qty < 1 ? 6 : 4) : nf(o.qty) + " stk."; }
  function simSignal(id) { var a = S.A[id]; return a ? { rec: a.rec.key, label: a.rec.label, upside: fin(a.upside) ? +a.upside.toFixed(4) : null, mu: +a.mu.toFixed(4), price: a.price } : null; }
  function simStart(cash) { S.sim = E.simNew(cash, new Date()); S.simB = E.simBook(S.sim, S.stocks, S.macro); saveSim(); }
  function tk() { return S.ticket || (S.ticket = { sid: null, side: "buy", mode: "qty", type: "limit", qty: "", amount: "", limit: "", validTo: TODAY }); }
  function ticketPreview() {
    var t = tk(), st = S.stocks[t.sid], out = $("tkOut"); if (!out || !st) return;
    var a = S.A[t.sid], hs = E.halfSpread(st, S.macro), fx = fxOf(st.currency), crypto = st.model === "crypto";
    var px0 = t.type === "limit" && +t.limit > 0 ? +t.limit : st.price * (t.side === "buy" ? 1 + hs : 1 - hs);
    var qty = t.mode === "amount" ? E.roundQty(st, (+t.amount || 0) / (px0 * fx)) : E.roundQty(st, +t.qty || 0);
    var B = S.simB, ms = E.marketStatus(st, new Date());
    var rows = [], warn = [];
    if (!(qty > 0)) { out.innerHTML = '<p class="small muted">Angiv ' + (t.mode === "amount" ? "et beløb" : "et antal") + " for at se beregningen." + (t.mode === "amount" && !crypto ? " Aktier købes i hele stk." : "") + "</p>"; return; }
    var c = E.simCost(st, t.side, qty, px0, S.macro);
    rows.push(["Antal", crypto ? nf(qty, qty < 1 ? 6 : 4) + " " + st.ticker : nf(qty) + " stk."]);
    rows.push(["Kurs nu (" + dk(st.priceDate) + ")", px(st.price, st.currency)]);
    rows.push([t.type === "limit" ? "Din limitkurs" : "Forventet handelskurs inkl. spread", px(px0, st.currency)]);
    rows.push(["Kursværdi", px(c.gross, st.currency) + (st.currency !== "DKK" ? " × " + nf(fx, 4) + " = " + kr(c.grossDKK) : "")]);
    rows.push([crypto ? "Børsgebyr (" + pc(0.004, 1) + ")" : "Kurtage", kr(c.kurtage)]);
    if (c.fxFee) rows.push(["Valutaveksling (0,25 %)", kr(c.fxFee)]);
    rows.push(["Skjult spread (est. " + pc(hs, 2) + " pr. side)", "ca. " + kr(qty * st.price * hs * fx)]);
    rows.push([t.side === "buy" ? "Du betaler i alt" : "Du får udbetalt", kr(c.total), t.side === "buy" ? "down" : "up"]);
    if (t.side === "buy") {
      var after = B.available - c.total;
      rows.push(["Disponibelt efter", kr(after), after < 0 ? "down" : ""]);
      if (after < 0) warn.push("Ikke nok penge til rådighed.");
      if (c.kurtage / c.grossDKK > 0.01) warn.push("Gebyret er " + pc(c.kurtage / c.grossDKK, 1) + " af beløbet – køb for mere ad gangen for at holde omkostningerne nede.");
    } else {
      var pos = B.positions.filter(function (p) { return p.sid === t.sid; })[0];
      if (!pos) warn.push("Du ejer ikke " + st.name + " i simuleringen. Short-salg er ikke muligt.");
      else {
        var costOut = pos.avgCost * Math.min(qty, pos.qty), gain = c.total - costOut;
        rows.push([crypto ? "Anskaffelse (FIFO)" : "Anskaffelse (GAK " + kr(pos.avgCost) + "/stk.)", kr(costOut)]);
        rows.push(["Gevinst/tab efter omkostninger", krs(gain), cls(gain)]);
        if (crypto) rows.push(["Skat (personlig indkomst, est.)", gain > 0 ? "ca. " + kr(gain * 0.42) : "fradrag ca. " + kr(-gain * 0.26)]);
        else if (S.rules) rows.push(["Aktieskat (est., frit depot)", gain > 0 ? "ca. " + kr(gain * S.rules.rateLow) + "–" + kr(gain * S.rules.rateHigh) : "tab modregnes"]);
        if (qty > pos.qty) warn.push("Du ejer kun " + (crypto ? nf(pos.qty, 6) : nf(pos.qty) + " stk.") + ".");
      }
    }
    var when = ms.open ? (crypto ? "Udføres med det samme til seneste kurs." : (st.priceDate >= TODAY ? "Markedet er åbent – udføres med det samme, hvis kursen tillader det." : "Markedet er åbent, men kursen er fra " + dk(st.priceDate) + " – ordren udføres ved næste kursopdatering.")) : "Markedet er lukket – ordren venter og udføres ved første nye kurs efter åbning.";
    out.innerHTML = tidy(kvList(rows) + '<p class="tiny muted" style="margin-top:6px">Afvikling (pengene/aktierne er endelig dine): ' + (crypto ? "med det samme" : "T+" + E.marketOf(st).settle + " handelsdage") + ". " + esc(when) + (t.type === "limit" ? " Limitordren gælder til og med " + esc(dk(t.validTo)) + "." : "") + "</p>" + warn.map(function (w) { return '<p class="note">' + esc(w) + "</p>"; }).join("") +
      (a ? '<p class="tiny muted">Modellens signal nu: <b>' + esc(a.rec.label) + "</b>" + (fin(a.upside) ? ", potentiale " + esc(spc(a.upside)) : "") + ". Gemmes med handlen, så du senere kan se, hvor godt signalerne ramte.</p>" : ""));
  }
  function simHandl() {
    var t = tk(), ids = Object.keys(S.stocks).sort(function (x, y) { return S.stocks[x].name.localeCompare(S.stocks[y].name, "da"); });
    if (!t.sid || !S.stocks[t.sid]) t.sid = ids[0];
    var st = S.stocks[t.sid], ms = E.marketStatus(st, new Date()), sh = ids.filter(function (i) { return S.stocks[i].model !== "crypto"; }), cr = ids.filter(function (i) { return S.stocks[i].model === "crypto"; });
    if (!t.limit) t.limit = String(+st.price.toPrecision(6));
    var firstDay = ms.open || !ms.next ? TODAY : ms.next.toLocaleDateString("sv-SE", { timeZone: "Europe/Copenhagen" });
    if (!t.validTo || t.validTo < firstDay) t.validTo = firstDay;
    var opt = function (i) { return '<option value="' + i + '"' + (i === t.sid ? " selected" : "") + ">" + esc(S.stocks[i].name + " (" + S.stocks[i].ticker + ")") + "</option>"; };
    var o = '<div class="card"><div class="seg segw" role="group" aria-label="Køb eller salg"><button type="button" data-act="tkside" data-v="buy" aria-pressed="' + (t.side === "buy") + '">Køb</button><button type="button" data-act="tkside" data-v="sell" aria-pressed="' + (t.side === "sell") + '">Sælg</button></div>' +
      '<form class="form" id="tkForm"><div class="field"><label for="tkSid">Værdipapir</label><select id="tkSid"><optgroup label="Aktier">' + sh.map(opt).join("") + "</optgroup>" + (cr.length ? '<optgroup label="Krypto">' + cr.map(opt).join("") + "</optgroup>" : "") + '</select></div>' +
      '<p class="tiny"><span class="dot' + (ms.open ? "" : " stale") + '"></span><b>' + esc(ms.name) + ":</b> " + esc(ms.text) + "</p>" +
      '<div class="seg segw" role="group" aria-label="Ordretype" style="margin:0"><button type="button" data-act="tktype" data-v="limit" aria-pressed="' + (t.type === "limit") + '">Limitordre</button><button type="button" data-act="tktype" data-v="market" aria-pressed="' + (t.type === "market") + '">Bedste pris</button></div>' +
      '<div class="fgrid"><div class="field"><label for="tkQty">' + (t.mode === "amount" ? "Beløb i kr." : st.model === "crypto" ? "Antal (decimaler ok)" : "Antal stk.") + ' <button type="button" class="linkbtn" data-act="tkmode">' + (t.mode === "amount" ? "skift til antal" : "skift til beløb") + '</button></label><input id="tkQty" type="number" min="0" step="any" inputmode="decimal" value="' + esc(t.mode === "amount" ? t.amount : t.qty) + '"></div>' +
      (t.type === "limit" ? '<div class="field"><label for="tkLimit">Limitkurs (' + esc(curL(st.currency)) + ')</label><input id="tkLimit" type="number" min="0" step="any" inputmode="decimal" value="' + esc(t.limit) + '"></div><div class="field"><label for="tkValid">Gyldig til og med</label><input id="tkValid" type="date" min="' + TODAY + '" value="' + esc(t.validTo) + '"></div>' : "") +
      '</div><div id="tkOut"></div><button class="btn" type="submit">' + (t.side === "buy" ? "Afgiv købsordre" : "Afgiv salgsordre") + ' (simuleret)</button></form></div>';
    o += '<details class="more card"><summary>Sådan fungerer handlerne</summary><ul class="facts" style="margin-top:8px"><li>Ordrer udføres kun, når børsen har åbent (dansk tid: København 9–17, Stockholm/Frankfurt/Paris/Zürich 9–17.30, Oslo 9–16.20, Helsinki 9–17.30, USA 15.30–22). Weekender og børsernes helligdage er lukket. Krypto handles døgnet rundt.</li><li>Simuleringen kender kurserne fra de automatiske opdateringer (hverdage kl. 8.41 og 17.41). En ordre udføres til den første nye kurs efter ordren – aldrig til en kurs, du allerede kendte. Limitordrer tjekkes mod hver ny kurs.</li><li>Omkostninger som i Nordnet: kurtage 0,10 % (min. 25 kr.) i Norden, 0,15 % (min. 25 kr.) i USA og Europa, plus 0,25 % valutaveksling. Krypto: 0,4 % børsgebyr. Oven i kommer et skønnet bid/ask-spread efter selskabets størrelse.</li><li>Afvikling: T+2 i Europa, T+1 i USA. Du kan handle videre for pengene med det samme, som hos Nordnet.</li><li>Udbytte krediteres på ex-datoen fratrukket udbytteskat (27 % i Danmark, ellers landets kildeskat).</li><li>Skat: aktier efter gennemsnitsmetoden (27/42 %), krypto efter FIFO som personlig indkomst (ca. 37–53 % afhængigt af din øvrige indkomst; tab giver ca. 26 % fradrag).</li></ul></details>';
    return o;
  }
  function orderCard(o) {
    var st = S.stocks[o.sid], f = o.fill, cur = f ? f.currency : st ? st.currency : "";
    var head = '<span class="tag ' + (o.side === "buy" ? "buy" : "sell") + '">' + (o.side === "buy" ? "Køb" : "Salg") + "</span><b>" + esc(o.name) + "</b> " + esc(fmtQty(o));
    var stt = { pending: "Afventer", filled: "Udført", cancelled: "Annulleret", expired: "Udløbet" }[o.status] || o.status;
    var sub = o.status === "filled" ? "à " + px(f.price, cur) + " · " + dkt(f.ts) : (o.type === "limit" ? "Limit " + px(o.limit, st ? st.currency : "") + " · gyldig til " + dk(o.validTo) : "Bedste pris") + " · afgivet " + dkt(o.created);
    var det = "";
    if (f) det = '<details class="more"><summary>Mellemregning</summary>' + kvList([["Kurs ved handel (midtkurs)", px(f.mid, cur)], ["Handelskurs inkl. spread", px(f.price, cur)], ["Kursværdi", px(f.gross, cur) + (cur !== "DKK" ? " × " + nf(f.fx, 4) : "")], ["Kursværdi i kr.", kr(f.grossDKK)], ["Kurtage/gebyr", kr(f.kurtage)], ["Valutaveksling", kr(f.fxFee)], ["Spread-omkostning", kr(f.spreadCost || 0)], [o.side === "buy" ? "Betalt i alt" : "Udbetalt i alt", kr(f.total)], ["Afviklingsdag", dk(f.settle)]].concat(o.signal ? [["Signal ved handel", o.signal.label + (o.signal.upside != null ? " (pot. " + spc(o.signal.upside) + ")" : "")]] : [])) + "</details>";
    return '<div class="tcard"><span>' + head + '<br><span class="m">' + esc(stt) + " · " + esc(sub) + "</span>" + det + "</span>" + (o.status === "pending" ? '<button type="button" class="btn ghost sm" data-act="simcancel" data-oid="' + esc(o.id) + '">Annullér</button>' : "") + "</div>";
  }
  function simEval() {
    // how did trades placed on each signal perform? (return from fill price to current price, after costs)
    var groups = {};
    S.sim.orders.filter(function (o) { return o.status === "filled" && o.side === "buy" && o.signal && S.stocks[o.sid]; }).forEach(function (o) {
      var st = S.stocks[o.sid], v = o.qty * st.price * fxOf(st.currency), r = v / o.fill.total - 1, k = o.signal.label;
      var g = groups[k] || (groups[k] = { n: 0, sum: 0, key: o.signal.rec }); g.n++; g.sum += r;
    });
    var keys = Object.keys(groups).sort(function (a, b) { return REC_ORDER[groups[a].key] - REC_ORDER[groups[b].key]; });
    if (!keys.length) return '<p class="small muted">Når du har købt i simuleringen, vises her, hvordan købene har klaret sig fordelt på modellens signal på købstidspunktet. Det viser, om signalerne rammer.</p>';
    return '<table class="t"><thead><tr><th>Signal ved køb</th><th class="r">Køb</th><th class="r">Gns. afkast</th></tr></thead><tbody>' + keys.map(function (k) { var g = groups[k], m = g.sum / g.n; return "<tr><td>" + esc(k) + '</td><td class="r num">' + g.n + '</td><td class="r num ' + cls(m) + '">' + esc(spc(m, 1)) + "</td></tr>"; }).join("") + '</tbody></table><p class="tiny muted" style="margin-top:6px">Afkast fra købskurs inkl. omkostninger til kursen nu. Få handler over kort tid siger meget lidt – se det over måneder.</p>';
  }
  function renderSim() {
    var v = $("v-sim"), sub = S.sub.sim, o = "";
    if (!S.macro || !Object.keys(S.stocks).length) { v.innerHTML = '<div class="card"><div class="empty">Indlæser kurser…</div></div>'; return; }
    if (!S.sim) {
      var c0 = (S.pf && S.pf.settings && S.pf.settings.cash) || 100000;
      v.innerHTML = tidy(card("Øv dig uden risiko", '<p class="small">Handl med fiktive penge på de rigtige kurser – med kurtage, valutaveksling, spread, åbningstider, afvikling, udbytte og skat som i virkeligheden. Simuleringen er helt adskilt fra din rigtige portefølje.</p><form class="form" id="simStartForm" style="margin-top:10px"><div class="field"><label for="simCash">Startkapital (kr.)</label><input id="simCash" type="number" min="1000" step="1000" inputmode="numeric" value="' + esc(c0) + '"></div><button class="btn" type="submit">Start simulering</button></form><p class="tiny muted" style="margin-top:8px">Startbeløbet er hentet fra dine kontanter under Min profil → Indstillinger. Du kan nulstille og starte forfra når som helst.</p>'));
      glossify(v); return;
    }
    var B = S.simB || E.simBook(S.sim, S.stocks, S.macro);
    if (sub === "handl") o = simHandl();
    else if (sub === "ordrer") {
      var items = [["open", "Åbne " + S.sim.orders.filter(function (x) { return x.status === "pending"; }).length], ["done", "Udførte"], ["all", "Alle"]], sv = segv("simord", items);
      var list = S.sim.orders.slice().reverse().filter(function (x) { return sv === "all" || (sv === "open" ? x.status === "pending" : x.status === "filled"); });
      o = '<div class="card">' + segs("simord", items) + (list.length ? '<div class="plist">' + list.map(orderCard).join("") + "</div>" : '<div class="empty">Ingen ordrer her.</div>') + "</div>";
    } else if (sub === "beholdning") {
      o = '<div class="card" style="padding-block:2px">' + (B.positions.length ? '<div class="plist">' + B.positions.slice().sort(function (a, b) { return b.value - a.value; }).map(function (p) {
        var a = S.A[p.sid], st = p.stock;
        return '<div class="pcard" style="cursor:default"><span class="r1"><b data-act="open" data-id="' + p.sid + '" style="cursor:pointer">' + esc(st ? st.name : p.sid) + "</b>" + (a ? pill(a.rec) : "") + '</span><span class="r2">' + esc((p.crypto ? nf(p.qty, p.qty < 1 ? 6 : 4) + " " + (st ? st.ticker : "") : nf(p.qty) + " stk.") + " · GAK " + kr(p.avgCost) + (p.crypto ? "" : "/stk.") + (st ? " · kurs " + px(st.price, st.currency) : "")) + '</span><span class="r3">' + stat(kr(p.value), "værdi", "", true) + stat(krs(p.gain), "gevinst " + spc(p.gainPct, 1), cls(p.gain), true) + stat(pc(p.value / B.total, 1), "af kontoen", "", true) + '</span><span class="row"><button type="button" class="btn ghost sm" data-act="simsell" data-id="' + p.sid + '">Sælg</button><button type="button" class="btn ghost sm" data-act="simbuy" data-id="' + p.sid + '">Køb flere</button></span></div>';
      }).join("") + "</div>" : '<div class="empty">Ingen beholdning endnu. Gå til Handl for at købe.</div>') + "</div>";
    } else if (sub === "regnskab") {
      var tx = S.rules ? E.simTax(S.sim, S.stocks, S.macro, S.rules, YEAR, !!(S.pf && S.pf.settings && S.pf.settings.married)) : null;
      var feesT = B.fees.kurtage + B.fees.fx + B.fees.spread, res = B.total - B.start;
      o = card("Resultat", kvList([["Startkapital", kr(B.start)], ["Værdi nu", kr(B.total)], ["Resultat før skat", krs(res), cls(res)], ["Heraf betalte omkostninger", "−" + kr(feesT)], ["Kurtage og gebyrer", kr(B.fees.kurtage)], ["Valutaveksling", kr(B.fees.fx)], ["Spread (skjult)", kr(B.fees.spread)], ["Udbytte efter udbytteskat", kr(B.divs.reduce(function (s, d) { return s + d.net; }, 0))]]));
      if (tx) o += card("Skat " + YEAR + " (estimat)", kvList([["Realiserede aktiegevinster", krs(tx.gains)], ["Udbytte før skat", kr(tx.divGross)], ["Aktieindkomst", krs(tx.shareIncome)], ["Aktieskat 27/42 %", kr(tx.shareTax)], ["Allerede trukket udbytteskat", "−" + kr(tx.withheld)], ["Rest aktieskat", kr(Math.max(0, tx.shareDue))], ["Kryptogevinster (personlig indkomst)", kr(tx.cryptoGain)], ["Kryptotab (fradrag ca. 26 %)", kr(tx.cryptoLoss)], ["Kryptoskat (est. 42 %)", krs(tx.cryptoTax)], ["Resultat efter skat (est.)", krs(res - Math.max(0, tx.shareDue) - tx.cryptoTax), cls(res - tx.shareDue - tx.cryptoTax)]]) + '<p class="tiny muted" style="margin-top:6px">Urealiserede gevinster beskattes først ved salg (frit depot). Kryptoskatten afhænger af din øvrige indkomst (37–53 %).</p>');
      var rl = B.realized.slice().reverse();
      o += card("Realiserede handler", rl.length ? '<div class="plist">' + rl.map(function (r) { var st = S.stocks[r.sid]; return '<div class="tcard"><span><b>' + esc(st ? st.name : r.sid) + '</b><br><span class="m">' + esc(dk(r.date)) + " · solgt for " + esc(kr(r.proceeds)) + " · anskaffet " + esc(kr(r.cost)) + (r.crypto ? " (FIFO)" : "") + '</span></span><span class="num ' + cls(r.gain) + '">' + esc(krs(r.gain)) + "</span></div>"; }).join("") + "</div>" : '<div class="empty">Ingen salg endnu.</div>');
      o += card("Nulstil", '<p class="small muted">Sletter alle simulerede handler og starter forfra med en ny startkapital.</p><button type="button" class="btn ghost" data-act="simreset" style="margin-top:8px">' + (S.simResetAsk ? "Tryk igen for at bekræfte" : "Nulstil simulering") + "</button>");
    } else {
      var res2 = B.total - B.start, sn = S.sim.snaps || [], pend = S.sim.orders.filter(function (x) { return x.status === "pending"; }).length;
      o = '<div class="kpi hero"><div class="l">Simuleret konto</div><div class="v">' + kr(B.total) + '</div><div class="s"><span class="' + cls(res2) + '">' + krs(res2) + " (" + spc(B.start ? res2 / B.start : NaN, 1) + ")</span> siden start " + esc(dk(S.sim.start.date)) + "</div></div>";
      o += '<div class="card"><div class="kpis"><div class="kpi"><div class="l">Kontanter til rådighed</div><div class="v">' + kr(B.available) + '</div><div class="s">' + (B.reserved > 0 ? kr(B.reserved) + " reserveret til åbne ordrer" : "ingen reserveret") + '</div></div><div class="kpi"><div class="l">Investeret</div><div class="v">' + kr(B.invested) + '</div><div class="s">' + B.positions.length + (B.positions.length === 1 ? " position" : " positioner") + '</div></div><div class="kpi"><div class="l">Omkostninger</div><div class="v">' + kr(B.fees.kurtage + B.fees.fx + B.fees.spread) + '</div><div class="s">kurtage, valuta og spread</div></div><div class="kpi"><div class="l">Åbne ordrer</div><div class="v">' + pend + '</div><div class="s">' + (B.unsettled ? "ikke afviklet: " + krs(B.unsettled) : "alt afviklet") + "</div></div></div></div>";
      o += card("Udvikling", sn.length >= 2 ? '<div class="chart" id="simchart"></div>' : '<p class="small muted">Grafen vises, når simuleringen har kørt mindst to dage.</p>');
      o += card("Rammer modellens signaler?", simEval());
      o += '<div class="row"><button type="button" class="btn" data-act="sub" data-view="sim" data-v="handl">Ny handel</button><button type="button" class="btn ghost" data-act="sub" data-view="sim" data-v="ordrer">Ordrer (' + pend + " åbne)</button></div>";
    }
    v.innerHTML = tidy(o); glossify(v);
    if (sub === "handl") ticketPreview();
    if (sub === "oversigt" || !sub) drawSimChart();
  }
  function drawSimChart() {
    var el = $("simchart"); if (!el || !S.sim) return;
    var sn = S.sim.snaps || [], start = S.simB ? S.simB.start : S.sim.start.cash;
    var pts = sn.map(function (x) { return [new Date(x.d + "T12:00:00").getTime(), x.v]; });
    lineChart(el, { label: "Simuleret kontoværdi", series: [{ name: "Værdi", color: "var(--s1)", pts: pts, area: true }], hlines: [{ y: start, color: "var(--ink-3)", dash: "3 3", label: "Start" }], h: 180, tfmt: kr,
      xfmt: function (x) { return new Date(x).toLocaleDateString("da-DK", { day: "numeric", month: "short" }); } });
  }
  function simSubmit() {
    var t = tk(), st = S.stocks[t.sid]; if (!st || !S.sim) return;
    var hs = E.halfSpread(st, S.macro), fx = fxOf(st.currency);
    var px0 = t.type === "limit" && +t.limit > 0 ? +t.limit : st.price * (t.side === "buy" ? 1 + hs : 1 - hs);
    var qty = t.mode === "amount" ? E.roundQty(st, (+t.amount || 0) / (px0 * fx)) : E.roundQty(st, +t.qty || 0);
    var r = E.simPlace(S.sim, S.stocks, S.macro, { sid: t.sid, side: t.side, qty: qty, type: t.type, limit: +t.limit, validTo: t.type === "limit" ? t.validTo : new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) }, new Date(), simSignal(t.sid));
    if (!r.ok) { toast(r.err); return; }
    saveSim(); S.simB = E.simBook(S.sim, S.stocks, S.macro);
    toast(r.filled ? "Udført: " + (t.side === "buy" ? "købt " : "solgt ") + fmtQty(r.order) + " " + st.ticker + " à " + px(r.order.fill.price, st.currency) : "Ordren afventer – udføres ved første nye kurs efter åbning.");
    t.qty = ""; t.amount = "";
    S.seg.simord = r.filled ? "done" : "open"; setSub("sim", "ordrer");
  }

  // ---------- data & compute ----------
  function isEmptyPf(p) { return !p || !((p.lots && p.lots.length) || (p.sales && p.sales.length) || (p.settings && p.settings.cash > 0) || p.exampleOff); }
  function activePf() { return S.example ? EXAMPLE : (S.pf || EMPTY); }
  function userSettings() {
    var st = (S.pf && S.pf.settings) || {}, u = {};
    ["kellyFraction", "maxWeight", "specificPremium", "analystWeight", "erp"].forEach(function (k) { if (fin(st[k])) u[k] = st[k]; });
    return u;
  }
  function compute() {
    if (!S.macro) return;
    var p = activePf();
    S.port = E.buildPortfolio(p.lots, p.sales, S.stocks, S.macro, { cash: +(p.settings && p.settings.cash) || 0 });
    var hyp = S.port.totalValue > 0 && !S.example ? null : { positions: {}, totalValue: 100000, cash: 100000 };
    S.hyp = !!hyp;
    var ctxPf = hyp || { positions: S.port.byStock, totalValue: S.port.totalValue, cash: S.port.cash };
    S.A = {};
    Object.keys(S.stocks).forEach(function (id) {
      try { S.A[id] = E.analyze(S.stocks[id], S.macro, userSettings(), { asOf: TODAY, portfolio: ctxPf }); }
      catch (e) { console.error("analyse", id, e); }
    });
    if (S.rules) S.tax = E.taxYear(S.port, S.stocks, S.rules, YEAR, { married: !!(p.settings && p.settings.married), fx: S.macro.fx, lossCarryForward: +p.lossCarry || 0 });
    simTick();
    S.alerts = buildAlerts();
  }
  function heldQty(id) { var h = S.port && S.port.byStock[id]; return !S.example && h ? h.qty : 0; }
  function trailingStop(id) {
    var st = S.stocks[id], a = S.A[id]; if (!st || !a || !S.port) return null;
    var first = null; S.port.positions.forEach(function (p) { if (p.stockId === id && (!first || p.firstDate < first)) first = p.firstDate; });
    if (!first) return null;
    var peak = 0;
    st.monthly.forEach(function (m) { if (m[0] >= first.slice(0, 7)) peak = Math.max(peak, m[1]); });
    st.daily.forEach(function (d) { if (d[0] >= first) peak = Math.max(peak, d[1]); });
    if (!peak) return null;
    return { peak: peak, stop: peak * Math.exp(-1.6448536 * a.sigma * Math.sqrt(0.25)) };
  }
  function buildAlerts() {
    var out = [];
    Object.keys(S.A).forEach(function (id) {
      var a = S.A[id], st = S.stocks[id], h = heldQty(id) > 0;
      if (a.price <= a.levels.buyBelow) out.push({ lvl: "mulighed", id: id, k: "Købszone", t: st.name + " er under købsgrænsen", d: "Kurs " + px(a.price, st.currency) + " mod købsgrænse " + px(a.levels.buyBelow, st.currency) + ". Potentiale " + spc(a.upside) + ", risiko for tab " + pc(a.risk.pLoss) + ".", pr: 1 });
      else if (a.rec.key === "koeb") out.push({ lvl: "mulighed", id: id, k: "Køb-signal", t: st.name, d: "Potentiale " + spc(a.upside) + ", risiko for tab " + pc(a.risk.pLoss) + " på 12 mdr.", pr: 2 });
      if (h) {
        if (a.rec.key === "saelg" || a.rec.key === "red") out.push({ lvl: "risiko", id: id, k: a.rec.label + "-signal", t: st.name + " – du ejer aktien", d: a.trade && a.trade.action === "sell" ? "Forslag: sælg " + a.trade.shares + " stk. (≈ " + kr(a.trade.amountDKK) + ")." : "Se begrundelsen.", pr: 0 });
        var ts = trailingStop(id);
        if (ts && a.price < ts.stop) out.push({ lvl: "risiko", id: id, k: "Risikostop", t: st.name + " er faldet " + pc(1 - a.price / ts.peak) + " fra toppen", d: "Kursen er under dit stop-niveau " + px(ts.stop, st.currency) + " – overvej at sælge eller reducere.", pr: 0 });
        if (a.price >= a.levels.sellAbove) out.push({ lvl: "mulighed", id: id, k: "Gevinst", t: "Overvej at tage gevinst i " + st.name, d: "Kursen er over salgsgrænsen " + px(a.levels.sellAbove, st.currency) + " (fair værdi + 15 %).", pr: 1 });
      }
      var rel = h || isFav(id) || a.rec.key === "koeb" || a.rec.key === "akk"; // with many stocks: only events for holdings, favourites and buy candidates
      if (rel && fin(a.ps.lastMove) && Math.abs(a.ps.lastMove) >= 0.05) out.push({ lvl: a.ps.lastMove < 0 ? "risiko" : "mulighed", id: id, k: "Stor bevægelse", t: st.name + " " + (a.ps.lastMove < 0 ? "faldt " : "steg ") + pc(Math.abs(a.ps.lastMove), 1), d: "Seneste handelsdag. Tjek nyhederne, før du handler.", pr: h ? 0 : 3 });
      (a.events || []).forEach(function (ev) {
        if (rel && ev.kind === "earnings" && ev.inDays <= 7 && ev.inDays >= -1) out.push({ lvl: "begivenhed", id: id, k: "Regnskab", t: st.name + (ev.inDays <= 0 ? " aflægger regnskab i dag" : " aflægger regnskab om " + ev.inDays + (ev.inDays === 1 ? " dag" : " dage")), d: "Typisk kursudsving på dagen ±" + pc(a.sigma / Math.sqrt(252) * 2.5, 0) + ". Handl efter regnskabet, ikke lige før.", pr: h ? 1 : 3 });
        if (ev.kind === "exdiv" && ev.inDays <= 5 && h) out.push({ lvl: "begivenhed", id: id, k: "Udbytte", t: st.name + " handles uden udbytte " + dk(ev.date), d: "Du skal eje aktien dagen før for at få udbyttet.", pr: 2 });
      });
    });
    S.prefs.alarms.forEach(function (al) {
      var st = S.stocks[al.stockId]; if (!st) return;
      var dist = st.price / al.price - 1;
      if (alarmHit(al, st)) out.push({ lvl: "alarm", id: al.stockId, k: "Kursalarm", t: st.name + (al.dir === "under" ? " er under " : " er over ") + px(al.price, st.currency), d: "Kurs nu " + px(st.price, st.currency) + " (" + dk(st.priceDate) + "). Slet eller flyt alarmen under Overvåg.", pr: 0 });
      else if (Math.abs(dist) <= 0.02) out.push({ lvl: "alarm", id: al.stockId, k: "Tæt på alarm", t: st.name + " er " + pc(Math.abs(dist), 1) + " fra din alarm", d: "Alarm ved " + px(al.price, st.currency) + " · kurs nu " + px(st.price, st.currency) + ".", pr: 2 });
    });
    if (S.tax && S.rules && !S.example) {
      var m = +TODAY.slice(5, 7);
      if (S.tax.due > 1000 && m >= 9) out.push({ lvl: "skat", tab: "tax", k: "Skat", t: "Forventet restskat " + kr(S.tax.due), d: "Ret forskudsopgørelsen eller indbetal frivilligt inden 31. december – så slipper du for rente.", pr: 1 });
      if (m >= 10 && S.tax.unrealizedLoss < -1000 && S.tax.gains > 0) out.push({ lvl: "skat", tab: "tax", k: "Skat", t: "Du kan modregne tab inden nytår", d: "Urealiserede tab " + kr(-S.tax.unrealizedLoss) + " mod realiserede gevinster " + kr(S.tax.gains) + ".", pr: 2 });
    }
    ((S.meta && S.meta.alerts) || []).forEach(function (al) {
      if (al.expires && al.expires < TODAY) return;
      out.push({ lvl: al.level || "begivenhed", id: al.stockId || null, tab: al.tab || null, k: al.kind || "Nyhed", t: al.title, d: al.text, pr: fin(al.priority) ? al.priority : 1, date: al.date });
    });
    out.sort(function (x, y) { return x.pr - y.pr; });
    return out;
  }

  // ---------- charts ----------
  function niceTicks(lo, hi, n) {
    var span = hi - lo; if (!(span > 0)) return [lo];
    var raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    var step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    var t = [], v = Math.ceil(lo / step) * step;
    for (; v <= hi + 1e-9; v += step) t.push(+v.toPrecision(12));
    return t;
  }
  function shortNum(v) { var a = Math.abs(v); if (a >= 1e6) return nf(v / 1e6, 1) + " mio"; if (a >= 10000) return nf(v / 1000, 0) + "k"; if (a >= 100) return nf(v, 0); return nf(v, a >= 10 ? 1 : 2); }
  function lineChart(el, cfg) {
    if (!el) return;
    var W = Math.max(280, Math.floor(el.clientWidth || 320)), H = cfg.h || 220, pl = 6, pr = 48, pt = 12, pb = 24;
    var xs = [], ys = [];
    cfg.series.forEach(function (s) { s.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    (cfg.areas || []).forEach(function (a) { a.lo.forEach(function (p) { ys.push(p[1]); }); a.hi.forEach(function (p) { ys.push(p[1]); }); });
    (cfg.hlines || []).forEach(function (h) { if (fin(h.y)) ys.push(h.y); });
    if (!xs.length) { el.innerHTML = '<div class="empty">Ingen data endnu</div>'; return; }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var pad = (y1 - y0) * 0.06 || Math.abs(y1) * 0.05 || 1; y0 -= pad; y1 += pad;
    var X = function (v) { return pl + (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0)) * (W - pl - pr); };
    var Y = function (v) { return pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb); };
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(cfg.label || "Graf") + '">';
    niceTicks(y0, y1, 4).forEach(function (t) { o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (W - pr + 6) + '" y="' + (Y(t) + 4) + '">' + esc((cfg.yfmt || shortNum)(t)) + "</text>"; });
    (cfg.xticks || []).forEach(function (t) { var xx = X(t[0]); if (xx < pl + 12 || xx > W - pr - 12) return; o += '<text x="' + xx + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(t[1]) + "</text>"; });
    (cfg.areas || []).forEach(function (a) {
      var d = a.hi.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("") + a.lo.slice().reverse().map(function (p) { return "L" + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("") + "Z";
      o += '<path d="' + d + '" fill="' + a.color + '" opacity="' + (a.op || 0.2) + '"/>';
    });
    (cfg.hlines || []).forEach(function (h) {
      if (!fin(h.y) || h.y < y0 || h.y > y1) return;
      o += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(h.y) + '" y2="' + Y(h.y) + '" stroke="' + h.color + '" stroke-width="1.5" stroke-dasharray="' + (h.dash || "4 4") + '"/>';
      if (h.label) o += '<text x="' + (pl + 4) + '" y="' + (Y(h.y) - 5) + '" style="fill:' + h.color + ';font-weight:500">' + esc(h.label) + "</text>";
    });
    cfg.series.forEach(function (s) {
      if (!s.pts.length) return;
      var d = s.pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("");
      if (s.area) o += '<path d="' + d + "L" + X(s.pts[s.pts.length - 1][0]).toFixed(1) + "," + (H - pb) + "L" + X(s.pts[0][0]).toFixed(1) + "," + (H - pb) + 'Z" fill="' + s.color + '" opacity="0.10"/>';
      o += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.w || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : "") + "/>";
      if (s.end !== false) { var lp = s.pts[s.pts.length - 1]; o += '<circle cx="' + X(lp[0]) + '" cy="' + Y(lp[1]) + '" r="4" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2"/>'; }
    });
    o += '<line class="xh" x1="0" x2="0" y1="' + pt + '" y2="' + (H - pb) + '" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/>';
    cfg.series.forEach(function (s, i) { o += '<circle class="xd" data-i="' + i + '" r="4.5" fill="' + s.color + '" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>'; });
    o += '<rect x="' + pl + '" y="0" width="' + (W - pl - pr) + '" height="' + H + '" fill="transparent"/></svg><div class="tip" hidden></div>';
    el.innerHTML = o;
    var svg = el.querySelector("svg"), tip = el.querySelector(".tip"), xh = el.querySelector(".xh"), dots = el.querySelectorAll(".xd");
    var main = cfg.series[0].pts;
    function move(ev) {
      var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * W / r.width;
      var best = 0, bd = Infinity;
      main.forEach(function (p, i) { var dd = Math.abs(X(p[0]) - sx); if (dd < bd) { bd = dd; best = i; } });
      var xv = main[best][0], cx = X(xv);
      xh.setAttribute("x1", cx); xh.setAttribute("x2", cx); xh.setAttribute("visibility", "visible");
      var lines = [esc((cfg.xfmt || String)(xv))];
      cfg.series.forEach(function (s, i) {
        var p = null; s.pts.forEach(function (q) { if (!p || Math.abs(q[0] - xv) < Math.abs(p[0] - xv)) p = q; });
        var dot = dots[i];
        if (p) { dot.setAttribute("cx", X(p[0])); dot.setAttribute("cy", Y(p[1])); dot.setAttribute("visibility", "visible"); lines.push(esc(s.name) + ": " + esc((cfg.tfmt || cfg.yfmt || shortNum)(p[1]))); }
        else dot.setAttribute("visibility", "hidden");
      });
      if (cfg.extra) lines = lines.concat(cfg.extra(xv));
      tip.innerHTML = lines.join("<br>"); tip.hidden = false;
      var left = cx / W * r.width; left = Math.max(80, Math.min(r.width - 80, left));
      tip.style.left = left + "px"; tip.style.top = (Y(main[best][1]) / H * r.height - 8) + "px";
    }
    function leave() { tip.hidden = true; xh.setAttribute("visibility", "hidden"); dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); }); }
    svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", leave);
  }
  function sparkline(vals, up) {
    if (!vals || vals.length < 2) return "";
    var W = 64, H = 30, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), sp = mx - mn || 1;
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + (i / (vals.length - 1) * (W - 4) + 2).toFixed(1) + "," + (H - 3 - (v - mn) / sp * (H - 6)).toFixed(1); }).join("");
    var c = up ? "var(--good)" : "var(--bad)";
    var ly = H - 3 - (vals[vals.length - 1] - mn) / sp * (H - 6);
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round"/><circle cx="' + (W - 2) + '" cy="' + ly + '" r="2.6" fill="' + c + '"/></svg>';
  }
  function donut(items) {
    var total = items.reduce(function (s, i) { return s + i.value; }, 0); if (!(total > 0)) return '<div class="empty">Ingen beholdning</div>';
    var R = 78, r = 50, cx = 90, cy = 90, a0 = -Math.PI / 2, o = '<svg viewBox="0 0 180 180" style="max-width:200px;width:100%;margin:0 auto;display:block" role="img" aria-label="Fordeling">';
    items.forEach(function (it) {
      var frac = it.value / total, a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0;
      if (frac >= 0.9999) { o += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" fill="none" stroke="' + it.color + '" stroke-width="' + (R - r) + '" data-act="pfsel" data-k="' + esc(it.key) + '" style="cursor:pointer"/>'; }
      else {
        var p = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(2) + "," + (cy + rad * Math.sin(a)).toFixed(2); };
        o += '<path d="M' + p(R, a0) + "A" + R + "," + R + " 0 " + large + " 1 " + p(R, a1) + "L" + p(r, a1) + "A" + r + "," + r + " 0 " + large + " 0 " + p(r, a0) + 'Z" fill="' + it.color + '" stroke="var(--surface)" stroke-width="2" data-act="pfsel" data-k="' + esc(it.key) + '" style="cursor:pointer"><title>' + esc(it.label + ": " + kr(it.value) + " (" + pc(frac) + ")") + "</title></path>";
      }
      a0 = a1;
    });
    o += '<text x="90" y="88" text-anchor="middle" style="font-family:var(--f-display);font-size:16px;font-weight:700;fill:var(--ink)">' + esc(kr(total).replace(" kr.", "")) + '</text><text x="90" y="106" text-anchor="middle" style="font-size:11px;fill:var(--ink-3)">kr. i alt</text></svg>';
    return o;
  }
  function ladder(a, st) {
    var cur = st.currency, P = a.price;
    var pts = [a.levels.stop, a.levels.buyBelow, a.low, P, a.fv, a.high, a.levels.sellAbove].filter(fin);
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    var W = 340, H = 140, L = 10, R = 330, y = 72;
    var X = function (v) { return L + (v - lo) / (hi - lo) * (R - L); };
    var o = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Kursstige: kurs, købsgrænse, fair værdi og salgsgrænse">';
    o += '<rect x="' + L + '" y="' + (y - 7) + '" width="' + Math.max(0, X(a.levels.buyBelow) - L) + '" height="14" rx="4" fill="var(--good-soft)"/>';
    o += '<rect x="' + X(a.levels.sellAbove) + '" y="' + (y - 7) + '" width="' + Math.max(0, R - X(a.levels.sellAbove)) + '" height="14" rx="4" fill="var(--bad-soft)"/>';
    o += '<rect x="' + X(a.low) + '" y="' + (y - 4) + '" width="' + Math.max(2, X(a.high) - X(a.low)) + '" height="8" rx="4" fill="var(--mark)" opacity=".35"/>';
    o += '<line x1="' + L + '" x2="' + R + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/>';
    var labels = [
      { v: a.levels.stop, t: "Stop", c: "var(--bad)", row: 1 },
      { v: a.levels.buyBelow, t: "Køb under", c: "var(--good)", row: 1 },
      { v: a.fv, t: "Fair værdi", c: "var(--mark)", row: -1 },
      { v: a.levels.sellAbove, t: "Sælg over", c: "var(--bad)", row: 1 },
      { v: P, t: "Kurs nu", c: "var(--ink)", row: -1, now: true }
    ];
    [-1, 1].forEach(function (row) {
      var ls = labels.filter(function (l) { return l.row === row && fin(l.v); }).sort(function (p, q) { return p.v - q.v; });
      var lastX = -1e9, lvl = 0;
      ls.forEach(function (l) { var xx = X(l.v); lvl = xx - lastX < 76 ? (lvl ? 0 : 1) : 0; l.lvl = lvl; lastX = xx; });
    });
    labels.forEach(function (l) {
      if (!fin(l.v)) return;
      var xx = X(l.v);
      if (l.now) o += '<path d="M' + (xx - 6) + "," + (y - 13) + "L" + (xx + 6) + "," + (y - 13) + "L" + xx + "," + (y - 3) + 'Z" fill="var(--ink)"/>';
      else o += '<line x1="' + xx + '" x2="' + xx + '" y1="' + (y - 9) + '" y2="' + (y + 9) + '" stroke="' + l.c + '" stroke-width="2"/>';
      var ty = l.row < 0 ? (y - 34 - l.lvl * 26) : (y + 25 + l.lvl * 26);
      var anchor = xx < 50 ? "start" : xx > R - 40 ? "end" : "middle";
      o += '<text x="' + xx + '" y="' + ty + '" text-anchor="' + anchor + '" style="font-family:var(--f-body);font-size:11px;fill:var(--ink-3)">' + esc(l.t) + '</text><text x="' + xx + '" y="' + (ty + 12) + '" text-anchor="' + anchor + '" style="font-family:var(--f-num);font-size:11.5px;font-weight:500;fill:' + l.c + '">' + esc(px(l.v, cur).replace(" kr.", "").replace(" " + cur, "")) + "</text>";
    });
    return o + "</svg>";
  }

  // ---------- sub-tabs ----------
  function subtabs(view, counts) {
    return '<div class="subtabs" role="tablist" aria-label="Underfaner">' + SUBS[view].map(function (x) {
      var on = S.sub[view] === x[0];
      return '<button type="button" role="tab" aria-selected="' + on + '" data-act="sub" data-view="' + view + '" data-v="' + x[0] + '">' + esc(x[1]) + (counts && counts[x[0]] ? '<span class="cnt">' + counts[x[0]] + "</span>" : "") + "</button>";
    }).join("") + "</div>";
  }
  function renderSubbar() {
    var counts = S.tab === "overview" ? { alerts: S.alerts.length } : null;
    $("subbar").innerHTML = subtabs(S.tab, counts);
    var on = $("subbar").querySelector('[aria-selected="true"]'); if (on && on.scrollIntoView) try { on.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
  }

  // ---------- overview ----------
  function renderStatus() {
    var m = S.meta || {}, el = $("status");
    if (S.dbState === "off") { el.innerHTML = '<span class="dot stale"></span>Data kan ikke hentes i denne visning'; return; }
    if (!m.updatedAt) { el.innerHTML = '<span class="dot stale"></span>Henter data…'; return; }
    var age = (Date.now() - new Date(m.updatedAt)) / 36e5;
    el.innerHTML = '<span class="dot' + (age > 30 ? " stale" : "") + '"></span><span class="lbl">Opdateret </span><b>' + esc(dkt(m.updatedAt).replace(" kl.", "")) + "</b>" + (m.nextRun ? '<span class="nx"><br>Næste: ' + esc(m.nextRun) + "</span>" : "");
  }
  function stockRows(ids) {
    return ids.map(function (id) {
      var st = S.stocks[id], a = S.A[id]; if (!a) return "";
      var spark = st.monthly.slice(-13).map(function (m) { return m[1]; });
      var mv = a.ps.lastMove;
      return '<button type="button" class="srow" data-act="open" data-id="' + id + '">' +
        '<span class="r1"><span class="nm">' + esc(st.name) + marks(id) + "</span>" + pill(a.rec) + "</span>" +
        '<span class="r2">' + esc(st.ticker) + " · " + esc(st.type) + (fin(mv) ? ' · i dag <span class="' + cls(mv) + '">' + esc(spc(mv, 1)) + "</span>" : "") + "</span>" +
        '<span class="r3"><span class="pxl">' + esc(px(a.price, st.currency)) + "</span>" +
        sparkline(spark, spark[spark.length - 1] >= spark[0]) + (st.model === "crypto" ? stat(spc(a.ps.ret1y), "1 år", cls(a.ps.ret1y)) : stat(spc(a.upside), "potentiale", cls(a.upside))) + stat(pc(a.risk.pLoss), "tab-risiko") + "</span></button>";
    }).join("");
  }
  function renderOverview() {
    var v = $("v-overview");
    if (!Object.keys(S.A).length) {
      v.innerHTML = '<div class="card"><div class="empty"><h2 style="margin-bottom:6px">Analysen indlæses</h2>' + (S.dbState === "off" ? "Denne visning har ikke adgang til databasen. Åbn siden i Claude for at se data." : "Kurser, nøgletal og nyheder hentes fra den automatisk opdaterede database.") + "</div></div>";
      return;
    }
    var sub = S.sub.overview, o = "";
    if (sub === "alerts") {
      var al = S.alerts, c = {};
      al.forEach(function (x) { c[x.lvl] = (c[x.lvl] || 0) + 1; });
      var items = [["alle", "Alle " + al.length]].concat([["mulighed", "Muligheder"], ["risiko", "Risici"], ["alarm", "Alarmer"], ["begivenhed", "Begivenheder"], ["skat", "Skat"]].filter(function (x) { return c[x[0]]; }).map(function (x) { return [x[0], x[1] + " " + c[x[0]]]; }));
      var lv = segv("alerts", items);
      var shown = al.filter(function (x) { return lv === "alle" || x.lvl === lv; });
      o += segs("alerts", items);
      o += '<div class="alerts">' + (shown.length ? shown.map(function (x) {
        return '<button type="button" class="alert ' + x.lvl + '" data-act="' + (x.id ? "open" : "tab") + '" data-id="' + esc(x.id || "") + '" data-tab="' + esc(x.tab || "") + '"><span class="stripe"></span><span style="min-width:0"><span class="k">' + esc(x.k || "") + '</span><span class="t">' + esc(x.t) + '</span><span class="d">' + esc(x.d || "") + '</span></span><span class="muted" aria-hidden="true">›</span></button>';
      }).join("") : '<div class="card"><div class="empty">Ingen signaler kræver handling lige nu.</div></div>') + "</div>";
      o += '<p class="disclaimer">Tryk på et punkt for at se analysen. Du får også en push-besked, når noget vigtigt ændrer sig.</p>';
    } else if (sub === "stocks") {
      var f = S.f, all = Object.keys(S.A), nCr = all.filter(isCrypto).length;
      var ids = all.filter(function (id) { return f.cls === "alle" || (f.cls === "krypto") === isCrypto(id); });
      var counts = { alle: ids.length }; ids.forEach(function (id) { var k = S.A[id].rec.key; counts[k] = (counts[k] || 0) + 1; });
      var list = filteredIds(); S.nav = list.slice();
      var views = [["liste", "Liste"], ["tabel", "Tabel"], ["kort", "Kort"], ["graf", "Graf"]];
      o += '<div class="filters">' + (nCr ? '<div class="seg clsseg" role="group" aria-label="Type">' + [["alle", "Alle", all.length], ["aktier", "Aktier", all.length - nCr], ["krypto", "Krypto", nCr]].map(function (c2) { return '<button type="button" data-act="cls" data-v="' + c2[0] + '" aria-pressed="' + (f.cls === c2[0]) + '">' + c2[1] + "<small>" + c2[2] + "</small></button>"; }).join("") + "</div>" : "") + '<div class="row"><div class="seg grow" role="group" aria-label="Visning">' + views.map(function (x) { return '<button type="button" data-act="view" data-v="' + x[0] + '" aria-pressed="' + (f.view === x[0]) + '">' + x[1] + "</button>"; }).join("") +
        '</div><select class="sel" id="sortSel" aria-label="Sortér"><option value="signal">Signal</option><option value="upside">Potentiale</option><option value="mu">Afkast</option><option value="risk">Risiko</option><option value="day">I dag</option><option value="name">Navn</option></select></div>' +
        '<div class="seg sigseg" role="group" aria-label="Signal">' + [["alle", "Alle"], ["koeb", "Køb"], ["akk", "Akk."], ["hold", "Hold"], ["red", "Red."], ["saelg", "Sælg"]].map(function (c2) {
          return '<button type="button" class="s-' + c2[0] + '" data-act="sig" data-v="' + c2[0] + '" aria-pressed="' + (f.sig === c2[0]) + '">' + c2[1] + "<small>" + (counts[c2[0]] || 0) + "</small></button>";
        }).join("") + '</div><div class="row nowrap"><div class="seg" role="group" aria-label="Marked">' + [["alle", "Alle"], ["dk", "DK"], ["int", "Udl."], ["mine", "Mine"], ["fav", "★"]].map(function (c2) {
          return '<button type="button" data-act="region" data-v="' + c2[0] + '" aria-pressed="' + (f.region === c2[0]) + '"' + (c2[0] === "fav" ? ' aria-label="Favoritter"' : "") + ">" + c2[1] + "</button>";
        }).join("") + '</div><input class="search" id="q" type="search" placeholder="Søg…" aria-label="Søg aktie eller sektor" value="' + esc(f.q) + '"></div></div>';
      o += '<div class="sec-title"><span class="tiny muted">' + list.length + " af " + ids.length + (f.cls === "krypto" ? " kryptovalutaer · " : f.cls === "aktier" ? " aktier · " : " værdipapirer · ") + (f.view === "graf" ? "tryk på en prik" : "tryk for analyse") + "</span></div>";
      if (!list.length) o += '<div class="card"><div class="empty">Intet matcher filtrene.</div></div>';
      else if (f.view === "tabel") o += '<div class="card tight">' + stockTable(list) + "</div>";
      else if (f.view === "kort") o += '<div class="card">' + heatmap(list) + "</div>";
      else if (f.view === "graf") o += '<div class="card">' + scatter(list) + "</div>";
      else o += '<div class="card" style="padding-block:2px"><div class="list">' + stockRows(list) + "</div></div>";
      o += '<p class="disclaimer">Signaler er modelberegninger ud fra offentlige data, ikke personlig investeringsrådgivning. Kurser kan være forsinkede.</p>';
    } else {
      o += watchView();
    }
    v.innerHTML = tidy(o); glossify(v);
    var ss = $("sortSel"); if (ss) ss.value = S.f.sort;
  }
  function filteredIds() {
    var f = S.f;
    var list = Object.keys(S.A).filter(function (id) {
      var st = S.stocks[id], a = S.A[id];
      if (f.sig !== "alle" && a.rec.key !== f.sig) return false;
      if (f.cls !== "alle" && (f.cls === "krypto") !== isCrypto(id)) return false;
      if (f.region === "dk" && st.country !== "DK") return false;
      if (f.region === "int" && (st.country === "DK" || isCrypto(id))) return false;
      if (f.region === "mine" && !(heldQty(id) > 0)) return false;
      if (f.region === "fav" && !isFav(id)) return false;
      if (f.q && (st.name + " " + st.ticker + " " + st.sector + " " + st.type).toLowerCase().indexOf(f.q.toLowerCase()) < 0) return false;
      return true;
    });
    var key = { signal: function (id) { return REC_ORDER[S.A[id].rec.key] * 10 - S.A[id].scores.comp; }, upside: function (id) { return -S.A[id].upside; }, mu: function (id) { return -S.A[id].mu; }, risk: function (id) { return S.A[id].risk.pLoss; }, day: function (id) { var mv = S.A[id].ps.lastMove; return fin(mv) ? -mv : 9; }, name: null }[f.sort];
    list.sort(function (x, y) {
      var r = key ? key(x) - key(y) : S.stocks[x].name.localeCompare(S.stocks[y].name, "da");
      if (!fin(r)) r = 0;
      return f.rev ? -r : r;
    });
    return list;
  }
  function stockTable(list) {
    var f = S.f, cols = [["name", "Aktie", ""], ["", "Kurs", "r"], ["day", "I dag %", "r"], ["upside", "Pot. %", "r"], ["risk", "Tab %", "r"], ["signal", "Signal", ""]];
    var num1 = function (x, d) { if (!fin(x)) return "–"; var r = +(x * 100).toFixed(d); return r === 0 ? "0" : (r > 0 ? "+" : "") + nf(r, d); };
    return '<table class="t st"><thead><tr>' + cols.map(function (c) {
      var on = c[0] && f.sort === c[0];
      return "<th" + (c[0] ? ' class="sort ' + c[2] + '" data-act="tsort" data-v="' + c[0] + '"' + (on ? ' aria-sort="' + (f.rev ? "ascending" : "descending") + '"' : "") : ' class="' + c[2] + '"') + ">" + c[1] + "</th>";
    }).join("") + "</tr></thead><tbody>" + list.map(function (id) {
      var st = S.stocks[id], a = S.A[id], mv = a.ps.lastMove;
      return '<tr class="click" data-act="open" data-id="' + id + '"><td><b>' + esc(st.ticker) + "</b>" + (isFav(id) ? '<span class="star">★</span>' : "") + "<small>" + esc(st.name) + (heldQty(id) > 0 ? " · ejer" : "") + '</small></td><td class="r num">' + esc(pxs(a.price)) + "<small>" + esc(curL(st.currency)) + '</small></td><td class="r num ' + cls(mv) + '">' + num1(mv, 1) + '</td><td class="r num ' + cls(a.upside) + '">' + num1(a.upside, 0) + '</td><td class="r num">' + nf(a.risk.pLoss * 100, 0) + '</td><td><span class="sdot ' + a.rec.key + '">' + SHORT[a.rec.key] + "</span></td></tr>";
    }).join("") + "</tbody></table>";
  }
  function heatmap(list) {
    var mode = S.f.color, modes = [["upside", "Potentiale"], ["day", "I dag"], ["y1", "1 år"], ["signal", "Signal"]];
    var lim = { upside: 0.4, day: 0.04, y1: 0.5, signal: 1 }[mode] || 0.4;
    var o = '<div class="seg segw" role="group" aria-label="Farve efter">' + modes.map(function (x) { return '<button type="button" data-act="color" data-v="' + x[0] + '" aria-pressed="' + (mode === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    o += '<div class="tiles">' + list.map(function (id) {
      var st = S.stocks[id], a = S.A[id], v, txt;
      if (mode === "day") { v = a.ps.lastMove; txt = fin(v) ? spc(v, 1) : "–"; }
      else if (mode === "y1") { v = a.ps.ret1y; txt = spc(v); }
      else if (mode === "signal") { v = { koeb: 1, akk: 0.55, hold: 0, red: -0.55, saelg: -1 }[a.rec.key]; txt = SHORT[a.rec.key]; }
      else { v = a.upside; txt = spc(v); }
      var t = fin(v) ? Math.max(-1, Math.min(1, v / lim)) : 0, strong = Math.abs(t) > 0.6;
      var bg = Math.abs(t) < 0.03 ? "var(--surface-2)" : "color-mix(in srgb, " + (t > 0 ? "var(--good)" : "var(--bad)") + " " + Math.round(10 + Math.abs(t) * 72) + "%, var(--surface))";
      return '<button type="button" class="tile" data-act="open" data-id="' + id + '" style="background:' + bg + (strong ? ";color:var(--tile-strong)" : "") + '" title="' + esc(st.name + " · " + a.rec.label + " · potentiale " + spc(a.upside)) + '"><b>' + esc(st.ticker) + "</b><span>" + esc(txt) + "</span>" + (isFav(id) ? "<i>★</i>" : heldQty(id) > 0 ? "<i>●</i>" : "") + "</button>";
    }).join("") + "</div>";
    o += '<p class="tiny muted" style="margin-top:8px">Grøn er positiv, rød negativ. Fuld farve ved ' + (mode === "signal" ? "Køb / Sælg" : "±" + pc(lim)) + ". ★ favorit · ● ejer.</p>";
    return o;
  }
  function scatter(list) {
    var ax = S.f.axes, axes = [["pot", "Potentiale / risiko"], ["mu", "Afkast / udsving"]];
    var o = '<div class="seg segw" role="group" aria-label="Akser">' + axes.map(function (x) { return '<button type="button" data-act="axes" data-v="' + x[0] + '" aria-pressed="' + (ax === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    var pts = list.map(function (id) { var a = S.A[id]; return { id: id, x: ax === "pot" ? a.risk.pLoss : a.sigma, y: ax === "pot" ? a.upside : a.mu, k: a.rec.key }; }).filter(function (p) { return fin(p.x) && fin(p.y); });
    if (!pts.length) return o + '<div class="empty">Ingen data</div>';
    var W = 340, H = 290, pl = 34, pr = 8, pt = 8, pb = 26;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return Math.max(-0.8, Math.min(1.2, p.y)); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys.concat([0])), y1 = Math.max.apply(null, ys.concat([0]));
    var px_ = (x1 - x0) * 0.08 || 0.05, py_ = (y1 - y0) * 0.08 || 0.05; x0 -= px_; x1 += px_; y0 -= py_; y1 += py_;
    var X = function (v) { return pl + (v - x0) / (x1 - x0) * (W - pl - pr); }, Y = function (v) { return pt + (1 - (Math.max(-0.8, Math.min(1.2, v)) - y0) / (y1 - y0)) * (H - pt - pb); };
    var col = { koeb: "var(--good)", akk: "var(--good)", hold: "var(--hold)", red: "var(--warn)", saelg: "var(--bad)" };
    var g = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(axes[ax === "pot" ? 0 : 1][1]) + '">';
    niceTicks(y0, y1, 5).forEach(function (t) { g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(t) + '" y2="' + Y(t) + '" stroke="var(--line)"/><text x="' + (pl - 4) + '" y="' + (Y(t) + 3) + '" text-anchor="end">' + Math.round(t * 100) + "%</text>"; });
    niceTicks(x0, x1, 5).forEach(function (t) { g += '<text x="' + X(t) + '" y="' + (H - 12) + '" text-anchor="middle">' + Math.round(t * 100) + "%</text>"; });
    var ref = ax === "pot" ? 0 : ((S.macro && S.macro.cash) || 0.025);
    g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(ref) + '" y2="' + Y(ref) + '" stroke="var(--ink-3)" stroke-dasharray="3 3"/>';
    g += '<text class="q" x="' + (W - pr) + '" y="' + (Y(ref) - 4) + '" text-anchor="end">' + (ax === "pot" ? "fair værdi" : "kontantrente") + "</text>";
    var ql = ax === "pot" ? ["Billig · lav risiko", "Billig · høj risiko", "Dyr · lav risiko", "Dyr · høj risiko"] : ["Højt afkast · roligt", "Højt afkast · vildt", "Lavt afkast · roligt", "Lavt afkast · vildt"];
    g += '<text class="q" x="' + (pl + 4) + '" y="' + (pt + 10) + '">' + ql[0] + '</text><text class="q" x="' + (W - pr - 2) + '" y="' + (pt + 10) + '" text-anchor="end">' + ql[1] + '</text><text class="q" x="' + (pl + 4) + '" y="' + (H - pb - 4) + '">' + ql[2] + '</text><text class="q" x="' + (W - pr - 2) + '" y="' + (H - pb - 4) + '" text-anchor="end">' + ql[3] + "</text>";
    g += '<text x="' + ((pl + W - pr) / 2) + '" y="' + (H - 1) + '" text-anchor="middle">' + (ax === "pot" ? "Risiko for tab om 12 mdr. →" : "Volatilitet pr. år →") + "</text>";
    // labels: favourites, holdings, selection and extremes first; skip labels that would overlap
    var placed = [], prio = pts.slice().sort(function (p, q) { var sp = function (z) { return (z.id === S.f.sel ? 100 : 0) + (isFav(z.id) ? 20 : 0) + (heldQty(z.id) > 0 ? 20 : 0) + Math.abs(z.y) * 10 + z.x * 3; }; return sp(q) - sp(p); });
    var labels = "";
    prio.forEach(function (p) {
      var st = S.stocks[p.id], w = st.ticker.length * 5.2 + 2, lx = X(p.x) + 6, ly = Y(p.y) + 3;
      if (lx + w > W - pr) lx = X(p.x) - 6 - w;
      var box = [lx, ly - 8, lx + w, ly + 2];
      var clash = placed.some(function (b) { return !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]); }) || pts.some(function (q) { var cx = X(q.x), cy = Y(q.y); return q !== p && cx > box[0] - 3 && cx < box[2] + 3 && cy > box[1] - 3 && cy < box[3] + 3; });
      if (clash) return;
      placed.push(box); labels += '<text class="lb" x="' + lx + '" y="' + ly + '">' + esc(st.ticker) + "</text>";
    });
    pts.forEach(function (p) {
      var on = p.id === S.f.sel;
      g += '<g class="pt" data-act="scsel" data-id="' + p.id + '"><circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="11" fill="transparent"/>' + (on ? '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="8" fill="none" stroke="var(--ink)" stroke-width="1.5"/>' : "") + '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (on ? 5.5 : 4.5) + '" fill="' + col[p.k] + '"' + (p.k === "akk" || p.k === "red" ? ' fill-opacity=".55"' : "") + ' stroke="var(--surface)" stroke-width="1.2"/></g>';
    });
    o += '<div class="scatter">' + g + labels + "</svg></div>";
    o += '<div class="legend"><span><i style="background:var(--good)"></i>Køb/Akk.</span><span><i style="background:var(--hold)"></i>Hold</span><span><i style="background:var(--warn)"></i>Reducér</span><span><i style="background:var(--bad)"></i>Sælg</span></div>';
    var sel = S.f.sel && S.A[S.f.sel] && list.indexOf(S.f.sel) >= 0 ? S.f.sel : null;
    if (sel) {
      var st = S.stocks[sel], a = S.A[sel];
      o += '<div class="selinfo"><div class="row" style="justify-content:space-between"><b>' + esc(st.name) + marks(sel) + "</b>" + pill(a.rec) + '</div><div class="row tiny" style="gap:12px">' + stat(spc(a.upside), "potentiale", cls(a.upside), true) + stat(pc(a.risk.pLoss), "tab-risiko", "", true) + stat(spc(a.mu, 1), "forv. afkast", "", true) + stat(pc(a.sigma), "udsving", "", true) + '</div><div class="row"><button type="button" class="btn sm" data-act="open" data-id="' + sel + '">Åbn analyse</button><button type="button" class="btn ghost sm" data-act="fav" data-id="' + sel + '">' + (isFav(sel) ? "★ Favorit" : "☆ Favorit") + '</button><button type="button" class="btn ghost sm" data-act="cmp" data-id="' + sel + '">' + (S.cmp.indexOf(sel) >= 0 ? "✓ Sammenlign" : "+ Sammenlign") + "</button></div></div>";
    } else o += '<p class="tiny muted" style="margin-top:6px">Tryk på en prik for at se aktien. Øverst til venstre er det mest attraktive hjørne.</p>';
    return o;
  }
  function watchView() {
    var al = S.prefs.alarms, fv = S.prefs.fav.filter(function (id) { return S.A[id]; });
    var items = [["alarmer", "Kursalarmer " + al.length], ["fav", "Favoritter " + fv.length], ["oensk", "Ønsk aktie"]], v = segv("watch", items), body;
    var ids = Object.keys(S.stocks).sort(function (x, y) { return S.stocks[x].name.localeCompare(S.stocks[y].name, "da"); });
    if (v === "fav") {
      body = fv.length ? '<div class="list">' + stockRows(fv) + '</div><div class="row" style="margin-top:10px"><button type="button" class="btn ghost sm" data-act="cmpfav"' + (fv.length < 2 ? " disabled" : "") + ">Sammenlign " + Math.min(3, fv.length) + " første</button></div>" : '<div class="empty">Tryk på ☆ øverst i en aktieanalyse for at følge aktien. Favoritter får besked om regnskaber og store kursudsving.</div>';
    } else if (v === "oensk") {
      var watch = (S.pf && S.pf.watch) || [];
      body = '<p class="small" style="margin-bottom:10px">Skriv navn eller ticker. Den automatiske opdatering henter kurser og regnskab, vælger den metode der passer til aktietypen og tilføjer aktien ved næste kørsel (hverdage kl. 8.41 og 17.41).</p><form class="row" id="watchForm"><input class="search" id="watchQ" placeholder="Fx Nestlé, Hermès eller Shopify" autocomplete="off"><button class="btn sm" type="submit">Tilføj</button></form>' +
        (watch.length ? '<div class="plist" style="margin-top:8px">' + watch.map(function (w) { return '<div class="tcard"><span><b>' + esc(w.q) + '</b><br><span class="m">Ønsket ' + esc(dk(w.date)) + '</span></span><span class="m">' + esc(w.status || "afventer") + "</span></div>"; }).join("") + "</div>" : "");
    } else {
      var rows = al.slice().sort(function (x, y) { var sx = S.stocks[x.stockId], sy = S.stocks[y.stockId]; return Math.abs(sx ? sx.price / x.price - 1 : 9) - Math.abs(sy ? sy.price / y.price - 1 : 9); });
      body = (rows.length ? '<div class="plist">' + rows.map(function (x) {
        var st = S.stocks[x.stockId]; if (!st) return "";
        var hit = alarmHit(x, st) || !!x.firedAt, dist = x.price / st.price - 1;
        return '<div class="tcard"><span><b data-act="open" data-id="' + x.stockId + '" style="cursor:pointer">' + esc(st.name) + '</b> <span class="m">' + (x.dir === "under" ? "under " : "over ") + esc(px(x.price, st.currency)) + '</span><br><span class="m">Kurs ' + esc(px(st.price, st.currency)) + " · " + (hit ? '<b class="' + (x.dir === "under" ? "down" : "up") + '">Udløst' + (x.firedAt ? " " + esc(dk(x.firedAt)) : "") + "</b>" : esc(pc(Math.abs(dist), 1)) + " " + (dist < 0 ? "nedenfor" : "ovenfor")) + '</span></span><button type="button" class="btn ghost sm" data-act="alarmdel" data-aid="' + esc(x.id) + '">Slet</button></div>';
      }).join("") + "</div>" : '<div class="empty">Ingen kursalarmer endnu. Sæt en her eller under Kurs i en aktieanalyse.</div>') +
        '<form class="alform" id="alarmForm2"><select id="alStock" aria-label="Aktie">' + ids.map(function (i) { return '<option value="' + i + '"' + (i === S.lastAlarmStock ? " selected" : "") + ">" + esc(S.stocks[i].name) + "</option>"; }).join("") + '</select><input id="alPrice2" type="number" min="0" step="any" inputmode="decimal" aria-label="Kurs" placeholder="Kurs"><button class="btn sm" type="submit">Sæt alarm</button></form><p class="tiny muted" style="margin-top:6px">Alarmen udløses, når kursen krydser niveauet. Du får push-besked ved næste automatiske opdatering og ser den under Opmærksomhed.</p>';
    }
    return '<div class="card">' + segs("watch", items) + body + "</div>";
  }

  // ---------- detail ----------
  var REFS = {
    dcf: [["Koller, Goedhart & Wessels: Valuation (McKinsey) – value driver-formlen", "https://www.mckinsey.com/capabilities/strategy-and-corporate-finance/our-insights/valuation-measuring-and-managing-the-value-of-companies"], ["Damodaran: Investment Valuation, DCF og implicit vækst", "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/background.html"], ["Chan, Karceski & Lakonishok (2003): The Level and Persistence of Growth Rates", "https://doi.org/10.1111/1540-6261.00540"]],
    ddm: [["Gordon (1962): The Investment, Financing and Valuation of the Corporation", "https://doi.org/10.2307/1926301"], ["Damodaran: Dividend Discount Models", "https://pages.stern.nyu.edu/~adamodar/pdfiles/valn2ed/ch13.pdf"]],
    rim: [["Ohlson (1995): Earnings, Book Values, and Dividends in Equity Valuation", "https://doi.org/10.1111/j.1911-3846.1995.tb00461.x"], ["Damodaran: Valuing Financial Service Firms", "https://pages.stern.nyu.edu/~adamodar/pdfiles/papers/finfirm09.pdf"]],
    epv: [["Greenwald m.fl. (2001): Value Investing – From Graham to Buffett and Beyond (EPV)", "https://www8.gsb.columbia.edu/valueinvesting/"], ["Damodaran: Valuing Cyclical and Commodity Companies", "https://pages.stern.nyu.edu/~adamodar/pdfiles/papers/cyclicals.pdf"]],
    rnpv: [["Stewart, Allison & Johnson (2001): Putting a price on biotechnology (rNPV)", "https://doi.org/10.1038/nbt0901-813"], ["Hay m.fl. (2014): Clinical development success rates for investigational drugs", "https://doi.org/10.1038/nbt.2786"]],
    common: [["Sharpe (1964): CAPM", "https://doi.org/10.1111/j.1540-6261.1964.tb02865.x"], ["Blume (1975): Betas and Their Regression Tendencies", "https://doi.org/10.1111/j.1540-6261.1975.tb01019.x"], ["Bates & Granger (1969): The Combination of Forecasts", "https://doi.org/10.1057/jors.1969.103"], ["Faber (2007): A Quantitative Approach to Tactical Asset Allocation (10-mdr. trend)", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=962461"], ["Jegadeesh & Titman (1993): Returns to Buying Winners and Selling Losers (momentum)", "https://doi.org/10.1111/j.1540-6261.1993.tb04702.x"], ["Piotroski (2000): Value Investing – F-score", "https://doi.org/10.2307/2672906"], ["Altman (1968): Z-score", "https://doi.org/10.1111/j.1540-6261.1968.tb00843.x"], ["Kelly (1956) og MacLean, Thorp & Ziemba (2010): The Kelly Capital Growth Investment Criterion", "https://doi.org/10.1142/7598"]]
  };
  function probTile(label, v, bar, x) { return '<div class="prob"><span class="small">' + label + '</span><span class="v">' + v + "</span>" + (bar ? '<div class="bar"><i style="width:' + Math.round(Math.min(1, Math.max(0, bar[1])) * 100) + "%;background:" + bar[0] + '"></i></div>' : "") + '<span class="x">' + x + "</span></div>"; }
  function sliderHTML(id, key, label, min, max, step, val, fmt, act) { return '<div class="sl"><label for="sl-' + key + '">' + label + ' <b id="slv-' + key + '">' + fmt(val) + '</b></label><input type="range" id="sl-' + key + '" data-act="' + (act || "slide") + '" data-id="' + id + '" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></div>'; }
  function fmtScore(x) { return (x > 0 ? "+" : "") + nf(x, 2); }

  function detailKonklusion(id, st, a) {
    var cur = st.currency, r = a.risk, t = a.trade, o = "";
    var verdictLine = {
      koeb: "Modellen ser aktien som billig med acceptabel risiko. Køb nu – helst efter et eventuelt regnskab.",
      akk: "Aktien ser attraktiv ud, men signalerne er ikke entydige. Køb gradvist i 2–3 portioner.",
      hold: "Ingen klar kant. Behold det, du ejer, og køb ikke mere nu.",
      red: "Risikoen eller prisen er for høj i forhold til potentialet. Skær ned.",
      saelg: "Modellen ser en dårlig kombination af pris, trend og risiko. Sælg positionen."
    }[a.rec.key];
    var cr = st.model === "crypto";
    if (cr) verdictLine = {
      koeb: "Trenden og timingen er stærkt positive. Køb en lille position – krypto har ingen fair værdi at falde tilbage på.",
      akk: "Trenden er positiv. Køb gradvist og kun med penge, du kan tåle at tabe.",
      hold: "Ingen klar trend. Behold det, du ejer, og køb ikke mere nu.",
      red: "Trenden er vendt nedad. Skær ned og tag noget af risikoen af bordet.",
      saelg: "Trend, timing og nyheder peger nedad. Sælg positionen."
    }[a.rec.key];
    o += '<div class="card verdict"><div class="row" style="justify-content:space-between"><span class="eyebrow">Konklusion</span>' + pill(a.rec, true) + '</div><p class="line">' + esc(verdictLine) + "</p>" + (a.guard ? '<p class="note">' + esc(a.guard) + "</p>" : "") +
      '<div class="trio">' + (cr ? '<div class="kpi"><div class="l">Seneste år</div><div class="v ' + cls(a.ps.ret1y) + '">' + esc(spc(a.ps.ret1y)) + '</div><div class="s">kursudvikling</div></div>' : '<div class="kpi"><div class="l">Potentiale</div><div class="v ' + cls(a.upside) + '">' + esc(spc(a.upside)) + '</div><div class="s">til fair værdi</div></div>') + '<div class="kpi"><div class="l">Forv. afkast</div><div class="v">' + esc(spc(a.mu, 0)) + '</div><div class="s">12 mdr.</div></div><div class="kpi"><div class="l">Tab-risiko</div><div class="v">' + esc(pc(r.pLoss)) + '</div><div class="s">12 mdr.</div></div></div>' +
      '<p class="small muted">Kurs ' + esc(px(a.price, cur)) + " pr. " + esc(dk(st.priceDate)) + (fin(a.ps.lastMove) ? ' · seneste dag <span class="' + cls(a.ps.lastMove) + '">' + esc(spc(a.ps.lastMove, 1)) + "</span>" : "") + ' · 1 år <span class="' + cls(a.ps.ret1y) + '">' + esc(spc(a.ps.ret1y)) + "</span></p></div>";
    var head = "Ingen handel", rows = [], notes = [];
    if (t) {
      if (t.action === "buy") {
        head = "Køb " + (cr ? nf(t.shares, t.shares < 1 ? 6 : 4) + " " + st.ticker : t.shares + " stk.");
        rows = [["Beløb", "≈ " + kr(t.amountDKK)], ["Limitkurs højst", px(fin(a.levels.sellAbove) ? Math.min(a.price * 1.005, a.levels.sellAbove) : a.price * 1.005, cur)], [cr ? "Gebyr (børs + veksling)" : "Kurtage (Nordnet)", "ca. " + kr(t.fee)], ["Andel af porteføljen", pc(t.currentWeight, 1) + " → " + pc(t.targetWeight, 1)]];
        if (S.hyp) notes.push("Beregnet for 100.000 kr. til rådighed. Angiv din egen kapital under Min profil → Indstillinger.");
      } else if (t.action === "sell") {
        head = "Sælg " + (cr ? nf(t.shares, t.shares < 1 ? 6 : 4) + " " + st.ticker : t.shares + " stk.");
        rows = [["Beløb", "≈ " + kr(t.amountDKK)], ["Du ejer", cr ? nf(t.heldQty, 6) : nf(t.heldQty) + " stk."], [cr ? "Gebyr (børs + veksling)" : "Kurtage (Nordnet)", "ca. " + kr(t.fee)]];
        if (S.tax && !S.example) S.port.positions.forEach(function (p) { if (p.stockId === id && p.account === "frit") { var q = Math.min(p.qty, t.shares); var tx = E.saleTax(p, q, t.priceDKK, S.tax, S.rules); rows.push(["Skat ved salg (frit depot)", "ca. " + kr(tx.tax)]); rows.push(["Gevinst ved salg", krs(tx.gain)]); } });
      } else {
        notes.push(t.note || (heldQty(id) > 0 ? "Behold din position på " + nf(heldQty(id)) + " stk." : "Afvent en bedre pris."));
        rows = cr ? [["Stop-niveau (3 mdr.)", px(a.levels.stop, cur)], ["Trendlinje (10 mdr. gns.)", px(a.levels.trendLine, cur)]] : [["Køb under", px(a.levels.buyBelow, cur)], ["Overvej salg over", px(a.levels.sellAbove, cur)]];
      }
      if (t.note && t.action !== "none") notes.push(t.note);
    }
    o += '<div class="card plan"><span class="eyebrow">Forslag</span><div class="head">' + esc(head) + '</div><dl>' + rows.map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("") + "</dl>" + notes.map(function (n) { return '<p class="note">' + esc(n) + "</p>"; }).join("") + '<p class="tiny muted">' + (cr ? "Kryptovaluta handles ikke direkte i Nordnet – kun via børshandlede produkter (ETP/ETN). Køb selv på en kryptobørs med en limitordre. Se begrundelsen under Hvorfor." : "Du handler selv i Nordnet med en limitordre. Se begrundelsen under Hvorfor.") + '</p><button type="button" class="btn ghost sm" data-act="simtrade" data-id="' + id + '" data-side="' + (t && t.action === "sell" ? "sell" : "buy") + '" data-qty="' + (t && t.shares > 0 ? t.shares : "") + '" style="justify-self:start">Prøv handlen i simulatoren</button></div>';
    var def = S.calc[id] || (t && t.action === "buy" && t.amountDKK > 0 ? Math.round(t.amountDKK / 500) * 500 : 10000);
    def = Math.max(1000, Math.min(200000, def));
    o += '<div class="card"><div class="card-h"><h3>Hvad hvis du køber?</h3><span class="tiny muted">12 mdr. frem</span></div><div class="sl"><label for="calcAmt">Beløb <b id="calcV">' + esc(kr(def)) + '</b></label><input type="range" id="calcAmt" data-id="' + id + '" min="1000" max="200000" step="500" value="' + def + '"></div><div id="calcOut"></div></div>';
    return o;
  }
  function calcUpdate(id) {
    var el = $("calcAmt"), out = $("calcOut"); if (!el || !out) return;
    var st = S.stocks[id], a = S.A[id], amt = +el.value; S.calc[id] = amt;
    var fx = fxOf(st.currency), pDKK = a.price * fx, cr = st.model === "crypto", n = cr ? Math.floor(amt / pDKK * 1e6) / 1e6 : Math.floor(amt / pDKK), r = a.risk;
    $("calcV").textContent = kr(amt);
    if (cr ? !(n > 0) : n < 1) { out.innerHTML = '<p class="small muted" style="margin-top:8px">Beløbet rækker ikke til én aktie (' + esc(kr(pDKK)) + ").</p>"; return; }
    var inv = n * pDKK, fee = E.fee(st, inv), lo = inv * (1 + r.q05), med = inv * (1 + r.q50), hi = inv * (1 + r.q95);
    var span = hi - lo, P = function (v) { return Math.max(0, Math.min(100, (v - lo) / span * 100)); };
    out.innerHTML = tidy('<div class="kpis" style="margin-top:10px"><div class="kpi"><div class="l">Du får</div><div class="v">' + (cr ? esc(nf(n, n < 1 ? 6 : 4)) + " " + esc(st.ticker) : nf(n) + " stk.") + '</div><div class="s">' + esc(kr(inv)) + (cr ? " + gebyr " : " + kurtage ") + esc(kr(fee)) + '</div></div><div class="kpi"><div class="l">Forventet gevinst</div><div class="v ' + cls(a.mu) + '">' + esc(krs(inv * a.mu)) + '</div><div class="s">risiko for tab ' + esc(pc(r.pLoss)) + "</div></div></div>" +
      '<div class="rbar" aria-hidden="true"><i style="left:0;right:0"></i>' + (inv > lo && inv < hi ? '<b style="left:' + P(inv) + '%"></b>' : "") + '<em style="left:' + P(med) + '%"></em></div><div class="row tiny" style="justify-content:space-between"><span>5 %: <b class="num">' + esc(kr(lo)) + '</b></span><span>Median <b class="num">' + esc(kr(med)) + '</b></span><span>95 %: <b class="num">' + esc(kr(hi)) + "</b></span></div>" +
      '<p class="tiny muted" style="margin-top:6px">90 % af udfaldene om et år ligger i intervallet. Stregen er dit indskud. I de værste 5 % af årene taber du i snit ' + esc(kr(inv * r.cvar95)) + "." + (fee / inv > 0.01 ? " Kurtagen er " + esc(pc(fee / inv, 1)) + " af beløbet – overvej at købe for mere ad gangen." : "") + "</p>");
  }
  function detailHvorfor(id, st, a) {
    var items = [["grunde", "Begrundelse"], ["score", "Delscorer"]], v = segv("hvorfor", items), body;
    if (v === "score") body = kvList([["Værdi (40 %)", fmtScore(a.scores.V), cls(a.scores.V)], ["Kvalitet (20 %)", fmtScore(a.scores.Q), cls(a.scores.Q)], ["Trend (20 %)", fmtScore(a.scores.M), cls(a.scores.M)], ["Timing (10 %)", fmtScore(a.scores.T), cls(a.scores.T)], ["Nyheder (10 %)", fmtScore(a.scores.N), cls(a.scores.N)], ["Samlet", fmtScore(a.scores.comp), cls(a.scores.comp)]]) + '<p class="small muted" style="margin-top:10px">Hver delscore går fra −1 til +1. Køb ≥ 0,30 · Akkumulér ≥ 0,12 · Hold ≥ −0,12 · Reducér ≥ −0,30 · ellers Sælg.</p>';
    else body = '<ul class="reasons">' + a.reasons.map(function (x) { return '<li><span class="sg ' + (x.sign > 0 ? "p" : x.sign < 0 ? "n" : "z") + '" aria-label="' + (x.sign > 0 ? "positivt" : x.sign < 0 ? "negativt" : "neutralt") + '">' + (x.sign > 0 ? "+" : x.sign < 0 ? "−" : "·") + "</span><span>" + esc(x.text) + "</span></li>"; }).join("") + "</ul>";
    return '<div class="card">' + segs("hvorfor", items) + body + "</div>";
  }
  function detailRisiko(id, st, a) {
    var r = a.risk, val = a.val, items = [["sand", "Procenter"], ["udfald", "Udfaldsrum"], ["beregn", "Formler"]], v = segv("risiko", items), body;
    if (v === "udfald") body = '<div class="chart" id="fan"></div><div class="legend"><span><i style="background:var(--accent)"></i>Median</span><span><i style="background:var(--accent);opacity:.35;height:8px"></i>50 % og 90 % af udfaldene</span><span><i class="dash" style="color:var(--mark)"></i>Fair værdi</span></div><p class="small" style="margin-top:10px">90 % af udfaldene om et år ligger mellem ' + esc(spc(r.q05)) + " og " + esc(spc(r.q95)) + ". Medianen er " + esc(spc(r.q50)) + ".</p>";
    else if (v === "beregn") body = '<div class="stack"><p class="small">Kursen modelleres som en geometrisk brownsk bevægelse (lognormal fordeling) med forventet afkast μ = ' + esc(pc(a.mu, 1)) + " og volatilitet σ = " + esc(pc(a.sigma)) + '. Volatiliteten vægter de seneste dages udsving og 5 års månedsdata ligeligt.</p><div class="formula">m = ln(1+μ) − σ²/2<br>P(tab) = Φ(−m/σ)<br>P(fald 20 %) = Φ((b−m)/σ) + e^(2mb/σ²)·Φ((b+m)/σ), b = ln 0,8</div><p class="small">Den sidste formel er refleksionsprincippet for brownsk bevægelse med drift. μ starter i CAPM-kravet (' + esc(pc(val.ce.capm, 1)) + ") og lukker " + esc(pc(1 - Math.pow(2, -1 / a.settings.halfLife), 0)) + " af afstanden til fair værdi pr. år (halveringstid " + a.settings.halfLife + " år), vægtet med modeltillid " + esc(pc(a.settings.confidence)) + ".</p></div>";
    else body = '<div class="pgrid">' +
      probTile("Risiko for tab om 12 mdr.", pc(r.pLoss), ["var(--bad)", r.pLoss], "Totalafkastet inkl. udbytte er negativt om et år.") +
      probTile("Fald på 20 % undervejs", pc(r.pDD20), ["var(--bad)", r.pDD20], "Kursen er på et tidspunkt 20 % under i dag.") +
      probTile("Chance for +20 %", pc(r.pGain20), ["var(--good)", r.pGain20], "Mindst 20 % gevinst om 12 mdr.") +
      probTile("Forventet afkast", spc(a.mu, 1), null, "Gennemsnit over 12 mdr. inkl. udbytte.") +
      probTile("Dårligste 5 % af årene", "−" + pc(r.cvar95), null, "Gennemsnitligt tab i de værste år (CVaR 95 %).") +
      probTile("Største fald på 5 år", spc(a.ps.maxDD5), null, "Fra top til bund i perioden.") + '</div><p class="small" style="margin-top:12px">Risikoniveau <b>' + esc(a.level.label) + "</b> (volatilitet " + pc(a.sigma) + " om året). 35–50 % risiko for tab over 12 mdr. er normalt for en enkeltaktie – spred derfor på flere.</p>";
    return '<div class="card">' + segs("risiko", items) + body + "</div>";
  }
  function detailKurs(id, st, a) {
    var o = card("Kursstige", '<div class="ladder">' + ladder(a, st) + '</div><p class="small muted" style="margin-top:8px">Købsgrænsen giver ' + pc(a.levels.mos) + " sikkerhedsmargin. Stop-niveauet svarer til et fald, der kun sker i 5 % af kvartalerne.</p>");
    o += card("Kursudvikling", '<div class="chart" id="pchart"></div><div class="legend"><span><i style="background:var(--ink)"></i>Kurs</span><span><i style="background:var(--s1)"></i>10-mdr. gns.</span><span><i class="dash" style="color:var(--mark)"></i>Fair værdi</span><span><i class="dash" style="color:var(--good)"></i>Køb under</span></div>',
      '<div class="seg" role="group" aria-label="Periode">' + [["3m", "3 mdr."], ["5y", "5 år"], ["10y", "10 år"]].map(function (x) { return '<button type="button" data-act="range" data-v="' + x[0] + '" aria-pressed="' + (S.range === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>");
    o += alarmCard(id, st, a);
    return o;
  }
  function alarmCard(id, st, a) {
    var cur = st.currency, als = alarmsFor(id);
    var quick = [["Købsgrænse", a.levels.buyBelow], ["Stop", a.levels.stop], ["−10 %", a.price * 0.9], ["+10 %", a.price * 1.1], ["Salgsgrænse", a.levels.sellAbove]].filter(function (x) { return fin(x[1]) && x[1] > 0; });
    var body = (als.length ? '<div class="plist">' + als.map(function (x) {
      var hit = alarmHit(x, st) || !!x.firedAt;
      return '<div class="tcard"><span>' + (x.dir === "under" ? "Falder under " : "Stiger over ") + '<b class="num">' + esc(px(x.price, cur)) + '</b><br><span class="m">' + (hit ? "Udløst" + (x.firedAt ? " " + esc(dk(x.firedAt)) : "") : esc(pc(Math.abs(x.price / a.price - 1), 1)) + " fra kursen") + '</span></span><button type="button" class="btn ghost sm" data-act="alarmdel" data-aid="' + esc(x.id) + '">Slet</button></div>';
    }).join("") + "</div>" : '<p class="small muted">Få besked, når kursen rammer et niveau – i appen og som push ved næste automatiske opdatering.</p>') +
      '<div class="qbtns">' + quick.map(function (q) { return '<button type="button" class="chip" data-act="alarmquick" data-id="' + id + '" data-p="' + q[1] + '">' + esc(q[0]) + ' <span class="num">' + esc(pxs(q[1])) + "</span></button>"; }).join("") + "</div>" +
      '<form class="row" id="alarmForm" data-id="' + id + '"><input class="search" id="alPrice" type="number" min="0" step="any" inputmode="decimal" placeholder="Egen kurs i ' + esc(curL(cur)) + '"><button class="btn sm" type="submit">Sæt alarm</button></form>';
    return card("Kursalarm", body, als.length ? '<span class="tiny muted">' + als.length + " aktiv" + (als.length > 1 ? "e" : "") + "</span>" : "");
  }
  function detailTal(id, st, a) {
    var f = st.fund, cur = st.currency, h = st.hist, e = st.est || {};
    if (st.model === "crypto") {
      var ci = [["pris", "Marked"], ["tek", "Teknisk"]], cv = segv("taltk", ci), cb;
      if (cv === "tek") cb = kvList([["Kurs mod 10-mdr. gns.", spc(a.price / a.ps.sma10 - 1, 1), cls(a.price / a.ps.sma10 - 1)], ["Momentum 12-1 mdr.", spc(a.ps.mom), cls(a.ps.mom)], ["RSI(14)", nf(a.ps.rsi, 0)], ["MACD", a.ps.macd ? (a.ps.macd.hist > 0 ? "peger op" : "peger ned") : "–"], ["Top (12 mdr.)", px(a.ps.hi52, cur)], ["Fra toppen", spc(a.ps.fromHigh), cls(a.ps.fromHigh)], ["Største fald i perioden", spc(a.ps.maxDD5)], ["Kurshistorik", st.monthly.length + " måneder"]]);
      else cb = kvList([["Markedsværdi", fin(f.marketCap) ? shortNum(f.marketCap / 1e9) + " mia. " + curL(cur) : "–"], ["Rang efter markedsværdi", st.rank ? "nr. " + st.rank : "–"], ["Seneste døgn", fin(st.chg24h) ? spc(st.chg24h, 1) : "–", cls(st.chg24h)], ["Seneste år", spc(a.ps.ret1y), cls(a.ps.ret1y)], ["Rekordkurs (ATH)", fin(st.ath) ? px(st.ath, cur) : "–"], ["Fra rekordkursen", fin(st.ath) ? spc(a.price / st.ath - 1) : "–", fin(st.ath) ? cls(a.price / st.ath - 1) : ""], ["Volatilitet (σ)", pc(a.sigma) + " om året"], ["Kategori", st.sector]]) + '<p class="tiny muted" style="margin-top:10px">Kryptovaluta har ingen regnskab, indtjening eller udbytte. Kurser i USD fra CoinPaprika og Yahoo Finance.</p>';
      return '<div class="card">' + segs("taltk", ci) + cb + "</div>";
    }
    var items = [["pris", "Pris"], ["kval", "Kvalitet"], ["tek", "Teknisk"], ["hist", "Historik"]], v = segv("tal", items), body;
    if (v === "kval") body = kvList([["ROE", pc(f.roe, 1)], ["ROIC", pc(f.roic, 1)], ["Driftsmargin", pc(f.operatingMargin, 1)], ["Nettokontant", fin(f.netCash) ? shortNum(f.netCash / 1e9) + " mia. " + curL(cur) : "–"], ["Gæld/egenkapital", nf(f.debtToEquity, 2)], ["Beta", nf(f.beta, 2)], ["Piotroski F-score", fin(f.piotroski) ? f.piotroski + " af 9" : "–"], ["Altman Z-score", nf(f.altmanZ, 2)]]) + '<p class="small muted" style="margin-top:10px">F-score 7–9 er stærk regnskabskvalitet. Z-score over 3 er sikker zone, under 1,8 er nødzone (gælder ikke banker og forsikring).</p>';
    else if (v === "tek") body = kvList([["Kurs mod 10-mdr. gns.", spc(a.price / a.ps.sma10 - 1, 1), cls(a.price / a.ps.sma10 - 1)], ["Momentum 12-1 mdr.", spc(a.ps.mom), cls(a.ps.mom)], ["RSI(14)", nf(a.ps.rsi, 0)], ["MACD", a.ps.macd && a.ps.macd.hist > 0 ? "peger op" : "peger ned"], ["52-ugers top", px(a.ps.hi52, cur)], ["Fra toppen", spc(a.ps.fromHigh), cls(a.ps.fromHigh)], ["Afkast 5 år p.a.", pc(a.ps.cagr5, 1)], ["Største fald 5 år", spc(a.ps.maxDD5)]]);
    else if (v === "hist") body = '<div class="tscroll"><table class="t"><thead><tr><th>År</th><th class="r">Omsætning</th><th class="r">EPS</th><th class="r">Udbytte</th><th class="r">Margin</th></tr></thead><tbody>' +
      h.years.map(function (y, i) { return "<tr><td>" + esc(y.replace("FY", "")) + '</td><td class="r num">' + (h.revenue && fin(h.revenue[i]) ? shortNum(h.revenue[i] / 1e9) + " mia." : "–") + '</td><td class="r num">' + nf(h.eps[i], 2) + '</td><td class="r num">' + (fin(h.dps[i]) ? nf(h.dps[i], 2) : "–") + '</td><td class="r num">' + (h.margin && fin(h.margin[i]) ? pc(h.margin[i], 1) : "–") + "</td></tr>"; }).join("") + '</tbody></table></div><p class="tiny muted" style="margin-top:8px">Beløb i ' + esc(curL(cur)) + ". TTM = seneste 12 måneder.</p>";
    else body = kvList([["Markedsværdi", fin(f.marketCap) ? shortNum(f.marketCap / 1e9) + " mia. " + curL(cur) : "–"], ["P/E", nf(f.pe, 1)], ["Forward P/E", nf(f.fwdPe, 1)], ["P/B", nf(f.pb, 2)], ["EV/EBITDA", nf(f.evEbitda, 1)], ["Udbytte pr. aktie", fin(f.dps) ? px(f.dps, cur) : "–"], ["Udbytteafkast", pc(f.divYield, 1)], ["Udbyttegrad", pc(f.payout)], ["Analytikernes kursmål", fin(e.target) ? px(e.target, cur) : "–"], ["Konsensus", e.consensus || "–"]]) + '<p class="tiny muted" style="margin-top:10px">Nøgletal pr. ' + esc(dk(f.statsDate)) + " (kurs dengang " + esc(px(f.statsPrice, cur)) + ").</p>";
    return '<div class="card">' + segs("tal", items) + body + "</div>";
  }
  function detailVaerdi(id, st, a) {
    if (st.model === "crypto") return '<div class="card"><h3 style="margin:0 0 8px">Ingen fair værdi</h3><p class="small">' + esc(a.val.why) + '</p><p class="small">Signalet bygger derfor kun på <b>trend</b> (kurs mod 10-måneders gennemsnit og 12-1-måneders momentum), <b>timing</b> (RSI og MACD) og <b>nyheder</b>. Positionsstørrelsen følger Kelly-formlen med forventet afkast lig den risikofri rente – det giver bevidst meget små positioner.</p><p class="small muted">Skat i Danmark: gevinst på krypto er personlig indkomst (ca. 37–53 %), tab kan trækkes fra med ca. 26 %. Opgøres efter FIFO.</p></div>';
    var v = a.val, f = st.fund, cur = st.currency, ovr = S.ov[id] || {}, b = a.blend;
    var items = [["fair", "Fair værdi"], ["ant", "Input"], ["selv", "Beregn"], ["metode", "Metode"]], sv = segv("vaerdi", items), body;
    if (sv === "ant") {
      var inputs = [];
      if (st.model === "dcf") inputs = [["Startindtjening E₁", px(v.E1, cur)], ["Kilde", v.E1src], ["ROIC brugt til geninvestering", pc(v.roe)], ["Vækst de første år", pc(v.g1, 1)], ["Historisk omsætningsvækst", pc(v.growth.gRev, 1)], ["Analytikernes vækst næste år", fin(v.growth.gAn) ? pc(v.growth.gAn, 1) : "–"]];
      if (st.model === "ddm") inputs = [["Udbytte pr. aktie D₀", px(v.D0, cur)], ["Vækst de første år", pc(v.g1, 1)], ["Bæredygtig vækst", pc(v.growth.gSustain, 1)], ["Historisk udbyttevækst", pc(v.growth.gDps, 1)]];
      if (st.model === "rim") inputs = [["Egenkapital pr. aktie B₀", px(f.bvps, cur)], ["ROE nu", pc(f.roe, 1)], ["Udbyttegrad inkl. tilbagekøb", pc(f.payout)]];
      if (st.model === "rnpv") inputs = [["Analytikernes kursmål", fin(st.est.target) ? px(st.est.target, cur) : "–"], ["Korrektion for optimisme", "−10 %"], ["Usikkerhed (σ) i værdien", "mindst 30 %"], ["Modeltillid i forventet afkast", "halveret"], ["Maks. vægt i porteføljen", "halveret"]];
      if (st.model === "epv") inputs = [["Median nettomargin (5 år)", pc(v.epv.histMedian, 1)], ["Margin seneste 12 mdr.", pc(v.epv.ttmMargin, 1)], ["Forventet margin", pc(v.epv.fwdMargin, 1)], ["Normaliseret EPS", px(v.epv.Enorm, cur)]];
      inputs = inputs.concat([["Risikofri rente", pc(v.ce.rf, 2)], ["Beta (justeret)", nf(v.ce.bUsed, 2)], ["Aktiepræmie (ERP)", pc(a.settings.erp, 1)]]);
      if (v.ce.cyc) inputs.push(["Cyklisk tillæg", pc(v.ce.cyc, 1)]);
      if (a.settings.specificPremium) inputs.push(["Dit sikkerhedstillæg", pc(a.settings.specificPremium, 1)]);
      inputs.push(["Afkastkrav r", pc(v.r, 2)], ["Evig vækst", pc(v.gT, 1)]);
      body = kvList(inputs);
    } else if (sv === "selv") {
      var sl = "";
      if (st.model === "rnpv") { body = '<p class="small">Der er ingen stabil indtjening at regne på, så der er ingen modelparametre at justere. Værdien følger analytikernes kursmål – brug Metode for at se, hvordan det håndteres.</p>'; return '<div class="card">' + segs("vaerdi", items) + body + "</div>"; }
      if (st.model === "dcf" || st.model === "ddm") sl += sliderHTML(id, "g1", "Vækst de første år", -0.05, 0.25, 0.005, fin(ovr.g1) ? ovr.g1 : v.g1, function (x) { return pc(x, 1); });
      if (st.model === "rim") sl += sliderHTML(id, "roe", "Egenkapitalforrentning (ROE)", 0.02, 0.30, 0.005, fin(ovr.roe) ? ovr.roe : v.roe, function (x) { return pc(x, 1); });
      if (st.model === "epv") sl += sliderHTML(id, "margin", "Normaliseret nettomargin", 0.01, 0.30, 0.0025, fin(ovr.margin) ? ovr.margin : v.normMargin, function (x) { return pc(x, 1); });
      sl += sliderHTML(id, "r", "Afkastkrav", 0.04, 0.16, 0.0025, fin(ovr.r) ? ovr.r : v.r, function (x) { return pc(x, 1); });
      sl += sliderHTML(id, "gT", "Vækst i al evighed", 0, 0.05, 0.0025, fin(ovr.gT) ? ovr.gT : v.gT, function (x) { return pc(x, 1); });
      body = '<div class="sliders">' + sl + '</div><div class="result-strip" style="margin-top:14px"><span class="small">Modelværdi</span><b id="ovres">–</b><span class="small" id="ovup"></span><button type="button" class="btn ghost sm" data-act="ovreset" data-id="' + id + '" style="margin-left:auto">Nulstil</button></div><p class="tiny muted" style="margin-top:8px">Ændrer kun beregningen her – ikke signalet.</p>';
    } else if (sv === "metode") {
      var formula = { dcf: "V₀ = Σ Eₜ·(1 − gₜ/ROIC) / (1+r)ᵗ<br>+ E₁₀·(1+g∞)·(1 − g∞/ROIC∞) / (r − g∞) / (1+r)¹⁰", ddm: "V₀ = Σ Dₜ / (1+r)ᵗ<br>+ D₁₀·(1+g∞) / (r − g∞) / (1+r)¹⁰", rim: "V₀ = B₀ + Σ (ROEₜ − r)·Bₜ₋₁ / (1+r)ᵗ<br>+ RI∞ / (r − g∞) / (1+r)¹⁰", epv: "V₀ = max( E_norm / r ,<br>E_norm·(1 − g∞/ROE_norm) / (r − g∞) )", rnpv: "V₀ = Σ pᵢ · NPVᵢ (sandsynlighedsvægtet pr. lægemiddel)<br>Her: V₀ ≈ analytikernes kursmål / 1,10" }[st.model];
      body = '<div class="stack"><span class="pill hold" style="font-weight:600;justify-self:start">' + esc(v.methodShort + " · " + st.type) + '</span><p class="small"><b>' + esc(v.method) + ".</b> " + esc(v.why) + '</p><div class="formula">' + formula + "</div></div>";
    } else {
      body = kvList([["Modelværdi", b && b.analystOnly ? "Ingen egen model (se Metode)" : px(a.fvModel, cur)]].concat(b && b.analystAdj ? [["Analytikernes kursmål", px(b.analyst, cur)], ["Kursmål −10 % (historisk optimisme)", px(b.analystAdj, cur)], ["Vægt model / analytikere", pc(b.wModel) + " / " + pc(1 - b.wModel)]] : []).concat([["Samlet fair værdi", px(a.fv, cur)], ["90 %-interval", px(a.low, cur) + " – " + px(a.high, cur)], ["Potentiale", spc(a.upside), cls(a.upside)]])) + '<p class="small" style="margin-top:12px">' + esc(a.reasons.filter(function (x) { return x.kind === "implied"; }).map(function (x) { return x.text; }).join(" ")) + "</p>";
    }
    return '<div class="card">' + segs("vaerdi", items) + body + "</div>";
  }
  function detailNyheder(id, st, a) {
    var news = (st.news || []).slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    var items = [["nyt", "Nyheder " + news.length], ["bgv", "Begivenheder"], ["kilder", "Kilder"]], v = segv("nyheder", items), body;
    if (v === "bgv") body = a.events.length ? kvList(a.events.map(function (e) { return [e.text, dk(e.date) + (e.inDays === 0 ? " (i dag)" : e.inDays > 0 ? " (om " + e.inDays + " d.)" : "")]; })) + '<p class="small muted" style="margin-top:10px">Omkring regnskaber svinger kursen typisk mere end normalt. Handl helst efter.</p>' : '<div class="empty">Ingen kendte begivenheder de næste 45 dage.</div>';
    else if (v === "kilder") body = '<p class="small muted" style="margin-bottom:6px">Data</p><ul class="refs">' + st.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + "</a></li>"; }).join("") + (S.macro && S.macro.sources ? S.macro.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + "</a></li>"; }).join("") : "") + '</ul><p class="small muted" style="margin:12px 0 6px">Metode</p><ul class="refs">' + REFS[st.model].concat(REFS.common).map(function (x) { return '<li><a href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + esc(x[0]) + "</a></li>"; }).join("") + "</ul>";
    else body = '<div class="news">' + (news.length ? news.map(function (n) { var sg = n.impact > 0 ? "p" : n.impact < 0 ? "n" : "z"; return '<div class="nitem"><span class="sg ' + sg + '">' + (n.impact > 0 ? "+" : n.impact < 0 ? "−" : "·") + "</span><div>" + esc(n.title) + '<div class="when">' + esc(dk(n.date)) + " · " + esc(n.src || "") + "</div></div></div>"; }).join("") : '<div class="empty">Ingen nyheder registreret.</div>') + '</div><p class="tiny muted" style="margin-top:12px">+ / − er Claudes vurdering af nyhedens effekt på kursen. Nyheder fra de seneste 60 dage tæller 10 % i signalet.</p>';
    return '<div class="card">' + segs("nyheder", items) + body + "</div>";
  }
  function navList() { var n = S.nav.filter(function (x) { return S.A[x]; }); if (n.indexOf(S.detail) < 0) n = Object.keys(S.A).sort(function (x, y) { return S.stocks[x].name.localeCompare(S.stocks[y].name, "da"); }); return n; }
  function navStep(d) { var n = navList(), i = n.indexOf(S.detail); if (i < 0 || n.length < 2) return; openDetail(n[(i + d + n.length) % n.length], true); }
  function renderDetail(keepScroll) {
    var sh = $("sheet");
    if (S.cmpOpen) { renderCompare(keepScroll); renderCmpbar(); return; }
    var id = S.detail;
    if (!id || !S.A[id]) { sh.hidden = true; document.body.style.overflow = ""; renderCmpbar(); return; }
    var st = S.stocks[id], a = S.A[id], sub = S.sub.detail, top = sh.scrollTop, mv = a.ps.lastMove;
    sh.hidden = false; document.body.style.overflow = "hidden";
    var fav = isFav(id), inCmp = S.cmp.indexOf(id) >= 0, nAl = alarmsFor(id).length;
    var o = '<div class="sheet-top"><div class="wrap"><button type="button" class="iconbtn" data-act="close" aria-label="Tilbage">' + ICON.back + '</button><div class="ttl"><b>' + esc(st.name) + '</b><span class="tl2"><span class="num">' + esc(px(a.price, st.currency)) + "</span>" + (fin(mv) ? ' <span class="' + cls(mv) + '">' + esc(spc(mv, 1)) + "</span>" : "") + " " + pill(a.rec) + '</span></div><div class="hbtns"><button type="button" class="iconbtn" data-act="fav" data-id="' + id + '" aria-pressed="' + fav + '" aria-label="' + (fav ? "Fjern fra favoritter" : "Tilføj til favoritter") + '">' + (fav ? ICON.starOn : ICON.star) + '</button><button type="button" class="iconbtn" data-act="cmp" data-id="' + id + '" aria-pressed="' + inCmp + '" aria-label="Sammenlign">' + ICON.cmp + '</button><button type="button" class="iconbtn" data-act="goalarm" aria-label="Kursalarm"' + (nAl ? ' aria-pressed="true"' : "") + ">" + ICON.bell + "</button></div>" + subtabs("detail") + '</div></div><div class="wrap body">';
    var fns = { hvorfor: detailHvorfor, risiko: detailRisiko, kurs: detailKurs, tal: detailTal, vaerdi: detailVaerdi, nyheder: detailNyheder };
    o += (fns[sub] || detailKonklusion)(id, st, a);
    var nav = navList(), ni = nav.indexOf(id);
    if (nav.length > 1) {
      var pv = S.stocks[nav[(ni - 1 + nav.length) % nav.length]], nx = S.stocks[nav[(ni + 1) % nav.length]];
      o += '<div class="navrow"><button type="button" class="btn ghost sm" data-act="nav" data-v="-1">‹ ' + esc(pv.ticker) + '</button><span class="tiny muted">' + (ni + 1) + " af " + nav.length + ' · swipe</span><button type="button" class="btn ghost sm" data-act="nav" data-v="1">' + esc(nx.ticker) + " ›</button></div>";
    }
    o += '<p class="disclaimer">' + esc(st.ticker + " · " + (st.model === "crypto" ? "kryptovaluta · " + st.sector : st.exchange + " · " + st.type)) + (st.model === "crypto" ? ". Modelberegning – ikke personlig investeringsrådgivning. Krypto er ureguleret og kan tabe det meste af sin værdi.</p></div>" : ". Modelberegning – ikke personlig investeringsrådgivning. Handl selv i Nordnet.</p></div>");
    sh.innerHTML = tidy(o); glossify(sh);
    if (keepScroll) sh.scrollTop = top;
    if (sub === "kurs") drawPriceChart();
    if (sub === "risiko" && S.seg.risiko === "udfald") drawFan();
    if (sub === "vaerdi" && S.seg.vaerdi === "selv") updateOverride(id);
    if (sub === "konklusion" || !fns[sub]) calcUpdate(id);
    renderCmpbar();
  }
  // ---------- compare ----------
  function toggleCmp(id) {
    var i = S.cmp.indexOf(id);
    if (i >= 0) S.cmp.splice(i, 1);
    else if (S.cmp.length >= 3) { toast("Du kan sammenligne højst 3 – fjern en først."); return; }
    else S.cmp.push(id);
    store("kv-cmp", JSON.stringify(S.cmp));
    toast(i >= 0 ? "Fjernet fra sammenligning" : "Tilføjet til sammenligning (" + S.cmp.length + "/3)");
  }
  function renderCmpbar() {
    var el = $("cmpbar"); if (!el) return;
    var ids = S.cmp.filter(function (x) { return S.stocks[x]; });
    var show = ids.length && !S.detail && !S.cmpOpen && S.tab === "overview";
    document.body.classList.toggle("has-cmp", !!show);
    if (!show) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<div class="in">' + ids.map(function (x) { return '<button type="button" class="ck" data-act="cmpdel" data-id="' + x + '">' + esc(S.stocks[x].ticker) + " ✕</button>"; }).join("") + '<button type="button" class="go" data-act="cmpopen"' + (ids.length < 2 ? " disabled" : "") + ">" + (ids.length < 2 ? "Vælg 1 mere" : "Sammenlign " + ids.length) + "</button></div>";
  }
  function renderCompare(keepScroll) {
    var sh = $("sheet"), top = sh.scrollTop, ids = S.cmp.filter(function (x) { return S.A[x]; });
    if (ids.length < 2) { S.cmpOpen = false; renderDetail(); return; }
    sh.hidden = false; document.body.style.overflow = "hidden";
    var rows = [
      ["Signal", function (a) { return '<span class="sdot ' + a.rec.key + '">' + SHORT[a.rec.key] + "</span>"; }],
      ["Kurs", function (a, st) { return esc(pxs(a.price)) + '<small> ' + esc(curL(st.currency)) + "</small>"; }],
      ["Potentiale", function (a) { return a.upside; }, 1, spc],
      ["Forv. afkast 12 mdr.", function (a) { return a.mu; }, 1, function (x) { return spc(x, 1); }],
      ["Tab-risiko 12 mdr.", function (a) { return a.risk.pLoss; }, -1, pc],
      ["Fald 20 % undervejs", function (a) { return a.risk.pDD20; }, -1, pc],
      ["Udsving (σ)", function (a) { return a.sigma; }, -1, pc],
      ["Samlet score", function (a) { return a.scores.comp; }, 1, fmtScore],
      ["Forward P/E", function (a, st) { return st.fund.fwdPe > 0 ? st.fund.fwdPe : NaN; }, -1, function (x) { return nf(x, 1); }],
      ["Udbytteafkast", function (a, st) { return st.fund.divYield; }, 1, function (x) { return pc(x, 1); }],
      ["ROE", function (a, st) { return st.fund.roe; }, 1, function (x) { return pc(x); }],
      ["F-score", function (a, st) { return st.fund.piotroski; }, 1, function (x) { return nf(x); }],
      ["1 år", function (a) { return a.ps.ret1y; }, 1, spc],
      ["5 år p.a.", function (a) { return a.ps.cagr5; }, 1, function (x) { return pc(x, 1); }],
      ["Metode", function (a) { return esc(a.val.methodShort || ""); }],
      ["Sektor", function (a, st) { return esc(st.sector); }]
    ];
    var o = '<div class="sheet-top"><div class="wrap"><button type="button" class="iconbtn" data-act="cmpclose" aria-label="Tilbage">' + ICON.back + '</button><div class="ttl"><b>Sammenlign</b><span class="tl2 tiny muted">' + ids.map(function (x) { return esc(S.stocks[x].ticker); }).join(" · ") + '</span></div><div class="hbtns"><button type="button" class="btn ghost sm" data-act="cmpclear">Ryd</button></div></div></div><div class="wrap body">';
    o += card("Kursudvikling (start = 100)", '<div class="chart" id="cchart"></div><div class="legend">' + ids.map(function (x, k) { return '<span><i style="background:' + SLOTS[k] + '"></i>' + esc(S.stocks[x].ticker) + "</span>"; }).join("") + "</div>",
      '<div class="seg" role="group" aria-label="Periode">' + [["3m", "3 mdr."], ["1y", "1 år"], ["5y", "5 år"]].map(function (x) { return '<button type="button" data-act="cmprange" data-v="' + x[0] + '" aria-pressed="' + (S.cmpRange === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>");
    var t = '<table class="t cmp"><thead><tr><th></th>' + ids.map(function (x, k) { return '<th class="r"><span class="sw" style="background:' + SLOTS[k] + '"></span>' + esc(S.stocks[x].ticker) + ' <button type="button" class="xbtn" data-act="cmpdel" data-id="' + x + '" aria-label="Fjern">✕</button></th>'; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) {
      var vals = ids.map(function (x) { return r[1](S.A[x], S.stocks[x]); }), best = null;
      if (r[2]) { var nums = vals.filter(fin); if (nums.length > 1) best = r[2] > 0 ? Math.max.apply(null, nums) : Math.min.apply(null, nums); }
      t += "<tr><td>" + esc(r[0]) + "</td>" + vals.map(function (v) { return '<td class="r' + (r[3] ? " num" : "") + (best !== null && v === best ? " best" : "") + '">' + (r[3] ? (fin(v) ? esc(r[3](v)) : "–") : v) + "</td>"; }).join("") + "</tr>";
    });
    t += "</tbody></table>";
    o += card("Nøgletal", t + '<p class="tiny muted" style="margin-top:8px">Grøn markerer den bedste værdi i rækken. Tryk på en aktie nedenfor for hele analysen.</p><div class="row" style="margin-top:8px">' + ids.map(function (x) { return '<button type="button" class="btn ghost sm" data-act="open" data-id="' + x + '">' + esc(S.stocks[x].name) + " ›</button>"; }).join("") + "</div>");
    o += '<p class="disclaimer">Modelberegning – ikke personlig investeringsrådgivning.</p></div>';
    sh.innerHTML = tidy(o); glossify(sh);
    if (keepScroll) sh.scrollTop = top;
    drawCmpChart(ids);
  }
  function drawCmpChart(ids) {
    var el = $("cchart"); if (!el) return;
    var series = ids.map(function (x, k) {
      var st = S.stocks[x], raw;
      if (S.cmpRange === "3m") raw = st.daily.map(function (d) { return [new Date(d[0] + "T12:00:00").getTime(), d[1]]; });
      else raw = st.monthly.slice(S.cmpRange === "1y" ? -13 : -61).map(function (m) { return [new Date(m[0] + "-15T12:00:00").getTime(), m[1]]; });
      var b = raw.length ? raw[0][1] : 1;
      return { name: st.ticker, color: SLOTS[k], pts: raw.map(function (p) { return [p[0], p[1] / b * 100]; }), w: 1.8 };
    });
    var xt = [], f0 = series[0].pts;
    if (S.cmpRange === "3m") f0.forEach(function (p, i) { if (i % 15 === 0) xt.push([p[0], new Date(p[0]).toLocaleDateString("da-DK", { day: "numeric", month: "short" })]); });
    else f0.forEach(function (p) { var d = new Date(p[0]); if (S.cmpRange === "1y" ? d.getMonth() % 3 === 0 : d.getMonth() === 0) xt.push([p[0], S.cmpRange === "1y" ? d.toLocaleDateString("da-DK", { month: "short" }) : String(d.getFullYear())]); });
    lineChart(el, { label: "Kursudvikling indekseret til 100", series: series, xticks: xt, h: 200, yfmt: function (v) { return nf(v, 0); }, tfmt: function (v) { return nf(v, 0) + " (" + spc(v / 100 - 1) + ")"; },
      xfmt: function (x) { return new Date(x).toLocaleDateString("da-DK", S.cmpRange === "3m" ? { day: "numeric", month: "short" } : { month: "short", year: "numeric" }); }, hlines: [{ y: 100, color: "var(--ink-3)", dash: "2 3" }] });
  }
  function drawPriceChart() {
    var id = S.detail, st = S.stocks[id], a = S.A[id], el = $("pchart"); if (!el) return;
    var pts, xt = [], xfmt;
    if (S.range === "3m") {
      pts = st.daily.map(function (d) { return [new Date(d[0] + "T12:00:00").getTime(), d[1]]; });
      xfmt = function (x) { return new Date(x).toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" }); };
      pts.forEach(function (p, i) { if (i % 15 === 0) xt.push([p[0], new Date(p[0]).toLocaleDateString("da-DK", { day: "numeric", month: "short" })]); });
    } else {
      var n = S.range === "5y" ? 61 : 121;
      pts = st.monthly.slice(-n).map(function (m) { return [new Date(m[0] + "-15T12:00:00").getTime(), m[1]]; });
      xfmt = function (x) { return new Date(x).toLocaleDateString("da-DK", { month: "short", year: "numeric" }); };
      pts.forEach(function (p) { var d = new Date(p[0]); if (d.getMonth() === 0 && (S.range === "5y" || d.getFullYear() % 2 === 0)) xt.push([p[0], String(d.getFullYear())]); });
    }
    var series = [{ name: "Kurs", color: "var(--ink)", pts: pts, area: true }];
    if (S.range !== "3m") {
      var m = st.monthly.map(function (x) { return x[1]; }), base = st.monthly.length - pts.length, smaPts = [];
      pts.forEach(function (p, i) { var j = base + i; if (j >= 9) smaPts.push([p[0], E.mean(m.slice(j - 9, j + 1))]); });
      series.push({ name: "10-mdr. gns.", color: "var(--s1)", pts: smaPts, w: 1.6, end: false });
    }
    lineChart(el, { label: "Kursudvikling for " + st.name, series: series, xticks: xt, xfmt: xfmt, yfmt: shortNum, tfmt: function (y) { return px(y, st.currency); }, h: 230,
      hlines: [{ y: a.fv, color: "var(--mark)", label: "Fair værdi" }, { y: a.levels.buyBelow, color: "var(--good)", label: "Køb under" }] });
  }
  function drawFan() {
    var id = S.detail, st = S.stocks[id], a = S.A[id], el = $("fan"); if (!el) return;
    var P = a.price, m = a.risk.m, s = a.sigma, lo90 = [], hi90 = [], lo50 = [], hi50 = [], med = [];
    for (var k = 0; k <= 12; k++) {
      var t = k / 12, mu = m * t, sd = s * Math.sqrt(t);
      lo90.push([k, P * Math.exp(mu - 1.645 * sd)]); hi90.push([k, P * Math.exp(mu + 1.645 * sd)]);
      lo50.push([k, P * Math.exp(mu - 0.674 * sd)]); hi50.push([k, P * Math.exp(mu + 0.674 * sd)]); med.push([k, P * Math.exp(mu)]);
    }
    lineChart(el, { label: "Udfaldsrum de næste 12 måneder", series: [{ name: "Median", color: "var(--accent)", pts: med }], h: 210,
      areas: [{ lo: lo90, hi: hi90, color: "var(--accent)", op: 0.12 }, { lo: lo50, hi: hi50, color: "var(--accent)", op: 0.22 }],
      hlines: [{ y: a.fv, color: "var(--mark)", label: "Fair værdi" }, { y: P, color: "var(--ink-3)", dash: "2 3" }],
      xticks: [[3, "3 mdr."], [6, "6 mdr."], [9, "9 mdr."]], xfmt: function (k) { return k === 0 ? "Nu" : "Om " + k + " mdr."; },
      tfmt: function (y) { return px(y, st.currency); },
      extra: function (k) { var i = Math.round(k); return ["90 %: " + px(lo90[i][1], st.currency) + " – " + px(hi90[i][1], st.currency)]; } });
  }
  function updateOverride(id) {
    var st = S.stocks[id], a = S.A[id], el = $("ovres"); if (!el) return;
    var s = E.settingsWith(S.macro, userSettings());
    var val = E.valuation(st, S.macro, s, S.ov[id] || {});
    el.textContent = px(val.fv, st.currency);
    var up = val.fv / a.price - 1;
    $("ovup").innerHTML = '<span class="' + cls(up) + '">' + esc(spc(up)) + "</span> mod kursen";
  }

  // ---------- profile ----------
  function groupKey(p, g) {
    var st = p.stock;
    if (g === "sector") return st ? st.sector : "Andet";
    if (g === "country") return st ? (COUNTRY[st.country] || st.country) : "Andet";
    if (g === "acct") return ACCTS[p.account] || p.account;
    if (g === "cur") return p.currency;
    if (g === "signal") return S.A[p.stockId] ? S.A[p.stockId].rec.label : "Ukendt";
    return "Alle";
  }
  var GROUPS = { sector: "Sektor", country: "Land", acct: "Konto", cur: "Valuta", signal: "Signal" };
  function filteredPositions() {
    var F = S.pf_f;
    return S.port.positions.filter(function (p) {
      if (F.acct !== "alle" && p.account !== F.acct) return false;
      if (F.gl === "gain" && p.gain < 0) return false;
      if (F.gl === "loss" && p.gain >= 0) return false;
      if (F.sel && groupKey(p, F.group) !== F.sel) return false;
      if (F.q && (p.name + " " + (p.stock ? p.stock.ticker : "")).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
      return true;
    });
  }
  function profileNoegletal() {
    var P = S.port;
    var pr = E.portfolioRisk(P, S.A, 0.4);
    var unreal = P.positions.reduce(function (s, x) { return s + x.gain; }, 0), cost = P.positions.reduce(function (s, x) { return s + x.cost; }, 0);
    var realY = P.realized.filter(function (r) { return r.year === YEAR; }).reduce(function (s, r) { return s + r.gain; }, 0);
    var items = [["afkast", "Afkast"], ["risiko", "Risiko"], ["skat", "Skat og udbytte"]], v = segv("pfkpi", items), tiles;
    if (v === "risiko") tiles = '<div class="kpi"><div class="l">Forventet afkast</div><div class="v">' + spc(pr.mu, 1) + '</div><div class="s">12 mdr.</div></div><div class="kpi"><div class="l">Volatilitet</div><div class="v">' + pc(pr.sigma) + '</div><div class="s">om året</div></div><div class="kpi"><div class="l">Risiko for tab</div><div class="v">' + (pr.risk ? pc(pr.risk.pLoss) : "–") + '</div><div class="s">12 mdr.</div></div><div class="kpi"><div class="l">Fald på 20 % undervejs</div><div class="v">' + (pr.risk ? pc(pr.risk.pDD20) : "–") + '</div><div class="s">12 mdr.</div></div>';
    else if (v === "skat") tiles = '<div class="kpi"><div class="l">Aktieskat ' + YEAR + '</div><div class="v">' + kr(S.tax ? S.tax.tax : NaN) + '</div><div class="s">Estimat</div></div><div class="kpi"><div class="l">Forventet restskat</div><div class="v">' + kr(S.tax ? Math.max(S.tax.due, 0) : NaN) + '</div><div class="s">Hvis du intet gør</div></div><div class="kpi"><div class="l">Udbytte ' + YEAR + '</div><div class="v">' + kr(S.tax ? S.tax.divDK + S.tax.divForeign : NaN) + '</div><div class="s">Frit depot, før skat</div></div><div class="kpi"><div class="l">ASK-skat</div><div class="v">' + kr(S.tax ? Math.max(0, S.tax.askTax) : NaN) + '</div><div class="s">17 % lager</div></div>';
    else tiles = '<div class="kpi"><div class="l">Urealiseret</div><div class="v ' + cls(unreal) + '">' + krs(unreal) + '</div><div class="s">' + spc(cost ? unreal / cost : NaN, 1) + '</div></div><div class="kpi"><div class="l">Realiseret ' + YEAR + '</div><div class="v ' + cls(realY) + '">' + krs(realY) + '</div><div class="s">Solgt i år</div></div><div class="kpi"><div class="l">Investeret</div><div class="v">' + kr(cost) + '</div><div class="s">Købsværdi</div></div><div class="kpi"><div class="l">Positioner</div><div class="v">' + P.positions.length + '</div><div class="s">' + Object.keys(P.byStock).length + " aktier</div></div>";
    return '<div class="kpi hero"><div class="l">Samlet værdi</div><div class="v">' + kr(P.totalValue) + '</div><div class="s">Aktier ' + kr(P.invested) + " · kontanter " + kr(P.cash) + "</div></div>" + '<div class="card">' + segs("pfkpi", items) + '<div class="kpis">' + tiles + "</div></div>";
  }
  function profileFordeling() {
    var P = S.port, F = S.pf_f;
    var groups = {}; P.positions.forEach(function (x) { var k = groupKey(x, F.group); groups[k] = (groups[k] || 0) + x.value; });
    if (P.cash > 0 && F.group !== "signal") groups["Kontanter"] = P.cash;
    var items = Object.keys(groups).map(function (k) { return { key: k, label: k, value: groups[k] }; }).sort(function (x, y) { return y.value - x.value; });
    if (items.length > 8) { var rest = items.slice(7).reduce(function (s, i) { return s + i.value; }, 0); items = items.slice(0, 7).concat([{ key: "Andet", label: "Andet", value: rest }]); }
    items.forEach(function (it, i) { it.color = SLOTS[i]; });
    var tot = items.reduce(function (s, i) { return s + i.value; }, 0);
    var gs = [["sector", "Sektor"], ["country", "Land"], ["acct", "Konto"], ["cur", "Valuta"], ["signal", "Signal"]];
    return '<div class="card"><div class="seg segw" role="tablist">' + gs.map(function (g) { return '<button type="button" data-act="grp" data-v="' + g[0] + '" aria-pressed="' + (F.group === g[0]) + '">' + g[1] + "</button>"; }).join("") + '</div><div style="display:grid;align-items:center" class="donutgrid">' + donut(items) + '<div style="display:grid;gap:2px">' +
      items.map(function (it) { return '<button type="button" data-act="pfsel" data-k="' + esc(it.key) + '" style="display:grid;grid-template-columns:12px 1fr auto auto;gap:10px;align-items:center;border:0;background:transparent;padding:9px 6px;border-radius:8px;cursor:pointer;text-align:left;font-size:.95rem"><i style="width:12px;height:12px;border-radius:3px;background:' + it.color + '"></i><span style="min-width:0">' + esc(it.label) + '</span><span class="num">' + pc(it.value / tot) + '</span><span class="muted" aria-hidden="true">›</span></button>'; }).join("") + '</div></div><p class="small muted" style="margin-top:10px">Tryk på en gruppe for at se aktierne i den. Maks. anbefalet vægt pr. aktie: ' + pc(E.settingsWith(S.macro, userSettings()).maxWeight) + ".</p></div>";
  }
  function profileUdvikling() {
    var P = S.port, items = [["vaerdi", "Værdi over tid"], ["gt", "Gevinst og tab"]], v = segv("udv", items), body;
    if (v === "gt") {
      var gp = P.positions.slice().sort(function (x, y) { return y.gain - x.gain; }), mx = Math.max.apply(null, gp.map(function (x) { return Math.abs(x.gain); }).concat([1]));
      body = '<div style="display:grid;gap:12px">' + (gp.length ? gp.map(function (x) {
        var w = Math.abs(x.gain) / mx * 100;
        return '<div style="display:grid;gap:5px"><div class="row" style="justify-content:space-between;font-size:.92rem"><span><b>' + esc(x.stock ? x.stock.ticker : x.name) + '</b> <span class="muted">' + esc(ACCTS[x.account] || x.account) + '</span></span><span class="num ' + cls(x.gain) + '">' + krs(x.gain) + " (" + spc(x.gainPct, 0) + ')</span></div><div style="height:8px;border-radius:4px;background:var(--surface-2);overflow:hidden"><div style="height:100%;width:' + w + "%;background:" + (x.gain >= 0 ? "var(--good)" : "var(--bad)") + ';border-radius:4px"></div></div></div>';
      }).join("") : '<div class="empty">Ingen positioner</div>') + "</div>";
    } else body = '<div class="chart" id="vchart"></div><div class="legend"><span><i style="background:var(--s1)"></i>Markedsværdi</span><span><i class="dash" style="color:var(--ink-3)"></i>Investeret</span></div><p class="small muted" style="margin-top:8px">Månedlig værdi i kr. med nuværende valutakurs.</p>';
    return '<div class="card">' + segs("udv", items) + body + "</div>";
  }
  function profileBeholdning() {
    var P = S.port, F = S.pf_f, o = "";
    var acctCounts = { alle: P.positions.length }; P.positions.forEach(function (x) { acctCounts[x.account] = (acctCounts[x.account] || 0) + 1; });
    o += '<div class="filters"><div class="chips" role="group" aria-label="Konto">' + [["alle", "Alle konti"], ["frit", "Frit depot"], ["ask", "Aktiesparekonto"], ["pension", "Pension"], ["boerne", "Børneopsparing"]].filter(function (c) { return c[0] === "alle" || acctCounts[c[0]]; }).map(function (c) { return '<button type="button" class="chip" data-act="pfacct" data-v="' + c[0] + '" aria-pressed="' + (F.acct === c[0]) + '">' + c[1] + '<span class="c">' + (acctCounts[c[0]] || 0) + "</span></button>"; }).join("") +
      '</div><div class="row"><div class="seg" role="group" aria-label="Gevinst eller tab">' + [["alle", "Alle"], ["gain", "Gevinst"], ["loss", "Tab"]].map(function (c) { return '<button type="button" data-act="pfgl" data-v="' + c[0] + '" aria-pressed="' + (F.gl === c[0]) + '">' + c[1] + "</button>"; }).join("") + '</div><select class="sel" id="pfSort" aria-label="Sortér"><option value="value">Sortér: værdi</option><option value="gain">Sortér: gevinst i kr.</option><option value="gainPct">Sortér: gevinst i %</option><option value="signal">Sortér: signal</option><option value="name">Sortér: navn</option></select></div><input class="search" id="pfq" type="search" placeholder="Søg i beholdning" value="' + esc(F.q) + '">' +
      (F.sel ? '<div class="row"><button type="button" class="chip" data-act="pfclear" aria-pressed="true">' + esc(GROUPS[F.group] + ": " + F.sel) + " ✕</button></div>" : "") + "</div>";
    var pos = filteredPositions();
    var sorters = { name: function (x) { return x.name; }, value: function (x) { return -x.value; }, gain: function (x) { return -x.gain; }, gainPct: function (x) { return -x.gainPct; }, signal: function (x) { return S.A[x.stockId] ? REC_ORDER[S.A[x.stockId].rec.key] : 9; } };
    var sk = sorters[F.sort] || sorters.value;
    pos.sort(function (x, y) { var a1 = sk(x), b1 = sk(y); return a1 < b1 ? -1 : a1 > b1 ? 1 : 0; });
    var sumV = pos.reduce(function (s, x) { return s + x.value; }, 0), sumG = pos.reduce(function (s, x) { return s + x.gain; }, 0);
    o += '<div class="sec-title"><span class="small muted">' + pos.length + " positioner · " + kr(sumV) + ' · <span class="' + cls(sumG) + '">' + krs(sumG) + "</span></span></div>";
    o += '<div class="card" style="padding:4px 14px"><div class="plist">' + (pos.length ? pos.map(function (x) {
      var st = x.stock, a = S.A[x.stockId], fxv = fxOf(x.currency);
      return '<button type="button" class="pcard" data-act="open" data-id="' + esc(st ? x.stockId : "") + '"><span class="r1"><span><b>' + esc(st ? st.name : x.name) + "</b></span>" + (a ? pill(a.rec) : "") + '</span><span class="r2">' + esc((st ? st.ticker + " · " : "") + (ACCTS[x.account] || x.account) + " · " + nf(x.qty) + " stk. · GAK " + px(x.avgCost / fxv, x.currency)) + '</span><span class="r3">' + stat(kr(x.value), "værdi", "", true) + stat(krs(x.gain), "gevinst " + spc(x.gainPct, 0), cls(x.gain), true) + stat(pc(x.value / P.totalValue, 1), "af porteføljen", "", true) + "</span></button>";
    }).join("") : '<div class="empty">Ingen positioner matcher filtrene.</div>') + "</div></div>";
    o += '<p class="tiny muted">GAK = gennemsnitlig anskaffelseskurs (gennemsnitsmetoden, inkl. kurtage).</p>';
    return o;
  }
  function profileHandler() {
    var p = activePf(), items = [["ny", "Ny handel"], ["liste", "Alle handler"]], v = segv("handler", items), body;
    if (v === "liste") {
      var trades = (p.lots || []).map(function (l) { return { t: "buy", x: l, kind: "lots" }; }).concat((p.sales || []).map(function (s) { return { t: "sell", x: s, kind: "sales" }; })).sort(function (a1, b1) { return a1.x.date < b1.x.date ? 1 : -1; });
      body = trades.length ? '<div class="plist">' + trades.map(function (tr) {
        var x = tr.x, st = S.stocks[x.stockId], conf = S.confirmDel === x.id;
        return '<div class="tcard"><span><span class="tag ' + tr.t + '">' + (tr.t === "buy" ? "Køb" : "Salg") + "</span><b>" + esc(st ? st.name : x.stockId) + '</b><br><span class="m">' + esc(dk(x.date)) + " · " + esc(ACCTS[x.account] || x.account) + " · " + nf(x.qty) + " stk. à " + esc(px(x.price, x.currency)) + "</span></span>" + (S.example ? "" : '<button type="button" class="btn ' + (conf ? "" : "ghost ") + 'sm" data-act="del" data-kind="' + tr.kind + '" data-tid="' + esc(x.id) + '">' + (conf ? "Bekræft" : "Slet") + "</button>") + "</div>";
      }).join("") + "</div>" : '<div class="empty">Ingen handler endnu.</div>';
    } else {
      var ids = Object.keys(S.stocks).sort(function (x, y) { return S.stocks[x].name < S.stocks[y].name ? -1 : 1; });
      body = '<div class="seg" role="group" aria-label="Type" style="margin-bottom:14px"><button type="button" data-act="ttype" data-v="buy" aria-pressed="' + (S.tradeType === "buy") + '">Køb</button><button type="button" data-act="ttype" data-v="sell" aria-pressed="' + (S.tradeType === "sell") + '">Salg</button></div><form class="form" id="tradeForm"><div class="fgrid"><div class="field" style="grid-column:1/-1"><label for="tStock">Aktie</label><select id="tStock">' + ids.map(function (i) { return '<option value="' + i + '">' + esc(S.stocks[i].name + " (" + S.stocks[i].ticker + ")") + "</option>"; }).join("") + '</select></div><div class="field"><label for="tAcct">Konto</label><select id="tAcct">' + Object.keys(ACCTS).map(function (k) { return '<option value="' + k + '">' + ACCTS[k] + "</option>"; }).join("") + '</select></div><div class="field"><label for="tDate">Dato</label><input id="tDate" type="date" value="' + TODAY + '" max="' + TODAY + '"></div><div class="field"><label for="tQty">Antal</label><input id="tQty" type="number" min="0" step="any" inputmode="decimal" required></div><div class="field"><label for="tPrice">Kurs (aktiens valuta)</label><input id="tPrice" type="number" min="0" step="any" inputmode="decimal" required></div><div class="field"><label for="tFx">Valutakurs (kr. pr. enhed)</label><input id="tFx" type="number" min="0" step="any" inputmode="decimal"></div><div class="field"><label for="tFee">Kurtage i kr.</label><input id="tFee" type="number" min="0" step="any" inputmode="decimal" value="25"></div></div><button class="btn" type="submit">Gem ' + (S.tradeType === "buy" ? "køb" : "salg") + '</button><p class="tiny muted">Tallene står på handelsnotaen i Nordnet. Valutakursen udfyldes automatisk for udenlandske aktier.</p></form>';
    }
    return '<div class="card">' + segs("handler", items) + body + "</div>";
  }
  function profileIndstillinger() {
    var set = (S.pf && S.pf.settings) || {};
    return card("Indstillinger", '<form class="form" id="setForm"><div class="field"><label for="sCash">Kontanter til investering (kr.)</label><input id="sCash" type="number" min="0" step="1000" inputmode="numeric" value="' + esc(fin(set.cash) ? set.cash : "") + '" placeholder="0"></div><div class="field"><label for="sCarry">Fremført tab fra tidligere år (kr.)</label><input id="sCarry" type="number" min="0" step="100" inputmode="numeric" value="' + esc(S.pf && S.pf.lossCarry ? S.pf.lossCarry : "") + '" placeholder="0"></div><label class="toggle"><input type="checkbox" id="sMarried"' + (set.married ? " checked" : "") + "> Gift eller registreret partner (fælles progressionsgrænse " + kr(S.rules ? S.rules.progressionLimitMarried : NaN) + ')</label><button class="btn" type="submit">Gem indstillinger</button></form><p class="small muted" style="margin-top:12px">Kontanterne bruges til at beregne, hvor mange aktier du bør købe. Din portefølje gemmes privat på din konto – kun du kan se den.</p>');
  }
  function renderProfile() {
    var v = $("v-profile");
    if (!S.port) { v.innerHTML = '<div class="card"><div class="empty">Indlæser…</div></div>'; return; }
    var o = "", sub = S.sub.profile;
    if (S.example && sub !== "indstillinger") o += '<div class="banner"><span><b>Eksempelportefølje.</b> Tallene er ikke dine. Registrér din første handel, så skifter siden til dine egne data.</span><span class="row"><button type="button" class="btn sm" data-act="gotrade">Registrér handel</button><button type="button" class="btn ghost sm" data-act="startempty">Start tom</button></span></div>';
    o += ({ fordeling: profileFordeling, udvikling: profileUdvikling, beholdning: profileBeholdning, handler: profileHandler, indstillinger: profileIndstillinger }[sub] || profileNoegletal)();
    v.innerHTML = tidy(o); glossify(v);
    var ps = $("pfSort"); if (ps) ps.value = S.pf_f.sort;
    var ts = $("tStock"); if (ts) { if (S.lastStock) ts.value = S.lastStock; syncTradeFx(); }
    if (sub === "udvikling" && S.seg.udv !== "gt") drawValueChart(S.port.positions);
  }
  function syncTradeFx() {
    var ts = $("tStock"), fx = $("tFx"), pr = $("tPrice"); if (!ts || !fx) return;
    var st = S.stocks[ts.value]; if (!st) return;
    fx.value = st.currency === "DKK" ? 1 : fxOf(st.currency);
    fx.disabled = st.currency === "DKK";
    if (pr) pr.placeholder = nf(st.price, 2);
  }
  function drawValueChart(pos) {
    var el = $("vchart"); if (!el) return;
    var p = activePf(), keys = {}; pos.forEach(function (x) { keys[x.stockId + "|" + x.account] = 1; });
    var lots = (p.lots || []).filter(function (l) { return keys[l.stockId + "|" + l.account]; }), sales = (p.sales || []).filter(function (s) { return keys[s.stockId + "|" + s.account]; });
    if (!lots.length) { el.innerHTML = '<div class="empty">Ingen handler endnu</div>'; return; }
    var start = lots.reduce(function (m, l) { return l.date < m ? l.date : m; }, "9999").slice(0, 7);
    var months = [], d = new Date(start + "-01T12:00:00"), end = TODAY.slice(0, 7);
    while (true) { var ym = d.toISOString().slice(0, 7); months.push(ym); if (ym >= end || months.length > 400) break; d.setMonth(d.getMonth() + 1); }
    var val = [], inv = [];
    months.forEach(function (ym) {
      var upto = ym + "-31";
      var sub = E.buildPortfolio(lots.filter(function (l) { return l.date <= upto; }), sales.filter(function (s) { return s.date <= upto; }), S.stocks, S.macro, { cash: 0 });
      var v2 = 0, c2 = 0;
      sub.positions.forEach(function (x) { var st = x.stock; c2 += x.cost; if (!st) { v2 += x.value; return; } var mp = st.monthly.filter(function (m) { return m[0] <= ym; }); var pr = mp.length ? mp[mp.length - 1][1] : st.price; v2 += x.qty * pr * fxOf(st.currency); });
      var t = new Date(ym + "-15T12:00:00").getTime(); val.push([t, v2]); inv.push([t, c2]);
    });
    var xt = []; val.forEach(function (p2) { var dd = new Date(p2[0]); if (dd.getMonth() % 6 === 0) xt.push([p2[0], dd.toLocaleDateString("da-DK", { month: "short", year: "2-digit" })]); });
    lineChart(el, { label: "Porteføljens værdi over tid", series: [{ name: "Værdi", color: "var(--s1)", pts: val, area: true }, { name: "Investeret", color: "var(--ink-3)", pts: inv, dash: "4 4", w: 1.6, end: false }], xticks: xt, xfmt: function (x) { return new Date(x).toLocaleDateString("da-DK", { month: "long", year: "numeric" }); }, tfmt: kr, h: 220 });
  }

  // ---------- tax ----------
  function taxTodo() {
    var t = S.tax, R = S.rules, out = [];
    if (!t || !R) return out;
    if (t.due > 0) out.push("Ret forskudsopgørelsen for " + YEAR + " i TastSelv. Skriv en forventet aktieindkomst på ca. " + kr(t.shareIncome) + ". Så trækkes skatten over de resterende måneder, og du undgår en restskat på ca. " + kr(t.due) + ".");
    if (t.due > 0) out.push("Eller lav en frivillig indbetaling på ca. " + kr(t.due) + " inden 31. december. Renten (" + pc(R.restskat.dayRate, 1) + ") løber først fra 1. januar.");
    if (t.roomLow > 0 && t.unrealized > 0) out.push("Du har " + kr(t.roomLow) + " tilbage i " + pc(R.rateLow) + "-trinnet i år. Skal du alligevel sælge med gevinst, er det billigst at fordele salget over årsskiftet, så begge års lave trin bruges.");
    if (t.taxable > t.limit) out.push("Din aktieindkomst er over progressionsgrænsen – " + kr(t.taxable - t.limit) + " beskattes med " + pc(R.rateHigh) + ". Udskyd nye gevinstsalg til januar, hvis du kan.");
    if (t.unrealizedLoss < 0 && t.gains > 0) out.push("Du har urealiserede tab på " + kr(-t.unrealizedLoss) + ". Sælger du dem inden nytår, modregnes de i årets gevinster.");
    if (t.foreignExcess > 0) out.push("Der er trukket ca. " + kr(t.foreignExcess) + " mere i udenlandsk udbytteskat end de 15 %, Danmark godskriver. Søg det tilbage hos landets skattemyndighed.");
    if (t.askGain > 0) out.push("Aktiesparekonto: skatten på ca. " + kr(t.askTax) + " trækkes automatisk fra kontoen i januar. Sørg for kontanter på kontoen, ellers sælger banken værdipapirer.");
    if (!out.length) out.push("Intet at gøre lige nu. Nordnet indberetter dine handler og udbytter automatisk til Skattestyrelsen.");
    return out;
  }
  function taxOverblik() {
    var t = S.tax, R = S.rules, used = Math.min(1, t.taxable / t.limit);
    var items = [["skat", "Skat i år"], ["trin", "27 %-trinnet"], ["ask", "ASK og pension"]], v = segv("taxkpi", items), tiles;
    if (v === "trin") tiles = '<div class="kpi"><div class="l">Brugt af trinnet</div><div class="v">' + pc(used) + '</div><div class="s">af ' + kr(t.limit) + '</div></div><div class="kpi"><div class="l">Plads tilbage</div><div class="v">' + kr(t.roomLow) + '</div><div class="s">til ' + pc(R.rateLow) + '</div></div><div class="kpi"><div class="l">Marginalskat nu</div><div class="v">' + pc(t.marginal) + '</div><div class="s">næste krone</div></div><div class="kpi"><div class="l">Urealiseret (frit)</div><div class="v ' + cls(t.unrealized) + '">' + krs(t.unrealized) + '</div><div class="s">ikke beskattet endnu</div></div>';
    else if (v === "ask") tiles = '<div class="kpi"><div class="l">ASK – årets afkast</div><div class="v ' + cls(t.askGain) + '">' + krs(t.askGain) + '</div><div class="s">estimat</div></div><div class="kpi"><div class="l">ASK-skat</div><div class="v">' + kr(Math.max(0, t.askTax)) + '</div><div class="s">' + pc(R.askRate) + ' lager</div></div><div class="kpi"><div class="l">ASK-indskud</div><div class="v">' + kr(t.askDeposits) + '</div><div class="s">loft ' + kr(R.askLimit) + '</div></div><div class="kpi"><div class="l">Pension</div><div class="v">' + pc(R.palRate, 1) + '</div><div class="s">PAL-skat, automatisk</div></div>';
    else tiles = '<div class="kpi"><div class="l">Beregnet skat</div><div class="v">' + kr(t.tax) + '</div><div class="s">' + pc(R.rateLow) + " / " + pc(R.rateHigh) + '</div></div><div class="kpi"><div class="l">Allerede trukket</div><div class="v">' + kr(t.withheldDK + t.foreignCredit) + '</div><div class="s">udbytteskat</div></div><div class="kpi"><div class="l">Forventet restskat</div><div class="v ' + (t.due > 0 ? "down" : "") + '">' + kr(Math.max(0, t.due)) + '</div><div class="s">hvis du intet gør</div></div><div class="kpi"><div class="l">Udbytte (est.)</div><div class="v">' + kr(t.divDK + t.divForeign) + '</div><div class="s">frit depot</div></div>';
    return '<div class="kpi hero"><div class="l">Aktieindkomst ' + YEAR + ' (frit depot)</div><div class="v">' + kr(t.shareIncome) + '</div><div class="s">Gevinster ' + kr(t.gains) + " · tab " + kr(t.losses) + '</div><div class="prob" style="border:0;padding:10px 0 0;grid-template-columns:1fr"><div class="bar"><i style="width:' + Math.round(used * 100) + '%;background:var(--accent)"></i></div><span class="x">' + pc(used) + " af " + pc(R.rateLow) + "-trinnet er brugt.</span></div></div>" +
      '<div class="card">' + segs("taxkpi", items) + '<div class="kpis">' + tiles + "</div></div>" +
      '<button type="button" class="btn" data-act="sub" data-view="tax" data-v="todo">Se hvad du skal gøre (' + taxTodo().length + ")</button>";
  }
  function taxTodoView() { return card("Gør dette for at undgå skattesmæk", '<ol class="todo">' + taxTodo().map(function (x, i) { return '<li><span class="ic">' + (i + 1) + "</span><span>" + esc(x) + "</span></li>"; }).join("") + "</ol>"); }
  function taxSalg() {
    var poss = S.port.positions.filter(function (p) { return p.stock; });
    var items = [["sim", "Beregn salg"], ["regler", "Sådan beskattes det"]], v = segv("salg", items), body;
    if (v === "regler") body = '<ul class="facts"><li>Frit depot: gevinsten (salgssum minus gennemsnitlig købspris inkl. kurtage) er aktieindkomst i salgsåret.</li><li>Aktiesparekonto og pension: salg udløser ingen ekstra skat – de beskattes af årets værdiændring.</li><li>Tab på børsnoterede aktier modregnes i gevinster og udbytter, ellers fremføres de.</li></ul>';
    else body = poss.length ? '<div class="stack"><div class="field"><label for="simPos">Position</label><select id="simPos">' + poss.map(function (p) { var k = p.stockId + "|" + p.account; return '<option value="' + esc(k) + '">' + esc(p.stock.name + " · " + ACCTS[p.account] + " · " + nf(p.qty) + " stk.") + "</option>"; }).join("") + '</select></div><div class="field"><label for="simQty">Antal (tom = alle)</label><input id="simQty" type="number" min="0" step="any" inputmode="decimal" placeholder="Alle"></div><div id="simOut"></div></div>' : '<div class="empty">Ingen positioner</div>';
    return '<div class="card">' + segs("salg", items) + body + "</div>";
  }
  function taxAarsopg() {
    var t = S.tax, t66 = t.gains + t.losses;
    var rows = [["61", "Udbytte af danske aktier (est.)", kr(t.divDK)], ["63", "Udbytte af udenlandske aktier, før udenlandsk skat (est.)", kr(t.divForeign)], ["–", "Indeholdt udenlandsk udbytteskat, godskrevet højst 15 %", kr(t.foreignCredit)], ["66", "Gevinst/tab på børsnoterede aktier (realiseret)", krs(t66)], ["345", "ETF'er på positivlisten (lagerbeskatning)", "0 kr."], ["ASK", "Aktiesparekonto – afregnes af Nordnet", kr(Math.max(0, t.askTax))]];
    return card("Til årsopgørelsen " + YEAR, '<p class="small muted" style="margin-bottom:6px">Nordnet indberetter automatisk. Brug tallene til at kontrollere årsopgørelsen i marts.</p>' + rows.map(function (r) { return '<div class="rub"><span class="no">' + r[0] + "</span><span>" + esc(r[1]) + '</span><span class="amt">' + esc(r[2]) + "</span></div>"; }).join("") + (t.lossToCarry > 0 ? '<p class="small" style="margin-top:10px">Nettotab ' + kr(t.lossToCarry) + " fremføres til næste år (eller bruges af ægtefælle).</p>" : "") + '<button type="button" class="btn" data-act="report" style="margin-top:14px;width:100%">Hent skatterapport (.txt)</button>');
  }
  function taxFrister() { return card("Frister", '<ul class="steps">' + S.rules.deadlines.map(function (d) { return '<li><span class="w">' + esc(d.when) + "</span><span>" + esc(d.what) + "</span></li>"; }).join("") + "</ul>"); }
  function taxRegler() {
    var R = S.rules, wh = R.withholding || {};
    var items = [["satser", "Satser"], ["nyt", "Ændringer"], ["udland", "Udland"], ["kurtage", "Kurtage"], ["kilder", "Kilder"]], v = segv("regler", items), body;
    if (v === "nyt") body = (R.pending && R.pending.length ? R.pending.map(function (p) { return '<p class="small" style="margin-bottom:8px">' + esc(p.text) + ' <a href="' + esc(p.source) + '" target="_blank" rel="noopener">Kilde</a></p>'; }).join("") : '<div class="empty">Ingen kendte forslag.</div>') + '<p class="tiny muted" style="margin-top:8px">Ikke vedtaget. Den automatiske opdatering holder øje og giver besked.</p>';
    else if (v === "udland") body = '<div class="tscroll"><table class="t"><thead><tr><th>Land</th><th class="r">Trækkes</th><th class="r">Søg tilbage</th></tr></thead><tbody>' + Object.keys(wh).map(function (k) { return "<tr><td>" + esc(COUNTRY[k] || k) + '</td><td class="r num">' + pc(wh[k], Math.round(wh[k] * 1000) % 10 ? 2 : 0) + '</td><td class="r num">' + (wh[k] > 0.15 ? pc(wh[k] - 0.15, 2) : "–") + "</td></tr>"; }).join("") + '</tbody></table></div><p class="small muted" style="margin-top:10px">' + esc(R.withholdingNote) + "</p>";
    else if (v === "kurtage") body = kvList([["Danske og nordiske aktier", R.nordnet.dk], ["USA og Tyskland", R.nordnet.us]]) + '<p class="small" style="margin-top:8px"><a href="' + esc(R.nordnet.source) + '" target="_blank" rel="noopener">Nordnets prisliste</a></p>';
    else if (v === "kilder") body = '<ul class="refs">' + R.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + "</a></li>"; }).join("") + "</ul>";
    else body = '<ul class="facts">' + R.facts.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul><p class="tiny muted" style="margin-top:10px">Verificeret ' + esc(dk(R.verifiedAt)) + " · tjekkes automatisk hver mandag.</p>";
    return '<div class="card">' + segs("regler", items) + body + "</div>";
  }
  function renderTax() {
    var v = $("v-tax"), t = S.tax, R = S.rules;
    if (!R || !t) { v.innerHTML = '<div class="card"><div class="empty">Skatteregler indlæses…</div></div>'; return; }
    var sub = S.sub.tax, o = "";
    if (S.example && sub !== "frister" && sub !== "regler") o += '<div class="banner"><span><b>Beregnet på eksempelporteføljen.</b> Registrér dine handler under Min profil.</span><button type="button" class="btn sm" data-act="gotrade">Min profil</button></div>';
    o += ({ todo: taxTodoView, salg: taxSalg, aarsopg: taxAarsopg, frister: taxFrister, regler: taxRegler }[sub] || taxOverblik)();
    if (sub !== "regler" && sub !== "frister") o += '<p class="disclaimer">Skatteberegningen er et estimat. Udbytter er anslået ud fra seneste udbytte og din beholdning før ex-dato. Kontrollér altid i TastSelv.</p>';
    v.innerHTML = tidy(o); glossify(v);
    if (sub === "salg") simUpdate();
  }
  function simUpdate() {
    var sp = $("simPos"), out = $("simOut"); if (!sp || !out) return;
    var k = sp.value.split("|"), p = S.port.positions.filter(function (x) { return x.stockId === k[0] && x.account === k[1]; })[0]; if (!p) return;
    var q = parseFloat(($("simQty").value || "").replace(",", ".")); if (!(q > 0) || q > p.qty) q = p.qty;
    var priceDKK = p.stock.price * fxOf(p.currency);
    var r = E.saleTax(p, q, priceDKK, S.tax, S.rules);
    var fee = E.fee(p.stock, q * priceDKK);
    out.innerHTML = tidy('<div class="kpis"><div class="kpi"><div class="l">Gevinst ved salg af ' + nf(q) + ' stk.</div><div class="v ' + cls(r.gain) + '">' + krs(r.gain) + '</div></div><div class="kpi"><div class="l">Skat</div><div class="v">' + kr(r.tax) + '</div><div class="s">Kurtage ca. ' + kr(fee) + '</div></div></div><p class="note" style="margin-top:10px">' + esc(r.note) + "</p>");
  }
  function reportText() {
    var t = S.tax, R = S.rules, P = S.port, L = [];
    L.push("SKATTERAPPORT " + YEAR + " – Kursvagt"); L.push("Dannet " + TODAY + (S.example ? " (EKSEMPELPORTEFØLJE)" : "")); L.push("");
    L.push("AKTIEINDKOMST (frit depot)");
    L.push("  Realiserede gevinster: " + kr(t.gains)); L.push("  Realiserede tab: " + kr(t.losses)); L.push("  Udbytte danske aktier (est.), rubrik 61: " + kr(t.divDK)); L.push("  Udbytte udenlandske aktier (est.), rubrik 63: " + kr(t.divForeign));
    L.push("  Indeholdt udenlandsk udbytteskat godskrevet (maks. 15 %): " + kr(t.foreignCredit)); L.push("  Udenlandsk skat at søge tilbage: " + kr(t.foreignExcess));
    L.push("  Gevinst/tab børsnoterede aktier, rubrik 66: " + krs(t.gains + t.losses)); L.push("  Fremført tab brugt: " + kr(Math.min(t.carry, Math.max(t.shareIncome, 0))));
    L.push("  Skattepligtig aktieindkomst: " + kr(t.taxable) + " (grænse " + kr(t.limit) + ")");
    L.push("  Beregnet skat: " + kr(t.tax) + " – allerede trukket " + kr(t.withheldDK + t.foreignCredit) + " = forventet restskat " + kr(Math.max(0, t.due))); L.push("");
    L.push("AKTIESPAREKONTO"); L.push("  Årets afkast (est.): " + krs(t.askGain) + " – skat " + pc(R.askRate) + ": " + kr(Math.max(0, t.askTax)) + " (afregnes automatisk af Nordnet)"); L.push("");
    L.push("REALISEREDE HANDLER " + YEAR);
    P.realized.filter(function (r) { return r.year === YEAR; }).forEach(function (r) { L.push("  " + r.date + "  " + r.stockId + "  " + ACCTS[r.account] + "  " + nf(r.qty) + " stk.  provenu " + kr(r.proceeds) + "  anskaffelse " + kr(r.cost) + "  gevinst " + krs(r.gain)); });
    L.push(""); L.push("BEHOLDNING"); P.positions.forEach(function (p) { L.push("  " + (p.stock ? p.stock.ticker : p.name) + "  " + ACCTS[p.account] + "  " + nf(p.qty) + " stk.  GAK " + kr(p.avgCost) + "/stk.  værdi " + kr(p.value) + "  urealiseret " + krs(p.gain)); });
    L.push(""); L.push("HANDLINGER"); taxTodo().forEach(function (x, i) { L.push("  " + (i + 1) + ". " + x); });
    L.push(""); L.push("FRISTER"); R.deadlines.forEach(function (d) { L.push("  " + d.when + ": " + d.what); });
    L.push(""); L.push("Regler verificeret " + R.verifiedAt + ". Estimat – kontrollér i TastSelv.");
    return tidy(L.join("\n"));
  }

  // ---------- method ----------
  function renderMethod() {
    var v = $("v-method"), m = S.meta || {}, M = S.macro || {}, s = E.settingsWith(S.macro, userSettings()), sub = S.sub.method, o = "", items, sv, body;
    if (sub === "opdatering") {
      items = [["status", "Status"], ["log", "Ændringer"], ["marked", "Marked"]]; sv = segv("opd", items);
      if (sv === "log") body = (m.changelog || []).length ? '<ul class="steps">' + m.changelog.slice(0, 12).map(function (c) { return '<li><span class="w">' + esc(dk(c.date)) + "</span><span>" + esc(c.text) + "</span></li>"; }).join("") + "</ul>" : '<div class="empty">Ingen ændringer endnu.</div>';
      else if (sv === "marked") body = kvList([["Risikofri rente DKK (10 år)", pc(M.rf && M.rf.DKK, 2)], ["Risikofri rente EUR (10 år)", pc(M.rf && M.rf.EUR, 2)], ["Risikofri rente USD (10 år)", pc(M.rf && M.rf.USD, 2)], ["Risikofri rente SEK (10 år)", pc(M.rf && M.rf.SEK, 2)], ["Risikofri rente NOK (10 år)", pc(M.rf && M.rf.NOK, 2)], ["Evig vækst (DKK)", pc(M.gT, 1)], ["Kontantrente", pc(M.cash, 1)], ["USD/DKK", nf(M.fx && M.fx.USD, 3)], ["EUR/DKK", nf(M.fx && M.fx.EUR, 3)], ["SEK/DKK", nf(M.fx && M.fx.SEK, 4)], ["NOK/DKK", nf(M.fx && M.fx.NOK, 4)], ["Opdateret", dk(M.asOf)]]);
      else body = '<p class="small" style="margin-bottom:10px">' + esc(m.schedule || "Kurser, nyheder og skatteregler opdateres automatisk hver hverdag morgen og eftermiddag.") + "</p>" + kvList([["Seneste opdatering", m.updatedAt ? dkt(m.updatedAt) : "–"], ["Næste opdatering", m.nextRun || "–"], ["Kurser pr.", m.priceAsOf ? dk(m.priceAsOf) : "–"], ["Skatteregler verificeret", S.rules ? dk(S.rules.verifiedAt) : "–"]]) + (window.kvPagesPanel ? window.kvPagesPanel() : "");
      o = '<div class="card">' + segs("opd", items) + body + "</div>";
    } else if (sub === "signaler") {
      items = [["signal", "Signal"], ["risiko", "Risiko"], ["beloeb", "Beløb"]]; sv = segv("sig", items);
      if (sv === "risiko") body = '<div class="stack"><p class="small">Afkastkravet er r = rf + β·ERP (CAPM). β justeres mod 1 (Blume: 0,67β + 0,33) med gulv ' + nf(s.betaFloor, 1) + ". Cykliske aktier får +1,5 %. Evig vækst og basisvækst følger landets rente (samme realvækst, lokal inflation).</p><p class=\"small\">Sandsynlighederne kommer fra en lognormal model. Risikoen for et fald på 20 % undervejs beregnes med refleksionsprincippet for brownsk bevægelse med drift.</p></div>";
      else if (sv === "beloeb") body = '<div class="stack"><div class="formula">Andel af porteføljen = ' + nf(s.kellyFraction, 2) + " × (μ − kontantrente) / σ²<br>højst " + pc(s.maxWeight) + ' pr. aktie</div><p class="small">Det er en brøkdel af Kelly-kriteriet. Fuld Kelly er for aggressiv, når μ og σ er estimater (MacLean, Thorp & Ziemba 2010). Handler under ' + kr(s.minTrade) + " foreslås ikke, fordi kurtagen bliver for stor. Akkumulér-signaler køber halvdelen nu og resten senere.</p></div>";
      else body = '<ol class="facts"><li><b>Værdi (40 %).</b> Fair værdi med den metode, der passer til aktietypen, kombineret med analytikernes kursmål (Bates & Granger 1969).</li><li><b>Kvalitet (20 %).</b> Piotroski F-score og Altman Z-score.</li><li><b>Trend (20 %).</b> Kurs mod 10-måneders gennemsnit (Faber 2007) og 12-1-måneders momentum (Jegadeesh & Titman 1993).</li><li><b>Timing (10 %).</b> RSI(14) og MACD.</li><li><b>Nyheder (10 %).</b> Vurderet effekt af nyheder de seneste 60 dage.</li></ol><p class="small" style="margin-top:12px">Signalet nedgraderes, hvis forventet afkast er under kontantrenten, eller hvis risikoen for et fald på 20 % undervejs er over 50 %.</p>';
      o = '<div class="card">' + segs("sig", items) + body + "</div>";
    } else if (sub === "modeller") {
      var byModel = { dcf: [], ddm: [], rim: [], epv: [], rnpv: [] }; Object.keys(S.stocks).forEach(function (id) { var st = S.stocks[id]; (byModel[st.model] || []).push(st.ticker); });
      var M2 = { dcf: ["Vækst- og kvalitetsaktier: indtjeningsbaseret DCF", "V₀ = Σ Eₜ(1 − g/ROIC)/(1+r)ᵗ + terminalværdi", "Vækst koster geninvestering: jo lavere ROIC, jo mere af indtjeningen skal tilbage i virksomheden. Startvæksten krympes mod 5 %, fordi høj vækst sjældent varer (Chan, Karceski & Lakonishok 2003), og glider til evig vækst over 10 år."],
        ddm: ["Forsikring og stabile udbytteaktier: to-trins udbyttemodel", "V₀ = Σ Dₜ/(1+r)ᵗ + D₁₀(1+g∞)/(r − g∞)", "Bruges når udbyttet er den primære måde, aktionærerne får værdien ud."],
        rim: ["Banker: residualindkomstmodel", "V₀ = B₀ + Σ (ROEₜ − r)Bₜ₋₁/(1+r)ᵗ", "Bankens værdi er egenkapitalen plus merafkastet over kapitalomkostningen. ROE glider halvvejs mod afkastkravet over 10 år."],
        epv: ["Cykliske selskaber: normaliseret indtjening (EPV)", "V₀ = max(E_norm/r, E_norm(1 − g/ROE)/(r − g))", "Normaliseret margin = gennemsnit af 5-års median, seneste 12 mdr. og forventet margin. Vækst giver kun værdi, når ROE er over afkastkravet."],
        rnpv: ["Biotek uden stabil indtjening: pipeline-værdi (rNPV)", "V₀ = Σ pᵢ · NPVᵢ ≈ kursmål / 1,10", "Værdien ligger i lægemiddelkandidater, der hver har en sandsynlighed for at nå markedet (Hay m.fl. 2014). Analytikernes kursmål bygger på sådanne modeller, så de bruges nedjusteret 10 % med et usikkerhedsbånd på mindst 30 %. Modeltilliden i forventet afkast og den maksimale vægt halveres pga. binær risiko ved forsøgsresultater."] };
      items = [["dcf", "Vækst (DCF)"], ["ddm", "Udbytte (DDM)"], ["rim", "Bank (RIM)"], ["epv", "Cyklisk (EPV)"], ["rnpv", "Biotek (rNPV)"]]; sv = segv("mod", items);
      o = '<div class="card">' + segs("mod", items) + '<div class="stack"><p class="small"><b>' + esc(M2[sv][0]) + '</b></p><p class="small muted">Bruges til: ' + esc(byModel[sv].join(", ") || "–") + '</p><div class="formula">' + esc(M2[sv][1]) + '</div><p class="small">' + esc(M2[sv][2]) + "</p></div></div>";
    } else if (sub === "ordbog") {
      o = glossaryView();
    } else if (sub === "indstillinger") {
      var us = (S.pf && S.pf.settings) || {}, dn = document.documentElement.getAttribute("data-density"), thm = document.documentElement.getAttribute("data-theme");
      o = card("Visning", '<div class="stack"><div><p class="tiny muted" style="margin-bottom:4px">Tekststørrelse og tæthed</p><div class="seg segw" style="margin:0">' + DENS.map(function (x) { return '<button type="button" data-act="density" data-v="' + x[0] + '" aria-pressed="' + (dn === x[0]) + '">' + x[1] + "</button>"; }).join("") + '</div></div><div><p class="tiny muted" style="margin-bottom:4px">Tema</p><div class="seg segw" style="margin:0">' + THEMES.map(function (x) { return '<button type="button" data-act="theme" data-v="' + x[0] + '" aria-pressed="' + (thm === x[0]) + '">' + x[1] + "</button>"; }).join("") + '</div></div><label class="toggle"><input type="checkbox" id="glOn"' + (glossOn() ? " checked" : "") + '> Understreg fagord, så de kan trykkes på for en forklaring</label><p class="tiny muted">Gemmes på denne enhed. Knappen Aa øverst skifter hurtigt tekststørrelse.</p></div>');
      o += card("Dine indstillinger", '<div class="sliders">' +
        sliderHTML("", "erp", "Aktiepræmie (ERP)", 0.03, 0.07, 0.0025, fin(us.erp) ? us.erp : s.erp, function (x) { return pc(x, 2); }, "setslide") +
        sliderHTML("", "specificPremium", "Ekstra sikkerhedstillæg på afkastkravet", 0, 0.03, 0.0025, fin(us.specificPremium) ? us.specificPremium : s.specificPremium, function (x) { return pc(x, 2); }, "setslide") +
        sliderHTML("", "kellyFraction", "Kelly-brøk (aggressivitet)", 0.1, 0.5, 0.05, fin(us.kellyFraction) ? us.kellyFraction : s.kellyFraction, function (x) { return nf(x, 2); }, "setslide") +
        sliderHTML("", "maxWeight", "Maks. vægt pr. aktie", 0.05, 0.25, 0.01, fin(us.maxWeight) ? us.maxWeight : s.maxWeight, function (x) { return pc(x); }, "setslide") +
        '<label class="toggle"><input type="checkbox" id="anW"' + ((fin(us.analystWeight) ? us.analystWeight : 1) ? " checked" : "") + '> Kombinér modellen med analytikernes kursmål</label></div><p class="small muted" style="margin-top:12px">Ændringer gemmes på din konto og slår igennem på alle signaler – også i de automatiske beskeder.</p>');
    } else {
      items = [["lit", "Litteratur"], ["graenser", "Begrænsninger"]]; sv = segv("kild", items);
      body = sv === "graenser" ? '<p class="small">Ingen model kan forudsige kurser præcist. Markedet prissætter hurtigt offentlig information, så en model vinder kun på disciplin: den køber, når prisen er lav i forhold til værdien, spreder risikoen og undgår de dyre fejl. Data hentes fra offentlige kilder med forsinkelse, nøgletal kan være nogle uger gamle, og nyhedsvurderinger er skøn. Brug signalerne som et grundigt udgangspunkt, og tjek selv de vigtigste antagelser.</p>' : '<ul class="refs">' + REFS.dcf.concat(REFS.ddm, REFS.rim, REFS.epv, REFS.rnpv, REFS.common).map(function (x) { return '<li><a href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + esc(x[0]) + "</a></li>"; }).join("") + "</ul>";
      o = '<div class="card">' + segs("kild", items) + body + "</div>";
    }
    v.innerHTML = tidy(o); if (sub !== "ordbog") glossify(v);
  }

  // ---------- render loop ----------
  var raf = 0;
  function schedule() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; compute(); renderAll(); }); }
  function renderView() { if (S.tab === "overview") renderOverview(); else if (S.tab === "profile") renderProfile(); else if (S.tab === "tax") renderTax(); else if (S.tab === "sim") renderSim(); else renderMethod(); }
  function renderAll() {
    renderStatus();
    if (!S.subChosen && Object.keys(S.A).length && !S.alerts.length) S.sub.overview = "stocks";
    renderSubbar();
    var b = $("badge"), n = S.alerts.filter(function (x) { return x.pr <= 1; }).length; b.hidden = !n; b.textContent = n;
    renderView();
    if (S.detail || S.cmpOpen) renderDetail(true); else renderCmpbar();
  }
  function setTab(t) {
    S.tab = t; store("kv-tab", t);
    document.querySelectorAll(".tabbar button").forEach(function (b) { if (b.dataset.tab === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    ["overview", "profile", "tax", "sim", "method"].forEach(function (k) { $("v-" + k).hidden = k !== t; });
    window.scrollTo(0, 0); renderAll();
  }
  function setSub(view, v) {
    S.sub[view] = v; S.subChosen = true; store("kv-sub", JSON.stringify(S.sub));
    if (view === "detail") { renderDetail(); $("sheet").scrollTop = 0; return; }
    if (view !== S.tab) { setTab(view); return; }
    renderSubbar(); renderView(); window.scrollTo(0, 0);
  }
  function openDetail(id, keepSub) { if (!S.stocks[id]) return; S.cmpOpen = false; S.detail = id; if (!keepSub) { S.range = "5y"; S.sub.detail = "konklusion"; } renderDetail(); $("sheet").scrollTop = 0; }
  function closeDetail() { S.detail = null; S.cmpOpen = false; renderDetail(); }
  // ---------- display: density & theme (per device) ----------
  var DENS = [["compact", "Kompakt"], ["normal", "Normal"], ["large", "Stor"]];
  var THEMES = [["dim", "Dæmpet"], ["dark", "Mørk"], ["light", "Lys"]];
  function applyView() {
    var d = load("kv-density"), th = load("kv-theme");
    if (!DENS.some(function (x) { return x[0] === d; })) d = "compact";
    if (!THEMES.some(function (x) { return x[0] === th; })) th = "dim";
    document.documentElement.setAttribute("data-density", d);
    document.documentElement.setAttribute("data-theme", th);
  }
  function setDisplay(k, v) { store(k, v); applyView(); compute(); renderAll(); }

  // ---------- saving ----------
  var saveT = 0, saving = false, again = false;
  function ensureOwnPf() {
    if (S.example) { S.example = false; S.pf = S.pf ? S.pf : clone(EMPTY); S.pf.exampleOff = true; }
    if (!S.pf) S.pf = clone(EMPTY);
    S.pf.settings = S.pf.settings || {}; S.pf.lots = S.pf.lots || []; S.pf.sales = S.pf.sales || []; S.pf.watch = S.pf.watch || [];
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(flush, 400); }
  var prefT = 0, prefSaving = false, prefAgain = false;
  function savePrefs() { store("kv-prefs", JSON.stringify(S.prefs)); clearTimeout(prefT); prefT = setTimeout(flushPrefs, 300); }
  function flushPrefs() {
    if (!(S.db && S.uid)) return;
    if (prefSaving) { prefAgain = true; return; }
    prefSaving = true;
    var body = clone(S.prefs); body.updatedAt = new Date().toISOString();
    var done = function () { prefSaving = false; if (prefAgain) { prefAgain = false; flushPrefs(); } };
    S.db.doc("data/users/" + S.uid + "/prefs").set(body).then(done, function () { toast("Kunne ikke gemme. Prøv igen om lidt."); done(); });
  }
  function toggleFav(id) { var i = S.prefs.fav.indexOf(id); if (i >= 0) S.prefs.fav.splice(i, 1); else S.prefs.fav.push(id); savePrefs(); toast(i >= 0 ? "Fjernet fra favoritter" : "Tilføjet til favoritter"); }
  function addAlarm(id, price) {
    var st = S.stocks[id]; if (!st || !(price > 0)) { toast("Skriv en kurs."); return; }
    if (S.prefs.alarms.length >= 60) { toast("Højst 60 alarmer – slet nogle først."); return; }
    var dir = price < st.price ? "under" : "over";
    S.prefs.alarms.push({ id: Math.random().toString(36).slice(2, 10), stockId: id, dir: dir, price: +price.toPrecision(6), created: TODAY });
    savePrefs(); toast("Alarm sat: " + st.ticker + (dir === "under" ? " under " : " over ") + px(price, st.currency));
  }
  function flush() {
    if (saving) { again = true; return; }
    saving = true;
    var body = clone(S.pf); body.updatedAt = new Date().toISOString();
    var done = function () { saving = false; if (again) { again = false; flush(); } };
    if (S.db && S.uid) {
      S.db.doc("data/users/" + S.uid + "/portfolio").set(body).then(function () { toast("Gemt"); done(); }, function (e) {
        toast(e && e.code === "invalid_argument" ? "Kunne ikke gemme – din adgang tillader ikke ændringer." : "Kunne ikke gemme. Prøv igen om lidt."); done();
      });
    } else { store("kv-pf", JSON.stringify(body)); toast("Gemt i denne browser"); done(); }
  }

  // ---------- events ----------
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest("#gpop") && !ev.target.closest(".gl")) hideGloss();
    var el = ev.target.closest("[data-act],[data-tab]"); if (!el) return;
    var act = el.dataset.act;
    if (!act && el.dataset.tab && el.closest(".tabbar")) { setTab(el.dataset.tab); return; }
    switch (act) {
      case "open": if (el.dataset.id) openDetail(el.dataset.id); break;
      case "tab": if (el.dataset.tab) setTab(el.dataset.tab); break;
      case "sub": setSub(el.dataset.view, el.dataset.v); break;
      case "seg": S.seg[el.dataset.k] = el.dataset.v; if (el.closest("#sheet")) renderDetail(true); else renderView(); break;
      case "close": closeDetail(); break;
      case "sig": S.f.sig = el.dataset.v; renderOverview(); break;
      case "refresh": if (window.kvRefresh) window.kvRefresh(); break;
      case "kvp": if (window.kvPagesAction) window.kvPagesAction(el.dataset.v, el); break;
      case "region": S.f.region = el.dataset.v; renderOverview(); break;
      case "cls": S.f.cls = el.dataset.v; S.f.sig = "alle"; renderOverview(); break;
      case "range": S.range = el.dataset.v; document.querySelectorAll('[data-act="range"]').forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.v === S.range); }); drawPriceChart(); break;
      case "ovreset": delete S.ov[el.dataset.id]; renderDetail(true); break;
      case "grp": S.pf_f.group = el.dataset.v; S.pf_f.sel = null; renderProfile(); break;
      case "pfacct": S.pf_f.acct = el.dataset.v; renderProfile(); break;
      case "pfgl": S.pf_f.gl = el.dataset.v; renderProfile(); break;
      case "pfsel": S.pf_f.sel = el.dataset.k === "Kontanter" ? null : el.dataset.k; setSub("profile", "beholdning"); break;
      case "pfclear": S.pf_f.sel = null; renderProfile(); break;
      case "ttype": S.tradeType = el.dataset.v; renderProfile(); break;
      case "gotrade": S.seg.handler = "ny"; S.sub.profile = "handler"; if (S.tab !== "profile") setTab("profile"); else setSub("profile", "handler"); break;
      case "startempty": ensureOwnPf(); save(); compute(); renderAll(); break;
      case "del":
        if (S.confirmDel !== el.dataset.tid) { S.confirmDel = el.dataset.tid; renderProfile(); setTimeout(function () { if (S.confirmDel === el.dataset.tid) { S.confirmDel = null; if (S.tab === "profile") renderProfile(); } }, 4000); break; }
        S.confirmDel = null; ensureOwnPf(); S.pf[el.dataset.kind] = S.pf[el.dataset.kind].filter(function (x) { return x.id !== el.dataset.tid; }); save(); compute(); renderAll(); break;
      case "report": downloadReport(); break;
      case "view": S.f.view = el.dataset.v; store("kv-view", S.f.view); renderOverview(); break;
      case "color": S.f.color = el.dataset.v; renderOverview(); break;
      case "axes": S.f.axes = el.dataset.v; renderOverview(); break;
      case "scsel": S.f.sel = S.f.sel === el.dataset.id ? null : el.dataset.id; renderOverview(); break;
      case "tsort": if (S.f.sort === el.dataset.v) S.f.rev = !S.f.rev; else { S.f.sort = el.dataset.v; S.f.rev = false; } renderOverview(); break;
      case "fav": toggleFav(el.dataset.id); compute(); renderAll(); break;
      case "cmp": toggleCmp(el.dataset.id); renderAll(); break;
      case "cmpdel": toggleCmp(el.dataset.id); if (S.cmpOpen && S.cmp.length < 2) S.cmpOpen = false; renderAll(); if (!S.detail && !S.cmpOpen) renderDetail(); break;
      case "cmpopen": if (S.cmp.length >= 2) { S.cmpOpen = true; S.detail = null; renderDetail(); $("sheet").scrollTop = 0; } break;
      case "cmpclose": S.cmpOpen = false; renderDetail(); break;
      case "cmpclear": S.cmp = []; store("kv-cmp", "[]"); S.cmpOpen = false; renderDetail(); toast("Sammenligning ryddet"); break;
      case "cmprange": S.cmpRange = el.dataset.v; document.querySelectorAll('[data-act="cmprange"]').forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.v === S.cmpRange); }); drawCmpChart(S.cmp.filter(function (x) { return S.A[x]; })); break;
      case "cmpfav": S.cmp = S.prefs.fav.filter(function (x) { return S.A[x]; }).slice(0, 3); store("kv-cmp", JSON.stringify(S.cmp)); if (S.cmp.length >= 2) { S.cmpOpen = true; S.detail = null; renderDetail(); } break;
      case "nav": navStep(+el.dataset.v); break;
      case "goalarm": S.sub.detail = "kurs"; renderDetail(); setTimeout(function () { var c = $("alarmForm"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30); break;
      case "alarmquick": addAlarm(el.dataset.id, parseFloat(el.dataset.p)); compute(); renderAll(); break;
      case "alarmdel": S.prefs.alarms = S.prefs.alarms.filter(function (x) { return x.id !== el.dataset.aid; }); savePrefs(); toast("Alarm slettet"); compute(); renderAll(); break;
      case "qsearch": S.f.view = S.f.view || "liste"; S.sub.overview = "stocks"; S.subChosen = true; if (S.detail || S.cmpOpen) closeDetail(); if (S.tab !== "overview") setTab("overview"); else { renderSubbar(); renderView(); } setTimeout(function () { var q = $("q"); if (q) { q.focus(); q.select(); } }, 30); break;
      case "density": if (el.closest(".tbtns")) { var cur = document.documentElement.getAttribute("data-density"), k = DENS.map(function (x) { return x[0]; }).indexOf(cur), nx = DENS[(k + 1) % DENS.length]; setDisplay("kv-density", nx[0]); toast("Tekststørrelse: " + nx[1]); } else setDisplay("kv-density", el.dataset.v); break;
      case "theme": setDisplay("kv-theme", el.dataset.v); break;
      case "gloss": showGloss(el.dataset.k, el); break;
      case "tkside": tk().side = el.dataset.v; renderSim(); break;
      case "tktype": tk().type = el.dataset.v; renderSim(); break;
      case "tkmode": tk().mode = tk().mode === "amount" ? "qty" : "amount"; renderSim(); setTimeout(function () { var q = $("tkQty"); if (q) q.focus(); }, 20); break;
      case "simcancel": S.sim.orders.forEach(function (x) { if (x.id === el.dataset.oid && x.status === "pending") { x.status = "cancelled"; x.ended = new Date().toISOString(); delete x.reserve; } }); saveSim(); compute(); renderAll(); toast("Ordren er annulleret"); break;
      case "simsell": case "simbuy": var tq = tk(), pp = S.simB && S.simB.positions.filter(function (x) { return x.sid === el.dataset.id; })[0]; tq.sid = el.dataset.id; tq.side = act === "simsell" ? "sell" : "buy"; tq.mode = "qty"; tq.qty = act === "simsell" && pp ? String(pp.qty) : ""; tq.limit = String(+S.stocks[el.dataset.id].price.toPrecision(6)); setSub("sim", "handl"); break;
      case "simtrade": var t3 = tk(); t3.sid = el.dataset.id; t3.side = el.dataset.side || "buy"; t3.mode = "qty"; t3.qty = el.dataset.qty || ""; t3.limit = String(+S.stocks[el.dataset.id].price.toPrecision(6)); closeDetail(); S.sub.sim = S.sim ? "handl" : "oversigt"; setTab("sim"); break;
      case "simreset": if (!S.simResetAsk) { S.simResetAsk = true; renderSim(); setTimeout(function () { S.simResetAsk = false; if (S.tab === "sim") renderSim(); }, 4000); break; } S.simResetAsk = false; S.sim = null; S.simB = null; store("kv-sim", ""); if (S.db && S.uid) S.db.doc("data/users/" + S.uid + "/sim").set({ reset: new Date().toISOString() }); S.sub.sim = "oversigt"; renderAll(); toast("Simuleringen er nulstillet"); break;
      case "glclose": hideGloss(); break;
    }
  });
  document.addEventListener("input", function (ev) {
    var el = ev.target;
    if (el.id === "q") { S.f.q = el.value; var pos = el.selectionStart; renderOverview(); var n = $("q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }
    else if (el.id === "pfq") { S.pf_f.q = el.value; var p2 = el.selectionStart; renderProfile(); var n2 = $("pfq"); n2.focus(); try { n2.setSelectionRange(p2, p2); } catch (e) {} }
    else if (el.dataset.act === "slide") {
      var id = el.dataset.id, k = el.dataset.k, val = parseFloat(el.value);
      S.ov[id] = S.ov[id] || {}; S.ov[id][k] = val;
      $("slv-" + k).textContent = pc(val, 1); updateOverride(id);
    } else if (el.dataset.act === "setslide") {
      var k2 = el.dataset.k, v2 = parseFloat(el.value);
      $("slv-" + k2).textContent = k2 === "kellyFraction" ? nf(v2, 2) : pc(v2, k2 === "maxWeight" ? 0 : 2);
    } else if (el.id === "simQty") simUpdate();
    else if (el.id === "calcAmt") calcUpdate(el.dataset.id);
    else if (el.id === "tkQty") { if (tk().mode === "amount") tk().amount = el.value; else tk().qty = el.value; ticketPreview(); }
    else if (el.id === "tkLimit") { tk().limit = el.value; ticketPreview(); }
    else if (el.id === "glq") { S.glq = el.value; var gp = el.selectionStart; renderMethod(); var gq = $("glq"); if (gq) { gq.focus(); try { gq.setSelectionRange(gp, gp); } catch (e) {} } }
  });
  document.addEventListener("change", function (ev) {
    var el = ev.target;
    if (el.id === "sortSel") { S.f.sort = el.value; renderOverview(); }
    else if (el.id === "pfSort") { S.pf_f.sort = el.value; renderProfile(); }
    else if (el.id === "tStock") { S.lastStock = el.value; $("tPrice").value = ""; syncTradeFx(); }
    else if (el.id === "simPos") simUpdate();
    else if (el.id === "tkSid") { var t4 = tk(); t4.sid = el.value; t4.limit = String(+S.stocks[el.value].price.toPrecision(6)); renderSim(); }
    else if (el.id === "tkValid") { tk().validTo = el.value || TODAY; ticketPreview(); }
    else if (el.id === "alStock") { S.lastAlarmStock = el.value; var stA = S.stocks[el.value], ip = $("alPrice2"); if (stA && ip) ip.placeholder = "Kurs nu " + pxs(stA.price) + " " + curL(stA.currency); }
    else if (el.dataset.act === "setslide") { ensureOwnPf(); S.pf.settings[el.dataset.k] = parseFloat(el.value); save(); compute(); renderAll(); }
    else if (el.id === "glOn") { store("kv-gloss", el.checked ? "on" : "off"); toast(el.checked ? "Forklaringer slået til" : "Forklaringer slået fra"); renderAll(); }
    else if (el.id === "anW") { ensureOwnPf(); S.pf.settings.analystWeight = el.checked ? 1 : 0; save(); compute(); renderAll(); }
  });
  document.addEventListener("submit", function (ev) {
    var f = ev.target; ev.preventDefault();
    if (f.id === "tradeForm") {
      var sid = $("tStock").value, st = S.stocks[sid]; if (!st) return;
      var qty = parseFloat($("tQty").value), price = parseFloat($("tPrice").value), fx = st.currency === "DKK" ? 1 : parseFloat($("tFx").value), fee = parseFloat($("tFee").value) || 0, date = $("tDate").value || TODAY, acct = $("tAcct").value;
      if (!(qty > 0) || !(price > 0) || !(fx > 0)) { toast("Udfyld antal, kurs og valutakurs."); return; }
      ensureOwnPf();
      if (S.tradeType === "sell") {
        var have = 0; E.buildPortfolio(S.pf.lots, S.pf.sales, S.stocks, S.macro, {}).positions.forEach(function (p) { if (p.stockId === sid && p.account === acct) have = p.qty; });
        if (qty > have + 1e-9) { toast("Du ejer kun " + nf(have) + " stk. på denne konto."); return; }
      }
      var rec = { id: Math.random().toString(36).slice(2, 10), stockId: sid, account: acct, date: date, qty: qty, price: price, currency: st.currency, fx: fx, fee: fee };
      S.pf[S.tradeType === "sell" ? "sales" : "lots"].push(rec);
      S.lastStock = sid; S.seg.handler = "liste"; save(); compute(); renderAll();
    } else if (f.id === "setForm") {
      ensureOwnPf();
      S.pf.settings.cash = parseFloat($("sCash").value) || 0; S.pf.settings.married = $("sMarried").checked; S.pf.lossCarry = parseFloat($("sCarry").value) || 0;
      save(); compute(); renderAll();
    } else if (f.id === "tkForm") { simSubmit();
    } else if (f.id === "simStartForm") { var c1 = parseFloat($("simCash").value); if (!(c1 >= 1000)) { toast("Startkapitalen skal være mindst 1.000 kr."); return; } simStart(c1); S.sub.sim = "handl"; compute(); renderAll(); toast("Simuleringen er startet med " + kr(c1));
    } else if (f.id === "alarmForm") {
      var pa = parseFloat(($("alPrice").value || "").replace(",", ".")); addAlarm(f.dataset.id, pa); compute(); renderAll();
    } else if (f.id === "alarmForm2") {
      var sA = $("alStock").value, pb = parseFloat(($("alPrice2").value || "").replace(",", ".")); S.lastAlarmStock = sA; addAlarm(sA, pb); compute(); renderAll();
    } else if (f.id === "watchForm") {
      var q = ($("watchQ").value || "").trim(); if (!q) return;
      ensureOwnPf(); S.pf.watch.push({ q: q.slice(0, 60), date: TODAY, status: "afventer" }); save(); renderOverview();
    }
  });
  document.addEventListener("keydown", function (ev) {
    var tg = ev.target && ev.target.tagName;
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("gl")) { ev.preventDefault(); showGloss(ev.target.dataset.k, ev.target); return; }
    if (ev.key === "Escape" && $("gpop") && !$("gpop").hidden) { hideGloss(); return; }
    if (ev.key === "Escape" && (S.detail || S.cmpOpen)) closeDetail();
    else if (S.detail && !S.cmpOpen && (ev.key === "ArrowRight" || ev.key === "ArrowLeft") && tg !== "INPUT" && tg !== "SELECT" && tg !== "TEXTAREA") navStep(ev.key === "ArrowRight" ? 1 : -1);
    else if (ev.key === "/" && !S.detail && tg !== "INPUT" && tg !== "TEXTAREA") { ev.preventDefault(); var b = document.querySelector('[data-act="qsearch"]'); if (b) b.click(); }
  });
  (function () {
    var sw = null, sh = $("sheet");
    sh.addEventListener("touchstart", function (e) { if (!S.detail || S.cmpOpen || e.touches.length !== 1 || e.target.closest(".chart,.ladder,input,select,textarea,.scatter")) { sw = null; return; } sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
    sh.addEventListener("touchend", function (e) { if (!sw) return; var p = e.changedTouches[0], dx = p.clientX - sw.x, dy = p.clientY - sw.y, ok = Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5 && Date.now() - sw.t < 700; sw = null; if (ok) navStep(dx < 0 ? 1 : -1); }, { passive: true });
  })();
  window.addEventListener("scroll", hideGloss, { passive: true });
  $("sheet").addEventListener("scroll", hideGloss, { passive: true });
  var rT = 0; window.addEventListener("resize", function () { hideGloss(); clearTimeout(rT); rT = setTimeout(function () { if (S.cmpOpen) drawCmpChart(S.cmp.filter(function (x) { return S.A[x]; })); if (S.detail) { if (S.sub.detail === "kurs") drawPriceChart(); if (S.sub.detail === "risiko" && S.seg.risiko === "udfald") drawFan(); } if (S.tab === "profile" && S.sub.profile === "udvikling" && S.seg.udv !== "gt") drawValueChart(S.port.positions); }, 200); });

  function downloadReport() {
    var txt = reportText(), name = "skatterapport-" + YEAR + ".txt";
    if (!S.dl) { toast("Download er ikke tilgængelig her – rapporten er kopieret."); try { navigator.clipboard.writeText(txt); } catch (e) {} return; }
    S.dl.save({ filename: name, data: txt }).then(function () { toast("Rapporten er gemt"); }, function (e) { if (e && e.code === "declined") return; toast("Kunne ikke gemme filen."); });
  }

  // stocks are stored with parallel date/close arrays; rebuild [date, close] pairs for the engine
  function normStock(d) {
    var x = clone(d);
    function zip(D, C) { var out = []; (D || []).forEach(function (dd, i) { if (fin(C[i])) out.push([dd, C[i]]); }); return out; }
    if (!x.monthly) x.monthly = zip(x.monthlyD, x.monthlyC || []);
    if (!x.daily) x.daily = zip(x.dailyD, x.dailyC || []);
    if (!x.monthly.length || !x.daily.length || !fin(x.price) || !x.fund || !x.hist) return null;
    x.est = x.est || {}; x.events = x.events || {}; x.news = x.news || []; x.sources = x.sources || [];
    return x;
  }

  // ---------- boot ----------
  window.__kvToast = toast;
  window.__kvRender = function () { renderAll(); };
  if (window.KV_WORKER) { var rb = $("refreshBtn"); if (rb) rb.hidden = false; }
  applyView();
  if (!load("kv-glhint")) setTimeout(function () { if (Object.keys(S.A).length) { toast("Tip: tryk på ord med prikket understregning for en forklaring"); store("kv-glhint", "1"); } }, 2500);
  try { var savedSub = JSON.parse(load("kv-sub") || "null"); if (savedSub) Object.keys(savedSub).forEach(function (k) { if (S.sub[k] && k !== "detail" && SUBS[k] && SUBS[k].some(function (x) { return x[0] === savedSub[k]; })) { S.sub[k] = savedSub[k]; S.subChosen = true; } }); } catch (e) {}
  var initialTab = (location.hash || "").replace("#", "");
  var tabMap = { overblik: "overview", profil: "profile", skat: "tax", simuler: "sim", metode: "method" };
  var savedTab = load("kv-tab");
  setTab(tabMap[initialTab] || (savedTab && SUBS[savedTab] ? savedTab : "overview"));
  var cached = load("kv-pf");
  function useLocal() { if (cached) { try { S.pf = JSON.parse(cached); S.example = isEmptyPf(S.pf); } catch (e) {} } }
  if (!window.claude || !window.claude.use) { S.dbState = "off"; useLocal(); renderAll(); return; }
  window.claude.use("downloads").then(function (d) { S.dl = d; }, function () {});
  Promise.all([window.claude.use("db"), window.claude.use("user")]).then(function (res) {
    S.db = res[0]; S.user = res[1];
    if (!S.db) { S.dbState = "off"; useLocal(); renderAll(); return; }
    S.dbState = "on";
    var onErr = function (e) { console.warn("db", e && e.code); };
    S.db.collection("stocks").onSnapshot(function (snap) { var o = {}; snap.docs.forEach(function (d) { if (d.exists) { var x = normStock(d.data()); if (x) o[d.id] = x; } }); S.stocks = o; schedule(); }, onErr);
    S.db.doc("meta/status").onSnapshot(function (d) { S.meta = d.exists ? d.data() : null; schedule(); }, onErr);
    S.db.doc("rules/dk").onSnapshot(function (d) { S.rules = d.exists ? d.data() : null; schedule(); }, onErr);
    S.db.doc("macro/current").onSnapshot(function (d) { S.macro = d.exists ? d.data() : null; schedule(); }, onErr);
    (S.user ? S.user.id() : Promise.resolve(null)).then(function (uid) {
      S.uid = uid;
      if (!uid) { useLocal(); schedule(); return; }
      S.db.doc("data/users/" + uid + "/sim").onSnapshot(function (d) {
        if (simSaving) return;
        var x = d.exists ? d.data() : null;
        if (x && x.start && Array.isArray(x.orders)) { S.sim = clone(x); store("kv-sim", JSON.stringify(S.sim)); }
        else if (x && x.reset) { S.sim = null; store("kv-sim", ""); }
        else if (!x && S.sim) flushSim();
        schedule();
      }, onErr);
      S.db.doc("data/users/" + uid + "/prefs").onSnapshot(function (d) {
        if (prefSaving) return;
        if (d.exists) { var pd = d.data() || {}; S.prefs = { fav: Array.isArray(pd.fav) ? pd.fav : [], alarms: Array.isArray(pd.alarms) ? pd.alarms : [] }; store("kv-prefs", JSON.stringify(S.prefs)); }
        else if (S.prefs.fav.length || S.prefs.alarms.length) flushPrefs();
        schedule();
      }, onErr);
      S.db.doc("data/users/" + uid + "/portfolio").onSnapshot(function (d) {
        if (saving) return;
        if (d.exists) { S.pf = clone(d.data()); S.example = isEmptyPf(S.pf); }
        else { S.pf = null; S.example = true; }
        schedule();
      }, onErr);
    });
  }, function () { S.dbState = "off"; useLocal(); renderAll(); });
})();
