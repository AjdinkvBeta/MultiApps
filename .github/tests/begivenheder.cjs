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
  await p.goto(BASE); await p.waitForTimeout(1500);
  console.log('kort:', await p.evaluate(() => !!document.querySelector('.leaflet-tile-pane')), '| fra:', await p.inputValue('#from'), 'til:', await p.inputValue('#to'));
  console.log('uden nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim());
  await p.click('#me'); await p.waitForTimeout(1500);
  await p.fill('#tmKey', 'forkert'); await p.dispatchEvent('#tmKey', 'change'); await p.waitForTimeout(1500);
  console.log('forkert nøgle:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim().slice(0, 80));
  await p.fill('#to', new Date(t0 + 30 * 86400e3).toISOString().slice(0, 10)); await p.dispatchEvent('#to', 'change');
  await p.fill('#tmKey', 'TESTKEY'); await p.dispatchEvent('#tmKey', 'change');
  await p.waitForFunction(() => /fundet/.test(document.getElementById('srcs').textContent), null, {timeout: 120000});
  const n = await p.$$eval('#list .ev', r => r.length);
  const expect = ALL.filter(e => e.id !== 'far').filter(e => { const d = new Date(e.dates.start.dateTime); const f = new Date(); f.setHours(0,0,0,0); const z = new Date(t0 + 30 * 86400e3); z.setHours(23, 59, 59); return d >= f && d <= z; }).length;
  console.log('fundet:', n, 'forventet:', expect, '| kald:', calls.length, '| uden for radius med:', await p.evaluate(() => /Langt væk/.test(document.getElementById('list').textContent)));
  console.log('overskrift:', await p.textContent('#resHead'), '| kilder:', (await p.textContent('#srcs')).replace(/\s+/g, ' ').trim());
  // Radius via skyder
  await p.$eval('#rad', el => { el.value = 3; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await p.waitForFunction(() => /^720 /.test(document.getElementById('resHead').textContent), null, {timeout: 60000}).catch(() => {});
  console.log('radius 3 km (forventet 720):', await p.$$eval('#list .ev', r => r.length));
  // Adressesøgning (rigtig Nominatim)
  await p.fill('#q', 'Sønderborg'); await p.waitForTimeout(2500);
  console.log('forslag:', await p.$$eval('#sugg .row', r => r.length));
  await p.fill('#q', ''); await p.evaluate(() => document.getElementById('sugg').innerHTML = ''); await p.waitForTimeout(1500);
  console.log('IMG1:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(300);
  console.log('IMG2:' + (await p.screenshot({type: 'jpeg', quality: 45})).toString('base64'));
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
