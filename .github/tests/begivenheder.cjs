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
  await p.route('**/begivenheder/data/sights.json*', r => r.fulfill({contentType: 'application/json', body: JSON.stringify({items: [
    {src: 'OpdagDanmark', kind: 'sight', id: 's:1', title: 'Byens Museum', city: 'København', venue: 'Gade 1', lat: 55.6765, lng: 12.575, url: 'https://s/1', img: '', desc: 'Historie', cats: ['Museer']},
    {src: 'OpdagDanmark', kind: 'sight', id: 's:2', title: 'Aarhus Dyrepark', city: 'Aarhus', lat: 56.12, lng: 10.15, url: 'https://s/2', img: '', desc: 'Dyr', cats: ['Zoo og dyreparker']},
    {src: 'OpdagDanmark', kind: 'sight', id: 's:3', title: 'Kongens Slot', city: 'København', lat: 55.685, lng: 12.58, url: 'https://s/3', img: '', desc: ''}]})}));
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
  console.log('kort:', await p.evaluate(() => !!document.querySelector('.leaflet-tile-pane')), '| fra:', await p.evaluate(() => document.getElementById('from').value), 'til:', await p.evaluate(() => document.getElementById('to').value));
  console.log('uden nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim());
  await p.click('#me'); await p.waitForTimeout(1500);
  await p.fill('#tmKey', 'forkert'); await p.dispatchEvent('#tmKey', 'change'); await p.waitForTimeout(1500);
  console.log('forkert nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim().slice(0, 80));
  await p.click('#dateBtn'); console.log('kalender:', await p.$$eval('#cal [data-d]', r => r.length), 'dage');
  await p.click('#datePanel [data-p="30"]');
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
  await p.click('#dateBtn'); await p.click('#datePanel [data-p="w"]'); await p.waitForTimeout(600); console.log('weekend:', await p.textContent('#dateBtn'), await p.evaluate(() => document.getElementById('from').value + ' ' + document.getElementById('to').value));
  // Kalender: tryk første og sidste dag
  await p.click('#dateBtn'); const dd = await p.$$eval('#cal [data-d]:not([disabled])', r => r.map(x => x.dataset.d)); await p.click(`#cal [data-d="${dd[1]}"]`); await p.click(`#cal [data-d="${dd[3]}"]`); await p.waitForTimeout(300);
  console.log('kalender-periode:', await p.textContent('#dateBtn'), '| panel lukket:', await p.evaluate(() => document.getElementById('datePanel').classList.contains('hidden')));
  await p.click('#dateBtn'); await p.click('#datePanel [data-p="30"]'); await p.waitForFunction(() => /Ticketmaster\s*\d+ fundet/.test(document.getElementById('srcs').textContent), null, {timeout: 120000});
  console.log('julemarked i dag-listen:', (await p.$$eval('#list .ev', r => (r.find(x => /Julemarked/.test(x.textContent)) || {}).textContent || '')).replace(/\s+/g, ' '));
  await p.evaluate(() => { const m = window.__beg.map; m.setView([55.676, 12.57], 17, {animate: false}); }); await p.waitForTimeout(800);
  await p.$$eval('.pin', r => r[r.length - 1].parentElement.click()); await p.waitForSelector('#pop .prow', {timeout: 5000}); await p.waitForTimeout(500);
  console.log('popup:', await p.$$eval('#pop .prow', r => r.length), (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim(), '| første:', (await p.textContent('#pop .prow')).replace(/\s+/g, ' ').trim().slice(0, 90));
  console.log('IMG3:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  console.log('popup over kortet:', await p.evaluate(() => { const a = document.getElementById('pop').getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(); return a.top >= m.top && a.bottom <= m.bottom + 1; }));
  await p.click('#popX'); await p.waitForTimeout(600);
  // Radius via skyder
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 14, {animate: false}));
  await p.waitForTimeout(800);
  console.log('zoom 14 – liste:', await p.textContent('#resHead'));
  // Klynge: popup med alle begivenhederne i klyngen
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 11, {animate: false})); await p.waitForTimeout(800);
  await p.$$eval('.pin', r => { const c = r.find(x => +x.textContent > 1); c.parentElement.click(); }); await p.waitForTimeout(500);
  console.log('klynge-popup:', (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim(), await p.$$eval('#pop .prow', r => r.length));
  console.log('IMG4:' + (await (await p.$('.mapwrap')).screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#popX');
  await p.waitForFunction(() => /^720 /.test(document.getElementById('resHead').textContent), null, {timeout: 60000}).catch(() => {});
  // Stjerne: gem en begivenhed fra listen og en fra popuppen
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 13, {animate: false})); await p.waitForTimeout(800);
  await p.click('#list .ev >> nth=0 >> .star'); await p.waitForTimeout(300);
  console.log('gemt fra listen:', await p.$$eval('#list .ev.saved', r => r.length), '| stjerne gul:', await p.$$eval('#list .star.on', r => r.length), '| knap:', await p.textContent('#savedBtn'), '| url uændret:', p.url().includes('begivenheder'));
  await p.$$eval('.pin', r => r[0].parentElement.click()); await p.waitForSelector('#pop .prow');
  await p.click('#pop .prow:not(.saved) .star >> nth=0'); await p.waitForTimeout(300);
  console.log('gemt fra popup:', await p.$$eval('#pop .prow.saved', r => r.length), '| gule prikker:', await p.$$eval('.pin.saved, .pin.hasSaved', r => r.length));
  console.log('IMG5:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#popX');
  await p.click('#savedBtn'); await p.waitForTimeout(800);
  console.log('Gemte-fanen: liste', await p.$$eval('#list .ev', r => r.length), '| prikker', await p.evaluate(() => { let n = 0; document.querySelectorAll('.pin').forEach(x => n += (+x.textContent || 1)); return n; }), '|', await p.textContent('#resHead'));
  console.log('IMG6:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.reload(); await p.waitForTimeout(2500);
  console.log('efter genindlæsning: gemte-filter', await p.getAttribute('#savedBtn', 'aria-pressed'), '| gemte', await p.$$eval('#list .ev', r => r.length));
  await p.click('#savedBtn'); await p.waitForTimeout(1500);
  // Filtre ud fra det synlige
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 14, {animate: false})); await p.waitForTimeout(800);
  const cls = await p.evaluate(() => [
    ['Julekoncert i Domkirken', [], 'Jul,Musik'], ['Sommerkoncert 5. juli', [], 'Musik'], ['Madsen Band live', [], 'Musik'],
    ['Viet nam – vietnamesiske retter', ['Guidede ture'], 'Mad & drikke'], ['Godnathistorier', ['Historie'], 'Børn & familie'],
    ['Kulturnat i byen', [], 'Andet'], ['Brondby IF vs Odense BK', [], 'Sport & motion'], ['Loppemarked i Sportscenter', [], 'Marked'],
  ].map(([title, cats, want]) => { const got = window.__beg.catsOf({title, cats}).slice().sort().join(','); return got === want.split(',').sort().join(',') ? 'ok' : title + ' → ' + got; }));
  console.log('klassificering:', cls.every(x => x === 'ok') ? 'alle rigtige' : cls.filter(x => x !== 'ok').join(' | '));
  console.log('filtre:', (await p.textContent('#filters')).replace(/\s+/g, ' '), '| rulbar:', await p.evaluate(() => { const f = document.getElementById('filters'); return getComputedStyle(f).flexWrap + '/' + getComputedStyle(f).overflowY + ' højde ' + f.clientHeight; }));
  console.log('IMG9:' + (await (await p.$('#filters')).screenshot({type: 'png'})).toString('base64'));
  await p.click('#filters [data-f="Marked"]'); await p.waitForTimeout(500);
  console.log('kun Marked:', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)), '| prikker:', await p.$$eval('.pin', r => r.length));
  console.log('IMG7:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#filters [data-f=""]'); await p.waitForTimeout(500);
  console.log('liste efter klynge:', await p.$$eval('#list .ev', r => r.length));
  // Adressesøgning (rigtig Nominatim)
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 13, {animate: false})); await p.waitForTimeout(600);
  await p.fill('#q', 'julemarked torvet'); await p.waitForTimeout(600);
  console.log('søg begivenheder:', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)), '| prikker:', await p.$$eval('.pin', r => r.length));
  await p.press('#q', 'Enter'); await p.waitForTimeout(200);
  // Tryk i listen: kortet flytter sig og popup åbnes; tryk i popup: hjemmesiden i en popup
  await p.click('#list .ev >> nth=0'); await p.waitForTimeout(1600);
  console.log('liste->kort: popup', await p.isVisible('#pop'), (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim(), '| zoom', await p.evaluate(() => window.__beg.map.getZoom()), '| midte', await p.evaluate(() => window.__beg.map.getCenter().lat.toFixed(3)));
  console.log('fremhævet i popup:', await p.$$eval('#pop .prow.focus .pt', r => r.map(x => x.textContent)));
  await p.evaluate(() => window.__beg.map.panBy([0, 0])); await p.waitForTimeout(900); await p.evaluate(() => window.__beg.map.panBy([30, 0], {animate: false})); await p.waitForTimeout(300);
  console.log('fremhævning væk efter flyt:', await p.$$eval('#pop .prow.focus', r => r.length) === 0);
  await p.click('#list .openbtn >> nth=0'); await p.waitForTimeout(400);
  console.log('Åbn i listen -> web-popup:', await p.isVisible('#web'), await p.getAttribute('#webFrame', 'src')); await p.click('#webX');
  await p.click('#list .ev >> nth=0'); await p.waitForTimeout(1600);
  await p.click('#pop .prow .pt >> nth=0'); await p.waitForTimeout(500);
  console.log('web-popup:', await p.isVisible('#web'), await p.getAttribute('#webFrame', 'src'), '|', await p.textContent('#webTitle'));
  await p.click('#webX');
  // Seværdigheder: grønne firkanter, egen fane i listen, egen filterlinje
  await p.fill('#q', ''); await p.waitForTimeout(500); await p.evaluate(() => document.body.click());
  await p.evaluate(() => window.__beg.map.setView([55.6761, 12.5683], 13, {animate: false})); await p.waitForTimeout(800);
  console.log('typer:', await p.$$eval('.filters .ty', r => r.map(x => x.textContent)), '| linjer:', await p.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect(), a = document.getElementById('filters').getBoundingClientRect(), b = document.getElementById('sfilters').getBoundingClientRect(); return (a.bottom <= m.top ? 'begivenheder over' : '?') + ', ' + (b.top >= m.bottom ? 'seværdigheder under' : '?'); }), '| grønne:', await p.$$eval('.pin.sq', r => r.length), '| faner:', (await p.textContent('#tabs')).replace(/\s+/g, ' '), '|', await p.textContent('#resHead'));
  console.log('seværdigheds-grupper:', await p.evaluate(() => ['Byens Museum|Museer', 'Aarhus Dyrepark|Zoo og dyreparker', 'Kongens Slot|'].map(x => { const [title, c] = x.split('|'); return title + '=' + window.__beg.catsOf({kind: 'sight', title, cats: c ? [c] : []}).join('+'); }).join(', ')));
  await p.click('#filters [data-t="e"]'); await p.waitForTimeout(600);
  console.log('kun seværdigheder:', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)), '| blå prikker:', await p.$$eval('.pin:not(.sq)', r => r.length), '|', await p.textContent('#resHead'));
  console.log('IMGS:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#filters [data-t="e"]'); await p.waitForTimeout(500);
  console.log('begge igen:', await p.textContent('#resHead'));
  await p.click('#tabs [data-tab="s"]'); await p.waitForTimeout(300);
  console.log('fane seværdigheder:', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)));
  await p.evaluate(() => document.getElementById('sfilters').scrollIntoView()); console.log('IMGT:' + (await p.screenshot({type: 'jpeg', quality: 40})).toString('base64'));
  // Grupper påvirker kun deres egen linje
  await p.click('#sfilters [data-f="Slotte & kirker"]'); await p.waitForTimeout(500);
  console.log('sev.-gruppe valgt:', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)).then(a => a.length + ' i listen, ' + a.filter(t => /Slot/.test(t)).join(',')), '| begivenheder stadig:', await p.$$eval('.pin:not(.sq)', r => r.length) > 0);
  await p.click('#filters [data-f="Marked"]'); await p.waitForTimeout(500);
  console.log('+ Marked: seværdigheder', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)), '| prikker blå/grønne:', await p.$$eval('.pin:not(.sq)', r => r.length), await p.$$eval('.pin.sq', r => r.length));
  await p.click('#tabs [data-tab="e"]'); await p.waitForTimeout(300);
  console.log('+ Marked: begivenheder', await p.$$eval('#list .ev .name', r => r.map(x => x.textContent)));
  console.log('IMGF:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#filters [data-f=""]'); await p.click('#sfilters [data-f=""]'); await p.waitForTimeout(400);
  // Søgning i hele Danmark: resultater under søgefeltet, X rydder
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.fill('#q', 'dyrepark'); await p.waitForTimeout(700);
  console.log('søgepopup:', await p.isVisible('#qpop'), (await p.textContent('#qpop')).replace(/\s+/g, ' ').slice(0, 120), '| X synlig:', await p.isVisible('#qx'));
  console.log('IMGQ:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.click('#qpop .prow .pt >> nth=0'); await p.waitForTimeout(1800);
  console.log('søg->kort:', 'popup skjult', !(await p.isVisible('#qpop')), '| midte', await p.evaluate(() => window.__beg.map.getCenter().lat.toFixed(2)), '|', (await p.textContent('#pop .phead')).replace(/\s+/g, ' ').trim());
  await p.click('#qx'); await p.waitForTimeout(500);
  console.log('ryddet:', JSON.stringify(await p.inputValue('#q')), '| X skjult:', !(await p.isVisible('#qx')), '|', await p.textContent('#resHead'));
  // Hjem-knap og dobbelttryk
  await p.click('#home'); await p.waitForTimeout(1500);
  console.log('hjem: zoom', await p.evaluate(() => window.__beg.map.getZoom()), 'midte', await p.evaluate(() => { const c = window.__beg.map.getCenter(); return c.lat.toFixed(1) + ',' + c.lng.toFixed(1); }));
  console.log('IMGH:' + (await (await p.$('.mapwrap')).screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  const z0 = await p.evaluate(() => window.__beg.map.getZoom()), mb = await (await p.$('#map')).boundingBox();
  await p.touchscreen.tap(mb.x + 60, mb.y + 60); await p.waitForTimeout(120); await p.touchscreen.tap(mb.x + 60, mb.y + 60); await p.waitForTimeout(900);
  const z1 = await p.evaluate(() => window.__beg.map.getZoom());
  await p.mouse.dblclick(mb.x + 80, mb.y + 80); await p.waitForTimeout(900);
  console.log('dobbelttryk zoom:', z0, '->', z1, '| dobbeltklik ->', await p.evaluate(() => window.__beg.map.getZoom()));
  console.log('IMG8:' + (await p.screenshot({type: 'jpeg', quality: 50})).toString('base64'));
  await p.fill('#q', ''); await p.waitForTimeout(800);
  console.log('IMGM:' + (await (await p.$('#map')).screenshot({type: 'png'})).toString('base64'));
  await p.evaluate(() => window.__beg.map.panBy([2, 0], {animate: false})); await p.waitForTimeout(600);
  console.log('IMGN:' + (await (await p.$('#map')).screenshot({type: 'png'})).toString('base64'));
  console.log('IMG1:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(300);
  console.log('IMG2:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
