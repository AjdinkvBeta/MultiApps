// Fil/Billede deling – Cloudflare Worker med R2.
// Filerne krypteres i browseren, før de sendes. Workeren ser kun krypterede bytes og kender aldrig nøglen.
//
// R2-nøgler:
//   i/<id>              offentlig info om delingen (JSON)
//   s/<id>/meta         krypteret liste over filer, navne, miniaturer og besked
//   s/<id>/f/<i>/<j>    krypteret stykke j af fil i
//
// Afsender (kræver headeren X-Key = hemmeligheden UPLOAD_KEY):
//   GET    /api/me                      tjek koden
//   POST   /api/shares                  opret deling -> {id}
//   PUT    /api/shares/<id>/meta
//   PUT    /api/shares/<id>/f/<i>/<j>
//   POST   /api/shares/<id>/done        gør delingen klar til at hente
//   GET    /api/shares                  dine delinger
//   DELETE /api/shares/<id>
// Modtager (kun id'et fra linket):
//   GET    /api/s/<id>                  info (410 hvis udløbet)
//   GET    /api/s/<id>/meta
//   GET    /api/s/<id>/f/<i>/<j>
//   POST   /api/s/<id>/got              modtageren har hentet alt

const MAX_PART = 64 * 1024 * 1024;       // pr. krypteret stykke (appen bruger 8 MB)
const MAX_DAYS = 30;
const ID_RE = /^[A-Za-z0-9]{10,24}$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Key",
  "Access-Control-Max-Age": "86400",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {...cors, "Content-Type": "application/json", "Cache-Control": "no-store"}});
const err = (status, msg) => json({error: msg}, status);

function newId(){
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(b, x => a[x % a.length]).join("");
}
function sameKey(a, b){
  if (typeof a !== "string" || typeof b !== "string" || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}
async function getInfo(env, id){
  const o = await env.BUCKET.get("i/" + id);
  return o ? await o.json() : null;
}
const putInfo = (env, id, info) => env.BUCKET.put("i/" + id, JSON.stringify(info), {httpMetadata: {contentType: "application/json"}});
const alive = info => info && info.done && info.expires > Date.now() && !(info.maxDownloads && info.downloads >= info.maxDownloads);

async function removeShare(env, id){
  let cursor;
  do {
    const l = await env.BUCKET.list({prefix: "s/" + id + "/", cursor});
    if (l.objects.length) await env.BUCKET.delete(l.objects.map(o => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  await env.BUCKET.delete("i/" + id);
}
async function allInfos(env){
  const out = []; let cursor;
  do {
    const l = await env.BUCKET.list({prefix: "i/", cursor});
    for (const o of l.objects) { const i = await getInfo(env, o.key.slice(2)); if (i) out.push(i); }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return out;
}
async function cleanup(env){
  const now = Date.now();
  for (const i of await allInfos(env)) {
    const stale = !i.done && now - i.created > 6 * 3600e3;   // upload der aldrig blev færdig
    if (i.expires <= now || stale || (i.maxDownloads && i.downloads >= i.maxDownloads)) await removeShare(env, i.id);
  }
}
async function readBody(req){
  const n = Number(req.headers.get("Content-Length") || 0);
  if (n > MAX_PART) return null;
  const b = await req.arrayBuffer();
  return b.byteLength > MAX_PART ? null : b;
}

export default {
  async fetch(req, env, ctx){
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
    const url = new URL(req.url), p = url.pathname.split("/").filter(Boolean), m = req.method;
    if (p[0] !== "api") return new Response("Fil/Billede deling", {headers: cors});
    try {
      // ---------- Modtager ----------
      if (p[1] === "s" && ID_RE.test(p[2] || "")) {
        const id = p[2], info = await getInfo(env, id);
        if (!alive(info)) return err(410, "Delingen findes ikke længere.");
        if (p.length === 3 && m === "GET") {
          const {id: _, to, ...pub} = info;
          return json(pub);
        }
        if (p[3] === "got" && m === "POST") {
          info.downloads = (info.downloads || 0) + 1; info.lastDownload = Date.now();
          await putInfo(env, id, info);
          if (info.maxDownloads && info.downloads >= info.maxDownloads) ctx.waitUntil(removeShare(env, id));
          return json({ok: true});
        }
        let key = null;
        if (p[3] === "meta" && p.length === 4) key = `s/${id}/meta`;
        if (p[3] === "f" && /^\d+$/.test(p[4] || "") && /^\d+$/.test(p[5] || "") && p.length === 6) key = `s/${id}/f/${+p[4]}/${+p[5]}`;
        if (key && m === "GET") {
          const o = await env.BUCKET.get(key);
          if (!o) return err(404, "Mangler.");
          return new Response(o.body, {headers: {...cors, "Content-Type": "application/octet-stream", "Content-Length": String(o.size), "Cache-Control": "no-store"}});
        }
        return err(404, "Ukendt.");
      }

      // ---------- Afsender ----------
      if (!env.UPLOAD_KEY) return err(500, "UPLOAD_KEY er ikke sat på Workeren.");
      if (!sameKey(req.headers.get("X-Key") || "", env.UPLOAD_KEY)) return err(401, "Forkert afsenderkode.");
      if (p[1] === "me") return json({ok: true});
      if (p[1] !== "shares") return err(404, "Ukendt.");

      if (p.length === 2 && m === "GET") {
        const list = (await allInfos(env)).filter(i => i.expires > Date.now()).sort((a, b) => b.created - a.created);
        return json({shares: list});
      }
      if (p.length === 2 && m === "POST") {
        const b = await req.json().catch(() => ({}));
        const hours = Math.max(1, Math.min(MAX_DAYS * 24, Number(b.hours) || 72));
        const id = newId(), now = Date.now();
        const info = {
          id, created: now, expires: now + hours * 3600e3, done: false,
          maxDownloads: Math.max(0, Math.min(100, Number(b.maxDownloads) || 0)), downloads: 0,
          hasCode: !!b.hasCode, count: Number(b.count) || 0, size: Number(b.size) || 0,
          to: String(b.to || "").slice(0, 60),
        };
        await putInfo(env, id, info);
        return json({id, expires: info.expires});
      }
      const id = p[2];
      if (!ID_RE.test(id || "")) return err(404, "Ukendt.");
      const info = await getInfo(env, id);
      if (!info) return err(404, "Delingen findes ikke.");
      if (p.length === 3 && m === "DELETE") { await removeShare(env, id); return json({ok: true}); }
      if (p[3] === "done" && m === "POST") { info.done = true; await putInfo(env, id, info); return json({ok: true}); }
      let key = null;
      if (p[3] === "meta" && p.length === 4) key = `s/${id}/meta`;
      if (p[3] === "f" && /^\d+$/.test(p[4] || "") && /^\d+$/.test(p[5] || "") && p.length === 6) key = `s/${id}/f/${+p[4]}/${+p[5]}`;
      if (key && m === "PUT") {
        if (info.done) return err(409, "Delingen er allerede lukket for upload.");
        const body = await readBody(req);
        if (!body) return err(413, "Stykket er for stort.");
        await env.BUCKET.put(key, body);
        return json({ok: true});
      }
      return err(404, "Ukendt.");
    } catch (e) {
      return err(500, "Fejl på serveren: " + (e && e.message || e));
    }
  },
  async scheduled(ev, env, ctx){ ctx.waitUntil(cleanup(env)); },
};
