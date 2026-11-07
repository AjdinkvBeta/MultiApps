/* Fælles hjælpere for Sporlys-værktøjerne */
(function(){

let toastT = 0;
function toast(t, ms){
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms || 3200);
}
// Gem en fil (Safari lægger den i Overførsler / Filer)
function saveFile(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function canShareFiles(){ try { return !!(navigator.canShare && navigator.canShare({files: [new File(['x'], 'x.txt', {type: 'text/plain'})]})); } catch (e) { return false; } }
async function shareFiles(files){
  try { await navigator.share({files}); return true; } catch (e) { if (e && e.name === 'AbortError') return true; return false; }
}
function fmtBytes(n){ return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' kB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function loadImage(blob){
  return new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => res(im); im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Billedet kunne ikke åbnes')); }; im.src = u; });
}
function canvasBlob(c, type, q){ return new Promise(res => c.toBlob(b => res(b), type, q)); }
function stamp(){ const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`; }

/* Lille PDF-skriver: én JPEG pr. side. pages: [{jpeg: Uint8Array, w, h}] (billedets pixels).
   size: 'a4' (tilpasset A4 med margen) eller 'fit' (siden får billedets form). */
function makePDF(pages, size){
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i*3} 0 R`);
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`]);
  pages.forEach((p, i) => {
    const pn = 3 + i*3, im = pn + 1, ct = pn + 2;
    let W, H, x, y, dw, dh;
    if (size === 'a4') {
      const land = p.w > p.h * 1.15; W = land ? 842 : 595; H = land ? 595 : 842;
      const m = 18, k = Math.min((W - 2*m) / p.w, (H - 2*m) / p.h); dw = p.w * k; dh = p.h * k; x = (W - dw) / 2; y = (H - dh) / 2;
    } else { const k = 72 / 150; W = dw = p.w * k; H = dh = p.h * k; x = 0; y = 0; }
    const f = v => v.toFixed(2);
    const cs = `q ${f(dw)} 0 0 ${f(dh)} ${f(x)} ${f(y)} cm /Im0 Do Q`;
    obj(pn, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`]);
    obj(im, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
    obj(ct, [`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`]);
  });
  const total = 3 + n*3, xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type: 'application/pdf'});
}

/* Læg et billede i Sporlys' galleri (samme hjemmeside, samme database) */
function sendToSporlys(blob, name){
  return new Promise(res => {
    try {
      const r = indexedDB.open('sporlys', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('images', {keyPath: 'id'});
      r.onerror = () => res(false);
      r.onsuccess = () => {
        try {
          const db = r.result, tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').put({id: 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name).slice(0, 40), blob, added: Date.now()});
          tx.oncomplete = () => res(true); tx.onerror = () => res(false);
        } catch (e) { res(false); }
      };
    } catch (e) { res(false); }
  });
}

/* Enkel nøgle/værdi-lagring i IndexedDB til værktøjernes egne data */
function store(dbName){
  let p = null;
  const open = () => p || (p = new Promise(res => {
    try { const r = indexedDB.open(dbName, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); }
  }));
  const req = (mode, fn) => open().then(db => new Promise(res => {
    if (!db) return res(null);
    try { const q = fn(db.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result); q.onerror = () => res(null); } catch (e) { res(null); }
  }));
  return {get: k => req('readonly', s => s.get(k)), set: (k, v) => req('readwrite', s => s.put(v, k)), del: k => req('readwrite', s => s.delete(k))};
}

window.SL = {toast, saveFile, canShareFiles, shareFiles, fmtBytes, esc, loadImage, canvasBlob, stamp, makePDF, store};
})();
