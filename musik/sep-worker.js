/* Adskiller en sang i fire spor med HT-Demucs (Meta, MIT-licens) i ONNX-form – kører helt i browseren.
   Modellen (166 MB) hentes første gang og gemmes i browserens cache.
   Ind:  {t:'run', L: Float32Array, R: Float32Array}  (44,1 kHz stereo)
   Ud:   {t:'model', got, total} · {t:'prog', done, total} · {t:'seg', start, stems:[Int16Array x4]} (stereo flettet) · {t:'done', ep} · {t:'err', msg} */
const Q = new URLSearchParams(self.location.search);
const ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${Q.get('ort') || '1.22.0'}/dist/`;
const MODEL = 'https://huggingface.co/adowu/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx';
importScripts(ORT + 'ort.min.js');
ort.env.wasm.wasmPaths = ORT;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const N = 343980, OV = Math.floor(N / 4), STRIDE = N - OV;
const WIN = new Float32Array(N);
for (let i = 0; i < N; i++) WIN[i] = Math.min(1, (i + 1) / (OV + 1), (N - i) / (OV + 1));

async function modelBytes(){
  let cache = null;
  try { cache = await caches.open('musik-model-v1'); const hit = await cache.match(MODEL); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) {}
  const r = await fetch(MODEL);
  if (!r.ok) throw new Error('Modellen kunne ikke hentes (' + r.status + ')');
  const total = +r.headers.get('content-length') || 165612636, rd = r.body.getReader(), out = new Uint8Array(total);
  let got = 0, last = 0;
  for (;;) {
    const {done, value} = await rd.read(); if (done) break;
    if (got + value.length > out.length) throw new Error('Uventet modelstørrelse');
    out.set(value, got); got += value.length;
    if (got - last > 2e6) { last = got; postMessage({t: 'model', got, total}); }
  }
  postMessage({t: 'model', got, total});
  try { if (cache) await cache.put(MODEL, new Response(out.slice(0, got), {headers: {'content-type': 'application/octet-stream'}})); } catch (e) {}
  return got === out.length ? out : out.slice(0, got);
}

let session = null, ep = '';
async function getSession(){
  if (session) return session;
  let bytes = await modelBytes();
  const tries = [];
  if (self.navigator && navigator.gpu) tries.push('webgpu');
  tries.push('wasm');
  let lastErr = null;
  for (const p of tries) {
    try { session = await ort.InferenceSession.create(bytes, {executionProviders: [p], graphOptimizationLevel: Q.get('opt') || 'disabled', enableCpuMemArena: false, enableMemPattern: false}); ep = p; break; }
    catch (e) { lastErr = e; postMessage({t: 'log', msg: p + ': ' + (e && e.message || e)}); }
  }
  bytes = null;
  if (!session) throw new Error('Modellen kunne ikke startes på denne enhed' + (lastErr ? ': ' + (lastErr.message || lastErr) : ''));
  return session;
}

const toI16 = v => { v = v < -1 ? -1 : v > 1 ? 1 : v; return v < 0 ? v * 32768 : v * 32767; };

onmessage = async ({data}) => {
  if (data.t !== 'run') return;
  try {
    const s = await getSession(), {L, R} = data, total = L.length;
    const chunks = Math.max(1, Math.ceil(total / STRIDE));
    // Akkumulator for det aktuelle vindue: 4 spor x 2 kanaler + vægt
    const acc = Array.from({length: 8}, () => new Float32Array(N)), w = new Float32Array(N);
    postMessage({t: 'prog', done: 0, total: chunks, ep});
    for (let c = 0; c < chunks; c++) {
      const st = c * STRIDE, len = Math.min(N, total - st);
      const x = new Float32Array(2 * N);
      x.set(L.subarray(st, st + len), 0); x.set(R.subarray(st, st + len), N);
      const out = await s.run({mix: new ort.Tensor('float32', x, [1, 2, N])});
      const y = (out.stems || out[Object.keys(out)[0]]).data;           // (1, 4, 2, N)
      for (let k = 0; k < 8; k++) { const a = acc[k], o = k * N; for (let i = 0; i < len; i++) a[i] += y[o + i] * WIN[i]; }
      for (let i = 0; i < len; i++) w[i] += WIN[i];
      // Det, der ligger før næste vindues start, er færdigt
      const fin = c === chunks - 1 ? len : Math.min(STRIDE, len);
      const stems = [];
      for (let k = 0; k < 4; k++) {
        const a = acc[2 * k], b = acc[2 * k + 1], o = new Int16Array(fin * 2);
        for (let i = 0; i < fin; i++) { const ww = w[i] > 1e-8 ? w[i] : 1e-8; o[2 * i] = toI16(a[i] / ww); o[2 * i + 1] = toI16(b[i] / ww); }
        stems.push(o);
      }
      postMessage({t: 'seg', start: st, stems}, stems.map(x => x.buffer));
      // Skub vinduet frem
      for (const a of acc) { a.copyWithin(0, STRIDE); a.fill(0, N - STRIDE); }
      w.copyWithin(0, STRIDE); w.fill(0, N - STRIDE);
      postMessage({t: 'prog', done: c + 1, total: chunks, ep});
    }
    postMessage({t: 'done', ep});
  } catch (e) { postMessage({t: 'err', msg: String(e && e.message || e)}); }
};
