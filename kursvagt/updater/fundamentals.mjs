// Kursvagt – automatic fundamentals from Yahoo Finance (used by update.mjs in the GitHub Action).
// Per stock: quoteSummary (key figures, analyst targets, calendar), fundamentals-timeseries (5 years of
// income statement, cash flow and balance sheet) and the dividend history from the chart API.
// Every per-share figure is derived so that it is in the stock's quote currency (works for ADRs and
// companies that report in another currency); statement amounts are converted with Yahoo FX rates.
// Piotroski F-score, Altman Z-score and ROIC are computed here from the statements.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const Q1 = "https://query1.finance.yahoo.com", Q2 = "https://query2.finance.yahoo.com";
const TS_TYPES = ["TotalRevenue", "NetIncome", "DilutedEPS", "FreeCashFlow", "OperatingCashFlow", "EBIT", "GrossProfit", "TotalAssets",
  "CurrentAssets", "CurrentLiabilities", "LongTermDebt", "RetainedEarnings", "TotalLiabilitiesNetMinorityInterest", "OrdinarySharesNumber",
  "InvestedCapital", "TaxRateForCalcs", "StockholdersEquity"];
const num = (v) => typeof v === "number" && isFinite(v);
const raw = (o) => (o && typeof o === "object" ? (num(o.raw) ? o.raw : null) : num(o) ? o : null);

