// "Ears" for the procedural audio: renders js/dsp.js sounds in Node, writes WAV + a labelled spectrogram PNG
// and prints the measurements used to judge them.
//   node tools/listen.js sfx pistol [variant]   one sound, big spectrogram
//   node tools/listen.js sfx all                contact sheet of every SFX
//   node tools/listen.js music city [stem]      song (mix or one stem: bed|groove|boss)
// Output goes to tools/out/ (git-ignored).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const DSP = require('../js/dsp.js');
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-5); // unique names: image viewers cache by path

// ---------- files ----------
function wav(file, chans, sr) {
  const n = chans[0].length, nc = chans.length, b = Buffer.alloc(44 + n * nc * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 2, 28); b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), 44 + (i * nc + c) * 2);
  fs.writeFileSync(file, b);
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc(buf) { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function png(file, img) {
  const { w, h, px } = img, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// ---------- tiny raster ----------
const image = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 3) });
function set(img, x, y, [r, g, b]) { if (x < 0 || y < 0 || x >= img.w || y >= img.h) return; const i = (y * img.w + x) * 3; img.px[i] = r; img.px[i + 1] = g; img.px[i + 2] = b; }
const FONT = { A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011',
  R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110', 4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010',
  8: '010101010101010', 9: '010101011001110', '.': '000000000000010', '-': '000000111000000', ':': '000010000010000', '/': '001001010100100', '%': '101001010100101', ' ': '000000000000000' };
function text(img, x, y, s, col = [255, 255, 255], sc = 2) {
  for (const ch of String(s).toUpperCase()) { const g = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) set(img, x + (i % 3) * sc + a, y + ((i / 3) | 0) * sc + b, col); x += 4 * sc; }
}
const STOPS = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]]; // inferno
function heat(v) { v = Math.max(0, Math.min(1, v)) * (STOPS.length - 1); const i = Math.min(STOPS.length - 2, v | 0), f = v - i; return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * f)); }

