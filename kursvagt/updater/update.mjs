// Kursvagt updater – run by the GitHub Action (.github/workflows/kursvagt.yml) about every 30 minutes.
// Reads and writes the market data in <data dir> (default kursvagt/data):
//   index.json  – groups + updatedAt        s*.json – stocks (25–26 per file)     c*.json – crypto
//   macro.json  – FX + risk-free rates     rules.json – Danish tax rules           meta.json – status, changelog, errors
// Sources: Yahoo Finance (stock prices, FX, fundamentals), CoinPaprika (crypto), Kraken (history for new crypto).
// Usage: node kursvagt/updater/update.mjs [dataDir]

import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { yahooSession, fetchFundamentals, applyFundamentals } from "./fundamentals.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.argv[2] || path.join(HERE, "..", "data"));
const SEED = path.join(HERE, "seed");
const CANDIDATES = JSON.parse(fs.readFileSync(path.join(HERE, "candidates.json"), "utf8"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const FX_SYMBOLS = { EUR: "EURDKK=X", USD: "USDDKK=X", SEK: "SEKDKK=X", NOK: "NOKDKK=X", CHF: "CHFDKK=X" };
const CRYPTO_TARGET = 100, GROUP_MAX = 25, FUND_PER_RUN = 30, FUND_MAX_AGE_H = 20, ADD_PER_RUN = 5;
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const wr = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o));

// ---------- helpers ----------
async function getJSON(url, tries = 2) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (r.ok) return r.json();
    if (i + 1 >= tries || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error("HTTP " + r.status + " " + url.split("?")[0]);
    await sleep(1500 * (i + 1));
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); }
function localDate(tsSec, tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(tsSec * 1000)); }
  catch (e) { return new Date(tsSec * 1000).toISOString().slice(0, 10); }
}
function putPoint(d, date, close) {
  if (!(close > 0)) return;
  const D = d.dailyD || (d.dailyD = []), C = d.dailyC || (d.dailyC = []);
  const i = D.indexOf(date);
  if (i >= 0) C[i] = close;
  else if (!D.length || date > D[D.length - 1]) { D.push(date); C.push(close); }
  else { let j = D.findIndex((x) => x > date); if (j < 0) j = D.length; D.splice(j, 0, date); C.splice(j, 0, close); return; }
  const ym = date.slice(0, 7), MD = d.monthlyD || (d.monthlyD = []), MC = d.monthlyC || (d.monthlyC = []);
  const last = MD[MD.length - 1];
  if (last === ym) { if (date >= D[D.length - 1]) MC[MC.length - 1] = close; }
  else if (!last || ym > last) { MD.push(ym); MC.push(close); }
}
function trim(d) {
  if (d.dailyD && d.dailyD.length > 260) { const k = d.dailyD.length - 260; d.dailyD.splice(0, k); d.dailyC.splice(0, k); }
  if (d.monthlyD && d.monthlyD.length > 130) { const k = d.monthlyD.length - 130; d.monthlyD.splice(0, k); d.monthlyC.splice(0, k); }
}
async function yahooChart(sym, range) {
  let j;
  try { j = await getJSON("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?range=" + range + "&interval=1d"); }
  catch (e) { j = await getJSON("https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?range=" + range + "&interval=1d"); }
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.meta) throw new Error("ingen data for " + sym);
  const tz = r.meta.exchangeTimezoneName, ts = r.timestamp || [], cl = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  const pts = []; ts.forEach((t, i) => { if (cl[i] > 0) pts.push([localDate(t, tz), cl[i]]); });
  const pdate = r.meta.regularMarketTime ? localDate(r.meta.regularMarketTime, tz) : (pts.length ? pts[pts.length - 1][0] : today());
  return { currency: r.meta.currency, price: r.meta.regularMarketPrice, pdate, pts };
}

// ---------- init ----------
if (!fs.existsSync(path.join(DATA, "index.json"))) {
  fs.mkdirSync(DATA, { recursive: true });
  for (const f of fs.readdirSync(SEED)) fs.copyFileSync(path.join(SEED, f), path.join(DATA, f));
  console.log("Startdata kopieret fra seed/");
}
const index = rd("index.json");
const groups = index.groups;
const files = Object.fromEntries(groups.map((g) => [g.g, rd(g.g + ".json")]));
const macro = rd("macro.json"), meta = rd("meta.json");
const errors = { kurser: [], krypto: [], valuta: [], noegletal: [], nye: [] };
const t0 = Date.now();