// ---------- Yahoo session (cookie + crumb), kept in memory for the run ----------
let SESSION = null;
export async function yahooSession(force) {
  if (SESSION && !force) return SESSION;
  let cookie = "";
  for (const u of ["https://fc.yahoo.com/", "https://finance.yahoo.com/"]) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "manual" });
      const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""];
      cookie = sc.map((s) => s.split(";")[0]).filter((s) => /^(A1|A3|B)=/.test(s)).join("; ");
      if (cookie) break;
    } catch (e) {}
  }
  if (!cookie) throw new Error("Yahoo-cookie kunne ikke hentes");
  const r = await fetch(Q1 + "/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await r.text()).trim();
  if (!r.ok || !crumb || crumb.length > 40 || /[<{]/.test(crumb)) throw new Error("Yahoo-crumb kunne ikke hentes (" + r.status + ")");
  SESSION = { cookie, crumb };
  return SESSION;
}

async function yget(url, session) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", Cookie: session ? session.cookie : "" } });
  if (r.status === 401 || r.status === 403) { const e = new Error("auth"); e.auth = true; throw e; }
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// FX: kroner per unit, Yahoo "XXXDKK=X"; cached in macro.fx (also for currencies like TWD)
export async function fxOf(cur, macro) {
  if (!cur) return null;
  if (cur === "DKK") return 1;
  macro.fx = macro.fx || { DKK: 1 };
  if (num(macro.fx[cur])) return macro.fx[cur];
  try {
    const j = await yget(Q1 + "/v8/finance/chart/" + cur + "DKK=X?range=5d&interval=1d");
    const p = j.chart.result[0].meta.regularMarketPrice;
    if (p > 0) { macro.fx[cur] = +p.toFixed(6); macro.fxChanged = true; return macro.fx[cur]; }
  } catch (e) {}
  return null;
}

// ---------- fetch everything for one stock and return a patch ----------
export async function fetchFundamentals(doc, session, macro) {
  const sym = doc.yahoo, enc = encodeURIComponent(sym);
  const modules = "financialData,defaultKeyStatistics,summaryDetail,calendarEvents,earningsTrend,price";
  const now = Math.floor(Date.now() / 1000), p1 = now - 7 * 365 * 86400;
  const tsUrl = Q2 + "/ws/fundamentals-timeseries/v1/finance/timeseries/" + enc + "?symbol=" + enc + "&period1=" + p1 + "&period2=" + now + "&type=" +
    TS_TYPES.map((t) => "annual" + t).concat(["trailingTotalRevenue", "trailingNetIncome", "trailingDilutedEPS", "trailingFreeCashFlow"]).join(",");
  const [qs, ts, ch] = await Promise.all([
    yget(Q2 + "/v10/finance/quoteSummary/" + enc + "?modules=" + modules + "&crumb=" + encodeURIComponent(session.crumb), session),
    yget(tsUrl, session).catch(() => null),
    yget(Q1 + "/v8/finance/chart/" + enc + "?range=6y&interval=1mo&events=div", session).catch(() => null),
  ]);
  const R = qs && qs.quoteSummary && qs.quoteSummary.result && qs.quoteSummary.result[0];
  if (!R) throw new Error("ingen nøgletal fra Yahoo");
  const fd = R.financialData || {}, ks = R.defaultKeyStatistics || {}, sd = R.summaryDetail || {}, pr = R.price || {}, cal = R.calendarEvents || {};
  const quoteCur = pr.currency || sd.currency || doc.currency;
  if (quoteCur !== doc.currency) throw new Error("valuta " + quoteCur + " ≠ " + doc.currency);
  const P = raw(pr.regularMarketPrice) || raw(fd.currentPrice) || doc.price;
  const finCur = fd.financialCurrency || quoteCur;
  const fxQ = await fxOf(quoteCur, macro), fxF = await fxOf(finCur, macro);
  const conv = fxQ && fxF ? fxF / fxQ : (finCur === quoteCur ? 1 : null); // financial currency -> quote currency

  // per-share figures in the quote currency (derived from multiples, so ADR ratios and currencies never mix)
  const pe = raw(sd.trailingPE), fpe = raw(sd.forwardPE) || raw(ks.forwardPE), pb = raw(ks.priceToBook);
  let eps = pe > 0 ? P / pe : null;
  if (eps == null && raw(ks.trailingEps) != null && conv) eps = raw(ks.trailingEps) * (finCur === quoteCur ? 1 : conv);
  const fwdEps = fpe > 0 ? P / fpe : null;
  const bvps = pb > 0 ? P / pb : (raw(ks.bookValue) != null && conv ? raw(ks.bookValue) * conv : null);
  const dps = raw(sd.dividendRate) != null ? raw(sd.dividendRate) : (raw(sd.trailingAnnualDividendRate) || null);
  const divYield = raw(sd.dividendYield) != null ? raw(sd.dividendYield) : (dps && P ? dps / P : null);
  const cash = raw(fd.totalCash), debt = raw(fd.totalDebt);

  const fund = {
    eps, fwdEps, bvps, dps: dps || null, divYield: divYield || null, payout: raw(sd.payoutRatio),
    roe: raw(fd.returnOnEquity), beta: raw(sd.beta) || raw(ks.beta), shares: raw(ks.sharesOutstanding),
    pe: pe || (eps > 0 ? P / eps : null), fwdPe: fpe, pb: pb || (bvps > 0 ? P / bvps : null), evEbitda: raw(ks.enterpriseToEbitda),
    fcf: raw(fd.freeCashflow) != null && conv ? raw(fd.freeCashflow) * conv : null,
    netCash: cash != null && debt != null && conv ? (cash - debt) * conv : null,
    debtToEquity: raw(fd.debtToEquity) != null ? raw(fd.debtToEquity) / 100 : null,
    operatingMargin: raw(fd.operatingMargins), marketCap: raw(sd.marketCap) || raw(pr.marketCap),
    revenueTtm: raw(fd.totalRevenue) != null && conv ? raw(fd.totalRevenue) * conv : null,
    statsPrice: P, statsDate: new Date().toISOString().slice(0, 10),
  };

  // statements (annual, last 5 years + TTM)
  const series = {};
  ((ts && ts.timeseries && ts.timeseries.result) || []).forEach((r) => {
    const t = r.meta && r.meta.type && r.meta.type[0]; if (!t || !Array.isArray(r[t])) return;
    series[t] = r[t].filter((x) => x && x.reportedValue && num(x.reportedValue.raw)).map((x) => ({ d: x.asOfDate, v: x.reportedValue.raw, cur: x.currencyCode }));
  });
  const years = (series.annualTotalRevenue || series.annualNetIncome || []).map((x) => x.d).sort().slice(-5);
  const at = (t, d) => { const x = (series[t] || []).find((y) => y.d === d); return x ? x.v : null; };
  const last = (t) => { const s = series[t] || []; return s.length ? s[s.length - 1].v : null; };
  let hist = null, extra = {};
  if (years.length >= 2 && conv) {
    const c = (v) => (v == null ? null : v * conv);
    const rev = years.map((d) => c(at("annualTotalRevenue", d))), ni = years.map((d) => c(at("annualNetIncome", d)));
    let epsH = years.map((d) => c(at("annualDilutedEPS", d))), fcfH = years.map((d) => c(at("annualFreeCashFlow", d)));
    const ttmRev = c(last("trailingTotalRevenue")), ttmNi = c(last("trailingNetIncome")), ttmFcf = c(last("trailingFreeCashFlow"));
    let ttmEps = c(last("trailingDilutedEPS"));
    // per-share scale fix (ADR ratio / share class): match TTM EPS to the multiple-derived EPS
    if (eps && ttmEps && Math.sign(eps) === Math.sign(ttmEps)) {
      const k = eps / ttmEps;
      if (k > 1.6 || k < 0.6) { epsH = epsH.map((v) => (v == null ? null : v * k)); ttmEps = eps; }
    }
    // dividends per year from the chart's dividend events (already in the quote currency)
    const divs = {};
    const ev = ch && ch.chart && ch.chart.result && ch.chart.result[0] && ch.chart.result[0].events && ch.chart.result[0].events.dividends;
    if (ev) Object.values(ev).forEach((x) => { const y = new Date(x.date * 1000).getUTCFullYear(); divs[y] = (divs[y] || 0) + x.amount; });
    const dpsH = years.map((d) => { const y = +d.slice(0, 4); return divs[y] != null ? +divs[y].toFixed(4) : null; });
    const lab = years.map((d) => "FY" + d.slice(0, 4));
    hist = {
      years: lab.concat(["TTM"]), revenue: rev.concat([ttmRev]), netIncome: ni.concat([ttmNi]), eps: epsH.concat([ttmEps != null ? ttmEps : eps]),
      dps: dpsH.concat([null]), fcf: fcfH.concat([ttmFcf]),
      margin: rev.concat([ttmRev]).map((r, i) => { const n = ni.concat([ttmNi])[i]; return r && n != null ? n / r : null; }),
    };
    if (hist.fcf.every((v) => v == null)) hist.fcf = null;

    // quality scores from the two latest annual statements
    const y1 = years[years.length - 1], y0 = years[years.length - 2];
    const g = (t, d) => at("annual" + t, d);
    const ta1 = g("TotalAssets", y1), ta0 = g("TotalAssets", y0);
    if (ta1 && ta0) {
      let f = 0, n = 0; const add = (cond) => { if (cond == null) return; n++; if (cond) f++; };
      const roa1 = g("NetIncome", y1) / ta1, roa0 = g("NetIncome", y0) / ta0, cfo1 = g("OperatingCashFlow", y1);
      add(roa1 > 0); add(cfo1 != null ? cfo1 > 0 : null); add(roa1 > roa0); add(cfo1 != null ? cfo1 / ta1 > roa1 : null);
      const lev1 = g("LongTermDebt", y1), lev0 = g("LongTermDebt", y0); add(lev1 != null && lev0 != null ? lev1 / ta1 <= lev0 / ta0 : null);
      const ca1 = g("CurrentAssets", y1), cl1 = g("CurrentLiabilities", y1), ca0 = g("CurrentAssets", y0), cl0 = g("CurrentLiabilities", y0);
      add(ca1 && cl1 && ca0 && cl0 ? ca1 / cl1 > ca0 / cl0 : null);
      const sh1 = g("OrdinarySharesNumber", y1), sh0 = g("OrdinarySharesNumber", y0); add(sh1 && sh0 ? sh1 <= sh0 * 1.005 : null);
      const gp1 = g("GrossProfit", y1), gp0 = g("GrossProfit", y0), r1 = g("TotalRevenue", y1), r0 = g("TotalRevenue", y0);
      add(gp1 && gp0 && r1 && r0 ? gp1 / r1 > gp0 / r0 : null); add(r1 && r0 ? r1 / ta1 > r0 / ta0 : null);
      if (n >= 7) extra.piotroski = Math.round(f * 9 / n);
      const tl = g("TotalLiabilitiesNetMinorityInterest", y1), re = g("RetainedEarnings", y1), ebit = g("EBIT", y1);
      const mcapFin = fund.marketCap && conv ? fund.marketCap / conv : null;
      if (ca1 != null && cl1 != null && re != null && ebit != null && tl && mcapFin && r1)
        extra.altmanZ = +(1.2 * (ca1 - cl1) / ta1 + 1.4 * re / ta1 + 3.3 * ebit / ta1 + 0.6 * mcapFin / tl + 1.0 * r1 / ta1).toFixed(2);
      const ic = g("InvestedCapital", y1), tax = g("TaxRateForCalcs", y1);
      if (ebit != null && ic > 0) extra.roic = +(ebit * (1 - (num(tax) ? tax : 0.22)) / ic).toFixed(4);
    }
  }

  // analysts + estimates + calendar
  const trend = ((R.earningsTrend && R.earningsTrend.trend) || []);
  const ny = trend.find((t) => t.period === "+1y") || {}, cy = trend.find((t) => t.period === "0y") || {};
  const rk = { strong_buy: "Strong Buy", buy: "Buy", hold: "Hold", underperform: "Sell", sell: "Strong Sell" }[fd.recommendationKey] || null;
  const tgt = raw(fd.targetMeanPrice), okT = (v) => (v && P && v / P > 0.2 && v / P < 5 ? v : null);
  const est = {
    revGrowth: raw(ny.revenueEstimate && ny.revenueEstimate.growth) != null ? raw(ny.revenueEstimate.growth) : raw(cy.revenueEstimate && cy.revenueEstimate.growth),
    epsGrowth: raw(ny.growth) != null ? raw(ny.growth) : raw(cy.growth),
    epsNext: fwdEps, target: okT(tgt), targetLow: okT(raw(fd.targetLowPrice)), targetHigh: okT(raw(fd.targetHighPrice)),
    consensus: rk, analysts: raw(fd.numberOfAnalystOpinions),
  };
  const ed = cal.earnings && cal.earnings.earningsDate && cal.earnings.earningsDate.map(raw).filter(num).sort()[0];
  const xd = raw(cal.exDividendDate) || raw(sd.exDividendDate);
  const iso = (s) => new Date(s * 1000).toISOString().slice(0, 10);
  const events = { earnings: ed ? iso(ed) : null, exDiv: xd ? iso(xd) : null };
  return { fund, extra, hist, est, events, finCur, conv };
}

// merge a patch into the stock doc; keep old values where Yahoo has nothing, and refuse implausible jumps
export function applyFundamentals(doc, p) {
  const warn = [];
  const f = doc.fund = doc.fund || {};
  const oldEps = f.eps;
  Object.entries(p.fund).forEach(([k, v]) => { if (v != null && num(v)) f[k] = v; });
  Object.entries(p.extra).forEach(([k, v]) => { if (num(v)) f[k] = v; });
  if (num(oldEps) && num(f.eps) && Math.abs(oldEps) > 0 && Math.abs(f.eps / oldEps) > 8) warn.push("EPS ændret fra " + oldEps.toFixed(2) + " til " + f.eps.toFixed(2) + " – tjek");
  if (p.hist && p.hist.years.length >= 3) doc.hist = p.hist;
  const e = doc.est = doc.est || {};
  Object.entries(p.est).forEach(([k, v]) => { if (v != null) e[k] = v; });
  doc.events = doc.events || {};
  const today = new Date().toISOString().slice(0, 10);
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
  if (p.events.earnings && p.events.earnings >= twoDaysAgo) doc.events.earnings = p.events.earnings;
  else if (doc.events.earnings && doc.events.earnings < twoDaysAgo) doc.events.earnings = null; // passed – wait for the next date
  if (p.events.exDiv) doc.events.exDiv = p.events.exDiv;
  if (p.finCur && p.finCur !== doc.currency) doc.finCur = p.finCur;
  doc.fundUpdatedAt = today;
  const src = doc.sources || (doc.sources = []);
  if (!src.some((s) => s.url && s.url.includes("finance.yahoo.com/quote/" + doc.yahoo + "/financials")))
    src.unshift({ label: "Regnskab, nøgletal og kursmål (Yahoo Finance)", url: "https://finance.yahoo.com/quote/" + doc.yahoo + "/financials/" });
  return warn;
}
