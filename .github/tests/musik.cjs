// Test af Musik: stemmeapparat, indlæsning, noder (Basic Pitch), tabs og adskillelse (HT-Demucs) på en kunstig sang.
const {chromium} = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/musik/';
const SEP = process.env.SEP !== '0';
function song(){
  const sr = 44100, dur = 12, n = sr * dur, L = new Float32Array(n), R = new Float32Array(n), hz = m => 440 * 2 ** ((m - 69) / 12);
  const mel = [60, 64, 67, 72, 67, 64], bass = [36, 43];
  for (let k = 0; k < dur * 2; k++) {                    // melodi: 2 noder pr. sekund
    const m = mel[k % mel.length], t0 = k * .5 * sr, f = hz(m);
    for (let i = 0; i < .48 * sr && t0 + i < n; i++) { const t = i / sr, e = Math.exp(-t * 4); const v = e * .22 * (Math.sin(2 * Math.PI * f * t) + .4 * Math.sin(4 * Math.PI * f * t) + .15 * Math.sin(6 * Math.PI * f * t)); L[t0 + i] += v * .9; R[t0 + i] += v; }
  }
  for (let k = 0; k < dur; k++) {                        // bas: 1 node pr. sekund
    const f = hz(bass[k % 2]), t0 = k * sr;
    for (let i = 0; i < .95 * sr && t0 + i < n; i++) { const t = i / sr, v = Math.exp(-t * 2) * .25 * Math.sin(2 * Math.PI * f * t); L[t0 + i] += v; R[t0 + i] += v; }
  }
  for (let k = 0; k < dur * 2; k++) { const t0 = Math.floor(k * .5 * sr); for (let i = 0; i < .12 * sr; i++) { const t = i / sr, v = Math.exp(-t * 30) * .35 * Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-t * 40)) * t); L[t0 + i] += v; R[t0 + i] += v; } }
  const buf = Buffer.alloc(44 + n * 4); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
  return buf;
}
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