// ---------- 1. FX ----------
let fxOk = 0;
await pool(Object.entries(FX_SYMBOLS), 5, async ([c, s]) => {
  try { const q = await yahooChart(s, "5d"); if (q.price > 0) { macro.fx[c] = +q.price.toFixed(4); fxOk++; } }
  catch (e) { errors.valuta.push(c + ": " + e.message); }
});
if (fxOk) macro.fxDate = today();

// ---------- 2. stock prices ----------
const stocks = groups.filter((g) => g.kind === "s").flatMap((g) => files[g.g]);
let nStock = 0;
await pool(stocks, 6, async (d) => {
  if (!d.yahoo) return;
  try {
    const q = await yahooChart(d.yahoo, (d.dailyD || []).length < 40 ? "3mo" : "1mo");
    if (q.currency && q.currency !== d.currency) throw new Error("valuta " + q.currency + " ≠ " + d.currency);
    if (!(q.price > 0)) throw new Error("ingen kurs");
    if (d.price > 0 && Math.abs(q.price / d.price - 1) > 0.6) throw new Error("kursspring " + d.price + " → " + q.price + " (tjek for split)");
    q.pts.forEach((p) => putPoint(d, p[0], p[1]));
    putPoint(d, q.pdate, q.price);
    d.price = q.price; d.priceDate = q.pdate; d.updatedAt = today();
    trim(d); nStock++;
  } catch (e) { errors.kurser.push(d.id + ": " + e.message); }
});

// ---------- 3. crypto prices ----------
const coins = groups.filter((g) => g.kind === "c").flatMap((g) => files[g.g]);
let nCoin = 0;
await pool(coins, 4, async (d) => {
  if (!d.paprikaId) return;
  try {
    const t = await getJSON("https://api.coinpaprika.com/v1/tickers/" + d.paprikaId, 3);
    const q = t.quotes && t.quotes.USD;
    if (!q || !(q.price > 0)) throw new Error("ingen kurs");
    const date = (t.last_updated || new Date().toISOString()).slice(0, 10);
    putPoint(d, date, q.price);
    d.price = q.price; d.priceDate = date; d.updatedAt = today();
    if (typeof q.percent_change_24h === "number") d.chg24h = q.percent_change_24h / 100;
    if (t.rank > 0 && t.rank < 5000) d.rank = t.rank;
    d.fund = d.fund || {};
    if (q.market_cap > 0) d.fund.marketCap = q.market_cap;
    if (d.ath != null && q.ath_price > 0) d.ath = q.ath_price;
    d.fund.statsPrice = q.price; d.fund.statsDate = date;
    trim(d); nCoin++;
  } catch (e) { errors.krypto.push(d.id + ": " + e.message); }
});

// ---------- 4. fundamentals (stalest first) ----------
const cutoff = Date.now() - FUND_MAX_AGE_H * 3600e3;
const stale = stocks.filter((d) => d.yahoo && (!d.fundCheckedAt || Date.parse(d.fundCheckedAt) < cutoff))
  .sort((a, b) => (a.fundCheckedAt || "").localeCompare(b.fundCheckedAt || "")).slice(0, FUND_PER_RUN);
let nFund = 0;
if (stale.length) {
  try {
    let session = await yahooSession();
    for (const d of stale) {
      d.fundCheckedAt = new Date().toISOString();
      try {
        let patch;
        try { patch = await fetchFundamentals(d, session, macro); }
        catch (e) { if (!e.auth) throw e; session = await yahooSession(true); patch = await fetchFundamentals(d, session, macro); }
        applyFundamentals(d, patch).forEach((w) => errors.noegletal.push(d.id + ": " + w));
        nFund++;
      } catch (e) { errors.noegletal.push(d.id + ": " + e.message); }
      await sleep(400);
    }
  } catch (e) { errors.noegletal.push("Yahoo: " + e.message); }
}
delete macro.fxChanged;

