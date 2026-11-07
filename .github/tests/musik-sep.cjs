// Prøver adskillelsen med forskellige opsætninger (ort-version / optimering) og logger, hvad der virker.
const {chromium} = require('playwright');
const song = require('./musik.cjs.song.js');
(async () => {
  const b = await chromium.launch();
  for (const q of (process.env.CFGS || '?ort=1.22.0&opt=basic').split(' ')) {
    const p = await (await b.newContext()).newPage(); const logs = [];
    p.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 300))); p.on('pageerror', e => logs.push('pageerror: ' + e.message));
    await p.goto('http://localhost:8080/musik/' + q); await p.waitForTimeout(500);
    await p.setInputFiles('#inp', {name: 'Test.wav', mimeType: 'audio/wav', buffer: song()});
    await p.waitForFunction(() => window.__musik.state().song, null, {timeout: 20000});
    const t0 = Date.now(); await p.click('#sepBtn');
    await p.waitForFunction(() => window.__musik.state().stems || /err/.test(document.getElementById('sepM').innerHTML), null, {timeout: 900000}).catch(() => {});
    console.log(q, '→', await p.textContent('#sepM'), '|', Math.round((Date.now() - t0) / 1000), 's |', (await p.textContent('#stems')).replace(/\s+/g, ' ').trim().slice(0, 80));
    console.log('  log:', logs.filter(l => !/favicon/.test(l)).slice(-6).join(' || '));
    if (await p.evaluate(() => window.__musik.state().stems)) {
      console.log('  energi:', await p.evaluate(() => window.__musik.energy()));
    }
    await p.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
