// Test af Musik: stemmeapparat, indlæsning, noder (Basic Pitch), tabs og adskillelse (HT-Demucs) på en kunstig sang.
const {chromium} = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/musik/';
const SEP = process.env.SEP !== '0';
const song = require('./musik.cjs.song.js');
(async () => {
  const b = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']}); const errs = [];
  const ctx = await b.newContext({viewport: {width: 390, height: 844}, acceptDownloads: true});
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(BASE); await p.waitForTimeout(800);
  // Stemmeapparat
  await p.click('.tabs [data-tab="tune"]');
  const strings = async () => (await p.$$eval('#strings .nn', r => r.map(x => x.textContent))).join(' ');
  console.log('guitar standard:', await strings());
  await p.click('#tTune [data-v="1"]'); console.log('drop D:', await strings());
  await p.click('#tInst [data-v="g12"]'); console.log('12-strenget:', (await p.textContent('#strings')).replace(/\s+/g, ' ').slice(0, 120));
  await p.click('#tInst [data-v="uke"]'); console.log('ukulele:', await strings(), '| stemninger:', await p.$$eval('#tTune button', r => r.map(x => x.textContent).join(', ')));
  await p.click('#strings .row >> nth=0'); await p.waitForTimeout(200); console.log('tone:', await p.textContent('#tNote'), await p.textContent('#tHz'));
  // Tonehøjde-detektor på en kunstig 110 Hz-tone (A2)
  console.log('detektor 110 Hz:', await p.evaluate(() => { const sr = 48000, b = new Float32Array(8192); for (let i = 0; i < b.length; i++) b[i] = .3 * Math.sin(2 * Math.PI * 110 * i / sr) + .1 * Math.sin(2 * Math.PI * 220 * i / sr); return window.__musik.detect(b, sr).toFixed(2) + ' Hz'; }));
  // Sang
  await p.click('.tabs [data-tab="learn"]');
  await p.setInputFiles('#inp', {name: 'Testsang.wav', mimeType: 'audio/wav', buffer: song()});
  await p.waitForFunction(() => window.__musik.state().song, null, {timeout: 20000});
  console.log('sang:', await p.textContent('#songM'), '| spor:', (await p.textContent('#stems')).trim(), '| afspiller:', await p.isVisible('#player'));
  // Noder på hele sangen
  await p.click('#lSrc [data-v="all"]');
  await p.click('#trBtn'); await p.waitForFunction(() => window.__musik.state().notes != null || /err/.test(document.getElementById('trM').innerHTML), null, {timeout: 180000});
  console.log('noder:', await p.textContent('#nInfo'), '|', await p.textContent('#trM'));
  console.log('første noder:', await p.evaluate(() => { const c = document.getElementById('cv'); return c.width + 'x' + c.height; }));
  await p.click('#playBtn'); await p.waitForTimeout(1500);
  console.log('spiller:', await p.evaluate(() => document.getElementById('au').currentTime.toFixed(1)));
  await p.screenshot({path: 'musik-klaver.png'});
  await p.click('#lInst [data-v="g6"]'); await p.waitForTimeout(600);
  console.log('tabs:', await p.evaluate(() => window.__musik.state().tab), 'noder placeret');
  await p.screenshot({path: 'musik-tabs.png'});
  const d = p.waitForEvent('download'); await p.click('#txtBtn'); const dl = await d; const txt = require('fs').readFileSync(await dl.path(), 'utf8');
  console.log('tekst-tabs:\n' + txt.split('\n').slice(0, 10).join('\n'));
  await p.click('#playBtn');
  if (SEP) {
    // Adskil (henter 166 MB model første gang)
    await p.click('#sepBtn');
    await p.waitForFunction(() => window.__musik.state().stems || /err/.test(document.getElementById('sepM').innerHTML), null, {timeout: 900000});
    console.log('adskillelse:', await p.textContent('#sepM'), '| tid', await p.evaluate(() => window.__musik.sepSec), 's | spor:', (await p.textContent('#stems')).replace(/\s+/g, ' ').trim());
    console.log('kilder:', await p.$$eval('#lSrc button', r => r.map(x => x.textContent).join(', ')));
    await p.click('#stems [data-solo="bass"]'); await p.waitForTimeout(800);
    // Energi i basspor vs. vokalspor (skal være størst i bas/resten, næsten intet i vokal)
        await p.click('#lSrc [data-v="bass"]'); await p.click('#lInst [data-v="bass"]'); await p.click('#trBtn');
    await p.waitForFunction(() => !document.getElementById('trBtn').disabled, null, {timeout: 180000}); await p.waitForTimeout(300);
    console.log('noder i bassporet:', await p.textContent('#nInfo'));
  }
  await p.screenshot({path: 'musik-slut.png', fullPage: true});
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
