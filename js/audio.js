'use strict';
// Runtime audio. Everything audible is rendered by js/dsp.js (in a Worker when available); this file only plays it:
// Sfx.play(name) picks a random pre-rendered variant with a little pitch/level spread, Music layers three looping
// stems per era (bed / groove / boss) by game intensity and crossfades between eras.

const SFX_LEVEL = { pistol: 0.6, smg: 0.45, rifle: 0.55, shotgun: 0.75, sniper: 0.85, rocket: 0.7, laser: 0.22, boom: 1, hit: 0.4, head: 0.55,
  block: 0.4, coin: 0.18, buy: 0.5, reload: 0.5, magout: 0.45, click: 0.35, hurt: 0.7, kick: 0.7, throw: 0.4, bow: 0.5, eshot: 0.45, elaser: 0.35,
  wave: 0.5, perk: 0.5, slow: 0.6, die: 0.85 };
const SFX_DUCK = { boom: 0.35, sniper: 0.6, die: 0.25, slow: 0.5 }; // big sounds push the music down briefly
// render order: what the first seconds of play need comes back first
const SFX_FIRST = ['click', 'pistol', 'hit', 'head', 'coin', 'magout', 'reload', 'kick', 'throw', 'hurt', 'boom', 'wave', 'perk'];
const MUSIC_VOL = 0.5, MUSIC_MIX = [[1, 0, 0], [0.8, 1, 0], [0.7, 1, 1]]; // bed/groove/boss gain for menu, fight, boss

function toBuf(ac, chans, sr) {
  const b = ac.createBuffer(chans.length, chans[0].length, sr);
  chans.forEach((c, i) => b.getChannelData(i).set(c));
  return b;
}
// render jobs go to a Worker; if it cannot start, the same code runs here (js/dsp.js is loaded by the page too)
function audioWorker() {
  const cbs = {}; let id = 0, w = null;
  const local = (m, cb) => setTimeout(() => cb(DSP.job(m).res), 0);
  try {
    w = new Worker('js/audio-worker.js');
    w.onmessage = e => { const f = cbs[e.data.id]; delete cbs[e.data.id]; if (f) f.cb(e.data); };
    w.onerror = () => { w = null; for (const k in cbs) { local(cbs[k].m, cbs[k].cb); delete cbs[k]; } };
  } catch (e) { w = null; }
  return { req(m, cb) { if (!w) return local(m, cb); const i = ++id; cbs[i] = { m, cb }; w.postMessage({ ...m, id: i }); } };
}

const Sfx = {
  ac: null, on: true, bus: null, buf: {}, raw: {}, last: {}, wk: null,
  // start rendering at page load (no AudioContext needed yet), one sound per job, most urgent first
  prep() {
    if (this.wk) return;
    this.wk = audioWorker();
    for (const n of [...new Set([...SFX_FIRST, ...DSP.SFX])]) this.wk.req({ type: 'sfx', name: n }, d => { this.raw[n] = d; this.ready(n); });
  },
  ready(n) { const d = this.raw[n]; if (this.ac && d) { this.buf[n] = d.vars.map(x => toBuf(this.ac, [x], d.sr)); delete this.raw[n]; } },
  init() {
    if (this.ac) { if (this.ac.state === 'suspended' && !Platform.inAd && !document.hidden) this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const a = this.ac = new AC();
    const lim = a.createDynamicsCompressor(); // master safety limiter
    lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.2; lim.connect(a.destination);
    this.bus = a.createGain(); this.bus.gain.value = 0.9; this.bus.connect(lim);
    Music.bus = a.createGain(); Music.bus.gain.value = 0; Music.bus.connect(lim);
    this.prep(); for (const n in this.raw) this.ready(n);
  },
  play(n) {
    if (!this.on || !this.ac) return;
    const t = this.ac.currentTime;
    if (t - (this.last[n] || 0) < 0.035) return; // retrigger guard (SMG hits, beam)
    this.last[n] = t;
    const vs = this.buf[n]; if (!vs) return; // still rendering
    const s = this.ac.createBufferSource(), g = this.ac.createGain();
    s.buffer = vs[(Math.random() * vs.length) | 0]; s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
    g.gain.value = (SFX_LEVEL[n] ?? 0.6) * (0.88 + Math.random() * 0.12);
    s.connect(g).connect(this.bus); s.start(t);
    if (SFX_DUCK[n]) Music.duck(SFX_DUCK[n]);
  },
};

const Music = {
  on: true, bus: null, vol: -1, key: null, keyT: 0, lvl: 0, cache: {}, pending: {}, cur: null,
  // called every frame with the era's music key and intensity (0 menu/pause, 1 fight, 2 boss)
  set(key, lvl) {
    if (!this.bus) return;
    const a = Sfx.ac, want = this.on ? MUSIC_VOL : 0;
    if (want !== this.vol) { this.vol = want; this.bus.gain.cancelScheduledValues(a.currentTime); this.bus.gain.setTargetAtTime(want, a.currentTime, 0.3); }
    const now = performance.now(); // wall clock: the audio clock is frozen while the context is suspended
    if (key !== this.key) { this.key = key; this.keyT = now; }
    if (now - this.keyT > 400) this.load(key); // wait until era browsing settles
    if (this.cache[key] && (!this.cur || this.cur.key !== key)) this.play(key);
    if (this.cur && lvl !== this.lvl) { this.lvl = lvl; this.mix(); }
  },
  load(key) {
    if (this.cache[key] || this.pending[key]) return;
    this.pending[key] = 1;
    Sfx.wk.req({ type: 'music', key }, d => {
      delete this.pending[key];
      this.cache[key] = { key, boost: d.bedBoost, raw: d }; // AudioBuffers are made on first play (the context may not exist yet)
      for (const k in this.cache) if (k !== key && k !== this.key && (!this.cur || k !== this.cur.key)) delete this.cache[k]; // ~20 MB per era
    });
  },
  play(key) {
    const a = Sfx.ac, t = a.currentTime + 0.05, c = this.cache[key], old = this.cur;
    if (!c.stems) { c.stems = ['bed', 'groove', 'boss'].map(k => toBuf(a, c.raw.stems[k], c.raw.sr)); c.raw = null; }
    const out = a.createGain(); out.gain.value = 0; out.gain.setTargetAtTime(1, t, old ? 0.8 : 0.4); out.connect(this.bus);
    const gs = c.stems.map(b => { const s = a.createBufferSource(), g = a.createGain(); s.buffer = b; s.loop = true; g.gain.value = 0; s.connect(g).connect(out); s.start(t); return { s, g }; });
    this.cur = { key, c, out, gs }; this.mix();
    if (old) { old.out.gain.setTargetAtTime(0, t, 0.6); for (const x of old.gs) x.s.stop(t + 4); }
  },
  mix() {
    const a = Sfx.ac, m = MUSIC_MIX[this.lvl] || MUSIC_MIX[0], c = this.cur;
    c.gs.forEach((x, i) => x.g.gain.setTargetAtTime(m[i] * (i === 0 && this.lvl === 0 ? c.c.boost : 1), a.currentTime, 0.8));
  },
  duck(amt) {
    if (!this.bus || this.vol <= 0) return;
    const a = Sfx.ac, g = this.bus.gain, t = a.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(this.vol * amt, t + 0.03); g.setTargetAtTime(this.vol, t + 0.2, 0.5);
  },
};
