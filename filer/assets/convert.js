/* Filkonvertering, der kører helt i browseren.
   CONV.kindOf(file) -> kind | null ; CONV.TARGETS[kind] -> [{id, label}] ; CONV.convert(file, kind, target) -> Promise<File[]> */
(function(){
const ext = n => (n.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
const base = f => f.name.replace(/\.[^.]+$/, '');
const mk = (data, name, type) => new File([data], name, {type});
const loaded = {};
function lib(file, global){
  if (window[global]) return Promise.resolve(window[global]);
  return loaded[file] || (loaded[file] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = (file.startsWith('http') ? '' : 'assets/vendor/') + file;
    s.onload = () => res(window[global]); s.onerror = () => { delete loaded[file]; rej(new Error('Et nødvendigt bibliotek kunne ikke hentes.')); };
    document.head.appendChild(s);
  }));
}
let pdfjsP = null;
function pdfjs(){
  return pdfjsP || (pdfjsP = import(new URL('vendor/pdfjs/pdf.min.mjs', document.querySelector('script[src$="convert.js"]').src).href).then(m => {
    m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.querySelector('script[src$="convert.js"]').src).href; return m;
  }));
}
const V = () => new URL('vendor/pdfjs/', document.querySelector('script[src$="convert.js"]').src).href;

