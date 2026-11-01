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
  await host.goto(BASE); await host.waitForFunction(() => /Venter på den anden/.test(document.getElementById('status').textContent), null, {timeout: 30000});
  console.log('host status:', await host.textContent('#status'));
  await host.setInputFiles('#inFiles', ['/tmp/big.bin']);
  const link = (await host.textContent('#link')).trim(); console.log('link:', link);
  console.log('qr lib:', await host.evaluate(() => typeof qrcode), 'peer lib:', await host.evaluate(() => typeof Peer));
  await guest.goto(link.replace(/^https?:\/\/[^/]+\/[^#]*/, BASE));
  await guest.waitForFunction(() => /Forbundet direkte/.test(document.getElementById('status').textContent), null, {timeout: 40000});
  await host.waitForFunction(() => /Forbundet direkte/.test(document.getElementById('status').textContent), null, {timeout: 20000});
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
  console.log('fejl:', errs.length ? errs : 'ingen');
  await b.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
