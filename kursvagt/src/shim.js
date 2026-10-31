// Kursvagt on GitHub Pages – bridge between the app and its data.
// Implements the small window.claude.use("db" | "user" | "downloads") API the app was written against:
//  - market data (stocks, crypto, FX, rules, status) is read from ./data/*.json, which a GitHub Action
//    refreshes on a schedule (see .github/workflows/kursvagt.yml);
//  - your own data (portfolio, favourites/alarms, simulator) lives only in this browser (localStorage),
//    with export/import as backup or to move it to another device;
//  - crypto prices are refreshed live from CoinPaprika in the browser; the ↻ button can also start
//    the GitHub Action right away if you have saved a GitHub token on this device.
(function () {
  var REPO = "AjdinkvBeta/MultiApps", WORKFLOW = "kursvagt.yml";
  var LS = { user: "kvu-", token: "kv-ghtoken" };
  var data = null, subs = { stocks: [], meta: [], macro: [], rules: [] }, userSubs = {}, refreshing = false, lastLoad = 0;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function getJSON(url) { return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " " + url); return r.json(); }); }
  function snapDoc(id, d) { return { id: id, exists: d != null, data: function () { return d; } }; }
  function toast(t) { if (window.__kvToast) window.__kvToast(t); }

  function emit(name) {
    if (!data) return;
    if (name === "stocks") {
      var docs = [];
      Object.keys(data.stocks).forEach(function (g) { (data.stocks[g] || []).forEach(function (d) { docs.push(snapDoc(d.id, d)); }); });
      subs.stocks.forEach(function (cb) { cb({ docs: docs }); });
    } else subs[name].forEach(function (cb) { cb(snapDoc(name, data[name])); });
  }
  function emitAll() { ["stocks", "meta", "macro", "rules"].forEach(emit); }

  // ---------- load market data ----------
  function load() {
    return getJSON("data/index.json?t=" + Date.now()).then(function (idx) {
      var v = encodeURIComponent(idx.updatedAt || Date.now());
      var parts = idx.groups.map(function (g) { return getJSON("data/" + g.g + ".json?v=" + v).then(function (arr) { return [g.g, arr]; }); });
      return Promise.all([Promise.all(parts), getJSON("data/macro.json?v=" + v), getJSON("data/rules.json?v=" + v), getJSON("data/meta.json?v=" + v)]).then(function (r) {
        var st = {}; r[0].forEach(function (x) { st[x[0]] = x[1]; });
        var old = data;
        data = { idx: idx, stocks: st, macro: r[1], rules: r[2], meta: r[3] };
        if (old && old.live) applyLive(old.live); // keep live crypto prices from this session if newer
        lastLoad = Date.now(); emitAll();
        return idx;
      });
    });
  }

  // ---------- live crypto prices (CoinPaprika allows browser requests) ----------
  function cryptoDocs() { var out = []; Object.keys(data.stocks).forEach(function (g) { if (g.charAt(0) === "c") out = out.concat(data.stocks[g]); }); return out; }
  function applyLive(live) {
    data.live = live;
    cryptoDocs().forEach(function (d) {
      var q = live[d.paprikaId]; if (!q || !(q.price > 0)) return;
      if (d.priceDate && q.date < d.priceDate) return;
      d.price = q.price; d.priceDate = q.date; if (q.chg != null) d.chg24h = q.chg;
      var D = d.dailyD, C = d.dailyC, i = D.indexOf(q.date);
      if (i >= 0) C[i] = q.price; else if (!D.length || q.date > D[D.length - 1]) { D.push(q.date); C.push(q.price); }
      var ym = q.date.slice(0, 7);
      if (d.monthlyD[d.monthlyD.length - 1] === ym) d.monthlyC[d.monthlyC.length - 1] = q.price; else if (ym > d.monthlyD[d.monthlyD.length - 1]) { d.monthlyD.push(ym); d.monthlyC.push(q.price); }
    });
  }
  function refreshCrypto() {
    var docs = cryptoDocs().filter(function (d) { return d.paprikaId; }), live = (data.live || {}), i = 0, ok = 0;
    function worker() {
      if (i >= docs.length) return Promise.resolve();
      var d = docs[i++];
      return getJSON("https://api.coinpaprika.com/v1/tickers/" + d.paprikaId).then(function (t) {
        var q = t.quotes && t.quotes.USD; if (!q || !(q.price > 0)) return;
        live[d.paprikaId] = { price: q.price, chg: typeof q.percent_change_24h === "number" ? q.percent_change_24h / 100 : null, date: (t.last_updated || new Date().toISOString()).slice(0, 10) };
        ok++;
      }, function () {}).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () { if (ok) { applyLive(live); emit("stocks"); } return ok; });
  }

  // ---------- start the GitHub Action (optional, needs a token saved on this device) ----------
  function dispatch() {
    var tok = lsGet(LS.token); if (!tok) return Promise.resolve(false);
    return fetch("https://api.github.com/repos/" + REPO + "/actions/workflows/" + WORKFLOW + "/dispatches", {
      method: "POST", headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    }).then(function (r) { if (r.status === 204) return true; if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error("GitHub-nøglen virker ikke (" + r.status + ")"); throw new Error("GitHub svarede " + r.status); });
  }
  function waitForNewData(prev, tries) {
    if (tries <= 0) { toast("Opdateringen kører stadig på GitHub – nye kurser kommer om lidt"); return; }
    setTimeout(function () {
      getJSON("data/index.json?t=" + Date.now()).then(function (idx) {
        if (idx.updatedAt && idx.updatedAt !== prev) return load().then(function () { toast("Nye aktiekurser hentet"); });
        waitForNewData(prev, tries - 1);
      }, function () { waitForNewData(prev, tries - 1); });
    }, 30000);
  }

  function setStatus(txt) { var el = document.getElementById("status"); if (el && txt) el.innerHTML = '<span class="dot"></span>' + txt; }
  function spin(on) { var b = document.getElementById("refreshBtn"); if (b) b.classList.toggle("spin", !!on); }
  function refresh(manual) {
    if (refreshing) return Promise.resolve();
    refreshing = true; spin(true); setStatus("Henter…");
    var prev = data && data.idx && data.idx.updatedAt, dispatched = false;
    return load().then(refreshCrypto).then(function () {
      if (!manual) return;
      return dispatch().then(function (d) { dispatched = d; }, function (e) { toast(e.message); });
    }).then(function () {
      refreshing = false; spin(false); emit("meta");
      if (manual) {
        if (dispatched) { toast("Krypto opdateret · aktiekurser hentes på GitHub (1–3 min.)"); waitForNewData(data.idx.updatedAt, 10); }
        else toast("Opdateret · aktiekurser opdateres automatisk ca. hver halve time");
      }
    }, function (e) { refreshing = false; spin(false); emit("meta"); toast("Kunne ikke hente data: " + e.message); });
  }
  window.kvRefresh = function () { return refresh(true); };
  setInterval(function () { if (document.visibilityState === "visible" && Date.now() - lastLoad > 10 * 60e3) refresh(false); }, 60e3);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && Date.now() - lastLoad > 5 * 60e3) refresh(false); });

  // ---------- your own data: this browser only ----------
  var USER_DOCS = ["portfolio", "prefs", "sim"];
  function readUser(name) { var t = lsGet(LS.user + name); try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function writeUser(name, obj) { lsSet(LS.user + name, JSON.stringify(obj)); }
  function importObj(o) {
    var n = 0;
    USER_DOCS.forEach(function (k) { if (o && o[k] && typeof o[k] === "object") { writeUser(k, o[k]); n++; } });
    if (!n) throw new Error("Filen indeholder ingen Kursvagt-data");
    return n;
  }
  // one-time import link: …/kursvagt/#import=<base64 json>
  (function () {
    var m = (location.hash || "").match(/^#import=(.+)$/);
    if (!m) return;
    try { var json = decodeURIComponent(escape(atob(decodeURIComponent(m[1])))); importObj(JSON.parse(json)); setTimeout(function () { toast("Dine data er importeret"); }, 1500); }
    catch (e) { setTimeout(function () { toast("Import mislykkedes"); }, 1500); }
    history.replaceState(null, "", location.pathname);
  })();

  window.kvPagesPanel = function () {
    var tok = !!lsGet(LS.token);
    return '<div style="margin-top:14px;display:grid;gap:8px"><p class="small"><b>Dine egne data</b> (portefølje, favoritter, alarmer og simulering) gemmes kun i denne browser. Tag en sikkerhedskopi, eller flyt dem til en anden enhed med eksport og import.</p>' +
      '<div class="row"><button type="button" class="btn ghost sm" data-act="kvp" data-v="export">Eksportér mine data</button><button type="button" class="btn ghost sm" data-act="kvp" data-v="import">Importér</button></div>' +
      '<p class="small"><b>Aktiekurser nu.</b> ' + (tok ? "Der er gemt en GitHub-nøgle på denne enhed – ↻ starter opdateringen på GitHub med det samme." : "Aktiekurser opdateres automatisk ca. hver halve time. Gem en GitHub-nøgle, hvis ↻ også skal hente aktiekurser med det samme.") + "</p>" +
      '<div class="row"><button type="button" class="btn ghost sm" data-act="kvp" data-v="token">' + (tok ? "Skift GitHub-nøgle" : "Gem GitHub-nøgle") + "</button>" + (tok ? '<button type="button" class="btn ghost sm" data-act="kvp" data-v="notoken">Fjern nøgle</button>' : "") + "</div></div>";
  };
  window.kvPagesAction = function (v) {
    if (v === "export") {
      var o = { app: "kursvagt", exported: new Date().toISOString() };
      USER_DOCS.forEach(function (k) { o[k] = readUser(k); });
      downloads.save({ filename: "kursvagt-data-" + new Date().toISOString().slice(0, 10) + ".json", data: JSON.stringify(o, null, 1) });
    } else if (v === "import") {
      var inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json,.json";
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        f.text().then(function (t) { importObj(JSON.parse(t)); toast("Data importeret – genindlæser"); setTimeout(function () { location.reload(); }, 900); }).catch(function (e) { toast("Import mislykkedes: " + e.message); });
      };
      inp.click();
    } else if (v === "token") {
      var t = prompt("Indsæt din GitHub-nøgle (fine-grained token med Actions: Read and write på repoet MultiApps). Den gemmes kun på denne enhed.");
      if (t && t.trim()) { lsSet(LS.token, t.trim()); toast("Nøglen er gemt"); if (window.__kvRender) window.__kvRender(); }
    } else if (v === "notoken") { lsSet(LS.token, null); toast("Nøglen er fjernet"); if (window.__kvRender) window.__kvRender(); }
  };

  // ---------- API the app expects ----------
  function userDoc(name) {
    return {
      onSnapshot: function (cb) { (userSubs[name] = userSubs[name] || []).push(cb); setTimeout(function () { cb(snapDoc(name, readUser(name))); }, 0); return function () {}; },
      set: function (body) { writeUser(name, body); return Promise.resolve(); }
    };
  }
  var db = {
    collection: function () { return { onSnapshot: function (cb) { subs.stocks.push(cb); if (data) emit("stocks"); return function () {}; } }; },
    doc: function (path) {
      var m = path.match(/^data\/users\/[^/]+\/(\w+)$/);
      if (m) return userDoc(m[1]);
      var name = { "meta/status": "meta", "macro/current": "macro", "rules/dk": "rules" }[path];
      return { onSnapshot: function (cb) { if (name) { subs[name].push(cb); if (data) cb(snapDoc(name, data[name])); } return function () {}; }, set: function () { return Promise.resolve(); } };
    }
  };
  var user = { id: function () { return Promise.resolve("me"); } };
  var downloads = {
    save: function (o) {
      var blob = new Blob([o.data], { type: /\.json$/.test(o.filename || "") ? "application/json" : "text/plain;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = o.filename || "kursvagt.txt"; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return Promise.resolve();
    }
  };
  // the page itself cannot be zoomed (iOS ignores user-scalable=no, so block the pinch gesture too)
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false }); });
  document.addEventListener("touchmove", function (e) { if (e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, { passive: false });

  window.claude = { use: function (n) { return Promise.resolve(n === "db" ? db : n === "user" ? user : n === "downloads" ? downloads : null); } };
  window.KV_WORKER = true; // shows the ↻ button
  load().then(function () { refreshCrypto(); }, function (e) {
    setTimeout(function () { setStatus("Data er ikke klar endnu – første opdatering på GitHub kører måske stadig"); }, 300);
    console.warn(e);
  });
})();
