// Indsamler begivenheder til Begivenheder-siden. Køres af GitHub Actionen (kursvagt.yml).
//   node begivenheder/collector/collect.mjs <datamappe> [--force]
// Kilder (styres af begivenheder/kilder.json):
//   - kalendere: iCal-links (.ics). Hentes hver 3. time. Gentagelser (RRULE) udfoldes et år frem.
//   - google: Googles begivenhedssøgning via SerpApi (kræver hemmeligheden SERPAPI_KEY). Fordeles over måneden,
//     så det gratis antal søgninger ikke overskrides.
// Steder uden koordinater slås op i OpenStreetMap (Nominatim, højst 1 opslag i sekundet) og gemmes i en cache.
// Resultatet skrives til <datamappe>/events.json, som siden filtrerer på kort, radius og datoer.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'begivenheder/data';
const FORCE = process.argv.includes('--force') || process.env.BEG_FORCE === '1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UA = 'MultiApps-Begivenheder/1.0 (+https://github.com/AjdinkvBeta/MultiApps)';
const ICAL_EVERY_H = 3, HORIZON_DAYS = 400, TZ = 'Europe/Copenhagen';
const fetchFn = globalThis.__fetch || fetch;
const now = new Date();

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');

fs.mkdirSync(DIR, {recursive: true});
const cfg = readJSON(path.join(ROOT, 'kilder.json'), {kalendere: [], google: {steder: []}});
const state = readJSON(path.join(DIR, 'state.json'), {});
const geo = readJSON(path.join(DIR, 'geocache.json'), {});
let icalEvents = readJSON(path.join(DIR, 'ical.json'), {cals: [], events: []});
let googleEvents = readJSON(path.join(DIR, 'google.json'), {places: {}});

// ---------- Hjælpere til tid ----------
// "Lokal" tid i Danmark for et UTC-tidspunkt
function localParts(d){
  const f = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return {day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`};
}
const todayStr = localParts(now).day;
const horizon = new Date(now.getTime() + HORIZON_DAYS * 864e5);

// ---------- Stedopslag (Nominatim) ----------
let geoCalls = 0;
async function geocode(q){
  q = String(q || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const k = q.toLowerCase();
  if (k in geo) return geo[k];
  if (geoCalls >= 80) return null;            // resten tages næste gang
  geoCalls++;
  await sleep(1100);
  try {
    const r = await fetchFn('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=dk,de,se,no&q=' + encodeURIComponent(q), {headers: {'User-Agent': UA, 'Accept-Language': 'da'}});
    const a = r.ok ? await r.json() : [];
    geo[k] = a[0] ? {lat: +a[0].lat, lng: +a[0].lon} : 0;
  } catch (e) { return null; }
  return geo[k];
}
// Prøv hele adressen, derefter kortere udgaver (sted, by)
async function geocodeAny(parts){
  const list = [];
  const full = parts.filter(Boolean).join(', ');
  if (full) list.push(full);
  const segs = full.split(',').map(s => s.trim()).filter(Boolean);
  for (let i = 1; i < segs.length; i++) list.push(segs.slice(i).join(', '));
  for (const q of list) { const g = await geocode(q); if (g) return g; }
  return null;
}

// ---------- iCal ----------
function unfold(txt){ return txt.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
const unesc = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
function parseProp(line){
  const i = line.indexOf(':'); if (i < 0) return null;
  const head = line.slice(0, i), value = line.slice(i + 1), [name, ...ps] = head.split(';');
  const params = {}; for (const p of ps) { const [k, v] = p.split('='); params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return {name: name.toUpperCase(), params, value};
}
// Tidspunkt -> {date: Date (UTC-instant eller lokal midnat), allDay, local:{day,time}}
function parseICalDate(p){
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const d = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return {instant: new Date(d + 'T12:00:00Z'), allDay: true, local: {day: d, time: ''}};
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/); if (!m) return null;
  const [, Y, Mo, D, h, mi, , z] = m;
  if (z) { const inst = new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi)); return {instant: inst, allDay: false, local: localParts(inst)}; }
  // Lokal tid (med eller uden TZID): vis som den står; regn et omtrentligt tidspunkt til sortering/filtrering
  const inst = new Date(Date.UTC(+Y, +Mo - 1, +D, +h - 1, +mi));
  return {instant: inst, allDay: false, local: {day: `${Y}-${Mo}-${D}`, time: `${h}:${mi}`}, floating: true};
}
const WD = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
function expand(start, rrule, exdates){
  // Returnerer liste af {day,time} for gentagelser (inkl. første) frem til horisonten
  const r = Object.fromEntries(rrule.split(';').map(x => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ, interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseICalDate({value: r.UNTIL, params: {}}).instant : horizon;
  const end = until < horizon ? until : horizon;
  const byday = r.BYDAY ? r.BYDAY.split(',').map(s => s.replace(/^[+-]?\d+/, '')).map(s => WD[s]).filter(x => x != null) : null;
  const out = [], [Y, M, D] = start.local.day.split('-').map(Number), time = start.local.time;
  const base = new Date(Date.UTC(Y, M - 1, D));
  const push = d => { const day = d.toISOString().slice(0, 10); if (!exdates.has(day)) out.push({day, time}); };
  let n = 0, guard = 0;
  if (freq === 'WEEKLY' && byday && byday.length) {
    const weekStart = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 864e5);
    for (let w = 0; guard++ < 3000; w += interval) {
      for (let k = 0; k < 7; k++) {
        const d = new Date(weekStart.getTime() + (w * 7 + k) * 864e5);
        if (d < base || !byday.includes(d.getUTCDay())) continue;
        if (d > end || n >= count) return out;
        push(d); n++;
      }
    }
    return out;
  }
  for (let i = 0; guard++ < 3000; i += interval) {
    let d;
    if (freq === 'DAILY') d = new Date(base.getTime() + i * 864e5);
    else if (freq === 'WEEKLY') d = new Date(base.getTime() + i * 7 * 864e5);
    else if (freq === 'MONTHLY') d = new Date(Date.UTC(Y, M - 1 + i, D));
    else if (freq === 'YEARLY') d = new Date(Date.UTC(Y + i, M - 1, D));
    else { push(base); return out; }
    if (d > end || n >= count) break;
    push(d); n++;
  }
  return out;
}
function parseICS(txt){
  const lines = unfold(txt).split('\n'), evs = []; let cur = null, calName = '';
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {ex: new Set()}; continue; }
    if (line === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; continue; }
    const p = parseProp(line); if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-CALNAME') calName = unesc(p.value); continue; }
    if (p.name === 'SUMMARY') cur.title = unesc(p.value);
    else if (p.name === 'DTSTART') cur.start = parseICalDate(p);
    else if (p.name === 'DTEND') cur.end = parseICalDate(p);
    else if (p.name === 'LOCATION') cur.location = unesc(p.value);
    else if (p.name === 'URL') cur.url = p.value.trim();
    else if (p.name === 'UID') cur.uid = p.value.trim();
    else if (p.name === 'GEO') { const [a, b] = p.value.split(/[;,]/).map(Number); if (!isNaN(a) && !isNaN(b)) cur.geo = {lat: a, lng: b}; }
    else if (p.name === 'RRULE') cur.rrule = p.value;
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const d = parseICalDate({value: v, params: p.params}); if (d) cur.ex.add(d.local.day); }
    else if (p.name === 'STATUS') cur.status = p.value.trim().toUpperCase();
    else if (p.name === 'RECURRENCE-ID') cur.recId = true;
    else if (p.name === 'DESCRIPTION' && !cur.url) { const m = unesc(p.value).match(/https?:\/\/\S+/); if (m) cur.descUrl = m[0]; }
  }
  return {calName, events: evs};
}
async function collectIcal(){
  const cals = [], events = [];
  for (const c of cfg.kalendere || []) {
    const name = c.navn || c.url, info = {navn: name, url: c.url, n: 0};
    try {
      const url = c.url.replace(/^webcal:/i, 'https:');
      const r = await fetchFn(url, {headers: {'User-Agent': UA, Accept: 'text/calendar,*/*'}});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      if (!/BEGIN:VCALENDAR/.test(txt)) throw new Error('Ikke en iCal-kalender');
      const {calName, events: raw} = parseICS(txt);
      if (!c.navn && calName) info.navn = calName;
      for (const e of raw) {
        if (!e.start || !e.title || e.status === 'CANCELLED') continue;
        const occ = e.rrule ? expand(e.start, e.rrule, e.ex) : [e.start.local];
        const g = e.geo || (c.lat != null ? {lat: +c.lat, lng: +c.lng} : null) || (e.location ? await geocodeAny([e.location]) : null) || null;
        for (const o of occ) {
          if (o.day < todayStr) continue;
          if (new Date(o.day + 'T00:00:00Z') > horizon) break;
          events.push({src: info.navn, kind: 'ical', id: 'ic:' + (e.uid || e.title) + ':' + o.day, title: e.title, day: o.day, time: e.start.allDay ? '' : o.time,
            venue: e.location || '', city: '', lat: g ? g.lat : null, lng: g ? g.lng : null, url: e.url || e.descUrl || '', img: ''});
          info.n++;
        }
      }
    } catch (e) { info.err = String(e.message || e).slice(0, 120); }
    cals.push(info);
  }
  return {cals, events};
}

// ---------- Google (SerpApi) ----------
const MON = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
function parseGoogleDate(ev){
  const sd = (ev.date && ev.date.start_date) || '', when = (ev.date && ev.date.when) || '';
  const m = sd.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/) || when.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/);
  if (!m || !MON[m[1].toLowerCase()]) return null;
  const mo = MON[m[1].toLowerCase()], d = +m[2], ty = +todayStr.slice(0, 4);
  // Google skriver ikke årstal: ligger datoen mere end en uge tilbage i år, er det næste år
  let y = ty; if (new Date(Date.UTC(ty, mo - 1, d)) < new Date(Date.parse(todayStr + 'T00:00:00Z') - 7 * 864e5)) y = ty + 1;
  const day = `${y}-${pad(mo)}-${pad(d)}`;
  // Tid: første klokkeslæt i "when", fx "Sat, Nov 7, 7 – 10 PM", "Nov 7, 8:00 PM", "Sat 7 Nov, 19:30"
  let time = '';
  const ampm = when.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:[–-]\s*\d{1,2}(?::\d{2})?\s*)?(AM|PM)\b/i), h24 = when.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
  if (ampm) { let h = +ampm[1]; const ap = ampm[3].toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; time = `${pad(h)}:${ampm[2] || '00'}`; }
  else if (h24) time = `${pad(+h24[1])}:${h24[2]}`;
  return {day, time};
}
// Hele landet: hovedbyen i hver af de 98 kommuner. Prioriterede byer (kilder.json → google.steder) opdateres oftest.
const DK_BYER = ['København','Frederiksberg','Ballerup','Brøndby','Dragør','Gentofte','Gladsaxe','Glostrup','Herlev','Albertslund','Hvidovre','Høje-Taastrup','Lyngby','Rødovre','Ishøj','Tårnby','Vallensbæk','Furesø','Allerød','Fredensborg','Helsingør','Hillerød','Hørsholm','Rudersdal','Egedal','Frederikssund','Greve','Køge','Halsnæs','Roskilde','Solrød','Gribskov','Odsherred','Holbæk','Faxe','Kalundborg','Ringsted','Slagelse','Stevns','Sorø','Lejre','Lolland','Næstved','Guldborgsund','Vordingborg','Bornholm','Middelfart','Assens','Faaborg','Kerteminde','Nyborg','Odense','Svendborg','Nordfyn','Langeland','Ærø','Haderslev','Billund','Sønderborg','Tønder','Esbjerg','Fanø','Varde','Vejen','Aabenraa','Fredericia','Horsens','Kolding','Vejle','Herning','Holstebro','Lemvig','Struer','Syddjurs','Norddjurs','Favrskov','Odder','Randers','Silkeborg','Samsø','Skanderborg','Aarhus','Ikast','Brande','Ringkøbing','Hedensted','Morsø','Skive','Thisted','Viborg','Brønderslev','Frederikshavn','Vesthimmerland','Læsø','Rebild','Mariagerfjord','Jammerbugt','Aalborg','Hjørring','Grenaa','Ebeltoft','Skagen'];
async function serpAccount(key){
  try { const r = await fetchFn('https://serpapi.com/account.json?api_key=' + encodeURIComponent(key), {headers: {'User-Agent': UA}}); const j = await r.json(); if (j && j.searches_per_month != null) return j; } catch (e) {}
  return null;
}
async function googleSearch(key, place, page){
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({engine: 'google_events', q: 'Events in ' + place + ', Denmark', hl: 'en', gl: 'dk', start: page * 10, api_key: key}).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetchFn(u, {headers: {'User-Agent': UA}}); state.google.used++; state.google.today = (state.google.today || 0) + 1;
  return r.json();
}
async function collectGoogle(){
  const key = process.env.SERPAPI_KEY, g = cfg.google || {};
  const prio = [...new Set(g.steder || [])], whole = g.heleLandet !== false;
  const towns = whole ? [...prio, ...DK_BYER.filter(b => !prio.some(p => p.toLowerCase() === b.toLowerCase()))] : prio;
  const month = todayStr.slice(0, 7);
  if (!state.google || state.google.month !== month) state.google = {month, used: 0, last: (state.google && state.google.last) || {}};
  if (state.google.day !== todayStr) { state.google.day = todayStr; state.google.today = 0; }
  if (!key) return {status: 'nokey'};
  // Budget: det, kontoen har tilbage denne måned, fordelt jævnt på de resterende dage
  const acc = await serpAccount(key);
  const limit = acc ? acc.searches_per_month : Math.max(0, g.maksPrMaaned || 90);
  const left = acc ? acc.plan_searches_left : Math.max(0, limit - state.google.used);
  state.google.limit = limit; state.google.left = left;
  const [Y, M, D] = todayStr.split('-').map(Number), daysLeft = new Date(Date.UTC(Y, M, 0)).getUTCDate() - D + 1;
  const perDay = Math.floor(Math.max(0, left - 2) / daysLeft);                 // 2 i reserve til "Opdatér nu"
  let budget = Math.min(8, Math.max(0, perDay - state.google.today));
  if (FORCE) budget = Math.max(budget, Math.min(2, Math.max(0, left - 1)));
  // Hvilke byer står for tur: prioriterede efter 3 dage, resten når de er ældst (højst én gang om måneden)
  const age = t => Date.now() - (state.google.last[t] || 0);
  const due = towns.filter(t => prio.includes(t) ? age(t) > (FORCE ? 30 * 60e3 : 3 * 864e5) : age(t) > 2 * 864e5)
    .sort((a, b) => (prio.includes(b) - prio.includes(a)) || age(b) - age(a));
  for (const place of due) {
    if (budget <= 0) break;
    const found = [];
    for (let pg = 0; pg < 3 && budget > 0; pg++) {
      let j; budget--;
      try { j = await googleSearch(key, place, pg); } catch (e) { break; }
      if (j.error) { if (!/hasn't returned any results/i.test(j.error)) state.google.err = String(j.error).slice(0, 120); break; }
      state.google.err = '';
      const arr = j.events_results || [];
      for (const ev of arr) {
        const dt = parseGoogleDate(ev); if (!dt || dt.day < todayStr) continue;
        const addr = Array.isArray(ev.address) ? ev.address : [];
        const venue = (ev.venue && ev.venue.name) || addr[0] || '';
        // Kendes stedet ikke, bruges søgebyens midte (markeres som omtrentlig)
        const exact = await geocodeAny(addr.length ? addr : [venue, place]);
        const town = exact ? null : await geocode(place + ', Danmark');
        const gc = exact ? {...exact} : town ? {...town, approx: true} : null;
        found.push({src: 'Google', kind: 'google', id: 'g:' + (ev.title || '') + ':' + dt.day + ':' + venue, title: ev.title || '', day: dt.day, time: dt.time,
          venue, city: addr.slice(1).join(', '), place, when: (ev.date && ev.date.when) || '', desc: String(ev.description || '').slice(0, 300),
          approx: !!(gc && gc.approx), lat: gc ? gc.lat : null, lng: gc ? gc.lng : null,
          url: ev.link || (ev.ticket_info && ev.ticket_info[0] && ev.ticket_info[0].link) || '', img: ev.thumbnail || ev.image || ''});
      }
      if (arr.length < 10) break;
    }
    state.google.last[place] = Date.now();
    googleEvents.places[place] = {at: Date.now(), events: found};
  }
  for (const p of Object.keys(googleEvents.places)) if (!towns.includes(p)) delete googleEvents.places[p];
  return {status: 'ok', towns: towns.length};
}

// ---------- Kør ----------
const icalDue = FORCE || !state.icalAt || Date.now() - state.icalAt > ICAL_EVERY_H * 3600e3 || JSON.stringify((cfg.kalendere || []).map(c => c.url)) !== JSON.stringify(state.icalUrls || []);
if (icalDue) { icalEvents = await collectIcal(); state.icalAt = Date.now(); state.icalUrls = (cfg.kalendere || []).map(c => c.url); }
const gres = await collectGoogle();

const all = [...icalEvents.events, ...Object.values(googleEvents.places).flatMap(p => p.events)].filter(e => e.day >= todayStr);
const out = {
  updatedAt: new Date().toISOString(),
  sources: {
    kalendere: icalEvents.cals,
    google: {status: gres.status, used: (state.google || {}).used || 0, limit: (state.google || {}).limit || 0, left: (state.google || {}).left, steder: (cfg.google || {}).steder || [],
      heleLandet: (cfg.google || {}).heleLandet !== false, byer: gres.towns || 0, hentet: Object.keys(googleEvents.places).length, err: (state.google || {}).err || '',
      opdateret: Object.fromEntries(Object.entries(googleEvents.places).map(([k, v]) => [k, v.at]))},
  },
  events: all,
};
writeJSON(path.join(DIR, 'events.json'), out);
writeJSON(path.join(DIR, 'ical.json'), icalEvents);
writeJSON(path.join(DIR, 'google.json'), googleEvents);
writeJSON(path.join(DIR, 'geocache.json'), geo);
writeJSON(path.join(DIR, 'state.json'), state);
console.log(`Google-budget: ${(state.google||{}).left} tilbage af ${(state.google||{}).limit}, i dag ${(state.google||{}).today}`);
console.log(`Begivenheder: ${icalEvents.events.length} fra ${icalEvents.cals.length} kalendere, ${Object.values(googleEvents.places).reduce((a, p) => a + p.events.length, 0)} fra Google (${gres.status}, brugt ${(state.google || {}).used || 0}), ${geoCalls} stedopslag`);
