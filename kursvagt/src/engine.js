/* Aktieanalyse engine — valuation, risk, sizing and Danish tax. Pure functions, no DOM. */
var Engine = (function () {
  "use strict";

  // ---------- math helpers ----------
  function erf(x) {
    // Abramowitz & Stegun 7.1.26
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : NaN; }
  function sd(a) { if (a.length < 2) return NaN; var m = mean(a); return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1)); }
  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }); var n = b.length; if (!n) return NaN; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  function num(v) { return typeof v === "number" && isFinite(v); }
  function days(a, b) { return (new Date(b) - new Date(a)) / 864e5; }

  function sma(arr, n) { if (arr.length < n) return NaN; return mean(arr.slice(-n)); }
  function emaSeries(arr, n) { var k = 2 / (n + 1), out = [], e = arr[0]; for (var i = 0; i < arr.length; i++) { e = i === 0 ? arr[0] : arr[i] * k + e * (1 - k); out.push(e); } return out; }
  function rsi(closes, n) {
    n = n || 14; if (closes.length < n + 1) return NaN;
    var g = 0, l = 0, i;
    for (i = 1; i <= n; i++) { var d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (i = n + 1; i < closes.length; i++) { var d2 = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d2, 0)) / n; l = (l * (n - 1) + Math.max(-d2, 0)) / n; }
    if (l === 0) return 100; var rs = g / l; return 100 - 100 / (1 + rs);
  }
  function macd(closes) {
    if (closes.length < 35) return null;
    var e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
    var line = e12.map(function (v, i) { return v - e26[i]; });
    var sig = emaSeries(line.slice(25), 9);
    var m = line[line.length - 1], s = sig[sig.length - 1];
    return { macd: m, signal: s, hist: m - s };
  }
  function maxDrawdown(p) { var peak = -Infinity, dd = 0; p.forEach(function (v) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }); return dd; }

  // ---------- defaults ----------
  var DEFAULTS = {
    erp: 0.045, betaFloor: 0.8, specificPremium: 0.0, cyclicalPremium: 0.015,
    gT: 0.025, baseGrowth: 0.05, years: 10, confidence: 0.5, halfLife: 3,
    kellyFraction: 0.25, maxWeight: 0.10, cash: 0.025, minTrade: 2500, analystBias: 0.10, analystWeight: 1
  };

  function settingsWith(macro, user) {
    var s = {}; Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    if (macro) { if (num(macro.erp)) s.erp = macro.erp; if (num(macro.gT)) s.gT = macro.gT; if (num(macro.cash)) s.cash = macro.cash; }
    if (user) Object.keys(user).forEach(function (k) { if (num(user[k])) s[k] = user[k]; });
    return s;
  }

  // ---------- cost of equity (CAPM + Blume-adjusted beta) ----------
  function costOfEquity(st, macro, s) {
    var rf = (macro.rf && macro.rf[st.currency]) || 0.035;
    var beta = num(st.fund.beta) ? st.fund.beta : 1;
    var blume = 0.67 * beta + 0.33;
    var bUsed = Math.max(blume, s.betaFloor);
    var cyc = st.cyclical ? s.cyclicalPremium : 0;
    return { r: rf + bUsed * s.erp + s.specificPremium + cyc, capm: rf + blume * s.erp, rf: rf, beta: beta, blume: blume, bUsed: bUsed, cyc: cyc };
  }

  // Fisher-consistent adjustment: local nominal growth = DKK growth + (local rf - DKK rf)
  function inflAdj(st, macro) {
    var ref = (macro.rf && macro.rf.DKK) || 0.03, loc = (macro.rf && macro.rf[st.currency]) || ref;
    return clamp(loc - ref, -0.03, 0.03);
  }

  // ---------- growth inputs ----------
  function histCagr(series, years) {
    if (!series) return NaN;
    var idx = []; series.forEach(function (v, i) { if (num(v) && v > 0) idx.push(i); });
    if (idx.length < 2) return NaN;
    var i0 = idx[0], i1 = idx[idx.length - 1];
    var periods = i1 - i0;
    if (years && years[i1] === "TTM") {
      if (num(series[i1 - 1]) && Math.abs(series[i1] / series[i1 - 1] - 1) < 1e-6) { i1 = i1 - 1; periods = i1 - i0; }
      else periods = periods - 0.25;
    }
    if (periods <= 0) return NaN;
    return Math.pow(series[i1] / series[i0], 1 / periods) - 1;
  }
  function growthEstimate(st, s) {
    var gRev = histCagr(st.hist.revenue, st.hist.years);
    var gEps = histCagr(st.hist.eps, st.hist.years);
    var gHist = num(gRev) ? gRev : (num(gEps) ? gEps : s.baseGrowth);
    var gHistC = clamp(gHist, -0.05, 0.25);
    var core = 0.5 * gHistC + 0.5 * s.baseGrowth; // shrink toward base rate (Chan, Karceski & Lakonishok 2003)
    var gAn = num(st.est.revGrowth) ? st.est.revGrowth : (num(st.est.epsGrowth) ? st.est.epsGrowth : null);
    var g1 = gAn === null ? core : (2 / 3) * core + (1 / 3) * clamp(gAn, -0.15, 0.30);
    return { g1: clamp(g1, -0.05, 0.20), gRev: gRev, gEps: gEps, gHist: gHist, gAn: gAn };
  }

  // ---------- valuation models ----------
  // Equity value-driver DCF: FCFE = E * (1 - g/RONIC)  (Koller, Goedhart & Wessels, "Valuation")
  function dcfCore(E1, g1, r, gT, roe, N) {
    if (!(E1 > 0) || r <= gT + 0.005) return NaN;
    var ron0 = clamp(roe, 0.10, 0.60), ronT = r + 0.5 * (Math.max(ron0, r) - r);
    var E = E1, pv = 0;
    for (var t = 1; t <= N; t++) {
      var gt = t < N ? g1 + (gT - g1) * (t - 1) / (N - 1) : gT;
      var ron = ron0 + (ronT - ron0) * (t - 1) / (N - 1);
      var rr = gt > 0 ? clamp(gt / ron, 0, 0.9) : 0;
      pv += E * (1 - rr) / Math.pow(1 + r, t);
      if (t < N) E = E * (1 + gt);
    }
    var tv = E * (1 + gT) * (1 - gT / ronT) / (r - gT);
    return pv + tv / Math.pow(1 + r, N);
  }
  function startEarnings(st) {
    var f = st.fund;
    if (num(f.fwdEps) && f.fwdEps > 0) return { E1: f.fwdEps, src: "forventet EPS (kurs ÷ forward P/E)" };
    if (num(f.eps) && f.eps > 0) return { E1: f.eps, src: "seneste 12 mdr. EPS" };
    var pos = (st.hist.eps || []).filter(function (v) { return num(v) && v > 0; });
    return { E1: pos.length ? mean(pos) : NaN, src: "gennemsnitlig positiv EPS" };
  }

  // Two-stage dividend discount model (Gordon 1962, multi-stage)
  function ddmCore(D0, g1, r, gT, N) {
    if (!(D0 > 0) || r <= gT + 0.005) return NaN;
    var D = D0, pv = 0;
    for (var t = 1; t <= N; t++) {
      var gt = g1 + (gT - g1) * (t - 1) / (N - 1);
      D = D * (1 + gt); pv += D / Math.pow(1 + r, t);
    }
    return pv + D * (1 + gT) / (r - gT) / Math.pow(1 + r, N);
  }

  // Residual income model (Edwards-Bell-Ohlson)
  function rimCore(B0, roe0, r, gT, payout, N) {
    if (!(B0 > 0) || r <= gT + 0.005) return NaN;
    var roeLR = r + 0.5 * (roe0 - r), B = B0, pv = 0, ri = 0;
    var p = clamp(payout, 0.3, 1.0);
    for (var t = 1; t <= N; t++) {
      var roe = roe0 + (roeLR - roe0) * (t - 1) / (N - 1);
      ri = (roe - r) * B; pv += ri / Math.pow(1 + r, t);
      B = B * (1 + roe * (1 - p));
    }
    var tv = (roeLR - r) * B * (1 + gT) / (r - gT);
    return B0 + pv + tv / Math.pow(1 + r, N);
  }

  // Earnings power value with growth only when returns exceed cost (Greenwald et al. 2001)
  function epvCore(Enorm, roeNorm, r, gT) {
    if (!(Enorm > 0)) return NaN;
    var noGrowth = Enorm / r;
    var withGrowth = roeNorm > gT ? Enorm * (1 - gT / roeNorm) / (r - gT) : noGrowth;
    return Math.max(noGrowth, withGrowth);
  }
  function epvInputs(st, s) {
    var m = (st.hist.margin || []).filter(num);
    var ttm = m.length ? m[m.length - 1] : NaN;
    var med = median(m);
    var f = st.fund, fwdM = NaN;
    if (num(f.fwdEps) && num(f.shares) && num(f.revenueTtm)) fwdM = f.fwdEps * f.shares / (f.revenueTtm * (1 + (st.est.revGrowth || 0)));
    var parts = [med, ttm, fwdM].filter(num);
    var normMargin = mean(parts);
    var Enorm = num(f.revenueTtm) && num(f.shares) ? f.revenueTtm * normMargin / f.shares : NaN;
    var roeNorm = num(f.bvps) && f.bvps > 0 ? Enorm / f.bvps : 0.10;
    return { normMargin: normMargin, histMedian: med, ttmMargin: ttm, fwdMargin: fwdM, Enorm: Enorm, roeNorm: roeNorm };
  }

  function valuation(st, macro, s, ov) {
    ov = ov || {};
    var ce = costOfEquity(st, macro, s);
    var r = num(ov.r) ? ov.r : ce.r;
    var infl = inflAdj(st, macro);
    var gT = num(ov.gT) ? ov.gT : s.gT + infl;
    s = Object.assign({}, s, { baseGrowth: s.baseGrowth + infl });
    var N = s.years, f = st.fund, out = { r: r, ce: ce, gT: gT, model: st.model };
    if (st.model === "crypto") {
      out.method = "Ingen fair værdi (kryptovaluta)";
      out.methodShort = "Krypto";
      out.why = "En kryptovaluta har ingen indtjening, udbytte eller pengestrømme, så der findes ingen indre værdi at regne på. Analysen bygger derfor kun på risiko, trend og timing, og det forventede afkast sættes til den risikofrie rente – der er ingen dokumenteret risikopræmie at regne med.";
      out.fv = NaN; out.low = NaN; out.high = NaN; out.implied = null;
      return out;
    }
    if (st.model === "rnpv") {
      out.method = "Pipeline-værdi (risikojusteret NPV)";
      out.methodShort = "rNPV";
      out.why = "Biotekselskaber uden stabil indtjening kan ikke værdiansættes ud fra nuværende overskud. Værdien ligger i sandsynlighedsvægtede fremtidige pengestrømme fra lægemiddelkandidaterne (rNPV). Analytikernes kursmål bygger på sådanne modeller, så de bruges nedjusteret 10 % for historisk optimisme og med et bredt usikkerhedsbånd.";
      out.fv = NaN; out.low = NaN; out.high = NaN; out.implied = null;
      return out;
    }
    function run(rr, gg, extra) {
      if (st.model === "dcf") return dcfCore(out.E1, gg, rr, gT, extra != null ? extra : out.roe, N);
      if (st.model === "ddm") return ddmCore(out.D0, gg, rr, gT, N);
      if (st.model === "rim") return rimCore(f.bvps, extra != null ? extra : out.roe, rr, gT, out.payout, N);
      if (st.model === "epv") { var E = st.fund.revenueTtm * (extra != null ? extra : out.normMargin) / f.shares; return epvCore(E, E / f.bvps, rr, gT); }
      return NaN;
    }
    if (st.model === "dcf") {
      var se = startEarnings(st), ge = growthEstimate(st, s);
      out.E1 = se.E1; out.E1src = se.src; out.growth = ge;
      out.g1 = num(ov.g1) ? ov.g1 : ge.g1;
      out.roe = clamp(Math.max(f.roe || 0, f.roic || 0), 0.10, 0.60);
      out.method = "Indtjeningsbaseret DCF (value driver)";
      out.methodShort = "DCF";
      out.why = "Virksomheder med stabil indtjening og vækst værdiansættes bedst ud fra fremtidige frie pengestrømme til aktionærerne. Value driver-formlen FCFE = E·(1 − g/ROIC) sikrer, at vækst koster geninvestering.";
    } else if (st.model === "ddm") {
      var ge2 = growthEstimate(st, s);
      var gS = clamp((f.roe || 0) * (1 - Math.min(f.payout || 1, 1)), 0, 0.10);
      var gD = clamp(histCagr(st.hist.dps, st.hist.years), -0.05, 0.15);
      out.D0 = Math.min(f.dps || 0, num(f.fwdEps) ? f.fwdEps * 0.95 : Infinity);
      out.g1 = num(ov.g1) ? ov.g1 : clamp(0.5 * gS + 0.25 * (num(gD) ? gD : s.baseGrowth) + 0.25 * s.baseGrowth, -0.03, 0.10);
      out.growth = { gSustain: gS, gDps: gD, g1: out.g1, gAn: ge2.gAn };
      out.method = "Udbyttemodel (to-trins Gordon/DDM)";
      out.methodShort = "DDM";
      out.why = "Forsikringsselskaber udbetaler størstedelen af overskuddet som udbytte under kapitalkrav, så nutidsværdien af fremtidige udbytter er den mest direkte værdi.";
    } else if (st.model === "rim") {
      out.roe = num(ov.roe) ? ov.roe : (f.roe || 0.1);
      out.payout = f.payout || 0.6;
      out.method = "Residualindkomstmodel (Ohlson)";
      out.methodShort = "RIM";
      out.why = "En banks gæld er råvare, ikke finansiering, så frie pengestrømme giver ikke mening. Værdien er egenkapitalen plus nutidsværdien af afkast over kapitalomkostningen.";
    } else if (st.model === "epv") {
      var ei = epvInputs(st, s);
      out.epv = ei; out.normMargin = num(ov.margin) ? ov.margin : ei.normMargin;
      out.method = "Normaliseret indtjening (Earnings Power Value)";
      out.methodShort = "EPV";
      out.why = "Cykliske selskaber har indtjening, der svinger med konjunkturen. Værdien bygger på en normaliseret margin over cyklussen frem for årets top eller bund.";
    }
    var ex = st.model === "rim" ? out.roe : st.model === "epv" ? out.normMargin : null;
    var gBase = out.g1;
    out.fv = run(r, gBase, ex);
    // scenario band: pessimistic (r+1pp, weaker driver), optimistic (r-1pp, stronger driver)
    if (st.model === "rim") { out.low = run(r + 0.01, null, ex - 0.02); out.high = run(Math.max(r - 0.01, gT + 0.01), null, ex + 0.02); }
    else if (st.model === "epv") { out.low = run(r + 0.01, null, ex * 0.8); out.high = run(Math.max(r - 0.01, gT + 0.01), null, ex * 1.2); }
    else if (st.model === "dcf") { out.low = run(r + 0.01, gBase - 0.03, out.roe * 0.8); out.high = run(Math.max(r - 0.01, gT + 0.01), gBase + 0.03, out.roe * 1.2); } // ROIC is an estimate too
    else { out.low = run(r + 0.01, gBase - 0.03); out.high = run(Math.max(r - 0.01, gT + 0.01), gBase + 0.03); }
    // reverse engineering: what the price implies
    var P = st.price, lo, hi, k, mid, v;
    if (st.model === "dcf" || st.model === "ddm") {
      lo = -0.15; hi = 0.40;
      if (run(r, hi) < P) out.implied = { kind: "growth", value: null, above: true };
      else if (run(r, lo) > P) out.implied = { kind: "growth", value: null, below: true };
      else { for (k = 0; k < 60; k++) { mid = (lo + hi) / 2; v = run(r, mid); if (v > P) hi = mid; else lo = mid; } out.implied = { kind: "growth", value: (lo + hi) / 2 }; }
    } else if (st.model === "rim") {
      lo = 0; hi = 0.6; for (k = 0; k < 60; k++) { mid = (lo + hi) / 2; v = run(r, null, mid); if (v > P) hi = mid; else lo = mid; }
      out.implied = { kind: "roe", value: (lo + hi) / 2 };
    } else if (st.model === "epv") {
      lo = 0; hi = 0.8; for (k = 0; k < 60; k++) { mid = (lo + hi) / 2; v = run(r, null, mid); if (v > P) hi = mid; else lo = mid; }
      out.implied = { kind: "margin", value: (lo + hi) / 2 };
    }
    return out;
  }

  // Inverse-variance forecast combination (Bates & Granger 1969) of model value and bias-corrected analyst target
  function combineFair(st, val, s) {
    var z = 1.6448536, m = val.fv;
    if (st.model === "crypto") return { fv: NaN, low: NaN, high: NaN, wModel: 1 };
    if (!num(m) || m <= 0) {
      // no usable model value (pipeline biotech or no positive earnings): bias-corrected analyst target with a wide band
      var e0 = st.est || {}, T0 = e0.target;
      if (num(T0) && T0 > 0 && s.analystWeight !== 0) {
        var Ta = T0 / (1 + s.analystBias);
        var s0 = num(e0.targetLow) && num(e0.targetHigh) && e0.targetLow > 0 ? Math.log(e0.targetHigh / e0.targetLow) / (2 * z) : 0.30;
        s0 = Math.max(s0, 0.30);
        return { fv: Ta, low: Ta * Math.exp(-z * s0), high: Ta * Math.exp(z * s0), wModel: 0, analystOnly: true, analystAdj: Ta, analyst: T0 };
      }
      return { fv: NaN, low: NaN, high: NaN, wModel: 1 };
    }
    var sm = num(val.low) && num(val.high) && val.low > 0 ? Math.log(val.high / val.low) / (2 * z) : 0.2;
    sm = Math.max(sm, 0.08);
    // if no growth rate in the search range can explain the price, the earnings model misses what the market prices: treat it as a weak forecast
    if (val.implied && val.implied.above) sm = Math.max(sm, 0.6);
    var e = st.est || {}, T = e.target;
    if (!num(T) || T <= 0 || s.analystWeight === 0) return { fv: m, low: val.low, high: val.high, wModel: 1, model: m };
    var Tadj = T / (1 + s.analystBias);
    var sa = num(e.targetLow) && num(e.targetHigh) && e.targetLow > 0 ? Math.log(e.targetHigh / e.targetLow) / (2 * z) : 0.2;
    sa = Math.max(sa, 0.08);
    var wm = (1 / (sm * sm)) / (1 / (sm * sm) + 1 / (sa * sa));
    var lnF = wm * Math.log(m) + (1 - wm) * Math.log(Tadj);
    var sF = Math.sqrt(1 / (1 / (sm * sm) + 1 / (sa * sa)));
    return { fv: Math.exp(lnF), low: Math.exp(lnF - z * sF), high: Math.exp(lnF + z * sF), wModel: wm, model: m, analystAdj: Tadj, analyst: T };
  }

  // ---------- price statistics & technicals ----------
  function priceStats(st) {
    var m = st.monthly.map(function (x) { return x[1]; });
    var mRet = []; for (var i = Math.max(1, m.length - 60); i < m.length; i++) mRet.push(Math.log(m[i] / m[i - 1]));
    var sigM = sd(mRet) * Math.sqrt(12);
    var d = st.daily, dRet = [];
    for (var j = 1; j < d.length; j++) if (days(d[j - 1][0], d[j][0]) <= 4) dRet.push(Math.log(d[j][1] / d[j - 1][1]));
    var sigD = dRet.length >= 15 ? sd(dRet) * Math.sqrt(st.model === "crypto" ? 365 : 252) : NaN;
    var sigma = num(sigD) ? Math.sqrt(0.5 * sigD * sigD + 0.5 * sigM * sigM) : sigM;
    var closes = d.map(function (x) { return x[1]; });
    var P = st.price;
    var last12 = m.slice(-13);
    var mom = m.length >= 13 ? m[m.length - 2] / m[m.length - 13] - 1 : NaN;
    var sma10 = sma(m, 10);
    var five = m.slice(-61);
    var hi52 = Math.max.apply(null, m.slice(-12).concat(closes.slice(-60)));
    var lo52 = Math.min.apply(null, m.slice(-12).concat(closes.slice(-60)));
    var lastMove = closes.length >= 2 && days(d[d.length - 2][0], d[d.length - 1][0]) <= 4 ? closes[closes.length - 1] / closes[closes.length - 2] - 1 : (num(st.chg24h) ? st.chg24h : NaN);
    return {
      sigma: sigma, sigD: sigD, sigM: sigM,
      cagr5: five.length >= 61 ? Math.pow(P / five[0], 1 / 5) - 1 : NaN,
      ret1y: m.length >= 13 ? P / m[m.length - 13] - 1 : NaN,
      maxDD5: maxDrawdown(five), mom: mom, sma10: sma10, aboveSma10: P > sma10,
      rsi: rsi(closes, 14), sma50: sma(closes, Math.min(50, closes.length)), macd: macd(closes),
      hi52: hi52, lo52: lo52, fromHigh: P / hi52 - 1, lastMove: lastMove, dailyCount: closes.length
    };
  }

  // ---------- probabilities (lognormal / GBM) ----------
  function riskProfile(mu, sigma) {
    var T = 1, m = Math.log(1 + mu) - 0.5 * sigma * sigma, sT = sigma * Math.sqrt(T);
    var b = Math.log(0.8);
    var pDD = Phi((b - m * T) / sT) + Math.exp(2 * m * b / (sigma * sigma)) * Phi((b + m * T) / sT);
    var z = 1.6448536;
    return {
      m: m,
      pLoss: Phi(-m / sT),
      pDD20: clamp(pDD, 0, 1),
      pGain20: 1 - Phi((Math.log(1.2) - m) / sT),
      q05: Math.exp(m - z * sT) - 1, q50: Math.exp(m) - 1, q95: Math.exp(m + z * sT) - 1,
      var95: -(Math.exp(m - z * sT) - 1),
      cvar95: 1 - (1 + mu) * Phi(-z - sT) / 0.05
    };
  }
  function riskLevel(sigma) {
    if (sigma < 0.2) return { key: "lav", label: "Lav" };
    if (sigma < 0.3) return { key: "moderat", label: "Moderat" };
    if (sigma < 0.45) return { key: "hoej", label: "Høj" };
    return { key: "meget", label: "Meget høj" };
  }

  // ---------- news ----------
  function newsScore(st, asOf) {
    var w = 0, s = 0, recent = [];
    (st.news || []).forEach(function (n) {
      var age = days(n.date, asOf); if (age < 0) age = 0; if (age > 60) return;
      var wt = Math.pow(0.5, age / 14); w += wt; s += wt * (n.impact || 0); recent.push(n);
    });
    return { score: w ? s / w : 0, count: recent.length };
  }

  // ---------- composite analysis ----------
  var REC = [
    { key: "koeb", label: "Køb", min: 0.30 },
    { key: "akk", label: "Akkumulér", min: 0.12 },
    { key: "hold", label: "Hold", min: -0.12 },
    { key: "red", label: "Reducér", min: -0.30 },
    { key: "saelg", label: "Sælg", min: -Infinity }
  ];

  function analyze(st, macro, userSettings, ctx) {
    ctx = ctx || {};
    var s = settingsWith(macro, userSettings);
    var asOf = ctx.asOf || st.priceDate;
    var val = valuation(st, macro, s, ctx.override);
    var ps = priceStats(st);
    var P = st.price;
    var blend = combineFair(st, val, s);
    var FV = blend.fv;
    var gap = num(FV) && FV > 0 ? Math.log(FV / P) : 0;
    var phi = 1 - Math.pow(2, -1 / s.halfLife);
    var conf = blend.analystOnly ? s.confidence * 0.5 : s.confidence; // weaker value signal without an own model
    var mu = st.model === "crypto" ? val.ce.rf : (1 + val.ce.capm) * Math.exp(conf * phi * gap) - 1;
    var sigma = st.model === "crypto" ? Math.max(ps.sigma, 0.4) : ps.sigma; // short/quiet crypto histories understate risk
    var risk = riskProfile(mu, sigma);
    var f = st.fund;

    // component scores in [-1, 1]
    var V = Math.tanh(gap / 0.25);
    var qParts = [];
    if (num(f.piotroski)) qParts.push((f.piotroski - 4.5) / 4.5);
    if (num(f.altmanZ) && st.model !== "rim" && st.model !== "ddm") qParts.push(clamp((f.altmanZ - 2.4) / 0.6, -1, 1));
    var Q = qParts.length ? mean(qParts) : 0;
    var trendStrength = num(ps.sma10) ? clamp(Math.abs(P / ps.sma10 - 1) / 0.05, 0, 1) : 0;
    var M = 0.5 * (ps.aboveSma10 ? 1 : -1) * trendStrength + 0.5 * (num(ps.mom) ? Math.tanh(ps.mom / 0.25) : 0);
    var rsiC = num(ps.rsi) ? clamp((50 - ps.rsi) / 25, -1, 1) : 0;
    var macdC = ps.macd ? (ps.macd.hist > 0 ? 0.5 : -0.5) : 0;
    var T = 0.5 * rsiC + 0.5 * macdC;
    var ns = newsScore(st, asOf);
    var N = ns.score;
    var comp = 0.40 * V + 0.20 * Q + 0.20 * M + 0.10 * T + 0.10 * N;

    var rec = REC.filter(function (x) { return comp >= x.min; })[0];
    var guard = null;
    if ((rec.key === "koeb" || rec.key === "akk") && mu < s.cash) { rec = REC[2]; guard = "Forventet afkast er under kontantrenten, så modellen anbefaler ikke køb."; }
    if (rec.key === "koeb" && risk.pDD20 > 0.5) { rec = REC[1]; guard = "Høj risiko for et fald på 20 % undervejs – køb gradvist i stedet for på én gang."; }

    var mos = clamp(0.6 * sigma, 0.10, 0.35);
    var levels = {
      buyBelow: num(FV) ? FV * (1 - mos) : NaN,
      sellAbove: num(FV) ? FV * 1.15 : NaN,
      stop: P * Math.exp(-1.6448536 * sigma * Math.sqrt(0.25)),
      trendLine: ps.sma10, mos: mos
    };

    // position sizing: fractional Kelly for a lognormal asset: f* = (mu - r) / sigma^2
    var kellyFull = (mu - s.cash) / (sigma * sigma);
    var wKelly = clamp(s.kellyFraction * kellyFull, 0, st.model === "crypto" ? s.maxWeight / 4 : blend.analystOnly ? s.maxWeight / 2 : s.maxWeight); // binary pipeline risk: half the max weight; crypto: a quarter

    var res = {
      id: st.id, price: P, fv: FV, fvModel: val.fv, blend: blend, low: blend.low, high: blend.high, upside: num(FV) ? FV / P - 1 : NaN,
      val: val, ps: ps, mu: mu, sigma: sigma, risk: risk, level: riskLevel(sigma), settings: s,
      scores: { V: V, Q: Q, M: M, T: T, N: N, comp: comp }, news: ns,
      rec: rec, guard: guard, levels: levels, kelly: { full: kellyFull, weight: wKelly },
      analyst: st.est.target ? { target: st.est.target, upside: st.est.target / P - 1, consensus: st.est.consensus } : null
    };
    res.reasons = reasons(st, res);
    res.events = upcomingEvents(st, asOf);
    if (ctx.portfolio) res.trade = tradePlan(st, res, ctx.portfolio, macro);
    return res;
  }

  function pct(x, d) { if (!num(x)) return "–"; var t = (x * 100).toFixed(d == null ? 0 : d); if (+t === 0) t = t.replace("-", ""); return t.replace(".", ",").replace("-", "\u2212") + "\u00a0%"; }
  function sgnPct(x, d) { if (!num(x)) return "–"; var t = pct(x, d); return (x > 0 && !/^0(,0+)?\u00a0%$/.test(t) ? "+" : "") + t; }
  function priceDigits(a) { return a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : a > 0 ? Math.min(12, Math.ceil(-Math.log10(a)) + 2) : 2; }
  function money(x, cur) { if (!num(x)) return "–"; var a = Math.abs(x); var dg = priceDigits(a); return x.toLocaleString("da-DK", { minimumFractionDigits: dg, maximumFractionDigits: dg }).replace("-", "\u2212") + (cur ? " " + (cur === "DKK" ? "kr." : cur) : ""); }

  function reasons(st, a) {
    var v = a.val, out = [], cur = st.currency;
    var b = a.blend;
    if (b && b.analystOnly) out.push({ kind: "val", sign: Math.sign(a.scores.V), text: (v.model === "rnpv" ? v.method + ": der er ingen stabil indtjening at regne på, så " : "Modellen kan ikke regne på den nuværende indtjening, så ") + "fair værdi bygger på analytikernes kursmål " + money(b.analyst, cur) + " nedjusteret 10 % = " + money(a.fv, cur) + ". Det er " + (a.upside >= 0 ? sgnPct(a.upside) + " over" : pct(-a.upside) + " under") + " kursen, men usikkerheden er stor (90 %-interval " + money(a.low, cur) + "–" + money(a.high, cur) + ")." });
    else if (st.model === "crypto") out.push({ kind: "val", sign: 0, text: "Kryptovaluta har ingen pengestrømme, så der findes ingen fair værdi. Signalet bygger kun på trend, timing og nyheder, og forventet afkast sættes til den risikofrie rente (" + pct(v.ce.rf, 1) + "). Risikoen regnes med mindst 40 % årlig volatilitet, og en enkelt kryptovaluta må højst fylde " + pct(a.settings.maxWeight / 4, 1) + " af porteføljen." });
    else if (!num(a.fv)) out.push({ kind: "val", sign: 0, text: "Der kan ikke beregnes en fair værdi (ingen positiv indtjening og intet kursmål). Signalet bygger kun på kvalitet, trend og nyheder." });
    else out.push({ kind: "val", sign: Math.sign(a.scores.V), text: v.method + " giver " + money(a.fvModel, cur) + " (afkastkrav " + pct(v.r, 1) + ")." + (b && b.analystAdj ? " Kombineret med analytikernes kursmål (nedjusteret 10 % for historisk optimisme) bliver fair værdi " + money(a.fv, cur) + " – modellen vægter " + pct(b.wModel) + "." : "") + " Det er " + (a.upside >= 0 ? sgnPct(a.upside) + " over" : pct(-a.upside) + " under") + " kursen (90 %-interval " + money(a.low, cur) + "–" + money(a.high, cur) + ")." });
    if (v.implied) {
      var im = v.implied, t;
      if (im.kind === "growth") {
        var hist = v.model === "ddm" ? v.growth.gDps : v.growth.gHist;
        t = im.value == null ? (im.above ? "Kursen kræver mere end 40 % årlig vækst for at give mening." : "Kursen kan forklares selv med fald i indtjeningen.") :
          "Kursen indregner " + pct(im.value, 1) + " årlig vækst de næste år (modellen bruger " + pct(v.g1, 1) + "; historisk " + pct(hist, 1) + ").";
        out.push({ kind: "implied", sign: im.value == null ? (im.above ? -1 : 1) : Math.sign(v.g1 - im.value), text: t });
      } else if (im.kind === "roe") {
        out.push({ kind: "implied", sign: Math.sign(v.roe - im.value), text: "Kursen svarer til en vedvarende egenkapitalforrentning på " + pct(im.value, 1) + " mod nuværende " + pct(v.roe, 1) + "." });
      } else if (im.kind === "margin") {
        out.push({ kind: "implied", sign: Math.sign(v.normMargin - im.value), text: "Kursen svarer til en normaliseret nettomargin på " + pct(im.value, 1) + " mod modellens " + pct(v.normMargin, 1) + " (median over cyklussen " + pct(v.epv.histMedian, 1) + ")." });
      }
    }
    var f = st.fund, q = [];
    if (num(f.piotroski)) q.push("Piotroski F-score " + f.piotroski + "/9 (" + (f.piotroski >= 7 ? "stærk" : f.piotroski >= 4 ? "middel" : "svag") + " regnskabskvalitet)");
    if (num(f.altmanZ) && st.model !== "rim" && st.model !== "ddm") q.push("Altman Z " + f.altmanZ.toFixed(1).replace(".", ",") + " (" + (f.altmanZ > 3 ? "sikker zone" : f.altmanZ > 1.8 ? "gråzone" : "nødzone") + ")");
    if (q.length) out.push({ kind: "quality", sign: Math.sign(a.scores.Q), text: q.join("; ") + "." });
    var ps = a.ps;
    out.push({ kind: "trend", sign: Math.sign(a.scores.M), text: "Kursen ligger " + pct(Math.abs(a.price / ps.sma10 - 1), 1) + (ps.aboveSma10 ? " over" : " under") + " 10-måneders gennemsnittet (" + (ps.aboveSma10 ? "optrend" : "nedtrend") + "). Momentum 12-1 mdr.: " + sgnPct(ps.mom, 0) + "." });
    if (num(ps.rsi)) out.push({ kind: "timing", sign: Math.sign(a.scores.T), text: "RSI(14) er " + Math.round(ps.rsi) + " (" + (ps.rsi < 30 ? "oversolgt – ofte god indgang" : ps.rsi > 70 ? "overkøbt – vent med at købe" : "neutral") + "); MACD " + (ps.macd && ps.macd.hist > 0 ? "peger op" : "peger ned") + "." });
    if (a.news.count) {
      var nn = (st.news || []).slice().sort(function (x, y) { return x.date < y.date ? 1 : -1; })[0];
      out.push({ kind: "news", sign: Math.sign(a.scores.N), text: "Nyhedsbilledet (60 dage) er " + (a.scores.N > 0.2 ? "positivt" : a.scores.N < -0.2 ? "negativt" : "blandet") + ". Seneste: “" + nn.title + "”." });
    }
    if (a.analyst) out.push({ kind: "analyst", sign: Math.sign(a.analyst.upside), text: "Analytikernes gennemsnitlige kursmål er " + money(a.analyst.target, cur) + " (" + sgnPct(a.analyst.upside) + ", " + (a.analyst.consensus || "") + ")." });
    if (st.note) out.push({ kind: "note", sign: 0, text: st.note });
    return out;
  }

  function upcomingEvents(st, asOf) {
    var ev = [];
    if (st.events && st.events.earnings) { var d = days(asOf, st.events.earnings); if (d >= -1 && d <= 45) ev.push({ kind: "earnings", date: st.events.earnings, inDays: Math.round(d), text: "Regnskab" }); }
    if (st.events && st.events.exDiv) { var e = days(asOf, st.events.exDiv); if (e >= 0 && e <= 45) ev.push({ kind: "exdiv", date: st.events.exDiv, inDays: Math.round(e), text: "Ex-udbytte" }); }
    return ev;
  }

  // ---------- trading plan for a portfolio ----------
  var FEES = {
    DK: { pct: 0.001, min: 25, fx: 0 }, SE: { pct: 0.001, min: 25, fx: 0.0025 }, NO: { pct: 0.001, min: 25, fx: 0.0025 }, FI: { pct: 0.001, min: 25, fx: 0.0025 },
    US: { pct: 0.0015, min: 25, fx: 0.0025 }, DE: { pct: 0.0015, min: 25, fx: 0.0025 }, NL: { pct: 0.0015, min: 25, fx: 0.0025 }
  };
  function fee(st, amountDKK) { var f = FEES[st.country] || FEES.US; return Math.max(f.min, amountDKK * f.pct) + amountDKK * f.fx; }

  function tradePlan(st, a, pf, macro) {
    var fx = (macro.fx && macro.fx[st.currency]) || 1;
    var priceDKK = a.price * fx;
    var held = pf.positions[st.id] || { qty: 0, value: 0 };
    var total = pf.totalValue;
    var curW = total > 0 ? held.value / total : 0;
    var target = a.kelly.weight, key = a.rec.key, action = "none", amount = 0, note = "";
    if (key === "koeb") { target = Math.max(target, 0); if (curW < target) { action = "buy"; amount = (target - curW) * total; } }
    else if (key === "akk") { if (curW < target) { action = "buy"; amount = 0.5 * (target - curW) * total; note = "Køb halvdelen nu og resten ved kurser under " + money(a.levels.buyBelow, st.currency) + " eller om 1–2 måneder."; } }
    else if (key === "hold") { if (curW > a.settings.maxWeight) { action = "sell"; amount = (curW - a.settings.maxWeight) * total; note = "Positionen er større end maks. " + pct(a.settings.maxWeight) + " af porteføljen."; } }
    else if (key === "red") { var t2 = Math.min(curW, target) * 0.5; if (curW > t2) { action = "sell"; amount = (curW - t2) * total; } }
    else if (key === "saelg") { if (held.qty > 0) { action = "sell"; amount = held.value; } }
    if (action === "buy") amount = Math.min(amount, pf.cash > 0 ? pf.cash : amount);
    var cr = st.model === "crypto";
    var shares = cr ? Math.floor(amount / priceDKK * 1e6) / 1e6 : Math.floor(amount / priceDKK);
    if (action === "sell") shares = cr ? Math.min(held.qty, Math.round(amount / priceDKK * 1e6) / 1e6) : Math.min(held.qty, Math.max(1, Math.round(amount / priceDKK)));
    amount = shares * priceDKK;
    if (!(shares > 0) || (!cr && shares < 1) || amount < a.settings.minTrade) { if (action !== "none") note = "Beløbet er under " + money(a.settings.minTrade, "kr.") + " – kurtagen ville fylde for meget. Ingen handel."; action = "none"; shares = 0; amount = 0; }
    return {
      action: action, shares: shares, amountDKK: amount, fee: action === "none" ? 0 : fee(st, amount),
      currentWeight: curW, targetWeight: key === "saelg" ? 0 : (key === "hold" ? Math.min(curW, a.settings.maxWeight) : target), note: note,
      priceDKK: priceDKK, heldQty: held.qty
    };
  }

  // ---------- portfolio & Danish tax ----------
  function buildPortfolio(lots, sales, stocks, macro, opts) {
    opts = opts || {};
    var fxNow = macro.fx || { DKK: 1 };
    var events = [];
    (lots || []).forEach(function (l) { events.push({ t: "buy", d: l.date, x: l }); });
    (sales || []).forEach(function (s) { events.push({ t: "sell", d: s.date, x: s }); });
    events.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t === "buy" ? -1 : 1); });
    var book = {}; // key stock|account -> {qty, costDKK}
    var realized = [];
    events.forEach(function (e) {
      var x = e.x, key = x.stockId + "|" + x.account;
      var b = book[key] || (book[key] = { stockId: x.stockId, account: x.account, qty: 0, cost: 0, firstDate: x.date, name: x.name || "" });
      var fx = num(x.fx) ? x.fx : (fxNow[x.currency || "DKK"] || 1);
      if (e.t === "buy") { b.qty += x.qty; b.cost += x.qty * x.price * fx + (x.fee || 0); if (x.date < b.firstDate) b.firstDate = x.date; }
      else {
        var q = Math.min(x.qty, b.qty); if (q <= 0) return;
        var avg = b.cost / b.qty, proceeds = q * x.price * fx - (x.fee || 0);
        realized.push({ date: x.date, year: +x.date.slice(0, 4), stockId: x.stockId, account: x.account, qty: q, proceeds: proceeds, cost: avg * q, gain: proceeds - avg * q });
        b.cost -= avg * q; b.qty -= q;
      }
    });
    var positions = [], byId = {};
    Object.keys(book).forEach(function (k) {
      var b = book[k]; if (b.qty <= 1e-9) return;
      var st = stocks[b.stockId];
      var cur = st ? st.currency : "DKK";
      var px = st ? st.price : (opts.manualPrices && opts.manualPrices[b.stockId]) || b.cost / b.qty;
      var value = b.qty * px * (fxNow[cur] || 1);
      var p = { stockId: b.stockId, account: b.account, qty: b.qty, cost: b.cost, avgCost: b.cost / b.qty, value: value, gain: value - b.cost, gainPct: value / b.cost - 1, currency: cur, firstDate: b.firstDate, stock: st || null, name: st ? st.name : b.name };
      positions.push(p);
      var agg = byId[b.stockId] || (byId[b.stockId] = { qty: 0, value: 0 }); agg.qty += b.qty; agg.value += value;
    });
    var invested = positions.reduce(function (s, p) { return s + p.value; }, 0);
    var cash = num(opts.cash) ? opts.cash : 0;
    return { positions: positions, byStock: byId, realized: realized, invested: invested, cash: cash, totalValue: invested + cash };
  }

  function taxYear(pf, stocks, rules, year, opts) {
    opts = opts || {};
    var limit = opts.married ? rules.progressionLimitMarried : rules.progressionLimit;
    var other = opts.otherShareIncome || 0;
    var gains = 0, losses = 0;
    pf.realized.forEach(function (r) { if (r.year === year && r.account === "frit") { if (r.gain >= 0) gains += r.gain; else losses += r.gain; } });
    var carry = opts.lossCarryForward || 0;
    // estimated dividends this year in free depot: DPS (ttm) for positions held before last ex-date in this year
    var divDK = 0, divForeign = 0, foreignWithheld = 0, foreignExcess = 0, wh = rules.withholding || {};
    pf.positions.forEach(function (p) {
      if (p.account !== "frit" || !p.stock) return;
      var st = p.stock, ex = st.events && st.events.exDiv;
      if (!ex || +ex.slice(0, 4) !== year || p.firstDate > ex || !num(st.fund.dps)) return;
      var fx = (opts.fx && opts.fx[st.currency]) || 1;
      var d = st.fund.dps * p.qty * fx;
      if (st.country === "DK") divDK += d;
      else { divForeign += d; var rate = num(wh[st.country]) ? wh[st.country] : 0.15; foreignWithheld += d * rate; foreignExcess += d * Math.max(rate - 0.15, 0); }
    });
    var shareIncome = gains + losses + divDK + divForeign + other;
    var afterCarry = shareIncome > 0 ? Math.max(shareIncome - carry, 0) : shareIncome;
    var taxable = Math.max(afterCarry, 0);
    var tax = rules.rateLow * Math.min(taxable, limit) + rules.rateHigh * Math.max(taxable - limit, 0);
    var withheldDK = divDK * rules.rateLow;
    var foreignCredit = Math.min(divForeign * 0.15, foreignWithheld);
    var due = tax - withheldDK - foreignCredit;
    var roomLow = Math.max(limit - taxable, 0);
    var marginal = taxable >= limit ? rules.rateHigh : rules.rateLow;
    var unrealized = 0, unrealizedLoss = 0;
    pf.positions.forEach(function (p) { if (p.account === "frit") { unrealized += p.gain; if (p.gain < 0) unrealizedLoss += p.gain; } });
    // ASK: lagerbeskatning 17 % of the year's change (approximation from Jan 1 value or cost)
    var askGain = 0, askDeposits = 0;
    pf.positions.forEach(function (p) {
      if (p.account !== "ask") return;
      askDeposits += p.cost;
      var st = p.stock; if (!st) return;
      var start = p.cost;
      if (p.firstDate < year + "-01-01") {
        var dec = st.monthly.filter(function (m) { return m[0] === (year - 1) + "-12"; })[0];
        if (dec) start = p.qty * dec[1] * ((opts.fx && opts.fx[st.currency]) || 1);
      }
      askGain += p.value - start;
    });
    var askTax = rules.askRate * askGain;
    return {
      year: year, limit: limit, gains: gains, losses: losses, divDK: divDK, divForeign: divForeign, other: other,
      carry: carry, shareIncome: shareIncome, taxable: taxable, tax: tax, withheldDK: withheldDK, foreignWithheld: foreignWithheld,
      foreignCredit: foreignCredit, foreignExcess: foreignExcess, due: due, roomLow: roomLow, marginal: marginal,
      unrealized: unrealized, unrealizedLoss: unrealizedLoss, askGain: askGain, askTax: askTax, askDeposits: askDeposits,
      lossToCarry: afterCarry < 0 ? -afterCarry : 0
    };
  }

  function saleTax(position, qty, priceDKK, taxInfo, rules) {
    var gain = qty * priceDKK - qty * position.avgCost;
    if (position.account === "ask") return { gain: gain, tax: 0, note: "Aktiesparekonto: lagerbeskattet med " + pct(rules.askRate) + " uanset salg." };
    if (position.account === "pension") return { gain: gain, tax: 0, note: "Pension: PAL-skat " + pct(rules.palRate, 1) + " på årets afkast uanset salg." };
    if (gain <= 0) return { gain: gain, tax: 0, note: "Tab kan modregnes i gevinster og udbytter på børsnoterede aktier." };
    var low = Math.min(gain, taxInfo.roomLow);
    var tax = low * rules.rateLow + (gain - low) * rules.rateHigh;
    return { gain: gain, tax: tax, note: low < gain ? "Gevinsten går over progressionsgrænsen – " + money(gain - low, "kr.") + " beskattes med " + pct(rules.rateHigh) + "." : "Hele gevinsten ligger i " + pct(rules.rateLow) + "-trinnet." };
  }

  function portfolioRisk(pf, analyses, rho) {
    rho = num(rho) ? rho : 0.4;
    var items = pf.positions.filter(function (p) { return analyses[p.stockId]; }).map(function (p) { return { w: p.value / (pf.totalValue || 1), a: analyses[p.stockId] }; });
    var mu = pf.cash / (pf.totalValue || 1) * (analyses.__cash || 0.025), v = 0;
    items.forEach(function (i) { mu += i.w * i.a.mu; });
    items.forEach(function (i) { items.forEach(function (j) { v += i.w * j.w * i.a.sigma * j.a.sigma * (i === j ? 1 : rho); }); });
    var sig = Math.sqrt(v);
    return { mu: mu, sigma: sig, risk: sig > 0 ? riskProfile(mu, sig) : null };
  }

  // ---------- paper-trading simulator (realistic order handling, costs, settlement, dividends, Danish tax) ----------
  // Trading hours in local exchange time; holidays = full-day closures (main exchange holidays Oct 2026 – Dec 2027).
  var NORDIC_HOL = ["2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01", "2027-03-26", "2027-03-29", "2027-12-24", "2027-12-31"];
  var MARKETS = {
    CPH: { name: "Nasdaq København", tz: "Europe/Copenhagen", open: 540, close: 1020, settle: 2, hol: NORDIC_HOL.concat(["2027-03-25", "2027-05-06", "2027-05-07", "2027-05-17"]) },
    STO: { name: "Nasdaq Stockholm", tz: "Europe/Stockholm", open: 540, close: 1050, settle: 2, hol: NORDIC_HOL.concat(["2027-01-06", "2027-05-06", "2027-06-25"]) },
    HEL: { name: "Nasdaq Helsinki", tz: "Europe/Helsinki", open: 600, close: 1110, settle: 2, hol: NORDIC_HOL.concat(["2026-12-06", "2027-05-06", "2027-06-25"]) },
    OSE: { name: "Oslo Børs", tz: "Europe/Oslo", open: 540, close: 980, settle: 2, hol: NORDIC_HOL.concat(["2027-03-25", "2027-05-06", "2027-05-17"]) },
    XETRA: { name: "Xetra Frankfurt", tz: "Europe/Berlin", open: 540, close: 1050, settle: 2, hol: NORDIC_HOL },
    EPA: { name: "Euronext Paris", tz: "Europe/Paris", open: 540, close: 1050, settle: 2, hol: NORDIC_HOL.filter(function (d) { return d !== "2026-12-24" && d !== "2026-12-31" && d !== "2027-12-24" && d !== "2027-12-31"; }) },
    SIX: { name: "SIX Swiss Exchange", tz: "Europe/Zurich", open: 540, close: 1050, settle: 2, hol: NORDIC_HOL.concat(["2027-05-06", "2027-05-17"]) },
    US: { name: "NYSE/Nasdaq (USA)", tz: "America/New_York", open: 570, close: 960, settle: 1, hol: ["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"] },
    CRYPTO: { name: "Kryptobørs (døgnåben)", tz: "UTC", open: 0, close: 1440, settle: 0, hol: [], always: true }
  };
  var EXCH = { CPH: "CPH", STO: "STO", HEL: "HEL", OSE: "OSE", XETRA: "XETRA", EPA: "EPA", SIX: "SIX", NYSE: "US", NASDAQ: "US", CRYPTO: "CRYPTO" };
  function marketOf(st) { return MARKETS[EXCH[st.exchange] || (st.country === "US" ? "US" : "CPH")] || MARKETS.CPH; }
  function localParts(date, tz) {
    var f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
    var p = {}; f.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var h = +p.hour % 24;
    return { day: p.year + "-" + p.month + "-" + p.day, min: h * 60 + (+p.minute), wd: p.weekday };
  }
  function isTradingDay(m, day, wd) { return m.always || (wd !== "Sat" && wd !== "Sun" && m.hol.indexOf(day) < 0); }
  function marketOpenAt(m, date) {
    if (m.always) return true;
    var lp = localParts(date, m.tz);
    return isTradingDay(m, lp.day, lp.wd) && lp.min >= m.open && lp.min < m.close;
  }
  // next opening moment after `date` (checks in 15-minute steps; at most 10 days ahead)
  function nextOpen(m, date) {
    if (m.always) return date;
    var t = new Date(date.getTime());
    for (var i = 0; i < 960; i++) { if (marketOpenAt(m, t)) return t; t = new Date(t.getTime() + 15 * 60000); }
    return null;
  }
  function marketStatus(st, now) {
    var m = marketOf(st); now = now || new Date();
    if (m.always) return { open: true, name: m.name, text: "Døgnåbent – handles hele tiden" };
    if (marketOpenAt(m, now)) { var lp = localParts(now, m.tz), left = m.close - lp.min; return { open: true, name: m.name, text: "Åben – lukker om " + (left >= 60 ? Math.floor(left / 60) + " t. " : "") + (left % 60) + " min." }; }
    var n = nextOpen(m, now);
    return { open: false, name: m.name, next: n, text: "Lukket – åbner " + (n ? n.toLocaleString("da-DK", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Copenhagen" }) + " (dansk tid)" : "senere") };
  }
  function addTradingDays(m, day, n) {
    if (!n) return day;
    var d = new Date(day + "T12:00:00Z"), k = 0;
    while (k < n) { d = new Date(d.getTime() + 864e5); var s = d.toISOString().slice(0, 10), wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]; if (isTradingDay(m, s, wd)) k++; }
    return d.toISOString().slice(0, 10);
  }
  // estimated half bid-ask spread from size / liquidity
  function halfSpread(st, macro) {
    if (st.model === "crypto") return (st.rank || 99) <= 10 ? 0.0005 : (st.rank || 99) <= 40 ? 0.0015 : 0.004;
    var mc = (st.fund && st.fund.marketCap || 0) * ((macro.fx && macro.fx[st.currency]) || 1);
    return mc > 5e11 ? 0.0002 : mc > 5e10 ? 0.0005 : mc > 1e10 ? 0.001 : 0.0025;
  }
  var CRYPTO_FEE = 0.004; // typical taker fee on a large crypto exchange (e.g. Kraken, Coinbase Advanced)
  // full cost breakdown of a trade; price = execution price in the asset's currency
  function simCost(st, side, qty, price, macro) {
    var fx = (macro.fx && macro.fx[st.currency]) || 1, gross = qty * price, grossDKK = gross * fx, crypto = st.model === "crypto";
    var f = FEES[st.country] || FEES.US, kurtage, fxFee, rule;
    if (crypto) { kurtage = grossDKK * CRYPTO_FEE; fxFee = st.currency === "DKK" ? 0 : grossDKK * 0.0025; rule = "Børsgebyr " + pct(CRYPTO_FEE, 1) + " + valutaveksling 0,25 %"; }
    else { kurtage = Math.max(f.min, grossDKK * f.pct); fxFee = grossDKK * f.fx; rule = "Kurtage " + pct(f.pct, 2) + " (min. " + f.min + " kr.)" + (f.fx ? " + valutaveksling " + pct(f.fx, 2) : ""); }
    var total = side === "buy" ? grossDKK + kurtage + fxFee : grossDKK - kurtage - fxFee;
    return { qty: qty, price: price, currency: st.currency, fx: fx, gross: gross, grossDKK: grossDKK, kurtage: kurtage, fxFee: fxFee, total: total, rule: rule };
  }
  function simNew(cash, now) { return { v: 1, start: { date: now.toISOString(), cash: cash }, cashFlow: [], orders: [], divs: [], snaps: [] }; }
  // replay all filled orders -> cash, holdings (average cost for shares, FIFO for crypto), realized results
  function simBook(sim, stocks, macro) {
    var cash = sim.start.cash, book = {}, realized = [], fees = { kurtage: 0, fx: 0, spread: 0 }, settled = sim.start.cash, unsettled = 0, today = new Date().toISOString().slice(0, 10);
    (sim.cashFlow || []).forEach(function (c) { cash += c.amount; settled += c.amount; });
    var fills = (sim.orders || []).filter(function (o) { return o.status === "filled"; }).sort(function (a, b) { return a.fill.ts < b.fill.ts ? -1 : 1; });
    fills.forEach(function (o) {
      var f = o.fill, st = stocks[o.sid] || { model: o.crypto ? "crypto" : "", name: o.name, currency: f.currency };
      var b = book[o.sid] || (book[o.sid] = { sid: o.sid, qty: 0, cost: 0, lots: [], crypto: !!o.crypto, first: f.ts });
      fees.kurtage += f.kurtage; fees.fx += f.fxFee; fees.spread += f.spreadCost || 0;
      var settle = f.settle || today, isSettled = settle <= today;
      if (o.side === "buy") {
        cash -= f.total; if (isSettled) settled -= f.total; else unsettled -= f.total;
        b.qty += o.qty; b.cost += f.total; b.lots.push({ qty: o.qty, cost: f.total, ts: f.ts });
      } else {
        cash += f.total; if (isSettled) settled += f.total; else unsettled += f.total;
        var q = Math.min(o.qty, b.qty), costOut = 0;
        if (b.crypto) { var rem = q; while (rem > 1e-12 && b.lots.length) { var L = b.lots[0], take = Math.min(rem, L.qty), c = L.cost * take / L.qty; costOut += c; L.qty -= take; L.cost -= c; rem -= take; if (L.qty <= 1e-12) b.lots.shift(); } }
        else costOut = b.qty > 0 ? b.cost / b.qty * q : 0;
        b.qty -= q; b.cost -= costOut; if (b.qty <= 1e-12) { b.qty = 0; b.cost = 0; b.lots = []; }
        realized.push({ sid: o.sid, date: f.ts.slice(0, 10), year: +f.ts.slice(0, 4), qty: q, proceeds: f.total, cost: costOut, gain: f.total - costOut, crypto: !!o.crypto, orderId: o.id });
      }
    });
    (sim.divs || []).forEach(function (d) { cash += d.net; settled += d.net; });
    var positions = [], invested = 0;
    Object.keys(book).forEach(function (k) {
      var b = book[k]; if (b.qty <= 1e-12) return;
      var st = stocks[k], fx = st ? ((macro.fx && macro.fx[st.currency]) || 1) : 1, value = st ? b.qty * st.price * fx : b.cost;
      invested += value;
      positions.push({ sid: k, stock: st || null, qty: b.qty, cost: b.cost, avgCost: b.cost / b.qty, value: value, gain: value - b.cost, gainPct: value / b.cost - 1, crypto: b.crypto, first: b.first });
    });
    // cash reserved by open buy orders and shares reserved by open sell orders
    var reserved = 0, resQty = {};
    (sim.orders || []).forEach(function (o) {
      if (o.status !== "pending") return;
      if (o.side === "buy") reserved += o.reserve || 0; else resQty[o.sid] = (resQty[o.sid] || 0) + o.qty;
    });
    return { cash: cash, settled: settled, unsettled: unsettled, reserved: reserved, available: cash - reserved, resQty: resQty, positions: positions, realized: realized, invested: invested, total: invested + cash, fees: fees, divs: sim.divs || [], start: sim.start.cash + (sim.cashFlow || []).reduce(function (s, c) { return s + c.amount; }, 0) };
  }
  function roundQty(st, q) { return st.model === "crypto" ? Math.floor(q * 1e6) / 1e6 : Math.floor(q); }
  // validate and place an order; executes at once when the market is open and the quote is from today
  function simPlace(sim, stocks, macro, req, now, signal) {
    var st = stocks[req.sid]; if (!st) return { ok: false, err: "Ukendt værdipapir." };
    var crypto = st.model === "crypto", qty = roundQty(st, +req.qty);
    if (!(qty > 0)) return { ok: false, err: crypto ? "Angiv et beløb eller antal større end 0." : "Aktier handles i hele stk. – angiv mindst 1." };
    var bk = simBook(sim, stocks, macro), hs = halfSpread(st, macro);
    var type = req.type === "market" ? "market" : "limit", limit = type === "limit" ? +req.limit : NaN;
    if (type === "limit" && !(limit > 0)) return { ok: false, err: "Angiv en limitkurs." };
    if (req.side === "sell") {
      var pos = bk.positions.filter(function (p) { return p.sid === req.sid; })[0], have = pos ? pos.qty : 0, free = have - (bk.resQty[req.sid] || 0);
      if (qty > free + 1e-9) return { ok: false, err: "Du kan højst sælge " + (crypto ? +free.toFixed(6) : free) + " (" + (have > free ? "resten er reserveret af en åben ordre" : "det er hvad du ejer") + "). Short-salg er ikke muligt." };
    } else {
      var px = type === "limit" ? limit : st.price * (1 + hs) * 1.03; // market orders reserve 3 % extra for price moves
      var est = simCost(st, "buy", qty, px, macro).total;
      if (est > bk.available + 1e-6) return { ok: false, err: "Ikke nok disponible penge: ordren kræver ca. " + money(est, "kr.") + ", du har " + money(bk.available, "kr.") + " til rådighed." };
    }
    var vt = req.validTo || now.toISOString().slice(0, 10);
    var o = { id: Math.random().toString(36).slice(2, 10), sid: st.id, name: st.name, ticker: st.ticker, crypto: crypto, side: req.side, qty: qty, type: type, limit: type === "limit" ? limit : null, validTo: vt,
      created: now.toISOString(), baseP: st.price, baseD: st.priceDate, status: "pending", signal: signal || null };
    if (req.side === "buy") o.reserve = simCost(st, "buy", qty, type === "limit" ? limit : st.price * (1 + hs) * 1.03, macro).total;
    sim.orders.push(o);
    var res = simTryFill(o, st, macro, now, true);
    return { ok: true, order: o, filled: res };
  }
  // attempt to execute one pending order against the newest known quote
  function simTryFill(o, st, macro, now, atPlacement) {
    var m = marketOf(st), crypto = st.model === "crypto", today = now.toISOString().slice(0, 10);
    var fresh;
    if (atPlacement) {
      // immediate execution only while the market is open and the quote is from today's session (crypto: quote < 36 h old)
      fresh = marketOpenAt(m, now) && (crypto ? (now - new Date(st.priceDate + "T12:00:00Z")) < 36 * 36e5 : st.priceDate >= localParts(now, m.tz).day);
    } else {
      // a new quote must have arrived after the order, and the market must have been open since the order was placed
      var newQuote = st.priceDate > o.baseD || Math.abs(st.price - o.baseP) > 1e-12;
      var opened = crypto || (function () { var n = nextOpen(m, new Date(o.created)); return n && n <= now; })();
      fresh = newQuote && opened;
    }
    if (!fresh) return false;
    var hs = halfSpread(st, macro), exec = o.side === "buy" ? st.price * (1 + hs) : st.price * (1 - hs);
    if (o.type === "limit") {
      if (o.side === "buy" && exec > o.limit) return false;
      if (o.side === "sell" && exec < o.limit) return false;
    }
    var c = simCost(st, o.side, o.qty, exec, macro);
    c.spreadCost = Math.abs(exec - st.price) * o.qty * c.fx;
    c.ts = now.toISOString(); c.quoteDate = st.priceDate; c.mid = st.price;
    c.settle = addTradingDays(m, localParts(now, m.tz).day, m.settle);
    o.status = "filled"; o.fill = c; delete o.reserve;
    return true;
  }
  // process pending orders, expiry and dividends; returns list of human-readable events
  function simProcess(sim, stocks, macro, rules, now) {
    var ev = [], today = now.toISOString().slice(0, 10);
    (sim.orders || []).forEach(function (o) {
      if (o.status !== "pending") return;
      var st = stocks[o.sid];
      if (!st) return;
      if (simTryFill(o, st, macro, now, false)) { ev.push({ kind: "fill", order: o }); return; }
      if (o.validTo < today) { o.status = "expired"; o.ended = now.toISOString(); delete o.reserve; ev.push({ kind: "expired", order: o }); }
    });
    // dividends: credit when a position was held before the ex-date (withholding: Danish 27 %, foreign per country)
    var bk = simBook(sim, stocks, macro), wh = (rules && rules.withholding) || {};
    bk.positions.forEach(function (p) {
      var st = p.stock; if (!st || p.crypto || !st.events || !st.events.exDiv || !(st.fund && st.fund.dps > 0)) return;
      var ex = st.events.exDiv;
      if (ex > today || ex <= p.first.slice(0, 10)) return;
      var key = p.sid + "|" + ex; if ((sim.divs || []).some(function (d) { return d.key === key; })) return;
      // only credit the latest dividend instalment (annual dps split by payout frequency is not known – use dps for annual payers)
      var fx = (macro.fx && macro.fx[st.currency]) || 1, gross = p.qty * st.fund.dps * fx;
      var rate = st.country === "DK" ? 0.27 : (wh[st.country] != null ? wh[st.country] : 0.15);
      sim.divs = sim.divs || [];
      sim.divs.push({ key: key, sid: p.sid, date: ex, qty: p.qty, gross: gross, rate: rate, withheld: gross * rate, net: gross * (1 - rate) });
      ev.push({ kind: "div", sid: p.sid, amount: gross * (1 - rate) });
    });
    return ev;
  }
  // estimated Danish tax on the simulation for one year
  function simTax(sim, stocks, macro, rules, year, married) {
    var bk = simBook(sim, stocks, macro), lim = married ? rules.progressionLimitMarried : rules.progressionLimit;
    var sh = bk.realized.filter(function (r) { return !r.crypto && r.year === year; }), cr = bk.realized.filter(function (r) { return r.crypto && r.year === year; });
    var gains = sh.reduce(function (s, r) { return s + r.gain; }, 0);
    var divs = (bk.divs || []).filter(function (d) { return +d.date.slice(0, 4) === year; });
    var divGross = divs.reduce(function (s, d) { return s + d.gross; }, 0), withheld = divs.reduce(function (s, d) { return s + Math.min(d.withheld, d.gross * (d.rate === 0.27 ? 0.27 : 0.15)); }, 0);
    var shareIncome = gains + divGross, taxable = Math.max(0, shareIncome);
    var shareTax = Math.min(taxable, lim) * rules.rateLow + Math.max(0, taxable - lim) * rules.rateHigh;
    var cGain = cr.filter(function (r) { return r.gain > 0; }).reduce(function (s, r) { return s + r.gain; }, 0), cLoss = cr.filter(function (r) { return r.gain < 0; }).reduce(function (s, r) { return s + r.gain; }, 0);
    var cryptoTax = cGain * 0.42 + cLoss * 0.26; // personal income ~42 % (37–53 % depending on other income); losses deductible at ~26 %
    return { gains: gains, divGross: divGross, withheld: withheld, shareIncome: shareIncome, shareTax: shareTax, shareDue: shareTax - withheld, cryptoGain: cGain, cryptoLoss: cLoss, cryptoTax: cryptoTax, limit: lim };
  }

  return {
    DEFAULTS: DEFAULTS, analyze: analyze, valuation: valuation, priceStats: priceStats, riskProfile: riskProfile,
    buildPortfolio: buildPortfolio, taxYear: taxYear, saleTax: saleTax, portfolioRisk: portfolioRisk, fee: fee,
    settingsWith: settingsWith, Phi: Phi, pct: pct, sgnPct: sgnPct, money: money, num: num, clamp: clamp, mean: mean, sd: sd, REC: REC,
    MARKETS: MARKETS, priceDigits: priceDigits, marketOf: marketOf, marketStatus: marketStatus, halfSpread: halfSpread, simCost: simCost, simNew: simNew, simBook: simBook, simPlace: simPlace, simProcess: simProcess, simTax: simTax, roundQty: roundQty
  };
})();
