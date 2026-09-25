'use strict';
// Offline audio synthesis. Every SFX variant and every music stem is computed sample by sample into
// Float32Arrays: the game runs this in a Worker (js/audio-worker.js), tools/listen.js runs the same code in
// Node to draw spectrograms and measure it. No WebAudio in here.
//
// Techniques: layered gunshots (crack / body / muzzle chirp / mechanics / reflections), Karplus-Strong strings
// with pick position + tuning allpass, 2-op FM (brass, tines), band-limited (polyBLEP) saw ensembles, modal
// synthesis (bells, wood, metal, coins), 808-style metallic hats, Freeverb, humanized timing and velocity.
const DSP = (() => {
  const TAU = Math.PI * 2;
  let SR = 44100;
  const secs = s => Math.max(1, Math.ceil(s * SR));
  const buf = s => new Float32Array(secs(s));
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const dbg = db => Math.pow(10, db / 20);
  function rng(seed) {
    let a = seed >>> 0 || 1;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const gauss = r => (r() + r() + r() + r() - 2) * 1.732; // ~N(0,1)
  const NT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function note(s) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); if (!m) throw new Error('bad note ' + s);
    return 12 * (+m[3] + 1) + NT[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  // ===== filters =====
  // RBJ biquad; set() can be called while running (sweeps)
  function bq(type, f, q = 0.707, db = 0) {
    let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const o = {
      set(f, Q = q) {
        f = Math.max(10, Math.min(f, SR * 0.45));
        const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q), A = Math.pow(10, db / 40);
        let n0, n1, n2, d0, d1, d2;
        if (type === 'lp') { n0 = (1 - c) / 2; n1 = 1 - c; n2 = n0; d0 = 1 + al; d1 = -2 * c; d2 = 1 - al; }
        else if (type === 'hp') { n0 = (1 + c) / 2; n1 = -(1 + c); n2 = n0; d0 = 1 + al; d1 = -2 * c; d2 = 1 - al; }
        else if (type === 'bp') { n0 = al; n1 = 0; n2 = -al; d0 = 1 + al; d1 = -2 * c; d2 = 1 - al; }
        else { n0 = 1 + al * A; n1 = -2 * c; n2 = 1 - al * A; d0 = 1 + al / A; d1 = -2 * c; d2 = 1 - al / A; } // 'pk'
        b0 = n0 / d0; b1 = n1 / d0; b2 = n2 / d0; a1 = d1 / d0; a2 = d2 / d0; return o;
      },
      run(x) { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; },
    };
    return o.set(f, q);
  }
  function filt(b, type, f, q, db) { const F = bq(type, f, q, db); for (let i = 0; i < b.length; i++) b[i] = F.run(b[i]); return b; }
  function op(f) { // one-pole
    let y = 0, a = 1 - Math.exp(-TAU * f / SR);
    return { lp(x) { return y += a * (x - y); }, hp(x) { y += a * (x - y); return x - y; } };
  }

  // ===== buffer helpers =====
  function add(dst, src, at = 0, g = 1) {
    const i0 = Math.max(0, Math.round(at * SR)), n = Math.min(src.length, dst.length - i0);
    for (let i = 0; i < n; i++) dst[i0 + i] += src[i] * g;
    return dst;
  }
  function peak(b) { let p = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; } return p; }
  function gain(b, g) { for (let i = 0; i < b.length; i++) b[i] *= g; return b; }
  function norm(b, db = -1) { const p = peak(b); return p ? gain(b, dbg(db) / p) : b; }
  function drive(b, d) { const k = 1 / Math.tanh(d); for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * d) * k; return b; }
  function fadeOut(b, s = 0.01) { const n = Math.min(b.length, secs(s)); for (let i = 0; i < n; i++) b[b.length - 1 - i] *= i / n; return b; }
  function trimTail(b, floorDb = -66) { // drop the silent end so short sounds stay short
    const th = peak(b) * dbg(floorDb); let e = b.length;
    while (e > 1 && Math.abs(b[e - 1]) < th) e--;
    return fadeOut(b.slice(0, Math.min(b.length, e + secs(0.005))), 0.004);
  }
  const vary = (n, fn) => Array.from({ length: n }, fn);

  // ===== space =====
  // Freeverb (8 lowpass-feedback combs + 4 allpasses per channel); returns the wet signal
  const CT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], AT = [556, 441, 341, 225];
  function verb(inL, inR, o = {}) {
    const k = SR / 44100 * (o.scale || 1), fb = 0.7 + 0.28 * (o.size ?? 0.6), damp = o.damp ?? 0.35, n = inL.length, pre = Math.round((o.pre || 0) * SR);
    const res = [];
    for (let ch = 0; ch < (inR ? 2 : 1); ch++) {
      const x = ch ? inR : inL, sp = ch ? 23 : 0, out = new Float32Array(n);
      const cb = CT.map(d => new Float32Array(Math.max(8, Math.round((d + sp) * k)))), ci = new Int32Array(8), cf = new Float64Array(8);
      const ab = AT.map(d => new Float32Array(Math.max(8, Math.round((d + sp) * SR / 44100)))), ai = new Int32Array(4);
      for (let j = 0; j < n; j++) {
        const xin = (j >= pre ? x[j - pre] : 0) * 0.015;
        let y = 0;
        for (let c = 0; c < 8; c++) {
          const b = cb[c], i = ci[c], v = b[i];
          cf[c] = v * (1 - damp) + cf[c] * damp; b[i] = xin + cf[c] * fb; ci[c] = i + 1 === b.length ? 0 : i + 1; y += v;
        }
        for (let a = 0; a < 4; a++) { const b = ab[a], i = ai[a], v = b[i]; b[i] = y + v * 0.5; ai[a] = i + 1 === b.length ? 0 : i + 1; y = v - y; }
        out[j] = y * 3;
      }
      res.push(out);
    }
    return res;
  }
  // discrete reflections: [delay s, gain, lowpass Hz] (walls, terrain)
  function taps(x, list) { // each reflection is smeared over a few ms (rough surfaces) and darkened 12 dB/oct
    const out = new Float32Array(x.length), sm = [[-0.004, 0.25], [-0.0015, 0.5], [0, 1], [0.002, 0.45], [0.005, 0.2]];
    for (const [d, g, f] of list) {
      const L = op(f), L2 = op(f), y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = L2.lp(L.lp(x[i]));
      for (const [ds, gs] of sm) { const o = secs(Math.max(0.001, d + ds)); for (let i = 0; i + o < x.length; i++) out[i + o] += y[i] * g * gs * 0.45; }
    }
    return out;
  }
  const env = (t, dur, a, d, s, r) => {
    const lv = t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : s;
    if (t < dur) return lv;
    const at = dur < a ? dur / a : dur < a + d ? 1 - (1 - s) * (dur - a) / d : s;
    return at * Math.exp(-(t - dur) * 6 / Math.max(r, 1e-3));
  };

  // ===== instruments (each returns a mono voice) =====
  // Karplus-Strong string: noise burst (darker when soft) -> pick-position comb -> loop with loss + tuning allpass
  function pluck(r, f, dur, o = {}) {
    const vel = o.vel ?? 0.8, bright = o.bright ?? 0.5, S = o.s ?? 0.5, rel = o.rel ?? 0.06;
    const N = SR / f, L = Math.max(2, Math.floor(N - S - 0.1)), D = N - S - L, C = (1 - D) / (1 + D);
    const out = buf(dur + rel), g = Math.pow(10, -3 / (f * (o.decay ?? 2)));
    const lp = op(150 + 9000 * bright * (0.35 + 0.65 * vel)), exc = new Float32Array(L);
    for (let i = 0; i < L; i++) exc[i] = lp.lp(r() * 2 - 1);
    const P = Math.max(1, Math.round((o.pos ?? 0.14) * L));
    for (let i = L - 1; i >= P; i--) exc[i] -= exc[i - P];
    let x1 = 0, y1 = 0;
    for (let n = 0; n < out.length; n++) {
      const a = n >= L ? out[n - L] : 0, b = n > L ? out[n - L - 1] : 0, v = (1 - S) * a + S * b;
      const ap = C * v + x1 - C * y1; x1 = v; y1 = ap;
      out[n] = (n < L ? exc[n] * vel * 1.6 : 0) + g * ap;
    }
    const stop = secs(dur), k = Math.exp(-1 / (rel / 5 * SR)); let e = 1; // fingers damp the string at note-off
    for (let n = stop; n < out.length; n++) out[n] *= (e *= k);
    if (o.body) for (const [bf, q, db] of o.body) filt(out, 'pk', bf, q, db);
    return filt(out, 'hp', 30, 0.7);
  }
  // several strings with a small delay between them (strum); up-strokes go high->low and are lighter
  function strum(r, ms, dur, o = {}) {
    const order = o.up ? [...ms].reverse().slice(0, 4) : ms, out = buf(dur + 0.3), dt = o.spread ?? 0.012;
    order.forEach((m, i) => add(out, pluck(r, mtof(m), dur - i * dt, { ...o, vel: (o.vel ?? 0.7) * (o.up ? 0.75 : 1) * (1 - i * 0.04) }), i * dt + r() * 0.002));
    return out;
  }
  // 2-operator FM; modulation index follows the amp envelope (brass) or decays on its own (tines, bells)
  function fm(r, f, dur, o = {}) {
    const ratio = o.ratio ?? 1, I0 = o.index ?? 2, a = o.a ?? 0.01, d = o.d ?? 0.3, s = o.s ?? 0.7, rl = o.r ?? 0.2, vel = o.vel ?? 0.8, vib = o.vib || 0;
    const out = buf(dur + rl); let pc = 0, pm = 0;
    for (let n = 0; n < out.length; n++) {
      const t = n / SR, e = env(t, dur, a, d, s, rl), fv = f * (1 + vib * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.3));
      const I = I0 * (o.iDec ? Math.exp(-t / o.iDec) : e) * (0.45 + 0.55 * vel);
      pm += TAU * fv * ratio / SR; pc += TAU * fv / SR;
      out[n] = Math.sin(pc + I * Math.sin(pm)) * e * vel;
    }
    return out;
  }
  const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
  // band-limited saw (or pulse) ensemble through a resonant lowpass; f may be an array (a whole chord shares one filter)
  function saws(r, f, dur, o = {}) {
    const fs = [].concat(f), nv = o.voices ?? 3, spread = o.spread ?? 10, vel = o.vel ?? 0.8, a = o.a ?? 0.05, d = o.d ?? 0.3, s = o.s ?? 0.8, rl = o.r ?? 0.3;
    const out = buf(dur + rl), lp = bq('lp', o.cut ?? 3000, o.q ?? 0.7), lp2 = o.pole4 ? bq('lp', o.cut ?? 3000, 0.6) : null;
    const ph = [], inc = [];
    for (const fr of fs) for (let v = 0; v < nv; v++) {
      const c = nv > 1 ? (v / (nv - 1) - 0.5) * 2 * spread + gauss(r) * 1.5 : 0;
      ph.push(r()); inc.push(fr * Math.pow(2, c / 1200) / SR);
    }
    const duty = o.pulse, vib = o.vib || 0, cut = o.cut ?? 3000, fenv = o.fenv || 0, fdec = o.fdec ?? 0.2, g0 = 1 / Math.sqrt(ph.length);
    for (let n = 0; n < out.length; n++) {
      const t = n / SR, e = env(t, dur, a, d, s, rl);
      if (fenv && !(n & 31)) { const fc = cut + fenv * Math.exp(-t / fdec); lp.set(fc); if (lp2) lp2.set(fc); }
      let vm = 1 + vib * Math.sin(TAU * 5.4 * t + ph[0] * 6) * Math.min(1, t / 0.4);
      if (o.glide) vm *= 1 + (o.glideFrom - 1) * Math.exp(-t / o.glide);
      let x = 0;
      for (let v = 0; v < ph.length; v++) {
        const p = ph[v], dt = inc[v] * vm;
        let y = 2 * p - 1 - blep(p, dt);
        if (duty) { let p2 = p + duty; if (p2 >= 1) p2 -= 1; y -= 2 * p2 - 1 - blep(p2, dt); }
        x += y; const q = p + dt; ph[v] = q >= 1 ? q - 1 : q;
      }
      let y = lp.run(x * g0); if (lp2) y = lp2.run(y);
      out[n] = y * e * vel;
    }
    return out;
  }
  // flute / whistle / ney: sine partials + breath noise tuned to the note + chiff at the attack
  function flute(r, f, dur, o = {}) {
    const vel = o.vel ?? 0.7, a = o.a ?? 0.06, rl = o.r ?? 0.12, out = buf(dur + rl), air = o.air ?? 0.22, vib = o.vib ?? 0.005;
    const bp = bq('bp', f, 7), bp2 = bq('bp', f * 2, 9), hp = bq('hp', 2500), h2 = o.h2 ?? 0.18, h3 = o.h3 ?? 0.06, wander = op(3);
    let p = 0;
    for (let n = 0; n < out.length; n++) {
      const t = n / SR, e = env(t, dur, a, 0.15, 0.85, rl), w = r() * 2 - 1;
      p += f * (1 + vib * Math.sin(TAU * 5 * t) * Math.min(1, t / 0.35) + wander.lp(w) * 0.004) / SR;
      const tone = Math.sin(TAU * p) + h2 * Math.sin(2 * TAU * p) + h3 * Math.sin(3 * TAU * p);
      const breath = (bp.run(w) * 3 + bp2.run(w)) * air, chiff = t < 0.05 ? hp.run(w) * (1 - t / 0.05) * 0.25 : 0;
      out[n] = (tone * (1 - air) + breath + chiff) * e * vel;
    }
    return out;
  }
  // modal synthesis: decaying sines [freq, amp, tau] + a short strike noise
  function modal(r, modes, dur, o = {}) {
    const out = buf(dur), hp = bq('hp', o.noiseHp ?? 2000), nt = o.noiseTau ?? 0.003, nn = o.noise ?? 0.3;
    for (const [f, a, tau] of modes) {
      if (f >= SR * 0.45) continue;
      // damped resonator y[n] = 2k·cos(w)·y[n-1] - k²·y[n-2]  ==  a·k^n·sin(n·w), no Math.sin per sample
      const w = TAU * f / SR, k = Math.exp(-1 / (tau * SR)), c1 = 2 * k * Math.cos(w), c2 = k * k, att = secs(o.att || 0), end = Math.min(out.length, Math.ceil(tau * SR * 11.5));
      let y2 = 0, y1 = a * k * Math.sin(w);
      for (let n = 1; n < end; n++) { out[n] += y1 * (n < att ? n / att : 1); const y = c1 * y1 - c2 * y2; y2 = y1; y1 = y; }
    }
    fadeOut(out, Math.min(0.03, dur * 0.2));
    for (let n = 0; n < out.length && n < secs(nt * 7); n++) out[n] += hp.run(r() * 2 - 1) * nn * Math.exp(-n / (nt * SR));
    return gain(out, o.vel ?? 1);
  }
  const marimba = (r, f, dur, vel) => { const tau = Math.min(0.55, 0.25 + 60 / f); return modal(r, [[f, 1, tau], [f * 3.93, 0.3, 0.1], [f * 9.2, 0.1, 0.025]], Math.max(dur + 0.3, tau * 4), { noise: 0.15, noiseHp: 600, vel }); };
  const bell = (r, f, vel) => modal(r, [[f * 0.5, 0.35, 2.2], [f, 1, 1.8], [f * 1.19, 0.5, 1.2], [f * 1.5, 0.35, 0.9], [f * 2, 0.4, 0.7], [f * 2.52, 0.25, 0.5], [f * 3.35, 0.15, 0.3]], 7, { noise: 0.2, vel });
  const plate = (r, f, dur, vel) => modal(r, [[f, 1, 0.35], [f * 1.505, 0.7, 0.28], [f * 2.157, 0.6, 0.22], [f * 2.708, 0.45, 0.18], [f * 3.49, 0.35, 0.14], [f * 4.3, 0.25, 0.1], [f * 5.9, 0.18, 0.07]], dur, { noise: 0.8, noiseHp: 3000, vel });
  function horn(r, f, dur, o = {}) { // three slightly detuned FM brass voices, darkened
    const out = buf(dur + 0.3);
    for (let v = 0; v < 3; v++) add(out, fm(r, f * Math.pow(2, (v - 1) * 6 / 1200), dur, { ratio: 1, index: o.index ?? 2.6, a: o.a ?? 0.07, d: 0.3, s: 0.8, r: 0.25, vel: o.vel ?? 0.7, vib: 0.004 }), r() * 0.01);
    return filt(filt(out, 'lp', o.cut ?? 2600, 0.7), 'pk', 1100, 1.2, 3);
  }
  const FORMANT = [[730, 1, 8], [1090, 0.5, 10], [2440, 0.3, 12]]; // "ah"
  function choir(r, fs, dur, o = {}) {
    const src = saws(r, fs, dur, { voices: 3, spread: 16, cut: 5000, a: o.a ?? 0.5, d: 0.4, s: 0.9, r: 0.6, vel: o.vel ?? 0.6, vib: 0.006 }), out = new Float32Array(src.length);
    for (const [ff, g, q] of FORMANT) { const F = bq('bp', ff, q); for (let i = 0; i < src.length; i++) out[i] += F.run(src[i]) * g * 2.5; }
    return out;
  }
  const fiddle = (r, f, dur, vel) => filt(filt(saws(r, f, dur, { voices: 1, cut: 4500, a: 0.06, d: 0.2, s: 0.85, r: 0.12, vel, vib: 0.006 }), 'pk', 480, 1.4, 6), 'pk', 2700, 1.5, 5);
  const accordion = (r, fs, dur, vel) => filt(saws(r, fs, dur, { voices: 2, spread: 13, pulse: 0.3, cut: 3200, a: 0.04, d: 0.2, s: 0.85, r: 0.08, vel }), 'pk', 1200, 1, 3);

  // ===== drums =====
  function kick(r, o = {}) {
    const out = buf(0.6), f0 = o.f0 ?? 150, f1 = o.f1 ?? 48, tau = o.tau ?? 0.2, hp = bq('hp', 3000); let ph = 0;
    for (let n = 0; n < out.length; n++) {
      const t = n / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / (o.pt ?? 0.03))) / SR;
      out[n] = Math.sin(ph) * Math.exp(-t / tau) + (t < 0.006 ? hp.run(r() * 2 - 1) * (o.click ?? 0.35) * Math.exp(-t / 0.0012) : 0);
    }
    return trimTail(drive(out, o.drive ?? 1.6), -60);
  }
  function snare(r, o = {}) {
    const out = buf(0.45), bp = bq('bp', o.nf ?? 3800, 0.7), hp = bq('hp', 1400); let p1 = 0, p2 = 0;
    for (let n = 0; n < out.length; n++) {
      const t = n / SR; p1 += TAU * (185 + 40 * Math.exp(-t / 0.01)) / SR; p2 += TAU * 332 / SR;
      const w = r() * 2 - 1;
      out[n] = (Math.sin(p1) * 0.55 + Math.sin(p2) * 0.3) * Math.exp(-t / (o.tt ?? 0.06)) + (hp.run(bp.run(w) * 2 + w * 0.3)) * (o.n ?? 0.9) * Math.exp(-t / (o.ntau ?? 0.13)) * Math.min(1, t / 0.0007);
    }
    return trimTail(drive(out, 1.4), -60);
  }
  const HAT = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function hat(r, o = {}) { // six detuned squares (TR-808 style) = metallic, not white noise
    const tau = o.open ? 0.32 : o.tau ?? 0.04, out = buf(tau * 6 + 0.02), bp = bq('bp', 10000, 1), hp = bq('hp', 7000), tune = o.tune ?? 1 + (r() - 0.5) * 0.02;
    const ph = HAT.map(() => r());
    for (let n = 0; n < out.length; n++) {
      let x = 0; for (let k = 0; k < 6; k++) { ph[k] += HAT[k] * tune / SR; x += (ph[k] % 1) < 0.5 ? 1 : -1; }
      out[n] = hp.run(bp.run(x * 0.25 + (r() * 2 - 1) * 0.3)) * Math.exp(-n / SR / tau);
    }
    return trimTail(out, -60);
  }
  function crash(r) { const o = hat(r, { open: 1, tau: 1.1 }), n = buf(2.2), hp = bq('hp', 4000); for (let i = 0; i < n.length; i++) n[i] = hp.run(r() * 2 - 1) * Math.exp(-i / SR / 0.9) * 0.5; return add(n, o, 0, 1.3); }
  function tom(r, f, o = {}) {
    const tau = o.tau ?? 0.35, out = buf(tau * 6), lp = bq('lp', o.skin ?? 2500); let ph = 0;
    for (let n = 0; n < out.length; n++) {
      const t = n / SR; ph += TAU * f * (1 + (o.bend ?? 0.5) * Math.exp(-t / 0.03)) / SR;
      out[n] = Math.sin(ph) * Math.exp(-t / tau) + (o.partial ? Math.sin(ph * 1.5) * 0.3 * Math.exp(-t / (tau * 0.5)) : 0) + lp.run(r() * 2 - 1) * (o.slap ?? 0.35) * Math.exp(-t / 0.012);
    }
    return trimTail(drive(out, o.drive ?? 1.5), -60);
  }
  function burstNoise(r, bpF, q, tau, len, attack = 0.0005) {
    const out = buf(len), F = bq('bp', bpF, q);
    for (let n = 0; n < out.length; n++) { const t = n / SR; out[n] = F.run(r() * 2 - 1) * Math.exp(-t / tau) * Math.min(1, t / attack); }
    return out;
  }
  function clap(r) { const out = buf(0.4); for (const [at, g] of [[0, 0.7], [0.009, 0.8], [0.019, 1]]) add(out, burstNoise(r, 1200, 1.1, at === 0.019 ? 0.09 : 0.004, 0.35), at, g); return norm(out, -1); }
  const shaker = r => norm(burstNoise(r, 7000, 1.3, 0.035, 0.18, 0.009), -3);
  const brush = r => norm(filt(burstNoise(r, 3500, 0.5, 0.07, 0.3, 0.012), 'hp', 900), -3);
  const jingles = r => norm(modal(r, vary(7, () => [5000 + r() * 4000, 0.3 + r() * 0.5, 0.05 + r() * 0.08]), 0.35, { noise: 0.6, noiseHp: 6000, noiseTau: 0.02 }), -4);
  const wood = (r, f) => modal(r, [[f, 1, 0.045], [f * 2.45, 0.5, 0.02], [f * 4.1, 0.2, 0.01]], 0.25, { noise: 0.4, noiseHp: 1500 });
  const tek = r => norm(modal(r, [[820, 1, 0.03], [1900, 0.6, 0.02], [3300, 0.45, 0.012]], 0.2, { noise: 0.6, noiseHp: 2500, noiseTau: 0.004 }), -2);
  const stomp = r => norm(add(kick(r, { f0: 110, f1: 55, tau: 0.11, click: 0.1, drive: 1.2 }), filt(burstNoise(r, 300, 0.6, 0.03, 0.2), 'lp', 900), 0, 0.8), -1);

  // ===== sound effects =====
  function gun(r, o) {
    const J = (v, p = 0.1) => v * (1 + (r() * 2 - 1) * p), out = buf(o.len ?? 1.2);
    { // crack: 1-2 ms broadband burst (muzzle blast onset)
      const hp = bq('hp', o.crackHp ?? 1500), tau = J(o.crackTau ?? 0.0012);
      for (let i = 0; i < secs(tau * 8); i++) out[i] += hp.run(r() * 2 - 1) * (o.crack ?? 1) * Math.exp(-i / (tau * SR));
    }
    { // body: noise through a 4-pole lowpass sweeping down as the gas cools
      const l1 = bq('lp', 1000, 0.8), l2 = bq('lp', 1000, 0.6), f0 = J(o.lp0 ?? 4000), f1 = J(o.lp1 ?? 700), tau = J(o.tau ?? 0.04), n = Math.min(out.length, secs(tau * 8));
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (!(i & 15)) { const fc = f1 + (f0 - f1) * Math.exp(-t / (tau * 0.8)); l1.set(fc, 0.8); l2.set(fc, 0.6); }
        out[i] += l2.run(l1.run(r() * 2 - 1)) * (o.body ?? 2.6) * (1 - Math.exp(-t / 0.0004)) * Math.exp(-t / tau);
      }
    }
    { // thump: low chirp whose half-cycles lengthen (measured muzzle-blast shape)
      let ph = 0; const f0 = J(o.th0 ?? 140), f1 = J(o.th1 ?? 45), tau = J(o.thTau ?? 0.05);
      for (let i = 0; i < Math.min(out.length, secs(tau * 11)); i++) { // run it out to -95 dB: a cut thump is a click
        const t = i / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.015)) / SR;
        out[i] += Math.sin(ph) * (o.thump ?? 0.8) * 0.55 * Math.exp(-t / tau);
      }
    }
    for (const [at, f, a] of o.mech || []) // slide / bolt / pump: small inharmonic metal hits
      add(out, modal(r, [[J(f, 0.05), 1, 0.012], [J(f * 1.83, 0.05), 0.6, 0.008], [J(f * 2.91, 0.05), 0.4, 0.005]], 0.08, { noise: 0.6, noiseHp: 3000, vel: a }), J(at, 0.05));
    if (o.slide) add(out, gain(filt(burstNoise(r, 2600, 1.5, 0.05, 0.14, 0.03), 'hp', 1200), o.slide[1]), o.slide[0]);
    drive(out, o.drive ?? 2.2);
    // space: discrete slapback reflections + a diffuse tail, both darker than the shot
    const refl = (o.refl ?? [[0.065, 0.32, 2600], [0.12, 0.22, 1900], [0.2, 0.13, 1400], [0.32, 0.07, 1000]]).map(([d, g, f]) => [J(d, 0.15), g * (o.room ?? 1), f]);
    const send = filt(filt(out.slice(), 'hp', 220, 0.7), 'hp', 220, 0.7); // outdoor reflections carry little low end
    const e = taps(send, refl), [w] = verb(send, null, { size: o.size ?? 0.55, damp: 0.55 }), wet = o.wet ?? 0.16;
    for (let i = 0; i < out.length; i++) out[i] += e[i] + w[i] * wet;
    return trimTail(norm(filt(out, 'hp', 45, 0.7), -1));
  }
  const GUNS = {
    pistol:  { crack: 1, crackHp: 1800, lp0: 4200, lp1: 800, tau: 0.034, thump: 0.8, th0: 150, th1: 50, thTau: 0.045, mech: [[0.012, 3200, 0.22]], drive: 2.4, len: 1.0 },
    smg:     { crack: 0.8, crackHp: 2200, lp0: 5000, lp1: 1100, tau: 0.02, thump: 0.5, th0: 170, th1: 60, thTau: 0.028, mech: [[0.008, 3800, 0.12]], drive: 2, len: 0.55, wet: 0.08, room: 0.55 },
    rifle:   { crack: 1.4, crackHp: 1500, lp0: 5600, lp1: 900, tau: 0.038, thump: 0.85, th0: 140, th1: 45, thTau: 0.05, mech: [[0.01, 2800, 0.18]], drive: 2.6, len: 0.9, wet: 0.12, room: 0.8 },
    shotgun: { crack: 1.1, crackHp: 1000, lp0: 3200, lp1: 450, tau: 0.07, body: 2, thump: 1, th0: 120, th1: 38, thTau: 0.07, drive: 2.8, len: 1.2, wet: 0.2 },
    sniper:  { crack: 1.8, crackHp: 1200, lp0: 6000, lp1: 700, tau: 0.06, body: 1.8, thump: 1.2, th0: 130, th1: 35, thTau: 0.08, drive: 3, len: 2.2, wet: 0.28, size: 0.85,
               refl: [[0.12, 0.4, 2200], [0.27, 0.28, 1600], [0.48, 0.18, 1100], [0.8, 0.1, 800], [1.2, 0.05, 600]] },
    eshot:   { crack: 0.3, crackHp: 2500, lp0: 2200, lp1: 500, tau: 0.05, thump: 0.6, th0: 110, th1: 40, thTau: 0.07, drive: 1.6, len: 1.2, wet: 0.35 }, // enemy gun: distant, muffled
  };
  function whoosh(r, len, f0, f1, f2, g = 1) { // band sweeping f0 -> f1 -> f2 with a bell-shaped level (air movement)
    const out = buf(len), F = bq('bp', f0, 1.4), n = out.length;
    for (let i = 0; i < n; i++) {
      const u = i / n; if (!(i & 15)) F.set(u < 0.5 ? f0 + (f1 - f0) * u * 2 : f1 + (f2 - f1) * (u - 0.5) * 2, 1.4);
      out[i] = F.run(r() * 2 - 1) * Math.pow(Math.sin(Math.PI * u), 2) * g * 3;
    }
    return out;
  }
  function boom(r) {
    const out = buf(2.8), J = (v, p = 0.12) => v * (1 + (r() * 2 - 1) * p);
    add(out, filt(burstNoise(r, 3000, 0.35, 0.006, 0.05), 'hp', 500), 0, 4); // detonation crack
    { let ph = 0; for (let i = 0; i < out.length; i++) { const t = i / SR; ph += TAU * (28 + 55 * Math.exp(-t / 0.15)) / SR; out[i] += Math.sin(ph) * 0.7 * Math.exp(-t / J(0.45)) * Math.min(1, t / 0.003); } }
    { // fireball roar: brown + white noise, lowpass sweeping down; turbulence = slow random amplitude
      const l1 = bq('lp', 6000, 0.7), l2 = bq('lp', 6000, 0.5), cr = bq('bp', 1400, 0.6); let b = 0, a0 = 1, a1 = r(), k = 0;
      const seg = secs(0.03), tr = J(0.35), td = J(0.7);
      for (let i = 0; i < out.length; i++) {
        const t = i / SR, w = r() * 2 - 1; b = (b + 0.05 * w) / 1.05;
        if (++k >= seg) { k = 0; a0 = a1; a1 = 0.35 + 0.65 * r(); }
        if (!(i & 31)) { const fc = 250 + 5500 * Math.exp(-t / tr); l1.set(fc, 0.7); l2.set(fc, 0.5); }
        const am = a0 + (a1 - a0) * k / seg, e = Math.exp(-t / td) * Math.min(1, t / 0.004);
        out[i] += (l2.run(l1.run(b * 6 + w * 0.5)) * 1.3 + cr.run(w) * 0.9 * Math.exp(-t / 0.3)) * am * e;
      }
    }
    for (let k = 0; k < 70; k++) { // debris: sparse small impacts, denser early
      const t = 0.06 + 1.7 * Math.pow(r(), 2), f = 900 + r() * 5000;
      add(out, modal(r, [[f, 0.5, 0.003 + r() * 0.008], [f * 1.7, 0.3, 0.004]], 0.08, { noise: 2.2, noiseHp: 1500 + r() * 2500, noiseTau: 0.002 + r() * 0.004 }), t, 0.3 * (1 - t / 2) * (0.4 + r() * 0.6));
    }
    drive(out, 2.4);
    const send = filt(out.slice(), 'hp', 150), [w] = verb(send, null, { size: 0.9, damp: 0.45 }), e = taps(send, [[0.09, 0.3, 2000], [0.23, 0.18, 1200], [0.45, 0.1, 800]]);
    for (let i = 0; i < out.length; i++) out[i] += w[i] * 0.35 + e[i];
    return trimTail(norm(filt(out, 'hp', 28), -1));
  }
  function rocket(r) {
    const out = buf(1.3);
    add(out, gun(r, { crack: 0.4, lp0: 2000, lp1: 400, tau: 0.05, thump: 1.2, th0: 110, th1: 40, thTau: 0.08, drive: 2, len: 0.5, wet: 0.05, room: 0.3 }), 0, 0.7);
    const F = bq('bp', 500, 1.1), L = bq('lp', 300); let b = 0;
    for (let i = 0; i < out.length; i++) { // motor: band rising while the rocket leaves, rumble underneath, sputter
      const t = i / SR, w = r() * 2 - 1; b = (b + 0.02 * w) / 1.02;
      if (!(i & 15)) F.set(500 + 2200 * Math.min(1, t / 0.5), 1.1);
      const e = Math.min(1, t / 0.03) * Math.exp(-Math.max(0, t - 0.15) / 0.35);
      out[i] += (F.run(w) * 1.6 + L.run(b * 6) * 0.8 + (r() < 0.004 ? (r() - 0.5) * 2 : 0)) * e;
    }
    const [w] = verb(out, null, { size: 0.7 }); for (let i = 0; i < out.length; i++) out[i] += w[i] * 0.2;
    return trimTail(norm(drive(out, 1.8), -1));
  }
  function hit(r, bone) { // bullet into flesh: dull thud + wet squelch (+ bone crack for headshots)
    const out = buf(0.35), l1 = bq('lp', 2200, 0.7), l2 = bq('lp', 2200, 0.6), sq = bq('bp', 1600, 3); let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR, w = r() * 2 - 1;
      ph += TAU * (55 + 65 * Math.exp(-t / 0.012)) / SR;
      if (!(i & 15)) sq.set(450 + 1300 * Math.exp(-t / 0.03), 4);
      out[i] = l2.run(l1.run(w)) * 2.2 * Math.exp(-t / 0.014) * Math.min(1, t / 0.0005) + Math.sin(ph) * 0.3 * Math.exp(-t / 0.025)
        + (t > 0.002 ? sq.run(w) * (bone ? 3.2 : 2.6) * Math.exp(-(t - 0.002) / 0.04) : 0);
    }
    if (bone) { add(out, filt(burstNoise(r, 3000, 0.8, 0.003, 0.03), 'hp', 2000), 0, 1.5); add(out, modal(r, [[1400 + r() * 300, 0.6, 0.01], [2300, 0.4, 0.008], [3700, 0.3, 0.005]], 0.06, { noise: 0 }), 0.001); }
    const [w] = verb(out, null, { size: 0.3 }); for (let i = 0; i < out.length; i++) out[i] += w[i] * 0.05;
    return trimTail(norm(drive(out, 1.8), -1));
  }
  function clang(r) { // metal shield / armor: dense inharmonic partials that die fast + impact, sometimes a ricochet
    const f0 = 650 + r() * 300, modes = [];
    for (let i = 0; i < 16; i++) { // close pairs beat against each other: the shimmer of real sheet metal
      const f = f0 * (1 + i * 0.58 + r() * 0.45), a = (0.4 + r() * 0.6) / (1 + i * 0.2), tau = 0.015 + 0.1 * r() / (1 + i * 0.15);
      modes.push([f, a, tau], [f * (1.004 + r() * 0.01), a * 0.7, tau * 0.8]);
    }
    const out = modal(r, modes, 0.5, { noise: 1.6, noiseHp: 2500, noiseTau: 0.008 });
    add(out, filt(burstNoise(r, 4500, 0.8, 0.05, 0.25), 'hp', 2500), 0.002, 0.35); // rattle / scrape
    if (r() < 0.5) { let ph = 0; const f0 = 3000 + r() * 800; for (let i = 0; i < secs(0.35); i++) { const t = i / SR; ph += TAU * (f0 - 1100 * t / 0.35) / SR; out[i] += Math.sin(ph) * 0.18 * Math.min(1, t / 0.01) * Math.exp(-t / 0.12); } }
    const [w] = verb(out, null, { size: 0.4 }); for (let i = 0; i < out.length; i++) out[i] += w[i] * 0.08;
    return trimTail(norm(out, -1));
  }
  function thud(r, f0, f1, tau, lpF = 800) { // body impact
    const out = buf(tau * 8), l1 = bq('lp', lpF, 0.7); let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / SR; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.015)) / SR; out[i] = Math.sin(ph) * Math.exp(-t / tau) + l1.run(r() * 2 - 1) * 1.5 * Math.exp(-t / (tau * 0.35)); }
    return out;
  }
  // foley blocks: a sharp mechanical snap, a textured friction scrape, a short inharmonic steel body
  const snap = (r, hp, tau) => { const out = buf(tau * 8), F = bq('hp', hp); for (let i = 0; i < out.length; i++) out[i] = F.run(r() * 2 - 1) * Math.exp(-i / (tau * SR)); return out; };
  function scrape(r, len, f0, f1) {
    const out = buf(len), F = bq('bp', f0, 1.2), n = out.length, grain = secs(0.004); let g = 1;
    for (let i = 0; i < n; i++) {
      const u = i / n; if (!(i & 15)) F.set(f0 + (f1 - f0) * u, 1.2); if (!(i % grain)) g = 0.35 + 0.65 * r(); // rough surface
      out[i] = F.run(r() * 2 - 1) * g * Math.sin(Math.PI * Math.min(1, u * 1.3)) * 2.5;
    }
    return out;
  }
  const steel = (r, f, tau) => modal(r, [[f, 1, tau], [f * 2.18, 0.6, tau * 0.7], [f * 3.4, 0.4, tau * 0.5], [f * 4.9, 0.25, tau * 0.35]], tau * 6 + 0.02, { noise: 0 });
  function withVerb(out, size, wet) { const [w] = verb(out, null, { size }); for (let i = 0; i < out.length; i++) out[i] += w[i] * wet; return out; }
  function reverseSwell(r, len) { // reversed reverb of a noise hit: the classic "suck-in"
    const x = buf(len); add(x, burstNoise(r, 1500, 0.5, 0.01, 0.05), 0, 1);
    const [w] = verb(x, null, { size: 0.9, damp: 0.3 }); return w.reverse();
  }
  const SFX = {
    pistol: [4, r => gun(r, GUNS.pistol)], smg: [4, r => gun(r, GUNS.smg)], rifle: [4, r => gun(r, GUNS.rifle)], shotgun: [3, r => gun(r, GUNS.shotgun)],
    sniper: [2, r => gun(r, GUNS.sniper)], eshot: [3, r => gun(r, GUNS.eshot)], rocket: [2, rocket], boom: [3, boom],
    hit: [4, r => hit(r, false)], head: [3, r => hit(r, true)], block: [4, clang],
    laser: [4, r => { // beam grain (the game retriggers it while firing): buzzing arc + crackle
      const out = buf(0.14), F = bq('bp', 900, 0.8); let p1 = r(), p2 = r();
      for (let i = 0; i < out.length; i++) {
        const t = i / SR, j = 1 + (r() - 0.5) * 0.06; p1 += 110 * j / SR; p2 += 221 * j / SR;
        const x = (p1 % 1) * 2 - 1 + ((p2 % 1) * 2 - 1) * 0.6 + (r() < 0.01 ? (r() - 0.5) * 4 : 0);
        out[i] = (F.run(x) * 2 + Math.sin(TAU * 55 * t) * 0.3) * Math.min(1, t / 0.01, (0.14 - t) / 0.03);
      }
      return norm(out, -2);
    }],
    elaser: [3, r => { // enemy laser bolt: falling FM zap
      const out = buf(0.35); let pc = 0, pm = 0;
      for (let i = 0; i < out.length; i++) { const t = i / SR, f = 500 + 2200 * Math.exp(-t / 0.05); pc += TAU * f / SR; pm += TAU * f * 1.5 / SR; out[i] = Math.sin(pc + 5 * Math.exp(-t / 0.08) * Math.sin(pm)) * Math.exp(-t / 0.1); }
      return trimTail(norm(withVerb(out, 0.5, 0.15), -2));
    }],
    bow: [3, r => { // string twang + wood + arrow air
      const out = buf(0.5); add(out, pluck(r, 110 + r() * 12, 0.35, { bright: 0.75, decay: 0.45, pos: 0.3, vel: 1 }), 0, 2.2);
      add(out, wood(r, 420 + r() * 60), 0, 0.35); add(out, whoosh(r, 0.18, 800, 2500, 1200), 0.02, 0.12);
      return trimTail(norm(withVerb(out, 0.4, 0.1), -2));
    }],
    throw: [3, r => norm(add(whoosh(r, 0.32, 400, 1500, 600), filt(whoosh(r, 0.32, 200, 400, 200), 'lp', 400), 0, 0.5), -3)],
    kick: [3, r => { // melee kick: short swish, then the impact
      const out = buf(0.4); add(out, whoosh(r, 0.07, 500, 1400, 900), 0, 0.4);
      add(out, thud(r, 100, 60, 0.035, 1600), 0.05, 1); add(out, burstNoise(r, 1300, 0.9, 0.01, 0.08), 0.05, 2.4);
      return trimTail(norm(drive(out, 2), -1));
    }],
    hurt: [3, r => { const out = add(add(gain(thud(r, 110, 60, 0.05, 1400), 0.6), burstNoise(r, 1100, 0.9, 0.018, 0.12), 0, 2.2), filt(burstNoise(r, 2600, 0.7, 0.006, 0.05), 'hp', 1500), 0, 1); return trimTail(norm(drive(out, 2), -1)); }],
    die: [1, r => { // body drop + falling sub + dark whoosh, big space
      const out = buf(2.2); add(out, thud(r, 80, 40, 0.12, 600), 0, 1);
      let ph = 0; for (let i = 0; i < secs(1.2); i++) { const t = i / SR; ph += TAU * (28 + 52 * Math.exp(-t / 0.35)) / SR; out[i] += Math.sin(ph) * Math.exp(-t / 0.5) * 0.9; }
      add(out, filt(whoosh(r, 1, 1800, 600, 120), 'lp', 1500), 0.02, 0.5);
      return trimTail(norm(withVerb(drive(out, 1.6), 0.9, 0.35), -1));
    }],
    magout: [2, r => { // release button, magazine slides out of the well, a little rattle as it leaves
      const out = buf(0.4), J = (v, p = 0.06) => v * (1 + (r() * 2 - 1) * p);
      add(out, snap(r, 2500, 0.0015), 0, 0.5); add(out, steel(r, J(2900), 0.012), 0, 0.25);
      add(out, snap(r, 1800, 0.002), 0.03, 0.8); add(out, steel(r, J(1700), 0.02), 0.03, 0.4); add(out, thud(r, 260, 180, 0.012, 700), 0.03, 0.3);
      add(out, scrape(r, 0.2, 1300, 2500), 0.05, 0.3);
      for (let k = 0; k < 3; k++) add(out, steel(r, 2500 + r() * 2000, 0.008), 0.23 + k * 0.025 + r() * 0.01, 0.12);
      return trimTail(norm(filt(out, 'lp', 7000, 0.7), -3));
    }],
    reload: [2, r => { // magazine seated (clack + latch), charging handle back, slams forward
      const out = buf(0.5), J = (v, p = 0.06) => v * (1 + (r() * 2 - 1) * p);
      add(out, thud(r, 220, 140, 0.02, 900), 0, 0.8); add(out, snap(r, 1200, 0.003), 0, 1); add(out, steel(r, J(1300), 0.03), 0, 0.5);
      add(out, snap(r, 2500, 0.0015), 0.035, 0.7); add(out, steel(r, J(3200), 0.01), 0.035, 0.3);
      add(out, scrape(r, 0.07, 2000, 3500), 0.13, 0.4); add(out, steel(r, J(2600), 0.05), 0.14, 0.12); // spring
      add(out, snap(r, 1500, 0.002), 0.22, 1.3); add(out, steel(r, J(1100), 0.04), 0.22, 0.6); add(out, thud(r, 150, 90, 0.03, 700), 0.22, 0.7);
      return trimTail(norm(filt(withVerb(out, 0.3, 0.06), 'lp', 8000, 0.7), -2));
    }],
    click: [2, r => { // tactical switch tick: dry, no ring
      const out = buf(0.06); add(out, filt(snap(r, 1800, 0.0012), 'lp', 6000, 0.7)); add(out, thud(r, 170, 120, 0.01, 900), 0, 0.25);
      return trimTail(norm(out, -4));
    }],
    coin: [4, r => { // pickup: a short, damped metal "chk" and a tiny settle, not a musical note
      const out = buf(0.12), f = 2300 * (1 + (r() * 2 - 1) * 0.05);
      add(out, snap(r, 2000, 0.0015), 0, 0.6); add(out, steel(r, f, 0.025), 0, 0.5); add(out, steel(r, f * 1.3, 0.012), 0.018, 0.2); add(out, snap(r, 2600, 0.001), 0.018, 0.3);
      return trimTail(norm(filt(out, 'lp', 6000, 0.7), -4));
    }],
    buy: [2, r => { // upgrade bought: a heavy mechanical "ka-chunk", like a part locking into the gun
      const out = buf(0.8);
      add(out, snap(r, 1500, 0.002), 0, 0.8); add(out, steel(r, 1600, 0.02), 0, 0.4);
      add(out, thud(r, 110, 60, 0.06, 700), 0.06, 1); add(out, snap(r, 900, 0.004), 0.06, 0.8); add(out, steel(r, 700, 0.06), 0.06, 0.5); add(out, steel(r, 1250, 0.04), 0.06, 0.3);
      return trimTail(norm(withVerb(drive(out, 1.4), 0.35, 0.1), -2));
    }],
    wave: [1, r => { // wave cleared: one cinematic low hit - a big drum under a dark brass power chord
      const out = buf(2.6);
      add(out, tom(r, 62, { tau: 0.4, slap: 0.9, drive: 2 }), 0, 0.8); add(out, snap(r, 900, 0.004), 0, 0.5);
      for (const n of ['D3', 'A3', 'D4']) add(out, horn(r, mtof(note(n)), 1.1, { vel: 0.8, a: 0.05, cut: 2600 }), 0.01, 0.5);
      return trimTail(norm(withVerb(out, 0.9, 0.35), -2));
    }],
    perk: [1, r => { // perk taken: a rising charge that locks in with a heavy hit
      const out = buf(1.6), T = 0.42, F = bq('bp', 300, 1.3), n = secs(T);
      for (let i = 0; i < n; i++) { const u = i / n; if (!(i & 15)) F.set(300 + 2300 * u * u, 1.3); out[i] = F.run(r() * 2 - 1) * u * u * 3; } // riser
      add(out, thud(r, 130, 70, 0.05, 900), T, 0.8); add(out, snap(r, 1500, 0.002), T, 0.7); add(out, steel(r, 900, 0.05), T, 0.35); add(out, steel(r, 1400, 0.04), T, 0.25);
      add(out, filt(burstNoise(r, 6000, 0.7, 0.25, 1), 'hp', 4000), T, 0.15); // air after the hit
      return trimTail(norm(withVerb(out, 0.7, 0.25), -2));
    }],
    slow: [1, r => { // bullet time: suck-in swell, then a deep hit that sinks
      const out = buf(1.8), sw = reverseSwell(r, 0.5); add(out, sw, 0, 1.5 / (peak(sw) || 1));
      let ph = 0; const at = secs(sw.length / SR);
      for (let i = 0; i < secs(1.2) && at + i < out.length; i++) { const t = i / SR; ph += TAU * (30 + 45 * Math.exp(-t / 0.25)) / SR; out[at + i] += Math.sin(ph) * Math.exp(-t / 0.45) * 0.9; }
      add(out, filt(whoosh(r, 0.9, 2400, 700, 150), 'lp', 2000), sw.length / SR, 0.35);
      return trimTail(norm(withVerb(out, 0.8, 0.25), -1));
    }],
  };
  function renderSfx(name, variant = 0) { SR = 44100; const [, fn] = SFX[name]; return fn(rng(0x5eed + variant * 7919 + name.length * 131)); }
  function renderAllSfx() { const o = {}; for (const k in SFX) o[k] = vary(SFX[k][0], (_, i) => renderSfx(k, i)); return o; }

  // ===== music =====
  // A song is rendered into three stereo stems that the game layers live: bed (menu/calm), groove (fight),
  // boss (extra drive). Stems carry dry + reverb-send buses; the reverb tail is folded onto the start so
  // the loop is seamless.
  const TAIL = 3;
  class Song {
    constructor(bpm, beats, bars, seed) {
      this.spb = 60 / bpm; this.beats = beats; this.bars = bars; this.T = bars * beats * this.spb; this.r = rng(seed); this.n = secs(this.T);
      this.st = {}; for (const k of ['bed', 'groove', 'boss']) this.st[k] = { d: [buf(this.T + TAIL), buf(this.T + TAIL)], w: [buf(this.T + TAIL), buf(this.T + TAIL)] };
    }
    put(stem, beat, v, g = 1, pan = 0, send = 0.2, hum = 0.005) {
      const S = this.st[stem], t = Math.max(0, beat * this.spb + gauss(this.r) * hum), i0 = Math.round(t * SR);
      const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * g * 1.414, gr = Math.sin(a) * g * 1.414, n = Math.min(v.length, S.d[0].length - i0);
      const dl = S.d[0], dr = S.d[1], wl = S.w[0], wr = S.w[1];
      for (let i = 0; i < n; i++) { const x = v[i], j = i0 + i; dl[j] += x * gl; dr[j] += x * gr; if (send) { wl[j] += x * gl * send; wr[j] += x * gr * send; } }
    }
    finish(vo) {
      const out = {};
      for (const k in this.st) {
        const S = this.st[k], [wl, wr] = verb(S.w[0], S.w[1], vo);
        const hpf = k === 'groove' ? 38 : 70; // rumble filter
        const ch = [0, 1].map(c => { // filter the whole take first, then fold the tail onto the start (seamless loop)
          const d = S.d[c], w = c ? wr : wl, full = new Float32Array(d.length), o = new Float32Array(this.n);
          for (let i = 0; i < d.length; i++) full[i] = d[i] + w[i];
          filt(filt(full, 'hp', hpf, 0.7), 'hp', hpf, 0.7);
          for (let i = 0; i < full.length; i++) o[i % this.n] += full[i];
          return o;
        });
        out[k] = ch;
      }
      // one gain for all stems: the full mix peaks at -1.5 dBFS and sits near -16 dBFS RMS
      let pk = 0, ss = 0;
      for (let i = 0; i < this.n; i++) for (let c = 0; c < 2; c++) { const x = out.bed[c][i] + out.groove[c][i] + out.boss[c][i]; pk = Math.max(pk, Math.abs(x)); ss += x * x; }
      const g = Math.min(dbg(-1.5) / (pk || 1), dbg(-16) / (Math.sqrt(ss / this.n / 2) || 1));
      for (const k in out) for (const c of out[k]) gain(c, g);
      let bp = 0, bs = 0; for (let i = 0; i < this.n; i++) { const x = out.bed[0][i]; bp = Math.max(bp, Math.abs(x)); bs += x * x; }
      const bedBoost = Math.min(dbg(-2) / (bp || 1), dbg(-20) / (Math.sqrt(bs / this.n) || 1)); // the bed alone (menu) should not be a whisper
      return { sr: SR, len: this.T, stems: out, bedBoost };
    }
  }
  function parse(str) {
    const out = []; let b = 0;
    for (const tok of str.trim().split(/\s+/)) {
      if (tok === '|') continue;
      const [n, d] = tok.split(':'); if (n !== '-') out.push({ b, m: n.split(',').map(note), d: +d }); b += +d;
    }
    return out;
  }
  // melody / chords from "E4:1 G4:.5 -:.5 C4,E4,G4:2" (note:beats, '-' rest, comma = chord)
  function mel(S, stem, beat0, str, inst, o = {}) {
    for (const e of parse(str)) {
      const vel = Math.max(0.1, (o.vel ?? 0.8) * (1 + gauss(S.r) * 0.07) * ((beat0 + e.b) % S.beats === 0 ? 1.08 : 1));
      const v = inst(e.m.map(m => mtof(m + (o.tr || 0))), e.d * S.spb * (o.leg ?? 0.95), vel);
      S.put(stem, beat0 + e.b + (o.late || 0), v, o.g ?? 1, o.pan ?? 0, o.send ?? 0.25, o.hum ?? 0.006);
    }
  }
  const mono = fn => (fs, d, v) => { if (fs.length === 1) return fn(fs[0], d, v); const out = buf(d + 1.5); for (const f of fs) add(out, fn(f, d, v)); return out; };
  // drum lane: one char per step ('X' accent, 'x' hit, 'o' ghost); a pattern longer than a bar spans bars
  function lane(S, stem, bar0, bars, pat, vs, o = {}) {
    const steps = o.steps ?? 16, sb = S.beats / steps;
    for (let bar = 0; bar < bars; bar++) for (let s = 0; s < steps; s++) {
      const ch = pat[(bar * steps + s) % pat.length], v = ch === 'X' ? 1 : ch === 'x' ? 0.7 : ch === 'o' ? 0.32 : 0;
      if (!v) continue;
      S.put(stem, (bar0 + bar) * S.beats + s * sb + (s % 2 ? (o.swing || 0) * sb : 0), vs[(S.r() * vs.length) | 0], v * (o.g ?? 1) * (1 + gauss(S.r) * 0.06), o.pan ?? 0, o.send ?? 0.12, o.hum ?? 0.003);
    }
  }
  // pads: consecutive equal chords are held as one note
  function pads(S, stem, chords, inst, o = {}) {
    for (let b = 0; b < chords.length;) {
      let e = b + 1; while (e < chords.length && chords[e].join() === chords[b].join()) e++;
      S.put(stem, b * S.beats, inst(chords[b].map(n => mtof(note(n))), (e - b) * S.beats * S.spb, o.vel ?? 0.6), o.g ?? 1, o.pan ?? 0, o.send ?? 0.4, 0.01);
      b = e;
    }
  }
  const C = s => s.split(' ').map(c => c.split(',')); // "E3,B3,G4 C3,G3,E4" -> chords

  const SONGS = {
    // modern city, zombies: dark palm-muted rock, E minor
    city(seed) {
      const S = new Song(116, 4, 16, seed), r = S.r;
      const roots = 'E2 E2 C2 D2 E2 E2 C2 B1 A1 A1 C2 G1 A1 C2 B1 B1'.split(' ').map(note);
      pads(S, 'bed', C('E3,B3,G4 E3,B3,G4 C3,G3,E4 D3,A3,F#4 E3,B3,G4 E3,B3,G4 C3,G3,E4 B2,F#3,D#4 A2,E3,C4 A2,E3,C4 C3,G3,E4 G2,D3,B3 A2,E3,C4 C3,G3,E4 B2,F#3,D#4 B2,F#3,D#4'),
        (fs, d, v) => saws(r, fs, d, { voices: 3, spread: 14, cut: 2600, a: 0.6, d: 0.5, s: 0.9, r: 0.9, vel: v }), { g: 0.4 });
      mel(S, 'bed', 0, 'E5:1.5 G5:.5 F#5:1 B4:1 | E5:1.5 G5:.5 A5:1 G5:1 | E5:2 D5:1 C5:1 | D5:3 -:1 | E5:1.5 G5:.5 F#5:1 B4:1 | E5:1.5 G5:.5 B5:1 A5:1 | G5:2 F#5:1 E5:1 | D#5:4' +
        ' | A4:2 C5:1 E5:1 | A5:3 -:1 | G5:1.5 E5:.5 C5:2 | D5:4 | C5:2 E5:1 A5:1 | G5:3 -:1 | F#5:2 D#5:2 | B4:4',
        mono((f, d, v) => fm(r, f, d, { ratio: 1, index: 2.2, iDec: 0.45, a: 0.003, d: 1.2, s: 0.25, r: 0.5, vel: v })), { g: 0.5, pan: 0.2, send: 0.45 });
      const kit = { k: vary(4, () => kick(r)), s: vary(4, () => snare(r)), h: vary(6, () => hat(r)), c: vary(2, () => crash(r)), t: vary(3, () => tom(r, 88, { tau: 0.16, bend: 0.9 })) };
      const gtr = (root, dur, mute, vel) => { // distorted power chord through a cab-like EQ
        const x = buf(dur + 0.2); for (const m of [0, 7, 12]) add(x, pluck(r, mtof(root + m), dur, { bright: mute ? 0.35 : 0.8, decay: mute ? 0.25 : 2.5, vel, rel: 0.05 }));
        drive(x, 7); filt(x, 'hp', 110); filt(x, 'pk', 1800, 1, -4); filt(x, 'lp', 4200, 0.9); return filt(x, 'lp', 5500, 0.6);
      };
      for (let b = 0; b < 16; b++) {
        const fill = b % 8 === 7, R = roots[b] < 40 ? roots[b] + 12 : roots[b], B = b >= 8;
        lane(S, 'groove', b, 1, 'x.....x.x.x.....', kit.k, { g: 0.6 });
        lane(S, 'groove', b, 1, fill ? '....X.......XoXx' : '....X.......X...', kit.s, { g: 0.7, send: 0.2 });
        lane(S, 'groove', b, 1, fill ? 'x.x.x.x.x.x.....' : B ? 'x.X.x.X.x.X.x.X.' : 'x.x.x.x.x.x.x.x.', kit.h, { g: 0.22, pan: 0.3 });
        if (b % 8 === 0) lane(S, 'groove', b, 1, 'X...............', kit.c, { g: 0.4, pan: -0.25, send: 0.2 });
        const pat = B ? 'X.......x.x.x.x.' : 'X.x.x.x.x.x.x.x.';
        for (let s = 0; s < 16; s += 2) if (pat[s] !== '.') {
          const open = B && s === 0;
          S.put('groove', b * 4 + s / 4, gtr(R, open ? 2 * S.spb : 0.2, !open, pat[s] === 'X' ? 0.9 : 0.7), 0.3, s % 4 ? 0.35 : -0.35, 0.08, 0.004);
          S.put('groove', b * 4 + s / 4, pluck(r, mtof(roots[b]), 0.22, { bright: 0.35, decay: 1, vel: 0.8, pos: 0.2 }), 0.55, 0, 0.02, 0.004);
        }
        lane(S, 'boss', b, 1, 'X.x.x.x.X.x.x.xx', kit.t, { g: 0.35, send: 0.25 });
        lane(S, 'boss', b, 1, 'xxxxxxxxxxxxxxxx', kit.h, { g: 0.12, pan: -0.3 });
        if (b % 2 === 0) mel(S, 'boss', b * 4, 'E3,B3,E4:1 -:1.5 E3,B3,E4:.5 -:1', mono((f, d, v) => horn(r, f, d, { vel: v })), { g: 0.35, tr: roots[b] - 40, send: 0.3 });
      }
      return S.finish({ size: 0.6, damp: 0.4 });
    },
    // prehistoric jungle: tribal toms, shaker, marimba ostinato, breathy pan flute; A minor
    jungle(seed) {
      const S = new Song(100, 4, 16, seed), r = S.r;
      const ch = 'A A G A A A F G C G A A F G A A'.split(' '), root = { A: 45, G: 43, F: 41, C: 48 };
      for (let b = 0; b < 16; b++) {
        const R = root[ch[b]], minor = ch[b] === 'A';
        const arp = [R + 12, R + 19, R + 24, R + (minor ? 15 : 16), R + 19, R + 24, R + 19, R + (minor ? 15 : 16)];
        arp.forEach((m, i) => S.put('bed', b * 4 + i * 0.5, marimba(r, mtof(m), 0.3, 0.45 + (i % 2 ? 0 : 0.15)), 0.5, i % 2 ? 0.3 : -0.3, 0.3));
        [R, -1, R, R + 7, -1, R + 10, R, -1].forEach((m, i) => { if (m > 0) S.put('groove', b * 4 + i * 0.5, marimba(r, mtof(m), 0.4, 0.85), 0.45, 0, 0.1); });
      }
      mel(S, 'bed', 0, 'E5:2 D5:1 C5:1 | A4:3 -:1 | G4:1 A4:1 C5:1 D5:1 | E5:4 | G5:2 E5:1 D5:1 | C5:2 A4:2 | D5:1.5 C5:.5 A4:1 G4:1 | A4:4' +
        ' | C5:2 E5:2 | D5:1 B4:1 G4:2 | A4:1.5 C5:.5 E5:2 | A5:4 | F5:2 E5:1 C5:1 | D5:2 B4:2 | E5:1 D5:1 C5:1 B4:1 | A4:4',
        mono((f, d, v) => flute(r, f, d, { vel: v, air: 0.35, h2: 0.25 })), { g: 0.6, pan: 0.15, send: 0.4 });
      const kit = { lo: vary(4, () => tom(r, 75, { tau: 0.4, slap: 0.4 })), hi: vary(4, () => tom(r, 150, { tau: 0.22, slap: 0.5 })), sh: vary(6, () => shaker(r)), wd: vary(4, () => wood(r, 520 + r() * 40)),
        tk: vary(3, () => tom(r, 52, { tau: 0.8, drive: 2.2, slap: 0.6, skin: 1200 })) };
      for (let b = 0; b < 16; b++) {
        lane(S, 'groove', b, 1, b % 4 === 3 ? 'X.....x.X..xX.xx' : 'X.....x.X...x...', kit.lo, { g: 0.32, send: 0.2 });
        lane(S, 'groove', b, 1, '...x..x....x.x..', kit.hi, { g: 0.4, pan: 0.3, send: 0.2 });
        lane(S, 'groove', b, 1, 'xoxoXoxoxoxoXoxo', kit.sh, { g: 0.45, pan: -0.35, swing: 0.12 });
        lane(S, 'groove', b, 1, 'x..x..x...x..x..', kit.wd, { g: 0.5, pan: 0.45 });
        lane(S, 'boss', b, 1, 'X.x.X.x.X.x.XxXx', kit.tk, { g: 0.4, send: 0.3 });
      }
      for (let b = 0; b < 16; b += 2) S.put('boss', b * 4, horn(r, mtof(45), 2 * 4 * S.spb * 0.9, { vel: 0.8, index: 3.5, a: 0.3, cut: 1800 }), 0.35, 0, 0.3);
      return S.finish({ size: 0.75, damp: 0.5 });
    },
    // medieval castle: spiccato strings, timpani, march snare, harp, recorder, horns; D harmonic minor
    castle(seed) {
      const S = new Song(92, 4, 16, seed), r = S.r;
      const chords = C('D3,A3,F4 D3,A3,F4 Bb2,F3,D4 A2,E3,C#4 D3,A3,F4 G2,D3,Bb3 A2,E3,C#4 A2,E3,C#4 G2,D3,Bb3 D3,A3,F4 Bb2,F3,D4 A2,E3,C#4 G2,D3,Bb3 D3,A3,F4 A2,E3,C#4 D3,A3,F4');
      pads(S, 'bed', chords, (fs, d, v) => saws(r, fs, d, { voices: 3, spread: 12, cut: 3200, a: 0.5, d: 0.4, s: 0.85, r: 0.8, vel: v, vib: 0.003 }), { g: 0.35 });
      chords.forEach((c, b) => { // harp arpeggio
        const ms = c.map(note); [ms[0] + 12, ms[1] + 12, ms[2] + 12, ms[1] + 24, ms[2] + 12, ms[1] + 12, ms[0] + 24, ms[2] + 12]
          .forEach((m, i) => S.put('bed', b * 4 + i * 0.5, pluck(r, mtof(m), 1.2, { bright: 0.65, decay: 2.5, vel: 0.55, pos: 0.3 }), 0.5, -0.35 + i * 0.1, 0.35));
      });
      mel(S, 'bed', 0, 'D5:1.5 E5:.5 F5:1 A5:1 | G5:1 F5:1 E5:2 | F5:1 D5:1 Bb4:2 | C#5:4 | D5:1.5 E5:.5 F5:1 G5:1 | A5:1 Bb5:1 G5:2 | E5:1 F5:1 G5:1 E5:1 | A4:4',
        mono((f, d, v) => flute(r, f, d, { vel: v, air: 0.15, h2: 0.35, h3: 0.15, vib: 0.004 })), { g: 0.6, pan: 0.2, send: 0.4 });
      const spic = (f, d, v) => saws(r, f, d, { voices: 2, spread: 8, cut: 2800, a: 0.006, d: 0.1, s: 0.3, r: 0.08, vel: v });
      chords.forEach((c, b) => {
        const ms = c.map(note);
        [ms[0], ms[1], ms[0] + 12, ms[1], ms[0], ms[1], ms[0] + 12, ms[2]].forEach((m, i) => S.put('groove', b * 4 + i * 0.5, spic(mtof(m), 0.2, i % 2 ? 0.55 : 0.8), 0.45, i % 2 ? 0.3 : -0.3, 0.2));
        S.put('groove', b * 4, saws(r, mtof(ms[0] - 12), 4 * S.spb * 0.95, { voices: 2, cut: 900, a: 0.08, s: 0.8, r: 0.2, vel: 0.8 }), 0.5, 0, 0.15);
      });
      const kit = { ti: vary(3, () => tom(r, 73, { tau: 0.9, bend: 0.1, partial: 1, slap: 0.25, skin: 1500 })), ta: vary(3, () => tom(r, 55, { tau: 0.9, bend: 0.1, partial: 1, slap: 0.25, skin: 1500 })),
        sn: vary(5, () => snare(r, { tt: 0.03, ntau: 0.09 })), cr: vary(2, () => crash(r)) };
      for (let b = 0; b < 16; b++) {
        lane(S, 'groove', b, 1, b % 4 === 3 ? 'X.......x.x.xxxx' : 'X.......x.......', kit.ti, { g: 0.4, send: 0.35 });
        lane(S, 'groove', b, 1, 'x...x.x.x...x.x.', kit.sn, { g: 0.45, send: 0.25, pan: 0.2 });
        lane(S, 'boss', b, 1, 'X.x.X.x.X.x.X.xx', kit.ta, { g: 0.35, send: 0.35 });
      }
      mel(S, 'groove', 32, 'G4:2 A4:1 Bb4:1 | A4:2 F4:2 | F4:1 G4:1 A4:1 Bb4:1 | A4:4 | Bb4:2 A4:1 G4:1 | F4:2 D4:2 | E4:1 F4:1 G4:1 E4:1 | D4:4',
        mono((f, d, v) => horn(r, f, d, { vel: v })), { g: 0.5, pan: -0.15, send: 0.35 });
      pads(S, 'boss', chords.map(c => c.map(n => { const m = note(n) + 12; return 'C C# D D# E F F# G G# A A# B'.split(' ')[m % 12] + (Math.floor(m / 12) - 1); })),
        (fs, d, v) => choir(r, fs, d, { vel: v }), { g: 0.45, send: 0.5 });
      lane(S, 'boss', 0, 16, 'X...............', kit.cr, { g: 0.3, send: 0.3 });
      return S.finish({ size: 0.85, damp: 0.35, pre: 0.02 });
    },
    // ancient desert: darbuka maqsum, riq, oud with tremolo, drone, ney; E hijaz
    desert(seed) {
      const S = new Song(100, 4, 16, seed), r = S.r;
      const oud = (f, d, v) => pluck(r, f, d, { bright: 0.55, decay: 1.4, vel: v, pos: 0.18, body: [[180, 1.5, 5], [420, 2, 3]] });
      for (let b = 0; b < 16; b += 2) for (const [m, at] of [[40, 0], [47, 1], [52, 2], [47, 3]]) S.put('bed', b * 4 + at * 2, pluck(r, mtof(m), 3.5, { bright: 0.35, decay: 5, vel: 0.5, pos: 0.45 }), 0.3, at % 2 ? 0.35 : -0.35, 0.35);
      mel(S, 'bed', 32, 'E5:4 | F5:4 | E5:2 D5:2 | C5:4 | B4:2 C5:2 | D5:2 C5:1 B4:1 | G#4:2 A4:2 | E4:4',
        mono((f, d, v) => flute(r, f, d, { vel: v, air: 0.45, h2: 0.3, vib: 0.007, a: 0.12 })), { g: 0.6, pan: 0.2, send: 0.5 });
      const line = 'E4:.5 F4:.5 G#4:1 A4:.5 G#4:.5 F4:1 | E4:3 -:1 | F4:.5 G#4:.5 A4:1 B4:.5 C5:.5 B4:1 | A4:.5 G#4:.5 F4:.5 G#4:.5 E4:2 | D4:.5 E4:.5 F4:1 A4:1 G#4:.5 F4:.5 | E4:.5 F4:.5 D4:1 E4:2 | A4:.5 G#4:.5 F4:.5 E4:.5 F4:1 D4:1 | E4:4' +
        ' | A4:1 C5:1 E5:1 D5:.5 C5:.5 | B4:.5 C5:.5 A4:3 | D5:1 C5:.5 B4:.5 A4:1 F4:1 | A4:2 D4:2 | F4:.5 G#4:.5 A4:.5 B4:.5 C5:1 A4:1 | G#4:.5 A4:.5 F4:1 E4:2 | G#4:.5 A4:.5 B4:.5 A4:.5 G#4:.5 F4:.5 E4:1 | E4:4';
      for (const e of parse(line)) { // long notes are tremolo-picked, as an oud player would
        const reps = e.d >= 2 ? e.d * 4 : 1;
        for (let k = 0; k < reps; k++) S.put('groove', e.b + k * e.d / reps, oud(mtof(e.m[0]), reps > 1 ? e.d / reps * S.spb : e.d * S.spb * 0.95, (reps > 1 ? 0.5 : 0.85) * (1 + gauss(r) * 0.08)), 0.8, 0.15, 0.3, 0.006);
      }
      const roots = [40, 40, 41, 40, 38, 38, 41, 40, 45, 45, 38, 38, 41, 41, 40, 40];
      const kit = { d: vary(4, () => tom(r, 92, { tau: 0.28, slap: 0.2, bend: 0.3 })), t: vary(5, () => tek(r)), q: vary(5, () => jingles(r)), fr: vary(3, () => tom(r, 62, { tau: 0.5, slap: 0.5, drive: 2 })) };
      for (let b = 0; b < 16; b++) {
        lane(S, 'groove', b, 1, 'X.......x.......', kit.d, { g: 0.55, send: 0.15 });
        lane(S, 'groove', b, 1, b % 4 === 3 ? '..X...x.o.X.xoxo' : '..X...x.....X...', kit.t, { g: 0.55, pan: 0.25, send: 0.15 });
        lane(S, 'groove', b, 1, '.o.o.o...o.o.o.o', kit.t, { g: 0.35, pan: 0.25 });
        lane(S, 'groove', b, 1, 'x.x.x.x.x.x.x.x.', kit.q, { g: 0.18, pan: -0.4 });
        [0, 2, 3].forEach(q => S.put('groove', b * 4 + q, pluck(r, mtof(roots[b]), 0.5, { bright: 0.4, decay: 1.2, vel: 0.8 }), 0.4, 0, 0.05));
        lane(S, 'boss', b, 1, 'X.x.X.xxX.x.X.xx', kit.fr, { g: 0.4, send: 0.3 });
      }
      mel(S, 'boss', 0, ('E2:1 E2:.5 F2:.5 E2:1 G#2:.5 F2:.5 | ').repeat(16), mono((f, d, v) => saws(r, f, d, { voices: 3, spread: 10, cut: 2200, a: 0.01, d: 0.2, s: 0.7, r: 0.1, vel: v })), { g: 0.25, send: 0.15, tr: 12 });
      return S.finish({ size: 0.7, damp: 0.3, pre: 0.015 });
    },
    // wild west: train-beat brushes, strummed acoustic, upright bass, twangy baritone, whistle; A minor
    west(seed) {
      const S = new Song(112, 4, 16, seed), r = S.r;
      const shapes = { Am: [45, 52, 57, 60, 64], G: [43, 47, 50, 55, 59], F: [41, 48, 53, 57, 60], E: [40, 47, 52, 56, 59], Dm: [50, 57, 62, 65, 69], C: [48, 52, 55, 60, 64] };
      const prog = 'Am Am G G F F E E Dm Am E Am Dm Am E E'.split(' '), bass = { Am: 45, G: 43, F: 41, E: 40, Dm: 38, C: 36 };
      prog.forEach((c, b) => { // fingerpicked bed
        const s = shapes[c]; [s[0], s[2], s[3], s[4], s[3], s[2], s[3], s[1]].forEach((m, i) => S.put('bed', b * 4 + i * 0.5, pluck(r, mtof(m), 1, { bright: 0.45, decay: 2, vel: 0.5 + (i % 2 ? 0 : 0.12), pos: 0.2, body: [[110, 1.2, 4], [230, 1.5, 3]] }), 0.35, -0.2 + i * 0.05, 0.3));
      });
      mel(S, 'bed', 32, 'A5:2 E5:1 A5:1 | C6:3 B5:1 | A5:2 E5:1 C5:1 | E5:4 | D5:2 F5:1 A5:1 | C6:2 B5:1 A5:1 | G#5:2 B5:2 | A5:4',
        mono((f, d, v) => flute(r, f, d, { vel: v, air: 0.1, h2: 0.02, h3: 0, vib: 0.012, a: 0.04 })), { g: 0.35, pan: 0.25, send: 0.45 });
      const kit = { br: vary(6, () => brush(r)), k: vary(3, () => kick(r, { f0: 110, tau: 0.16, click: 0.1 })), rim: vary(3, () => wood(r, 900)), g: vary(3, () => tom(r, 95, { tau: 0.3 })) };
      prog.forEach((c, b) => {
        lane(S, 'groove', b, 1, 'xoxoXoxoxoxoXoxo', kit.br, { g: 0.35, pan: 0.2, swing: 0.1 });
        lane(S, 'groove', b, 1, 'x.......x.......', kit.k, { g: 0.45 });
        [[0, 0], [2, 7]].forEach(([q, iv]) => S.put('groove', b * 4 + q, pluck(r, mtof(bass[c] - 12 + iv), 0.7, { bright: 0.4, decay: 1.5, vel: 0.85, pos: 0.25 }), 0.45, 0, 0.05));
        'D.D.U.DU'.split('').forEach((st, i) => { if (st !== '.') S.put('groove', b * 4 + i * 0.5, strum(r, shapes[c], 0.4, { up: st === 'U', vel: st === 'D' ? 0.6 : 0.45, bright: 0.6, decay: 1.2, spread: 0.01 }), 0.28, -0.35, 0.15, 0.004); });
        lane(S, 'boss', b, 1, 'x.xxx.xxx.xxx.xx', kit.g, { g: 0.3, send: 0.25 });
      });
      const twang = (f, d, v) => { const x = pluck(r, f, d, { bright: 0.85, decay: 2.5, vel: v, pos: 0.1 }); for (let i = 0; i < x.length; i++) x[i] *= 1 - 0.3 * (0.5 + 0.5 * Math.sin(TAU * 6 * i / SR)); return x; };
      mel(S, 'groove', 0, 'A3:1.5 C4:.5 E4:1 A4:1 | G4:1.5 E4:.5 D4:2 | G3:1.5 B3:.5 D4:1 G4:1 | F4:1.5 D4:.5 B3:2 | F3:1.5 A3:.5 C4:1 F4:1 | E4:1.5 C4:.5 A3:2 | E3:1 G#3:1 B3:1 E4:1 | D4:1 C4:1 B3:2',
        mono(twang), { g: 0.5, pan: 0.2, send: 0.5 });
      for (let b = 0; b < 16; b += 4) S.put('boss', b * 4, bell(r, mtof(57), 0.7), 0.4, 0.3, 0.4);
      mel(S, 'boss', 0, 'A2,E3:2 A2,E3:2 | G2,D3:4 | F2,C3:4 | E2,B2:4 | '.repeat(4), mono((f, d, v) => horn(r, f, d, { vel: v, cut: 2200 })), { g: 0.25, send: 0.3, tr: 12 });
      return S.finish({ size: 0.65, damp: 0.3, pre: 0.03 });
    },
    // pirates: 6/8 shanty; stomps, claps, accordion oom-pah, fiddle, tin whistle; D dorian
    sea(seed) {
      const S = new Song(228, 6, 16, seed), r = S.r; // 6 eighths per bar
      const prog = 'Dm C Dm Am Dm C F Dm F C Dm Am F C Am Dm'.split(' ');
      const ch = { Dm: ['D4', 'F4', 'A4'], C: ['C4', 'E4', 'G4'], Am: ['A3', 'C4', 'E4'], F: ['F3', 'A3', 'C4'] }, bass = { Dm: 38, C: 36, Am: 45, F: 41 };
      const acc = (fs, d, v) => accordion(r, fs, d, v);
      pads(S, 'bed', prog.map(c => ch[c]), (fs, d, v) => accordion(r, fs, d, v * 0.7), { g: 0.35, send: 0.35 });
      mel(S, 'bed', 48, 'A5:3 G5:3 | F5:6 | E5:3 D5:3 | C5:6 | A5:3 G5:3 | F5:3 E5:3 | D5:3 C5:3 | D5:6',
        mono((f, d, v) => flute(r, f, d, { vel: v, air: 0.18, h2: 0.1, vib: 0.008, a: 0.03 })), { g: 0.3, pan: -0.25, send: 0.4 });
      const kit = { st: vary(4, () => stomp(r)), cl: vary(4, () => clap(r)), tb: vary(4, () => jingles(r)), bo: vary(4, () => tom(r, 85, { tau: 0.25, slap: 0.5 })) };
      prog.forEach((c, b) => {
        lane(S, 'groove', b, 1, 'X..x..', kit.st, { steps: 6, g: 0.55, send: 0.15 });
        lane(S, 'groove', b, 1, '...X..', kit.cl, { steps: 6, g: 0.4, pan: 0.3, send: 0.25 });
        lane(S, 'groove', b, 1, 'x.xx.x', kit.tb, { steps: 6, g: 0.14, pan: -0.4 });
        S.put('groove', b * 6, accordion(r, [mtof(bass[c])], 0.4, 0.8), 0.4, 0, 0.1);
        S.put('groove', b * 6 + 3, accordion(r, [mtof(bass[c] + 7)], 0.4, 0.7), 0.4, 0, 0.1);
        for (const q of [1, 2, 4, 5]) S.put('groove', b * 6 + q, acc(ch[c].map(n => mtof(note(n))), 0.18, q === 1 || q === 4 ? 0.6 : 0.45), 0.3, -0.15, 0.12);
        lane(S, 'boss', b, 1, 'xxXxxX', kit.bo, { steps: 6, g: 0.35, send: 0.2 });
      });
      mel(S, 'groove', 0, 'D5:3 A4:2 D5:1 | C5:3 G4:2 C5:1 | D5:2 E5:1 F5:2 E5:1 | E5:3 A4:3 | D5:3 A4:2 D5:1 | C5:2 D5:1 E5:3 | F5:2 E5:1 C5:2 E5:1 | D5:6' +
        ' | F5:3 E5:2 D5:1 | E5:3 G5:3 | A5:2 G5:1 F5:2 E5:1 | E5:3 C5:3 | F5:2 G5:1 A5:2 F5:1 | G5:2 E5:1 C5:3 | A4:2 C5:1 E5:3 | D5:6',
        mono((f, d, v) => fiddle(r, f, d, v)), { g: 0.55, pan: 0.2, send: 0.3 });
      mel(S, 'boss', 0, 'D2,A2:6 | '.repeat(16), mono((f, d, v) => horn(r, f, d, { vel: v, cut: 2000, index: 3 })), { g: 0.22, send: 0.3, tr: 12 });
      return S.finish({ size: 0.6, damp: 0.45 });
    },
    // cyber future: synthwave; four-on-the-floor, gated snare, 16th arp bass, supersaw pad, glide lead; F minor
    future(seed) {
      const S = new Song(124, 4, 16, seed), r = S.r;
      const prog = 'Fm Fm Db Db Ab Ab Eb Eb Db Eb Fm Fm Db Eb C C'.split(' ');
      const ch = { Fm: ['F3', 'Ab3', 'C4', 'F4'], Db: ['Db3', 'F3', 'Ab3', 'Db4'], Ab: ['Ab2', 'C3', 'Eb3', 'Ab3'], Eb: ['Eb3', 'G3', 'Bb3', 'Eb4'], C: ['C3', 'E3', 'G3', 'C4'] };
      pads(S, 'bed', prog.map(c => ch[c]), (fs, d, v) => saws(r, fs, d, { voices: 4, spread: 18, cut: 3200, a: 0.7, d: 0.5, s: 0.85, r: 1, vel: v }), { g: 0.4, send: 0.5 });
      prog.forEach((c, b) => ch[c].concat(ch[c].slice(1, 3).reverse()).slice(0, 4).forEach((n, i) => S.put('bed', b * 4 + i, fm(r, mtof(note(n) + 24), 0.5, { ratio: 3.5, index: 1.4, iDec: 0.25, a: 0.002, d: 0.6, s: 0, r: 0.4, vel: 0.35 }), 0.4, i % 2 ? 0.4 : -0.4, 0.5)));
      mel(S, 'bed', 0, 'F5:2 Ab5:1 G5:1 | F5:3 C5:1 | Db5:2 F5:1 Eb5:1 | Db5:3 Ab4:1 | C5:2 Eb5:1 Db5:1 | C5:3 Ab4:1 | Bb4:2 C5:1 Db5:1 | Eb5:4',
        mono((f, d, v) => saws(r, f, d, { voices: 2, spread: 6, pulse: 0.5, cut: 2400, a: 0.03, s: 0.8, r: 0.3, vel: v, vib: 0.005 })), { g: 0.28, pan: -0.15, send: 0.5 });
      const kit = { k: vary(3, () => kick(r, { f0: 170, f1: 45, tau: 0.25, drive: 2 })), s: vary(3, () => snare(r, { nf: 3000, ntau: 0.1 })), h: vary(6, () => hat(r, { tau: 0.03 })), o: vary(3, () => hat(r, { open: 1, tau: 0.18 })), c: vary(2, () => clap(r)) };
      const root = { Fm: 41, Db: 37, Ab: 44, Eb: 39, C: 36 };
      prog.forEach((c, b) => {
        lane(S, 'groove', b, 1, 'X...x...x...x...', kit.k, { g: 0.55 });
        lane(S, 'groove', b, 1, '....X.......X...', kit.s, { g: 0.55, send: 0.55 });
        lane(S, 'groove', b, 1, '....x.......x...', kit.c, { g: 0.3, send: 0.4, pan: 0.2 });
        lane(S, 'groove', b, 1, 'xoxo.oxoxoxo.oxo', kit.h, { g: 0.2, pan: 0.35 });
        lane(S, 'groove', b, 1, '..x...x...x...x.', kit.o, { g: 0.12, pan: -0.3 });
        [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 7, 10].forEach((iv, i) => S.put('groove', b * 4 + i * 0.25, saws(r, mtof(root[c] + iv), 0.13, { voices: 1, cut: 300, fenv: 2600, fdec: 0.06, q: 2.5, a: 0.002, d: 0.1, s: 0.6, r: 0.04, vel: i % 4 ? 0.65 : 0.9 }), 0.5, 0, 0.05, 0.002));
        lane(S, 'boss', b, 1, 'X.x.X.x.X.xxX.xx', kit.k, { g: 0.3 });
        S.put('boss', b * 4, saws(r, [mtof(root[c]), mtof(root[c]) * 1.006], 4 * S.spb * 0.95, { voices: 1, cut: 1400, q: 1.5, a: 0.01, s: 0.9, r: 0.1, vel: 0.9 }), 0.3, 0, 0.1);
      });
      mel(S, 'groove', 32, 'C5:1.5 Ab4:.5 F4:2 | Eb5:1.5 C5:.5 Bb4:2 | Ab4:1 Bb4:1 C5:1 Eb5:1 | F5:4 | Eb5:1.5 Db5:.5 C5:2 | Bb4:1.5 C5:.5 G4:2 | C5:1 Db5:1 E5:1 G5:1 | C5:4',
        mono((f, d, v) => saws(r, f, d, { voices: 2, spread: 8, cut: 3200, a: 0.01, s: 0.85, r: 0.25, vel: v, vib: 0.006, glide: 0.04, glideFrom: 0.94 })), { g: 0.4, pan: 0.1, send: 0.45 });
      return S.finish({ size: 0.8, damp: 0.3, pre: 0.02 });
    },
  };
  function renderMusic(key, seed = 7) { SR = 32000; return SONGS[key](seed); }

  // one render request from the game: { type: 'sfx' } or { type: 'music', key }; returns the result + its transferables
  function job(m) {
    if (m.type === 'sfx') { const vars = vary(SFX[m.name][0], (_, i) => renderSfx(m.name, i)); return { res: { name: m.name, sr: 44100, vars }, tr: vars.map(x => x.buffer) }; }
    const s = renderMusic(m.key);
    return { res: { key: m.key, sr: s.sr, bedBoost: s.bedBoost, stems: s.stems }, tr: Object.values(s.stems).flat().map(x => x.buffer) };
  }
  return { SFX: Object.keys(SFX), SONGS: Object.keys(SONGS), renderSfx, renderAllSfx, renderMusic, job };
})();
if (typeof module !== 'undefined') module.exports = DSP;