/* ---------- Typer ---------- */
const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif', 'svg', 'tif', 'tiff', 'ico'],
  pdf: ['pdf'], docx: ['docx'], md: ['md', 'markdown'], txt: ['txt', 'text', 'log'], html: ['html', 'htm'],
  csv: ['csv', 'tsv'], xlsx: ['xlsx'], json: ['json'], yaml: ['yaml', 'yml'], xml: ['xml'],
  media: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'mp4', 'mov', 'm4v', 'webm', '3gp', 'caf', 'aiff', 'aif']
};
function kindOf(f){
  const e = ext(f.name);
  for (const [k, l] of Object.entries(KINDS)) if (l.includes(e)) return k;
  if (/^image\//.test(f.type)) return 'image'; if (/^(audio|video)\//.test(f.type)) return 'media';
  if (f.type === 'application/pdf') return 'pdf'; if (/^text\/plain/.test(f.type)) return 'txt';
  return null;
}
const T = (id, label) => ({id, label});
const TARGETS = {
  image: [T('jpg', 'JPG'), T('png', 'PNG'), T('webp', 'WebP'), T('bmp', 'BMP'), T('ico', 'Ikon (ICO)'), T('pdf', 'PDF')],
  pdf: [T('jpg', 'JPG-billeder'), T('png', 'PNG-billeder'), T('txt', 'Tekst (TXT)'), T('docx', 'Word (DOCX)')],
  docx: [T('pdf', 'PDF'), T('txt', 'Tekst (TXT)'), T('html', 'HTML'), T('md', 'Markdown')],
  md: [T('pdf', 'PDF'), T('docx', 'Word (DOCX)'), T('html', 'HTML'), T('txt', 'Tekst (TXT)')],
  txt: [T('pdf', 'PDF'), T('docx', 'Word (DOCX)'), T('html', 'HTML')],
  html: [T('pdf', 'PDF'), T('docx', 'Word (DOCX)'), T('md', 'Markdown'), T('txt', 'Tekst (TXT)')],
  csv: [T('xlsx', 'Excel (XLSX)'), T('json', 'JSON'), T('html', 'HTML-tabel'), T('pdf', 'PDF-tabel')],
  xlsx: [T('csv', 'CSV'), T('json', 'JSON'), T('html', 'HTML-tabel'), T('pdf', 'PDF-tabel')],
  json: [T('csv', 'CSV'), T('xlsx', 'Excel (XLSX)'), T('yaml', 'YAML')],
  yaml: [T('json', 'JSON')],
  xml: [T('json', 'JSON')],
  media: [T('wav', 'Lyd som WAV'), T('mp3', 'Lyd som MP3')]
};
const LABEL = {image: 'Billede', pdf: 'PDF', docx: 'Word', md: 'Markdown', txt: 'Tekst', html: 'HTML', csv: 'CSV', xlsx: 'Excel', json: 'JSON', yaml: 'YAML', xml: 'XML', media: 'Lyd/video'};

/* ---------- Billeder ---------- */
async function toCanvas(f, max){
  const im = await SL.loadImage(f), k = max ? Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)) : 1;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round((im.naturalWidth || 512) * k)); c.height = Math.max(1, Math.round((im.naturalHeight || 512) * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(im.src); return c;
}
function flatten(c){ const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0); return o; }
function bmp(c){
  const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data, row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h;
  const b = new DataView(new ArrayBuffer(size));
  b.setUint16(0, 0x4D42, true); b.setUint32(2, size, true); b.setUint32(10, 54, true); b.setUint32(14, 40, true); b.setInt32(18, w, true); b.setInt32(22, h, true);
  b.setUint16(26, 1, true); b.setUint16(28, 24, true); b.setUint32(34, row * h, true); b.setInt32(38, 2835, true); b.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4, o = 54 + y * row + x * 3; b.setUint8(o, d[i+2]); b.setUint8(o+1, d[i+1]); b.setUint8(o+2, d[i]); }
  return b.buffer;
}
async function ico(c){
  const sizes = [16, 32, 48, 64, 128, 256], pngs = [];
  for (const s of sizes) { const o = document.createElement('canvas'); o.width = o.height = s; const x = o.getContext('2d'); const k = Math.min(s / c.width, s / c.height); x.imageSmoothingQuality = 'high'; x.drawImage(c, (s - c.width*k) / 2, (s - c.height*k) / 2, c.width*k, c.height*k); pngs.push(new Uint8Array(await (await SL.canvasBlob(o, 'image/png')).arrayBuffer())); }
  const head = 6 + 16 * sizes.length, total = head + pngs.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true); let off = head;
  sizes.forEach((s, i) => { const e = 6 + 16*i; out[e] = s === 256 ? 0 : s; out[e+1] = s === 256 ? 0 : s; dv.setUint16(e+4, 1, true); dv.setUint16(e+6, 32, true); dv.setUint32(e+8, pngs[i].length, true); dv.setUint32(e+12, off, true); out.set(pngs[i], off); off += pngs[i].length; });
  return out;
}
async function imageConv(f, t){
  const c = await toCanvas(f, t === 'pdf' ? 2400 : 0), b = base(f);
  if (t === 'jpg') return [mk(await SL.canvasBlob(flatten(c), 'image/jpeg', .9), b + '.jpg', 'image/jpeg')];
  if (t === 'png') return [mk(await SL.canvasBlob(c, 'image/png'), b + '.png', 'image/png')];
  if (t === 'webp') { const x = await SL.canvasBlob(c, 'image/webp', .9); if (!x || x.type !== 'image/webp') throw new Error('Denne browser kan ikke lave WebP. Vælg JPG eller PNG.'); return [mk(x, b + '.webp', 'image/webp')]; }
  if (t === 'bmp') return [mk(bmp(flatten(c)), b + '.bmp', 'image/bmp')];
  if (t === 'ico') return [mk(await ico(c), b + '.ico', 'image/x-icon')];
  if (t === 'pdf') { const j = await SL.canvasBlob(flatten(c), 'image/jpeg', .9); return [mk(SL.makePDF([{jpeg: new Uint8Array(await j.arrayBuffer()), w: c.width, h: c.height}], 'a4'), b + '.pdf', 'application/pdf')]; }
}

