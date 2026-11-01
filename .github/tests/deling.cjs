// Ende-til-ende-test af Fil/Billede deling med to browsere og den rigtige PeerJS-server.
const {chromium} = require('playwright'); const fs = require('fs'), crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8080/deling/';
const sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
(async () => {
  fs.writeFileSync('/tmp/big.bin', crypto.randomBytes(25 * 1024 * 1024 + 123));
  fs.writeFileSync('/tmp/lille.txt', 'Hej fra gæsten\n');
  const b = await chromium.launch(); const errs = [];
  const mk = async name => { const c = await b.newContext({acceptDownloads: true}); const p = await c.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(name, 'console:', m.text()); }); return p; };
  const host = await mk('host'), guest = await mk('guest');
  await host.goto(BASE); await host.waitForFunction(() => /Ikke forbundet|Venter/.test(document.getElementById('status').textContent), null, {timeout: 30000});
  console.log('host status:', await host.textContent('#status'));
  await host.setInputFiles('#inFiles', ['/tmp/big.bin']);
  const link = (await host.textContent('#link')).trim(); console.log('link:', link);
  console.log('qr lib:', await host.evaluate(() => typeof qrcode), 'peer lib:', await host.evaluate(() => typeof Peer));
  await guest.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE));
  await guest.waitForFunction(() => /Forbundet med/.test(document.getElementById('status').textContent), null, {timeout: 40000});
  await host.waitForFunction(() => /Forbundet med/.test(document.getElementById('status').textContent), null, {timeout: 20000});
  console.log('begge forbundet');
  await guest.waitForSelector('#theirs .row', {timeout: 10000});
  console.log('gæst ser:', await guest.$$eval('#theirs .row', r => r.map(x => x.innerText.replace(/\n/g, ' '))));
  const dl = guest.waitForEvent('download', {timeout: 120000});
  const t0 = Date.now(); await guest.click('#theirs [data-get]');
  const d = await dl; await d.saveAs('/tmp/out_big.bin');
  console.log('stor fil:', sha(fs.readFileSync('/tmp/out_big.bin')) === sha(fs.readFileSync('/tmp/big.bin')) ? 'IDENTISK' : 'FORSKELLIG', ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  await guest.waitForTimeout(800);
  console.log('gæst liste efter gem:', await guest.$$eval('#theirs .row', r => r.length), '| host liste:', await host.$$eval('#mine .row', r => r.length));
  // Nye filer i samme session
  fs.writeFileSync('/tmp/ny.txt', 'Ny fil\n');
  await host.setInputFiles('#inFiles', ['/tmp/ny.txt']);
  await guest.waitForSelector('#theirs .row', {timeout: 10000});
  console.log('gæst ser nu:', await guest.$$eval('#theirs .row', r => r.map(x => x.innerText.replace(/\n/g, ' '))));
  const dl3 = guest.waitForEvent('download', {timeout: 30000}); await guest.click('#theirs [data-get]'); await (await dl3).saveAs('/tmp/out_ny.txt');
  console.log('ny fil:', fs.readFileSync('/tmp/out_ny.txt', 'utf8') === 'Ny fil\n' ? 'IDENTISK' : 'FORSKELLIG');
  // Blandet pakke: billede + dokument, Hent og gem alle
  fs.writeFileSync('/tmp/billede.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgYGD4z8DAwMDAAAAADgAB3dNcdAAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync('/tmp/doc.pdf', '%PDF-1.4 test');
  await host.setInputFiles('#inFiles', ['/tmp/billede.png', '/tmp/doc.pdf']);
  await guest.waitForFunction(() => document.querySelectorAll('#theirs .row').length === 2, null, {timeout: 10000});
  const got = []; guest.on('download', d => got.push(d.suggestedFilename()));
  await guest.click('#getAll'); await guest.waitForTimeout(3000);
  console.log('blandet:', got.sort().join(','), '| gæst liste:', await guest.$$eval('#theirs .row', r => r.length), '| host liste:', await host.$$eval('#mine .row', r => r.length));
  // Den anden vej
  await guest.setInputFiles('#inFiles', ['/tmp/lille.txt']);
  await host.waitForSelector('#theirs .row', {timeout: 10000});
  const dl2 = host.waitForEvent('download', {timeout: 30000}); await host.click('#theirs [data-get]');
  const d2 = await dl2; await d2.saveAs('/tmp/out_lille.txt');
  console.log('retur:', fs.readFileSync('/tmp/out_lille.txt', 'utf8') === fs.readFileSync('/tmp/lille.txt', 'utf8') ? 'IDENTISK' : 'FORSKELLIG');
  await host.waitForTimeout(800);
  console.log('lister til sidst – host modtag:', await host.$$eval('#theirs .row', r => r.length), 'gæst send:', await guest.$$eval('#mine .row', r => r.length));
  // Forkert link
  const bad = await mk('bad'); await bad.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE).replace(/\.([A-Za-z0-9_-]{6})/, '.AAAAAA'));
  await bad.waitForTimeout(12000); console.log('forkert nøgle:', await bad.textContent('#status'), '| host stadig:', await host.textContent('#status'));
  // "Husk" efter link, luk begge og åbn igen uden link
  await guest.click('#rememberBtn'); await guest.waitForTimeout(800);
  console.log('husket – gæst:', await guest.$$eval('#pairs .row', r => r.length), 'host:', await host.$$eval('#pairs .row', r => r.length));
  const hc = host.context(), gc = guest.context();
  await host.close(); await guest.close(); await bad.close();
  await new Promise(r => setTimeout(r, 3000));
  const host2 = await hc.newPage(), guest2 = await gc.newPage();
  for (const [n, pg] of [['host2', host2], ['guest2', guest2]]) pg.on('pageerror', e => errs.push(n + ': ' + e.message));
  let t1 = Date.now();
  await host2.goto(BASE); await guest2.goto(BASE);
  await Promise.all([host2, guest2].map(pg => pg.waitForFunction(() => /Forbundet med/.test(document.getElementById('status').textContent), null, {timeout: 90000})));
  console.log('genåbnet og forbundet af sig selv på', ((Date.now() - t1) / 1000).toFixed(1), 's');
  fs.writeFileSync('/tmp/efter.txt', 'Efter genåbning\n');
  await host2.setInputFiles('#inFiles', ['/tmp/efter.txt']); await guest2.waitForSelector('#theirs [data-get]', {timeout: 10000});
  const dl4 = guest2.waitForEvent('download', {timeout: 30000}); await guest2.click('#theirs [data-get]'); await (await dl4).saveAs('/tmp/out_efter.txt');
  console.log('fil efter genåbning:', fs.readFileSync('/tmp/out_efter.txt', 'utf8') === 'Efter genåbning\n' ? 'IDENTISK' : 'FORSKELLIG');

  // Parring med kode mellem to nye enheder
  const A = await mk('A'), B = await mk('B');
  await A.goto(BASE); await B.goto(BASE);
  await A.waitForFunction(() => /Ikke forbundet/.test(document.getElementById('status').textContent), null, {timeout: 30000});
  await B.waitForFunction(() => /Ikke forbundet/.test(document.getElementById('status').textContent), null, {timeout: 30000});
  await A.click('#showCode'); await A.waitForFunction(() => /Gælder/.test(document.getElementById('codeLeft').textContent), null, {timeout: 20000});
  const code = (await A.textContent('#codeVal')).replace(/\D/g, ''); console.log('kode:', code.length, 'cifre');
  await B.click('#enterCode'); await B.fill('#joinIn', '000000'.slice(0, 0)); await B.type('#joinIn', code);
  await A.waitForSelector('#codeReqs .row', {timeout: 20000}); console.log('anmodning:', (await A.textContent('#codeReqs')).trim().slice(0, 40));
  await A.click('#codeReqs .row button >> nth=0');
  await Promise.all([A, B].map(pg => pg.waitForFunction(() => /Forbundet med/.test(document.getElementById('status').textContent), null, {timeout: 60000})));
  console.log('parret og forbundet – A:', await A.textContent('#status'), '| B gemte:', await B.$$eval('#pairs .row', r => r.length));
  const ac = A.context(), bc = B.context(); await A.close(); await B.close(); await new Promise(r => setTimeout(r, 3000));
  const A2 = await ac.newPage(); await A2.goto(BASE); await new Promise(r => setTimeout(r, 8000));
  const B2 = await bc.newPage(); t1 = Date.now(); await B2.goto(BASE);
  await Promise.all([A2, B2].map(pg => pg.waitForFunction(() => /Forbundet med/.test(document.getElementById('status').textContent), null, {timeout: 90000})));
  console.log('kode-par genåbnet hver for sig og forbundet på', ((Date.now() - t1) / 1000).toFixed(1), 's');
  // Forkert kode
  const C = await mk('C'); await C.goto(BASE); await C.waitForTimeout(3000); await C.click('#enterCode'); await C.type('#joinIn', '123456');
  await C.waitForTimeout(14000); console.log('forkert kode:', await C.textContent('#joinMsg'));
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
