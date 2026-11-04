// Test af Begivenheder: kort, radius, datoer og Ticketmaster-søgning (Ticketmaster svarer med testdata).
const {chromium} = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/begivenheder/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, hasTouch: true, permissions: ['geolocation'], geolocation: {latitude: 55.6761, longitude: 12.5683}});
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  const calls = [];
  // Falsk Ticketmaster: 2.400 begivenheder jævnt fordelt i perioden; højst 1.000 kan hentes pr. søgning
  const ALL = []; const t0 = Date.now();
  for (let i = 0; i < 2400; i++) { const d = new Date(t0 + i * 3600e3 * 0.29); ALL.push({id: 'e' + i, name: 'Koncert ' + i, url: 'https://example.com/' + i, dates: {start: {localDate: d.toISOString().slice(0, 10), localTime: d.toISOString().slice(11, 19), dateTime: d.toISOString()}},
    _embedded: {venues: [{name: 'Sted ' + (i % 7), city: {name: 'København'}, location: {latitude: String(55.6761 + (i % 10) * 0.01), longitude: '12.5683'}}]}, images: [], classifications: [{segment: {name: 'Music'}}]}); }
  ALL.push({id: 'far', name: 'Langt væk', url: 'https://example.com/far', dates: {start: {localDate: new Date(t0 + 86400e3).toISOString().slice(0, 10), localTime: '20:00:00'}}, _embedded: {venues: [{name: 'Aarhus', location: {latitude: '56.15', longitude: '10.2'}}]}});
  await p.route('https://app.ticketmaster.com/**', route => {
    const u = new URL(route.request().url()); calls.push(u.search);
    if (u.searchParams.get('apikey') !== 'TESTKEY') return route.fulfill({status: 401, body: '{}'});
    const a = new Date(u.searchParams.get('startDateTime')), z = new Date(u.searchParams.get('endDateTime')), size = +u.searchParams.get('size'), page = +u.searchParams.get('page');
    const hit = ALL.filter(e => { const d = new Date(e.dates.start.dateTime || (e.dates.start.localDate + 'T20:00:00Z')); return d >= a && d <= z; });
    const slice = page * size < 1000 ? hit.slice(page * size, Math.min(1000, (page + 1) * size)) : [];
    route.fulfill({contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify({_embedded: slice.length ? {events: slice} : undefined, page: {size, totalElements: hit.length, totalPages: Math.ceil(hit.length / size), number: page}})});
  });
  // Indsamlede data (kalendere + Google) – én begivenhed findes også hos Ticketmaster (skal kun vises én gang)
  const d0 = new Date(t0 + 2 * 86400e3).toISOString().slice(0, 10);
  let dataVer = 1; const gh = [];
  const evData = () => ({updatedAt: 'v' + dataVer, sources: {kalendere: [{navn: 'Alsion', url: 'https://x/a.ics', n: 2}], google: {status: 'ok', used: 4, limit: 90, steder: ['Sønderborg'], opdateret: {'Sønderborg': Date.now()}}},
    events: [{src: 'Alsion', kind: 'ical', id: 'ic1', title: 'Strikkeklub', day: d0, time: '18:00', venue: 'Biblioteket', lat: 55.68, lng: 12.57, url: 'https://x/s'},
             {src: 'Alsion', kind: 'ical', id: 'ic2', title: 'Uden sted', day: d0, time: '', venue: '', lat: null, lng: null, url: ''},
             {src: 'Google', kind: 'google', id: 'g1', title: 'Koncert 5', day: ALL[5].dates.start.localDate, time: '', venue: 'Sted 5', lat: 55.70, lng: 12.5683, url: 'https://g/5'},
             {src: 'OpdagDanmark', kind: 'odk', id: 'o1', title: 'Julemarked', day: new Date(t0 - 2 * 86400e3).toISOString().slice(0, 10), dayEnd: new Date(t0 + 3 * 86400e3).toISOString().slice(0, 10), time: '10:00', venue: 'Torvet', city: 'København', lat: 55.676, lng: 12.57, url: 'https://k/1', img: '', desc: 'Hygge'},
             {src: 'OpdagDanmark', kind: 'odk', id: 'o3', title: 'Lang udstilling', day: new Date(t0 - 2 * 86400e3).toISOString().slice(0, 10), dayEnd: new Date(t0 + 60 * 86400e3).toISOString().slice(0, 10), time: '', venue: 'Museum', city: 'København', lat: 55.677, lng: 12.571, url: 'https://k/3'},
             {src: 'OpdagDanmark', kind: 'odk', id: 'o2', title: 'Aarhus-fest', day: d0, time: '19:00', venue: 'Musikhuset', city: 'Aarhus', lat: 56.15, lng: 10.2, url: 'https://k/2'},
             {src: 'Google', kind: 'google', id: 'g2', title: dataVer > 1 ? 'Ny fra Google' : 'Langt fra', day: d0, time: '20:00', venue: 'X', lat: dataVer > 1 ? 55.68 : 57.0, lng: dataVer > 1 ? 12.57 : 9.9, url: 'https://g/2'}]});
  await p.route('**/begivenheder/data/events.json*', r => r.fulfill({contentType: 'application/json', body: JSON.stringify(evData())}));
  await p.route('https://api.github.com/**', async r => {
    const req = r.request(); gh.push(req.method() + ' ' + new URL(req.url()).pathname);
    if (req.method() === 'GET') return r.fulfill({contentType: 'application/json', body: JSON.stringify({sha: 'abc', content: Buffer.from(JSON.stringify({kalendere: [], google: {steder: ['Sønderborg']}})).toString('base64')})});
    if (req.method() === 'PUT') { gh.push('BODY ' + Buffer.from(JSON.parse(req.postData()).content, 'base64').toString().replace(/\s+/g, '')); return r.fulfill({contentType: 'application/json', body: '{}'}); }
    if (/dispatches/.test(req.url())) { dataVer = 2; return r.fulfill({status: 204, body: ''}); }
    r.fulfill({status: 404, body: '{}'});
  });
  await p.goto(BASE); await p.waitForTimeout(1500);
  await p.click('#gear');
  console.log('topbar:', (await p.textContent('.bar')).replace(/\s+/g, ' ').trim(), '| datoknap:', await p.textContent('#dateBtn'));
  console.log('kort:', await p.evaluate(() => !!document.querySelector('.leaflet-tile-pane')), '| fra:', await p.inputValue('#from'), 'til:', await p.inputValue('#to'));
  console.log('uden nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim());
  await p.click('#me'); await p.waitForTimeout(1500);
  await p.fill('#tmKey', 'forkert'); await p.dispatchEvent('#tmKey', 'change'); await p.waitForTimeout(1500);
  console.log('forkert nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim().slice(0, 80));
  await p.click('#dateBtn');
  await p.fill('#to', new Date(t0 + 30 * 86400e3).toISOString().slice(0, 10)); await p.dispatchEvent('#to', 'change');
  await p.fill('#tmKey', 'TESTKEY'); await p.dispatchEvent('#tmKey', 'change');
  await p.waitForFunction(() => /Ticketmaster\s*\d+ fundet/.test(document.getElementById('srcs').textContent), null, {timeout: 120000});
  const n = await p.$$eval('#list .ev', r => r.length);
  const expect = ALL.filter(e => e.id !== 'far').filter(e => { const d = new Date(e.dates.start.dateTime); const f = new Date(); f.setHours(0,0,0,0); const z = new Date(t0 + 30 * 86400e3); z.setHours(23, 59, 59); return d >= f && d <= z; }).length;
  console.log('fundet:', n, 'forventet:', expect, '| kald:', calls.length, '| uden for radius med:', await p.evaluate(() => /Langt væk/.test(document.getElementById('list').textContent)));
  console.log('overskrift:', await p.textContent('#resHead'), '| kilder:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim());
  console.log('Koncert 5 vises', await p.$$eval('#list .ev', r => r.filter(x => /Koncert 5$/.test(x.querySelector('.name').textContent)).length), 'gang(e):', await p.$$eval('#list .ev', r => (r.find(x => /Koncert 5$/.test(x.querySelector('.name').textContent)) || {}).textContent));
  console.log('kalendere:', (await p.textContent('#cals')).replace(/\s+/g, ' ').trim(), '| google:', (await p.textContent('#gplaces')).replace(/\s+/g, ' ').trim().slice(0, 40), '|', await p.textContent('#gUse'));
  // Tilføj kalender med GitHub-nøgle -> kilder.json gemmes, Actionen startes, nye data hentes
  await p.fill('#ghKey', 'ghp_test'); await p.dispatchEvent('#ghKey', 'change');
  await p.fill('#calIn', 'webcal://example.com/k.ics'); await p.click('#calAdd');
  await p.waitForFunction(() => /Ny fra Google/.test(document.getElementById('list').textContent), null, {timeout: 60000});
  console.log('github:', gh.join(' ; '));
  // Prikker på kortet: tryk -> boble med info; "Vis i listen" ruller til begivenheden
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(800);
  const pins = await p.$$eval('.pin', r => r.map(x => x.textContent));
  console.log('prikker:', pins.length, 'eksempel:', pins.slice(0, 4).join(','));
  console.log('klynger:', await p.evaluate(() => !!L.markerClusterGroup), '| Aarhus på kortet, ikke i listen:', await p.evaluate(() => { let n = 0; window.__beg.map.eachLayer(l => { if (l.getAllChildMarkers) n++; }); return n; }) >= 0, !/Aarhus-fest/.test(await p.textContent('#list')));
  console.log('lang udstilling skjult:', !/Lang udstilling/.test(await p.textContent('#list')));
  await p.click('#datePanel [data-p="w"]'); await p.waitForTimeout(600); console.log('weekend:', await p.textContent('#dateBtn'), await p.inputValue('#from'), await p.inputValue('#to'));
  await p.click('#dateBtn'); await p.click('#datePanel [data-p="30"]'); await p.waitForFunction(() => /Ticketmaster\s*\d+ fundet/.test(document.getElementById('srcs').textContent), null, {timeout: 120000});
  console.log('julemarked i dag-listen:', (await p.$$eval('#list .ev', r => (r.find(x => /Julemarked/.test(x.textContent)) || {}).textContent || '')).replace(/\s+/g, ' '));
  await p.evaluate(() => { const m = window.__beg.map; m.setView([55.68, 12.57], 17, {animate: false}); }); await p.waitForTimeout(800);
  await p.$$eval('.pin', r => r[r.length - 1].parentElement.click()); await p.waitForSelector('#pop .pop', {timeout: 5000}); await p.waitForTimeout(500);
  console.log('popup:', await p.$$eval('#pop .pop', r => r.length), (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim(), '| første:', (await p.textContent('#pop .pop')).replace(/\s+/g, ' ').trim().slice(0, 90));
  console.log('IMG3:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  console.log('popup over kortet:', await p.evaluate(() => { const a = document.getElementById('pop').getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return a.top >= m.top && a.bottom <= m.bottom + 1; }));
  await p.click('#pop [data-show] >> nth=0'); await p.waitForTimeout(600);
  console.log('fremhævet i listen:', await p.$$eval('#list .ev.hl', r => r.map(x => x.querySelector('.name').textContent)));
  // Radius via skyder
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 14, {animate: false}));
  await p.waitForTimeout(800);
  console.log('zoom 14 – liste:', await p.textContent('#resHead'));
  // Klynge: popup med alle begivenhederne i klyngen
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 11, {animate: false})); await p.waitForTimeout(800);
  await p.$$eval('.pin', r => { const c = r.find(x => +x.textContent > 1); c.parentElement.click(); }); await p.waitForTimeout(500);
  console.log('klynge-popup:', (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim(), await p.$$eval('#pop .pop', r => r.length));
  console.log('IMG4:' + (await (await p.$('.mapwrap')).screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#popX');
  await p.waitForFunction(() => /^720 /.test(document.getElementById('resHead').textContent), null, {timeout: 60000}).catch(() => {});
  console.log('liste efter klynge:', await p.$$eval('#list .ev', r => r.length));
  // Adressesøgning (rigtig Nominatim)
  await p.fill('#q', 'Sønderborg'); await p.waitForTimeout(2500);
  console.log('forslag:', await p.$$eval('#sugg .row', r => r.length));
  await p.fill('#q', ''); await p.evaluate(() => document.getElementById('sugg').innerHTML = ''); await p.waitForTimeout(1500);
  console.log('IMGM:' + (await (await p.$('#map')).screenshot({type: 'png'})).toString('base64'));
  await p.evaluate(() => window.__beg.map.panBy([2, 0], {animate: false})); await p.waitForTimeout(600);
  console.log('IMGN:' + (await (await p.$('#map')).screenshot({type: 'png'})).toString('base64'));
  console.log('IMG1:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(300);
  console.log('IMG2:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