/* ---------- PDF ---------- */
async function openPdf(f){ const m = await pdfjs(); return m.getDocument({data: new Uint8Array(await f.arrayBuffer()), cMapUrl: V() + 'cmaps/', cMapPacked: true, standardFontDataUrl: V() + 'standard_fonts/', wasmUrl: V() + 'wasm/'}).promise; }
async function pdfText(f){
  const pdf = await openPdf(f), pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent(); let s = '';
    for (const it of tc.items) { s += it.str; if (it.hasEOL) s += '\n'; }
    pages.push(s.replace(/[ \t]+\n/g, '\n').trim());
  }
  return pages;
}
async function pdfConv(f, t){
  const b = base(f);
  if (t === 'txt') return [mk((await pdfText(f)).join('\n\n\f\n\n'), b + '.txt', 'text/plain')];
  if (t === 'docx') { const pages = await pdfText(f), blocks = []; pages.forEach(p => p.split(/\n{2,}/).forEach(par => blocks.push({t: 'p', runs: [{text: par.replace(/\n/g, ' ')}]}))); return [mk(await toDocx(blocks), b + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')]; }
  const pdf = await openPdf(f), out = [], type = t === 'png' ? 'image/png' : 'image/jpeg';
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), vp0 = pg.getViewport({scale: 1}), k = Math.min(2.5, 2400 / Math.max(vp0.width, vp0.height)), vp = pg.getViewport({scale: k});
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({canvasContext: x, viewport: vp}).promise;
    out.push(mk(await SL.canvasBlob(c, type, .9), `${b} side ${i}.${t}`, type));
  }
  return out;
}

/* ---------- Dokumenter: fælles "blokke" ---------- */
// {t:'h', level, runs} {t:'p', runs, list:'ul'|'ol', n} {t:'pre', text} {t:'table', rows} {t:'hr'}; runs: [{text, b, i}]
const runsText = r => r.map(x => x.text).join('');
async function docxBlocks(f){
  const JSZip = await lib('jszip.min.js', 'JSZip'), z = await JSZip.loadAsync(f), xml = await z.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const kids = (el, name) => [...el.childNodes].filter(n => n.namespaceURI === W && n.localName === name);
  const all = (el, name) => [...el.getElementsByTagNameNS(W, name)];
  const runsOf = p => {
    const out = [];
    for (const r of all(p, 'r')) {
      const pr = kids(r, 'rPr')[0], b = !!(pr && kids(pr, 'b').length && kids(pr, 'b')[0].getAttributeNS(W, 'val') !== '0'), it = !!(pr && kids(pr, 'i').length);
      let text = ''; for (const n of r.childNodes) { if (n.localName === 't') text += n.textContent; else if (n.localName === 'tab') text += '\t'; else if (n.localName === 'br' || n.localName === 'cr') text += '\n'; }
      if (text) out.push({text, b, i: it});
    }
    return out;
  };
  const blocks = [], body = all(doc, 'body')[0]; let olN = 0;
  for (const n of body.childNodes) {
    if (n.localName === 'p') {
      const pPr = kids(n, 'pPr')[0], style = pPr && kids(pPr, 'pStyle')[0] ? kids(pPr, 'pStyle')[0].getAttributeNS(W, 'val') : '', runs = runsOf(n);
      const hm = style.match(/^(?:Heading|Overskrift|Titel|Title)(\d?)/i);
      if (hm) { blocks.push({t: 'h', level: +(hm[1] || 1), runs}); olN = 0; continue; }
      if (pPr && kids(pPr, 'numPr').length) { blocks.push({t: 'p', runs, list: 'ul'}); continue; }
      blocks.push({t: 'p', runs}); olN = 0;
    } else if (n.localName === 'tbl') {
      blocks.push({t: 'table', rows: kids(n, 'tr').map(tr => kids(tr, 'tc').map(tc => all(tc, 'p').map(p => runsText(runsOf(p))).join('\n')))});
    }
  }
  return blocks;
}
function htmlBlocks(html){
  const d = new DOMParser().parseFromString(html, 'text/html'), blocks = [];
  const inline = (el, st, out) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' '); if (t) out.push({text: t, b: st.b, i: st.i}); }
      else if (n.nodeType === 1) { const tg = n.tagName; if (tg === 'BR') out.push({text: '\n'}); else if (!/^(SCRIPT|STYLE)$/.test(tg)) inline(n, {b: st.b || /^(B|STRONG|TH)$/.test(tg), i: st.i || /^(I|EM)$/.test(tg)}, out); }
    }
    return out;
  };
  const trim = r => { if (r.length) { r[0].text = r[0].text.replace(/^\s+/, ''); r[r.length-1].text = r[r.length-1].text.replace(/\s+$/, ''); } return r.filter(x => x.text); };
  const walk = el => {
    for (const n of el.children) {
      const tg = n.tagName;
      if (/^H[1-6]$/.test(tg)) blocks.push({t: 'h', level: +tg[1], runs: trim(inline(n, {}, []))});
      else if (tg === 'P' || tg === 'BLOCKQUOTE' && !n.querySelector('p')) { const r = trim(inline(n, {}, [])); if (r.length) blocks.push({t: 'p', runs: r}); }
      else if (tg === 'UL' || tg === 'OL') { let k = 0; for (const li of n.children) if (li.tagName === 'LI') { k++; const r = trim(inline(li, {}, [])); blocks.push({t: 'p', runs: r, list: tg === 'OL' ? 'ol' : 'ul', n: k}); } }
      else if (tg === 'PRE') blocks.push({t: 'pre', text: n.textContent.replace(/\n$/, '')});
      else if (tg === 'TABLE') blocks.push({t: 'table', rows: [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.trim()))});
      else if (tg === 'HR') blocks.push({t: 'hr'});
      else if (/^(SCRIPT|STYLE|HEAD|TITLE|META|LINK)$/.test(tg)) continue;
      else if (n.children.length && [...n.children].some(c => /^(P|H[1-6]|UL|OL|PRE|TABLE|DIV|SECTION|ARTICLE|BLOCKQUOTE|HR|MAIN|HEADER|FOOTER)$/.test(c.tagName))) walk(n);
      else { const r = trim(inline(n, {}, [])); if (r.length) blocks.push({t: 'p', runs: r}); }
    }
  };
  walk(d.body); return blocks;
}
const txtBlocks = s => s.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => ({t: 'p', runs: [{text: p}]}));
async function mdHtml(s){ const m = await lib('marked.min.js', 'marked'); return (m.parse || m.marked)(s); }
const escH = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function toHtml(blocks, title){
  const run = r => r.map(x => { let t = escH(x.text).replace(/\n/g, '<br>'); if (x.b) t = `<strong>${t}</strong>`; if (x.i) t = `<em>${t}</em>`; return t; }).join('');
  let h = '', list = null;
  const close = () => { if (list) { h += `</${list}>\n`; list = null; } };
  for (const b of blocks) {
    if (b.t === 'p' && b.list) { if (list !== b.list) { close(); list = b.list; h += `<${list}>\n`; } h += `<li>${run(b.runs)}</li>\n`; continue; }
    close();
    if (b.t === 'h') h += `<h${Math.min(6, b.level)}>${run(b.runs)}</h${Math.min(6, b.level)}>\n`;
    else if (b.t === 'p') h += `<p>${run(b.runs)}</p>\n`;
    else if (b.t === 'pre') h += `<pre>${escH(b.text)}</pre>\n`;
    else if (b.t === 'hr') h += '<hr>\n';
    else if (b.t === 'table') h += '<table>\n' + b.rows.map((r, i) => '<tr>' + r.map(c => i ? `<td>${escH(c)}</td>` : `<th>${escH(c)}</th>`).join('') + '</tr>').join('\n') + '\n</table>\n';
  }
  close();
  return `<!doctype html>\n<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#1a1a1a}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}pre{background:#f4f4f4;padding:10px;overflow:auto}</style></head><body>\n${h}</body></html>\n`;
}
function toMd(blocks){
  const run = r => r.map(x => { let t = x.text.replace(/\n/g, '  \n'); if (x.b && t.trim()) t = `**${t}**`; if (x.i && t.trim()) t = `*${t}*`; return t; }).join('');
  return blocks.map(b => b.t === 'h' ? '#'.repeat(Math.min(6, b.level)) + ' ' + run(b.runs) : b.t === 'p' ? (b.list === 'ul' ? '- ' : b.list === 'ol' ? `${b.n || 1}. ` : '') + run(b.runs)
    : b.t === 'pre' ? '```\n' + b.text + '\n```' : b.t === 'hr' ? '---' : b.t === 'table' ? b.rows.map((r, i) => '| ' + r.map(c => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |' + (i === 0 ? '\n|' + r.map(() => ' --- |').join('') : '')).join('\n') : '')
    .join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function toTxt(blocks){
  return blocks.map(b => b.t === 'h' || b.t === 'p' ? (b.list === 'ul' ? '• ' : b.list === 'ol' ? `${b.n || 1}. ` : '') + runsText(b.runs) : b.t === 'pre' ? b.text : b.t === 'hr' ? '———' : b.t === 'table' ? b.rows.map(r => r.join('\t')).join('\n') : '').join('\n\n') + '\n';
}
async function toDocx(blocks){
  const D = await lib('docx.min.js', 'docx'), HL = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const runs = r => r.flatMap(x => x.text.split('\n').map((t, k) => new D.TextRun({text: t, bold: !!x.b, italics: !!x.i, break: k ? 1 : 0})));
  const kids = [];
  for (const b of blocks) {
    if (b.t === 'h') kids.push(new D.Paragraph({heading: HL[Math.min(6, b.level)], children: runs(b.runs)}));
    else if (b.t === 'p') kids.push(new D.Paragraph(b.list ? {bullet: {level: 0}, children: runs(b.runs)} : {children: runs(b.runs)}));
    else if (b.t === 'pre') kids.push(...b.text.split('\n').map(l => new D.Paragraph({children: [new D.TextRun({text: l, font: 'Courier New'})]})));
    else if (b.t === 'hr') kids.push(new D.Paragraph({children: [new D.TextRun('———')]}));
    else if (b.t === 'table' && b.rows.length) {
      const n = Math.max(...b.rows.map(r => r.length));
      kids.push(new D.Table({width: {size: 100, type: D.WidthType.PERCENTAGE}, rows: b.rows.map((r, i) => new D.TableRow({children: Array.from({length: n}, (_, j) => new D.TableCell({children: [new D.Paragraph({children: [new D.TextRun({text: r[j] || '', bold: i === 0})]})]}))}))}));
    }
  }
  const doc = new D.Document({sections: [{children: kids.length ? kids : [new D.Paragraph('')]}]});
  return D.Packer.toBlob(doc);
}
/* PDF fra blokke: rigtig tekst med Helvetica, når alle tegn kan; ellers tegnes siderne som billeder (virker for alle sprog) */
async function toPdf(blocks){
  const {PDFDocument, StandardFonts, rgb} = await lib('pdf-lib.min.js', 'PDFLib');
  const doc = await PDFDocument.create(), F = {r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique), m: await doc.embedFont(StandardFonts.Courier)};
  const allText = blocks.map(b => b.t === 'table' ? b.rows.flat().join(' ') : b.t === 'pre' ? b.text : b.runs ? runsText(b.runs) : '').join(' ').replace(/[\n\t]/g, ' ');
  let vector = true; try { F.r.encodeText(allText); } catch (e) { vector = false; }
  const PW = 595.28, PH = 841.89, M = 56, CW = PW - 2*M;
  // Fælles opsætning: måling og tegning
  let measure, newPage, draw, pageCanvas = null, pages = [];
  if (vector) {
    let page; measure = (t, sz, st) => F[st].widthOfTextAtSize(t, sz);
    newPage = () => { page = doc.addPage([PW, PH]); };
    draw = (t, x, y, sz, st, gray) => page.drawText(t, {x, y: PH - y - sz * .8, size: sz, font: F[st], color: rgb(gray, gray, gray)});
  } else {
    const S = 2.2; let ctx;
    const font = (sz, st) => `${st === 'b' ? '700 ' : st === 'i' ? 'italic ' : ''}${sz * S}px ${st === 'm' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;
    measure = (t, sz, st) => { const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d')); c.font = font(sz, st); return c.measureText(t).width / S; };
    newPage = () => { const c = document.createElement('canvas'); c.width = Math.round(PW * S); c.height = Math.round(PH * S); ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.textBaseline = 'top'; pages.push(c); };
    draw = (t, x, y, sz, st, gray) => { ctx.font = font(sz, st); const g = Math.round(gray * 255); ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fillText(t, x * S, y * S); };
  }
  let y = M; newPage();
  const ensure = h => { if (y + h > PH - M) { newPage(); y = M; } };
  // Ombryd tekststykker med forskellig stil
  const flow = (runs, sz, x0, width, lh) => {
    const words = []; for (const r of runs) { const st = r.b ? 'b' : r.i ? 'i' : 'r'; r.text.split(/(\n|\s+)/).forEach(w => { if (w) words.push({w, st}); }); }
    let line = [], lw = 0;
    const flush = () => {
      ensure(sz * lh); let x = x0;
      // Saml ord med samme stil, så teksten kan kopieres som hele sætninger
      const groups = []; for (const p of line) { const g = groups[groups.length - 1]; if (g && g.st === p.st) g.w += p.w; else groups.push({w: p.w, st: p.st}); }
      for (const g of groups) { draw(g.w, x, y, sz, g.st, .1); x += measure(g.w, sz, g.st); }
      y += sz * lh; line = []; lw = 0;
    };
    for (const p of words) {
      if (p.w === '\n') { flush(); continue; }
      const sp = /^\s+$/.test(p.w); if (sp && !line.length) continue;
      let wd = measure(sp ? ' ' : p.w, sz, p.st);
      if (!sp && lw + wd > width && line.length) { while (line.length && /^\s+$/.test(line[line.length-1].w)) line.pop(); flush(); }
      if (!sp && wd > width) { // meget lange ord eller tekst uden mellemrum (fx kinesisk): del op tegn for tegn
        let chunk = ''; for (const ch of p.w) { if (measure(chunk + ch, sz, p.st) > width - lw && (chunk || line.length)) { line.push({w: chunk, st: p.st}); flush(); chunk = ''; } chunk += ch; }
        line.push({w: chunk, st: p.st}); lw = measure(chunk, sz, p.st); continue;
      }
      line.push({w: sp ? ' ' : p.w, st: p.st}); lw += wd;
    }
    if (line.length) flush();
  };
  for (const b of blocks) {
    if (b.t === 'h') { const sz = [0, 22, 18, 15, 13, 12, 11][Math.min(6, b.level)]; y += sz * .6; ensure(sz * 2); flow(b.runs.map(r => ({...r, b: true})), sz, M, CW, 1.25); y += sz * .3; }
    else if (b.t === 'p') { const ind = b.list ? 16 : 0; if (b.list) { ensure(14); draw(b.list === 'ol' ? `${b.n || 1}.` : '•', M + 2, y, 11, 'r', .1); } flow(b.runs, 11, M + ind, CW - ind, 1.45); y += b.list ? 2 : 8; }
    else if (b.t === 'pre') { for (const l of b.text.split('\n')) flow([{text: l || ' '}].map(r => r), 9.5, M + 8, CW - 16, 1.35); y += 8; }
    else if (b.t === 'hr') { ensure(16); draw('—'.repeat(30), M, y, 10, 'r', .6); y += 16; }
    else if (b.t === 'table' && b.rows.length) {
      const n = Math.max(...b.rows.map(r => r.length)), cw = CW / n;
      b.rows.forEach((r, i) => { const y0 = y; let maxY = y; for (let j = 0; j < n; j++) { y = y0; flow([{text: r[j] || '', b: i === 0}], 9.5, M + j*cw, cw - 6, 1.3); maxY = Math.max(maxY, y); } y = maxY + 4; });
      y += 8;
    }
  }
  if (vector) return new Blob([await doc.save()], {type: 'application/pdf'});
  const list = []; for (const c of pages) { const j = await SL.canvasBlob(c, 'image/jpeg', .9); list.push({jpeg: new Uint8Array(await j.arrayBuffer()), w: c.width, h: c.height}); }
  return SL.makePDF(list, 'a4');
}
async function docConv(f, kind, t){
  const b = base(f); let blocks;
  if (kind === 'docx') blocks = await docxBlocks(f);
  else if (kind === 'html') blocks = htmlBlocks(await f.text());
  else if (kind === 'md') { const s = await f.text(); if (t === 'html') { const h = await mdHtml(s); return [mk(`<!doctype html>\n<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(b)}</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em}pre{background:#f4f4f4;padding:10px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body>\n${h}</body></html>\n`, b + '.html', 'text/html')]; } blocks = htmlBlocks(await mdHtml(s)); }
  else blocks = txtBlocks(await f.text());
  if (t === 'html') return [mk(toHtml(blocks, b), b + '.html', 'text/html')];
  if (t === 'md') return [mk(toMd(blocks), b + '.md', 'text/markdown')];
  if (t === 'txt') return [mk(toTxt(blocks), b + '.txt', 'text/plain')];
  if (t === 'docx') return [mk(await toDocx(blocks), b + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')];
  if (t === 'pdf') return [mk(await toPdf(blocks), b + '.pdf', 'application/pdf')];
}

/* ---------- Tabeller ---------- */
function parseCSV(s){
  s = s.replace(/^﻿/, ''); const first = s.split('\n')[0] || '';
  const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i+1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}
const toCSV = rows => '﻿' + rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n') + '\r\n';
const num = v => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && !/^0\d/.test(v.trim())) ? +v : v;
function rowsToJSON(rows){ const [h, ...rest] = rows; return rest.map(r => Object.fromEntries(h.map((k, i) => [k || 'kolonne' + (i + 1), num(r[i] ?? '')]))); }
function jsonToRows(j){
  if (!Array.isArray(j)) { const arr = Object.values(j).find(Array.isArray); j = arr || [j]; }
  if (j.every(Array.isArray)) return j;
  const keys = [...new Set(j.flatMap(o => o && typeof o === 'object' ? Object.keys(o) : ['værdi']))];
  return [keys, ...j.map(o => keys.map(k => { const v = o && typeof o === 'object' ? o[k] : o; return v && typeof v === 'object' ? JSON.stringify(v) : v ?? ''; }))];
}
async function readXlsx(f){
  const JSZip = await lib('jszip.min.js', 'JSZip'), z = await JSZip.loadAsync(f), P = s => new DOMParser().parseFromString(s, 'application/xml');
  const ss = z.file('xl/sharedStrings.xml') ? [...P(await z.file('xl/sharedStrings.xml').async('string')).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const wb = P(await z.file('xl/workbook.xml').async('string')), rels = P(await z.file('xl/_rels/workbook.xml.rels').async('string'));
  const relMap = Object.fromEntries([...rels.getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sheets = [];
  for (const sh of wb.getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = relMap[rid] || ''; path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const file = z.file(path); if (!file) continue;
    const doc = P(await file.async('string')), rows = [];
    for (const r of doc.getElementsByTagName('row')) {
      const ri = (+r.getAttribute('r') || rows.length + 1) - 1, row = rows[ri] = rows[ri] || [];
      for (const c of r.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || '', col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : v ? v.textContent : '';
        if (t === 's') val = ss[+val] ?? ''; else if (t === 'b') val = val === '1' ? 'SAND' : 'FALSK'; else if (!t || t === 'n') val = val === '' ? '' : num(val);
        row[col >= 0 ? col : row.length] = val;
      }
    }
    for (let i = 0; i < rows.length; i++) rows[i] = Array.from(rows[i] || [], v => v ?? '');
    sheets.push({name: sh.getAttribute('name'), rows});
  }
  return sheets;
}
async function writeXlsx(rows, name){
  const JSZip = await lib('jszip.min.js', 'JSZip'), z = new JSZip(), x = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const data = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => { const ref = col(ci) + (ri + 1), n = num(v); return typeof n === 'number' && isFinite(n) ? `<c r="${ref}"><v>${n}</v></c>` : v === '' || v == null ? '' : `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${x(v)}</t></is></c>`; }).join('') + '</row>').join('');
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x((name || 'Ark1').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
  z.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`);
  return z.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const tableBlocks = rows => [{t: 'table', rows: rows.map(r => r.map(v => String(v ?? '')))}];
async function tableConv(f, kind, t){
  const b = base(f), XL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let sheets;
  if (kind === 'xlsx') sheets = await readXlsx(f);
  else if (kind === 'csv') sheets = [{name: b, rows: parseCSV(await f.text())}];
  else if (kind === 'json') sheets = [{name: b, rows: jsonToRows(JSON.parse(await f.text()))}];
  if (kind === 'json' && t === 'yaml') { const Y = await lib('js-yaml.min.js', 'jsyaml'); return [mk((Y.safeDump || Y.dump)(JSON.parse(await f.text())), b + '.yaml', 'application/yaml')]; }
  const multi = sheets.length > 1, nm = s => multi ? `${b} - ${s.name}` : b, out = [];
  for (const s of sheets) {
    if (t === 'csv') out.push(mk(toCSV(s.rows), nm(s) + '.csv', 'text/csv'));
    else if (t === 'json') out.push(mk(JSON.stringify(rowsToJSON(s.rows), null, 2), nm(s) + '.json', 'application/json'));
    else if (t === 'xlsx') out.push(mk(await writeXlsx(s.rows, s.name), nm(s) + '.xlsx', XL));
    else if (t === 'html') out.push(mk(toHtml(tableBlocks(s.rows), nm(s)), nm(s) + '.html', 'text/html'));
    else if (t === 'pdf') out.push(mk(await toPdf(tableBlocks(s.rows)), nm(s) + '.pdf', 'application/pdf'));
  }
  return out;
}
async function dataConv(f, kind){
  const b = base(f), s = await f.text();
  if (kind === 'yaml') { const Y = await lib('js-yaml.min.js', 'jsyaml'); return [mk(JSON.stringify((Y.safeLoad || Y.load)(s), null, 2), b + '.json', 'application/json')]; }
  if (kind === 'xml') { await lib('xml-js.min.js', 'xml2json'); return [mk(window.xml2json(s, {compact: true, spaces: 2}), b + '.json', 'application/json')]; }
}

/* ---------- Lyd og video ---------- */
async function decodeAudio(f){
  const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), buf = await f.arrayBuffer();
  try { return await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); }
  catch (e) { throw new Error('Lyden i filen kunne ikke læses af denne browser.'); }
  finally { try { ctx.close(); } catch (e) {} }
}
function wav(ab){
  const ch = Math.min(2, ab.numberOfChannels), sr = ab.sampleRate, n = ab.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({length: ch}, (_, c) => ab.getChannelData(c)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7FFF, true); o += 2; }
  return out.buffer;
}
async function mp3(ab, onProgress){
  const L = await lib('https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js', 'lamejs');
  const ch = Math.min(2, ab.numberOfChannels), enc = new L.Mp3Encoder(ch, ab.sampleRate, 192), conv = a => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = Math.max(-1, Math.min(1, a[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7FFF; } return o; };
  const left = conv(ab.getChannelData(0)), right = ch > 1 ? conv(ab.getChannelData(1)) : null, parts = [], B = 1152 * 20;
  for (let i = 0; i < left.length; i += B) {
    const d = right ? enc.encodeBuffer(left.subarray(i, i + B), right.subarray(i, i + B)) : enc.encodeBuffer(left.subarray(i, i + B));
    if (d.length) parts.push(new Uint8Array(d)); if (onProgress && i % (B * 20) === 0) { onProgress(i / left.length); await new Promise(r => setTimeout(r)); }
  }
  const e = enc.flush(); if (e.length) parts.push(new Uint8Array(e));
  return new Blob(parts, {type: 'audio/mpeg'});
}
async function mediaConv(f, t, onProgress){
  const ab = await decodeAudio(f), b = base(f);
  if (t === 'wav') return [mk(wav(ab), b + '.wav', 'audio/wav')];
  if (t === 'mp3') return [mk(await mp3(ab, onProgress), b + '.mp3', 'audio/mpeg')];
}

async function convert(f, kind, t, onProgress){
  if (kind === 'image') return imageConv(f, t);
  if (kind === 'pdf') return pdfConv(f, t);
  if (['docx', 'md', 'txt', 'html'].includes(kind)) return docConv(f, kind, t);
  if (['csv', 'xlsx', 'json'].includes(kind)) return tableConv(f, kind, t);
  if (['yaml', 'xml'].includes(kind)) return dataConv(f, kind);
  if (kind === 'media') return mediaConv(f, t, onProgress);
  throw new Error('Den filtype kan ikke konverteres her.');
}
window.CONV = {kindOf, TARGETS, LABEL, convert, KINDS, openPdf, lib};
})();