// ---------- analysis ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function stft(x, sr, N, cols) {
  const hop = Math.max(1, (x.length - N) / Math.max(1, cols - 1)), win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))), out = [];
  for (let c = 0; c < cols; c++) {
    const s = Math.round(c * hop) - N / 2, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = s + i; re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0; }
    fft(re, im); const mag = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (N / 4); out.push(mag);
  }
  return out;
}
const db = v => 20 * Math.log10(Math.max(v, 1e-9));
function measure(x, sr) {
  let pk = 0, ss = 0; for (const v of x) { pk = Math.max(pk, Math.abs(v)); ss += v * v; }
  const rms = Math.sqrt(ss / x.length), w = Math.round(sr * 0.005), envl = [];
  for (let i = 0; i < x.length; i += w) { let s = 0; for (let j = i; j < Math.min(x.length, i + w); j++) s += x[j] * x[j]; envl.push(Math.sqrt(s / w)); }
  const ep = Math.max(...envl), ip = envl.indexOf(ep), t = i => (i * w / sr * 1000).toFixed(0) + 'ms';
  const firstBelow = d => { for (let i = ip; i < envl.length; i++) if (db(envl[i] / ep) < d) return t(i); return '>end'; };
  const att = envl.findIndex(v => db(v / ep) > -3);
  // long-term spectrum
  const N = 4096, bands = [[0, 60], [60, 250], [250, 1000], [1000, 4000], [4000, 10000], [10000, sr / 2]], be = bands.map(() => 0); let cn = 0, cd = 0;
  for (const mag of stft(x, sr, N, Math.min(200, Math.max(4, Math.ceil(x.length / 2048))))) mag.forEach((m, k) => { const f = k * sr / N, e = m * m; cn += f * e; cd += e; bands.forEach(([a, b], i) => { if (f >= a && f < b) be[i] += e; }); });
  const tot = be.reduce((a, b) => a + b, 0) || 1;
  return { dur: (x.length / sr).toFixed(2) + 's', peak: db(pk).toFixed(1), rms: db(rms).toFixed(1), crest: (db(pk) - db(rms)).toFixed(1), attack: t(att), peakAt: t(ip),
    decay20: firstBelow(-20), decay40: firstBelow(-40), centroid: Math.round(cn / (cd || 1)) + 'Hz',
    bands: 'sub ' + ['', 'bass ', 'lowmid ', 'mid ', 'high ', 'air '].map((l, i) => l + Math.round(be[i] / tot * 100) + '%').join(' ') };
}
// ---------- drawing ----------
function draw(img, x0, y0, w, h, x, sr, label, o = {}) {
  const wh = Math.round(h * 0.22), sh = h - wh - 14, N = o.N || (x.length / sr < 1.5 ? 512 : 2048), fmin = 40, fmax = Math.min(18000, sr / 2);
  text(img, x0 + 2, y0 + 2, label, [255, 255, 255], 2);
  // waveform (min/max per column) + 5 ms dB envelope in yellow
  const per = x.length / w;
  for (let c = 0; c < w; c++) {
    let mn = 0, mx = 0, s = 0; const a = Math.floor(c * per), b = Math.max(a + 1, Math.floor((c + 1) * per));
    for (let i = a; i < b && i < x.length; i++) { mn = Math.min(mn, x[i]); mx = Math.max(mx, x[i]); s += x[i] * x[i]; }
    const mid = y0 + 14 + wh / 2; for (let y = Math.round(mid - mx * wh / 2); y <= Math.round(mid - mn * wh / 2); y++) set(img, x0 + c, y, [120, 160, 200]);
    const e = Math.max(0, (db(Math.sqrt(s / (b - a))) + 60) / 60); set(img, x0 + c, Math.round(y0 + 14 + wh - e * wh), [255, 220, 60]);
  }
  const spec = stft(x, sr, N, w), top = y0 + 14 + wh;
  for (let yy = 0; yy < sh; yy++) {
    const f = fmin * Math.pow(fmax / fmin, 1 - yy / (sh - 1)), k = f * N / sr, k0 = Math.floor(k), fr = k - k0;
    for (let c = 0; c < w; c++) { const m = spec[c], v = (m[k0] || 0) * (1 - fr) + (m[k0 + 1] || 0) * fr; set(img, x0 + c, top + yy, heat((db(v) + 96) / 96)); }
  }
  for (const [f, l] of [[100, '100'], [1000, '1K'], [10000, '10K']]) {
    if (f > fmax) continue; const yy = top + Math.round((1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (sh - 1));
    for (let c = 0; c < w; c += 3) set(img, x0 + c, yy, [80, 200, 255]); text(img, x0 + w - 26, yy - 12, l, [80, 200, 255], 2);
  }
  const dur = x.length / sr, step = dur > 8 ? 2 : dur > 2 ? 0.5 : dur > 0.6 ? 0.1 : 0.05;
  for (let t = step; t < dur; t += step) { const c = Math.round(t / dur * w); for (let y = top + sh - 8; y < top + sh; y++) set(img, x0 + c, y, [255, 255, 255]); if (o.big) text(img, x0 + c + 2, top + sh - 12, (t < 1 ? Math.round(t * 1000) + 'MS' : t.toFixed(1) + 'S'), [255, 255, 255], 2); }
}

const [mode, what, arg] = process.argv.slice(2);
if (mode === 'sfx' && what === 'all') {
  const names = DSP.SFX, cols = 4, tw = 360, th = 220, img = image(cols * tw, Math.ceil(names.length / cols) * th);
  names.forEach((n, i) => { const x = DSP.renderSfx(n, 0); draw(img, (i % cols) * tw + 2, Math.floor(i / cols) * th + 2, tw - 4, th - 4, x, 44100, n); const m = measure(x, 44100); console.log(n.padEnd(8), m.dur, 'pk', m.peak, 'rms', m.rms, 'crest', m.crest, 'att', m.attack, '-20dB@', m.decay20, '-40dB@', m.decay40, m.centroid, '|', m.bands); });
  png(path.join(OUT, `sfx-all-${RUN}.png`), img); console.log('->', path.join(OUT, `sfx-all-${RUN}.png`));
} else if (mode === 'sfx') {
  const t0 = Date.now(), x = DSP.renderSfx(what, +(arg || 0)), ms = Date.now() - t0, img = image(1200, 620);
  draw(img, 0, 0, 1200, 620, x, 44100, `${what} v${arg || 0}`, { big: 1 });
  png(path.join(OUT, `${what}-${RUN}.png`), img); wav(path.join(OUT, what + '.wav'), [x], 44100);
  console.log(what, `render ${ms}ms`, measure(x, 44100), '\n->', path.join(OUT, `${what}-${RUN}.png`));
} else if (mode === 'music') {
  const t0 = Date.now(), s = DSP.renderMusic(what), ms = Date.now() - t0, st = s.stems, n = st.bed[0].length;
  const mix = [0, 1].map(c => { const o = new Float32Array(n); for (const k of arg ? [arg] : ['bed', 'groove', 'boss']) for (let i = 0; i < n; i++) o[i] += st[k][c][i]; return o; });
  const img = image(1400, 560); draw(img, 0, 0, 1400, 560, mix[0], s.sr, `${what} ${arg || 'mix'}`, { big: 1, N: 4096 });
  png(path.join(OUT, `music-${what}-${arg || 'mix'}-${RUN}.png`), img); wav(path.join(OUT, `music-${what}-${arg || 'mix'}.wav`), mix, s.sr);
  const seam = Math.max(...mix.map(c => Math.abs(c[0] - c[n - 1])));
  console.log(what, `render ${ms}ms, loop ${s.len.toFixed(1)}s, seam jump ${seam.toFixed(4)}`);
  for (const k of ['bed', 'groove', 'boss']) { const m = measure(st[k][0], s.sr); console.log(' ', k.padEnd(6), 'pk', m.peak, 'rms', m.rms, m.centroid, '|', m.bands); }
  const m = measure(mix[0], s.sr); console.log('  mix    pk', m.peak, 'rms', m.rms, m.centroid, '|', m.bands, '\n->', path.join(OUT, `music-${what}-${arg || 'mix'}-${RUN}.png`));
} else console.log('usage: node tools/listen.js sfx <name|all> [variant] | music <era> [bed|groove|boss]');
