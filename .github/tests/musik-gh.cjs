// Adskillelse via GitHub-maskinen, hele vejen (rigtig workflow, rigtig kryptering) med en kunstig sang.
const {chromium} = require('playwright');
const song = require('./musik.cjs.song.js');
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({viewport: {width: 390, height: 844}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'})).newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await p.goto('http://localhost:8080/musik/'); await p.waitForTimeout(500);
  await p.setInputFiles('#inp', {name: 'Test.wav', mimeType: 'audio/wav', buffer: song()});
  await p.waitForFunction(() => window.__musik.state().song, null, {timeout: 20000});
  // Uden nøgle på "iPhone": beder om nøglen i stedet for at gå ned
  await p.click('#sepBtn'); await p.waitForTimeout(300);
  console.log('uden nøgle:', await p.textContent('#sepM'), '| felt:', await p.isVisible('#ghIn'));
  await p.fill('#ghIn', process.env.TOKEN); await p.dispatchEvent('#ghIn', 'change');
  const t0 = Date.now(); let last = '';
  await p.click('#sepBtn');
  const iv = setInterval(async () => { try { const t = await p.textContent('#sepM'); if (t !== last) { last = t; console.log(`  ${Math.round((Date.now() - t0) / 1000)} s: ${t}`); } } catch (e) {} }, 2000);
  await p.waitForFunction(() => window.__musik.state().stems || /err/.test(document.getElementById('sepM').innerHTML), null, {timeout: 1500000});
  clearInterval(iv);
  console.log('resultat:', await p.textContent('#sepM'), '|', Math.round((Date.now() - t0) / 1000), 's');
  console.log('energi:', await p.evaluate(() => window.__musik.energy()));
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
