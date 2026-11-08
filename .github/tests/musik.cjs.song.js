function song(){
  const sr = 44100, dur = +(process.env.DUR || 12), n = sr * dur, L = new Float32Array(n), R = new Float32Array(n), hz = m => 440 * 2 ** ((m - 69) / 12);
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
module.exports = song;