// ---------- 5. more crypto (until 100) ----------
const added = [];
if (coins.length < CRYPTO_TARGET) {
  const have = new Set(coins.map((d) => d.ticker));
  const failed = new Set(meta.cryptoFailed || []);
  const todo = CANDIDATES.filter((c) => !have.has(c.sym) && !failed.has(c.sym)).slice(0, Math.min(ADD_PER_RUN, CRYPTO_TARGET - coins.length));
  for (const c of todo) {
    try { added.push(await buildCoin(c)); }
    catch (e) { failed.add(c.sym); errors.nye.push(c.sym + ": " + e.message); }
  }
  meta.cryptoFailed = [...failed];
  for (const d of added) {
    let last = groups.filter((g) => g.kind === "c").pop();
    if (!last || files[last.g].length >= GROUP_MAX) { last = { g: "c" + groups.filter((g) => g.kind === "c").length, kind: "c", n: 0 }; groups.push(last); files[last.g] = []; }
    files[last.g].push(d); last.n = files[last.g].length;
  }
}
async function buildCoin(c) {
  let pid = c.pid;
  if (!pid) {
    const s = await getJSON("https://api.coinpaprika.com/v1/search?q=" + encodeURIComponent(c.sym) + "&c=currencies&limit=10");
    const hits = (s.currencies || []).filter((x) => (x.symbol || "").toUpperCase() === c.sym.toUpperCase() && x.rank > 0).sort((a, b) => a.rank - b.rank);
    if (!hits.length) throw new Error("ikke fundet hos CoinPaprika");
    pid = hits[0].id;
  }
  const t = await getJSON("https://api.coinpaprika.com/v1/tickers/" + pid, 3);
  const q = t.quotes && t.quotes.USD;
  if (!q || !(q.price > 0)) throw new Error("ingen kurs");
  const since = Math.floor(Date.now() / 1000) - 400 * 86400;
  const k = await getJSON("https://api.kraken.com/0/public/OHLC?pair=" + c.sym + "USD&interval=1440&since=" + since);
  if (k.error && k.error.length) throw new Error("Kraken: " + k.error.join(","));
  const key = Object.keys(k.result || {}).find((x) => x !== "last");
  const d = {
    id: "C-" + c.sym, name: c.name, ticker: c.sym, exchange: "CRYPTO", currency: "USD", sector: c.cat, country: "", model: "crypto", type: "Kryptovaluta", cyclical: false,
    price: q.price, priceDate: today(), split: null, rank: t.rank, chg24h: q.percent_change_24h / 100, ath: q.ath_price || null, paprikaId: pid,
    fund: { marketCap: q.market_cap || null, beta: null, statsPrice: q.price, statsDate: today() },
    hist: { years: [], revenue: null, netIncome: null, eps: [], dps: [], fcf: null, margin: [] },
    est: { target: null, consensus: null }, events: {}, news: [], note: c.note, updatedAt: today(),
    sources: [{ label: "Aktuel kurs og markedsværdi (CoinPaprika)", url: "https://coinpaprika.com/coin/" + pid + "/" }, { label: "Kurshistorik (Kraken)", url: "https://api.kraken.com/0/public/OHLC?pair=" + c.sym + "USD&interval=1440" }],
    monthlyD: [], monthlyC: [], dailyD: [], dailyC: [],
  };
  (key ? k.result[key] : []).forEach((r) => putPoint(d, new Date(r[0] * 1000).toISOString().slice(0, 10), +r[4]));
  putPoint(d, today(), q.price);
  if (d.monthlyD.length < 12) throw new Error("for kort kurshistorik (" + d.monthlyD.length + " mdr.)");
  trim(d);
  return d;
}

// ---------- 6. status + write ----------
const now = new Date().toISOString();
meta.updatedAt = now; meta.priceAsOf = today();
meta.nextRun = "automatisk ca. hver halve time";
meta.schedule = "Aktiekurser, valuta, regnskabstal, nøgletal og kursmål hentes af en GitHub Action ca. hver halve time (regnskabstal ca. én gang i døgnet pr. aktie). Kryptokurser hentes også direkte i appen, når du åbner den eller trykker ↻.";
const errList = Object.entries(errors).filter(([, v]) => v.length);
meta.lastErrors = Object.fromEntries(errList.map(([k, v]) => [k, { at: now, n: v.length, errors: v.slice(0, 8) }]));
meta.changelog = meta.changelog || [];
if (added.length) meta.changelog.unshift({ date: today(), text: "Nye kryptovalutaer tilføjet: " + added.map((d) => d.name).join(", ") + "." });
if (!meta.changelog.some((c) => /GitHub/.test(c.text)))
  meta.changelog.unshift({ date: today(), text: "Flyttet til GitHub Pages: kurser, valuta, regnskabstal, nøgletal og kursmål hentes nu automatisk af en GitHub Action. Dine egne data gemmes kun på din enhed." });
meta.changelog = meta.changelog.slice(0, 20);
for (const g of groups) { g.n = files[g.g].length; wr(g.g + ".json", files[g.g]); }
wr("macro.json", macro); wr("meta.json", meta);
if (!fs.existsSync(path.join(DATA, "rules.json"))) fs.copyFileSync(path.join(SEED, "rules.json"), path.join(DATA, "rules.json"));
wr("index.json", { groups, updatedAt: now });

console.log(`Kurser ${nStock}/${stocks.length} · krypto ${nCoin}/${coins.length} · valuta ${fxOk}/5 · nøgletal ${nFund}/${stale.length} · nye krypto ${added.length} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const [k, v] of errList) console.log("Fejl (" + k + "):\n  " + v.join("\n  "));
