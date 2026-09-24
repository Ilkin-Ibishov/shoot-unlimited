'use strict';
// Utils, synth audio, procedural rigs (pose + draw) and verlet ragdolls.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l, 0, 1) : 0;
  const x = a[0] + dx * t - px, y = a[1] + dy * t - py;
  return Math.sqrt(x * x + y * y);
}
// ===== colors =====
const INK = '#151822'; // outline color
const _rgb = new Map(), _shade = new Map();
function hexRgb(h) {
  let v = _rgb.get(h); if (v) return v;
  let s = h.slice(1); if (s.length === 3) s = s.replace(/./g, '$&$&');
  const n = parseInt(s, 16); v = [n >> 16 & 255, n >> 8 & 255, n & 255]; _rgb.set(h, v); return v;
}
const toHex = a => '#' + a.map(x => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
function shade(h, f) { // f < 1 darker, f > 1 lighter
  if (h[0] !== '#' || f === 1) return h;
  const k = h + f; let v = _shade.get(k); if (v) return v;
  v = toHex(hexRgb(h).map(x => f < 1 ? x * f : x + (255 - x) * (f - 1))); _shade.set(k, v); return v;
}
const mix = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return toHex(A.map((x, i) => x + (B[i] - x) * t)); };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };

// soft radial sprite, tinted per color (cached); used for glow, smoke, light
const _glow = new Map();
function glowSprite(color) {
  let s = _glow.get(color); if (s) return s;
  s = document.createElement('canvas'); s.width = s.height = 64;
  const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, 64, 64);
  _glow.set(color, s); return s;
}
function glow(c, x, y, r, color, a) { c.globalAlpha = a; c.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); }
// outlined box
function obox(c, x, y, w, h, color) { c.fillStyle = INK; c.fillRect(x - 1.3, y - 1.3, w + 2.6, h + 2.6); c.fillStyle = color; c.fillRect(x, y, w, h); }

function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return '' + n;
  const u = ['K', 'M', 'B', 'T']; let i = -1;
  while (n >= 1000 && i < 3) { n /= 1000; i++; }
  return (n < 100 ? n.toFixed(1) : n.toFixed(0)).replace('.0', '') + u[i];
}

// ===== synth audio (no asset files) =====
const Sfx = {
  ac: null, out: null, nb: null, on: true, last: {},
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const a = this.ac = new AC();
    this.out = a.createGain(); this.out.gain.value = 0.45;
    this.out.connect(a.createDynamicsCompressor()).connect(a.destination);
    const b = a.createBuffer(1, a.sampleRate, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.nb = b;
  },
  noise(t, dur, f, type, q, vol) {
    const a = this.ac, s = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.nb; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  tone(t, dur, f1, f2, type, vol) {
    const a = this.ac, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  },
  play(n) {
    if (!this.on || !this.ac) return;
    const t = this.ac.currentTime;
    if (t - (this.last[n] || 0) < 0.035) return; // throttle spam (SMG hits etc.)
    this.last[n] = t;
    switch (n) {
      case 'pistol':  this.noise(t, .13, 1500, 'bandpass', .7, .9); this.tone(t, .07, 190, 60, 'square', .12); break;
      case 'smg':     this.noise(t, .07, 2100, 'bandpass', .8, .55); break;
      case 'rifle':   this.noise(t, .1, 1700, 'bandpass', .7, .75); this.tone(t, .05, 160, 60, 'square', .08); break;
      case 'shotgun': this.noise(t, .3, 900, 'lowpass', .5, 1.2); this.tone(t, .12, 110, 40, 'sine', .5); break;
      case 'sniper':  this.noise(t, .4, 2600, 'lowpass', .4, 1.2); this.tone(t, .2, 140, 35, 'sawtooth', .2); break;
      case 'rocket':  this.noise(t, .5, 600, 'lowpass', .5, .7); this.tone(t, .35, 300, 80, 'sawtooth', .1); break;
      case 'laser':   this.tone(t, .07, 900 + Math.random() * 120, 600, 'sawtooth', .05); break;
      case 'boom':    this.noise(t, .9, 420, 'lowpass', .6, 1.5); this.tone(t, .6, 90, 28, 'sine', .8); break;
      case 'hit':     this.noise(t, .05, 3200, 'highpass', .7, .35); break;
      case 'head':    this.tone(t, .06, 1400, 900, 'square', .12); this.noise(t, .08, 2400, 'bandpass', 1, .5); break;
      case 'block':   this.tone(t, .09, 1900, 1500, 'triangle', .25); break;
      case 'coin':    this.tone(t, .06, 990, 990, 'square', .06); this.tone(t + .06, .1, 1320, 1320, 'square', .06); break;
      case 'buy':     this.tone(t, .08, 660, 660, 'square', .1); this.tone(t + .08, .14, 990, 990, 'square', .1); break;
      case 'reload':  this.noise(t, .03, 4000, 'highpass', 1, .5); this.noise(t + .14, .04, 3000, 'highpass', 1, .5); break;
      case 'click':   this.tone(t, .03, 700, 500, 'square', .1); break;
      case 'hurt':    this.tone(t, .22, 240, 90, 'sawtooth', .3); break;
      case 'kick':    this.tone(t, .14, 130, 45, 'sine', .8); this.noise(t, .1, 500, 'lowpass', .8, .6); break;
      case 'throw':   this.noise(t, .15, 800, 'bandpass', 2, .25); break;
      case 'eshot':   this.noise(t, .1, 1200, 'bandpass', .8, .35); break;
      case 'wave':    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * .08, .14, f, f, 'square', .08)); break;
      case 'perk':    [784, 988, 1319].forEach((f, i) => this.tone(t + i * .06, .12, f, f, 'triangle', .15)); break;
      case 'slow':    this.tone(t, .5, 500, 120, 'sine', .3); break;
      case 'die':     this.tone(t, .9, 320, 50, 'sawtooth', .3); break;
    }
  },
};

// ===== rigs =====
// bones: [a, b, halfWidth at a, colorKey, 'h'and | 'f'oot, back, halfWidth at b]; drawn in order (back parts first,
// shaded darker). Limbs taper toward hands/feet; the human torso (1->2) is wider at the shoulders.
const RIGS = {
  human: { head: 0, neck: 1, core: 2, headR: 11, torso: 4,
    bones: [[1, 3, 4.8, 's', 0, 1, 3.8], [3, 4, 3.8, 'a', 'h', 1, 3.1], [2, 7, 6, 'p', 0, 1, 4.6], [7, 8, 4.6, 'p', 'f', 1, 3.6], [1, 2, 9.5, 's', 0, 0, 7.8],
            [2, 9, 6, 'p', 0, 0, 4.6], [9, 10, 4.6, 'p', 'f', 0, 3.6], [1, 5, 4.8, 's', 0, 0, 3.8], [5, 6, 3.8, 'a', 'h', 0, 3.1]],
    extra: [[0, 1], [0, 2]] },
  raptor: { head: 0, neck: 1, core: 2, headR: 9,
    bones: [[3, 8, 6, 'p', 0, 1, 4], [8, 9, 3.8, 'p', 'f', 1, 2.4], [3, 4, 6.5, 's', 0, 0, 4], [4, 5, 4, 's', 0, 0, 1.5], [2, 3, 9, 's', 0, 0, 11],
            [1, 2, 5, 's', 0, 0, 8], [1, 0, 5, 's', 0, 0, 4.5], [3, 6, 6, 'p', 0, 0, 4], [6, 7, 3.8, 'p', 'f', 0, 2.4]],
    extra: [[0, 2], [1, 3], [2, 4]] },
  flyer: { head: 0, neck: 1, core: 1, headR: 7, body: 8, wings: [2, 3],
    bones: [[1, 4, 4.5, 's', 0, 0, 1.5]],
    extra: [[0, 1], [1, 2], [1, 3], [2, 3], [0, 4]] },
};
let RIM = 'rgba(255,255,255,0.16)'; // lit-edge color, tinted per era by the renderer
let GFX_LOW = false; // low graphics: plain stroked limbs, no outfit/lit edge

function P(o, i, x, y) { const q = o[i] || (o[i] = [0, 0]); q[0] = x; q[1] = y; }
// two-segment limb; angles measured from straight down, positive = forward (facing f)
function limb(o, i, j, x, y, a1, a2, len, f) {
  const kx = x + f * Math.sin(a1) * len, ky = y + Math.cos(a1) * len;
  P(o, i, kx, ky); P(o, j, kx + f * Math.sin(a2) * len, ky + Math.cos(a2) * len);
}
// arms reaching along world angle `a` (gun holders); elbows droop downward
function aimArms(o, nx, ny, A, a) {
  const c = Math.cos(a), s = Math.sin(a);
  let qx = -s, qy = c; if (qy < 0) { qx = -qx; qy = -qy; }
  P(o, 3, nx + c * A * 0.675 + qx * A * 0.74, ny + s * A * 0.675 + qy * A * 0.74); P(o, 4, nx + c * A * 1.35, ny + s * A * 1.35);
  P(o, 5, nx + c * A * 0.9 + qx * A * 0.44, ny + s * A * 0.9 + qy * A * 0.44); P(o, 6, nx + c * A * 1.8, ny + s * A * 1.8);
}
// standing: t is a clock used for breathing; flinch leans the torso back after a hit
function poseHuman(o, x, y, s, f, t, legs, arms, act, aim, flinch = 0) {
  const L = 21 * s, T = 30 * s, A = 15 * s, HD = 15 * s;
  const run = legs === 'run', walk = legs !== 'stand';
  const sw = Math.sin(t), amp = run ? 0.85 : walk ? 0.45 : 0;
  const lean = (run ? 0.28 : 0.03) + (arms === 'zombie' ? 0.08 : 0) - flinch * 0.7;
  const px = x, py = y - L * 1.96 - (walk ? Math.abs(Math.cos(t)) * 2.5 * s : (Math.sin(t * 2.2) + 1) * 0.8 * s);
  P(o, 2, px, py);
  const ls = Math.sin(lean), lc = Math.cos(lean), nx = px + f * ls * T, ny = py - lc * T;
  P(o, 1, nx, ny); P(o, 0, nx + f * ls * HD, ny - lc * HD);
  if (walk) {
    const kb = run ? 1.4 : 0.8, a1 = sw * amp, a2 = -sw * amp;
    limb(o, 7, 8, px, py, a1, a1 - Math.max(0, Math.sin(t + 1.6)) * kb, L, f);
    limb(o, 9, 10, px, py, a2, a2 - Math.max(0, -Math.sin(t + 1.6)) * kb, L, f);
  } else { limb(o, 7, 8, px, py, -0.18, -0.12, L, f); limb(o, 9, 10, px, py, 0.2, 0.05, L, f); }
  const as = run ? 1.4 : walk ? 0.7 : 0.1, bend = 0.4 + (run ? 0.9 : 0);
  switch (arms) {
    case 'zombie': limb(o, 3, 4, nx, ny, 1.45 + sw * 0.1, 1.55 + sw * 0.1, A, f); limb(o, 5, 6, nx, ny, 1.35 - sw * 0.1, 1.5 - sw * 0.1, A, f); break;
    case 'aim': aimArms(o, nx, ny, A, aim); break;
    case 'shield': limb(o, 3, 4, nx, ny, -sw * 0.5, -sw * 0.5 + 0.6, A, f); limb(o, 5, 6, nx, ny, 0.9, 1.6, A, f); break;
    case 'hold': limb(o, 3, 4, nx, ny, -sw * as * 0.6, -sw * as * 0.6 + bend, A, f); limb(o, 5, 6, nx, ny, 0.5, 2.1, A, f); break;
    default: limb(o, 3, 4, nx, ny, -sw * as * 0.6, -sw * as * 0.6 + bend, A, f); limb(o, 5, 6, nx, ny, sw * as * 0.6, sw * as * 0.6 + bend, A, f);
  }
  if (act > 0 && arms !== 'aim') { const a = 0.9 + 1.9 * act * act; limb(o, 5, 6, nx, ny, a, a + 0.3, A, f); }
}
function poseRaptor(o, x, y, s, f, t, act, moving) {
  const L = 19 * s, sw = moving ? Math.sin(t) : 0;
  const hx = x, hy = y - L * 1.85 - (moving ? Math.abs(Math.cos(t)) * 2 * s : 0);
  P(o, 3, hx, hy);
  P(o, 2, hx + f * 24 * s, hy - 5 * s);
  P(o, 1, hx + f * 36 * s, hy - 18 * s);
  P(o, 0, hx + f * (48 + act * 12) * s, hy - 22 * s + Math.sin(t * 2) * 1.5 * s);
  P(o, 4, hx - f * 24 * s, hy - 3 * s + Math.sin(t) * 3 * s);
  P(o, 5, hx - f * 48 * s, hy - 8 * s + Math.sin(t + 1) * 5 * s);
  limb(o, 6, 7, hx, hy, sw * 0.6 + 0.1, sw * 0.6 - 0.5 - Math.max(0, Math.sin(t + 1.6)) * 0.8, L, f);
  limb(o, 8, 9, hx, hy, -sw * 0.6 + 0.1, -sw * 0.6 - 0.5 - Math.max(0, -Math.sin(t + 1.6)) * 0.8, L, f);
}
function poseFlyer(o, x, y, s, f, t) {
  const flap = Math.sin(t * 14);
  P(o, 1, x, y); P(o, 0, x + f * 11 * s, y - 3 * s);
  P(o, 2, x - f * 4 * s, y - 18 * s * flap - 2 * s);
  P(o, 3, x + f * 3 * s, y - 16 * s * flap * 0.9 + 2 * s);
  P(o, 4, x - f * 13 * s, y + 2 * s);
}

// Cartoon rendering: ink outline per part, back limbs shaded darker, era-tinted lit edge (top-left).
// capsule whose radius goes r0 -> r1 from A to B; ends are 3-point polygons (much cheaper than arcs,
// and the round-joined ink outline hides the facets)
function taper(c, A, B, r0, r1) {
  const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux, k = 0.7071;
  c.beginPath();
  c.moveTo(A[0] + nx * r0, A[1] + ny * r0); c.lineTo(B[0] + nx * r1, B[1] + ny * r1);
  c.lineTo(B[0] + (nx + ux) * k * r1, B[1] + (ny + uy) * k * r1); c.lineTo(B[0] + ux * r1, B[1] + uy * r1); c.lineTo(B[0] + (ux - nx) * k * r1, B[1] + (uy - ny) * k * r1);
  c.lineTo(B[0] - nx * r1, B[1] - ny * r1); c.lineTo(A[0] - nx * r0, A[1] - ny * r0);
  c.lineTo(A[0] - (nx + ux) * k * r0, A[1] - (ny + uy) * k * r0); c.lineTo(A[0] - ux * r0, A[1] - uy * r0); c.lineTo(A[0] + (nx - ux) * k * r0, A[1] + (ny - uy) * k * r0);
  c.closePath();
}
// cut: point index detached from the body (skip its bones); headAng overrides head rotation;
// opt: { deco: outfit detail, face: 'zombie' | 'hero' | default }; lod: cheap mode for corpses (no lit edge)
function drawRig(c, rig, p, look, s, f, flash, hat, cut = -1, headAng, opt = {}, lod = false) {
  const R = RIGS[rig], col = (k, back) => flash ? '#fff' : shade(look[k] || look.s, back ? 0.76 : 1);
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (R.wings) R.wings.forEach((w, i) => {
    c.beginPath(); c.moveTo(p[1][0], p[1][1]); c.lineTo(p[w][0], p[w][1]); c.lineTo(p[1][0] - f * 10 * s, p[1][1] + 3 * s); c.closePath();
    c.strokeStyle = INK; c.lineWidth = 3; c.stroke(); c.fillStyle = col('a', i === 0); c.fill();
  });
  R.bones.forEach((b, bi) => {
    if (b[0] === cut || b[1] === cut) return;
    const A = p[b[0]], B = p[b[1]], r0 = b[2] * s, r1 = (b[6] || b[2]) * s;
    if (GFX_LOW) { // two round strokes: ~2x cheaper than the tapered polygon
      c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]);
      c.strokeStyle = INK; c.lineWidth = r0 + r1 + 3; c.stroke(); c.strokeStyle = col(b[3], b[5]); c.lineWidth = r0 + r1; c.stroke();
    } else { taper(c, A, B, r0, r1); c.strokeStyle = INK; c.lineWidth = 3; c.stroke(); c.fillStyle = col(b[3], b[5]); c.fill(); }
    if (!flash && !lod && !GFX_LOW && b[2] >= 6) { // lit edge toward the sky (thick parts only)
      const o = Math.min(r0, r1) * 0.35;
      taper(c, [A[0] - o, A[1] - o], [B[0] - o, B[1] - o], r0 * 0.4, r1 * 0.4); c.fillStyle = RIM; c.fill();
    }
    if (bi === R.torso && !flash && !GFX_LOW) outfit(c, A, B, r0, r1, look, s, f, opt.deco);
    if (b[4] === 'h') { c.beginPath(); c.arc(B[0], B[1], 3.6 * s, 0, TAU); c.strokeStyle = INK; c.lineWidth = 2.6; c.stroke(); c.fillStyle = col('k', b[5]); c.fill(); }
    else if (b[4] === 'f') { // boot with a dark sole
      c.save(); c.translate(B[0], B[1]); obox(c, -4 * s + f * 2 * s, -3 * s, 10 * s, 5.5 * s, flash ? '#fff' : '#2a2d38');
      c.fillStyle = flash ? '#fff' : '#15171f'; c.fillRect(-4 * s + f * 2 * s, 1.2 * s, 10 * s, 1.3 * s); c.restore();
    }
  });
  if (R.body) {
    c.beginPath(); c.arc(p[1][0], p[1][1], R.body * s, 0, TAU);
    c.strokeStyle = INK; c.lineWidth = 3; c.stroke(); c.fillStyle = col('s'); c.fill();
  }
  const h = p[R.head], nb = p[R.neck];
  c.save(); c.translate(h[0], h[1]); c.rotate(headAng ?? Math.atan2(h[1] - nb[1], h[0] - nb[0]) + Math.PI / 2);
  drawHead(c, rig, R.headR * s, look, f, flash, hat, opt.face);
  c.restore();
}

// outfit details painted on the torso; local frame: origin at the hips, -y toward the neck
function outfit(c, N, Pl, rs, rh, look, s, f, deco) {
  const L = Math.hypot(N[0] - Pl[0], N[1] - Pl[1]), dk = shade(look.s, 0.72), fx = f * s;
  c.save(); c.translate(Pl[0], Pl[1]); c.rotate(Math.atan2(N[1] - Pl[1], N[0] - Pl[0]) + Math.PI / 2);
  const belt = (col = shade(look.p || '#333333', 0.6)) => { c.fillStyle = col; c.fillRect(-rh, -3.5 * s, rh * 2, 3.4 * s); c.fillStyle = '#c9a23a'; c.fillRect(fx * 3 - 1.6 * s, -3.6 * s, 3.2 * s, 3.6 * s); };
  const collar = () => { c.fillStyle = dk; c.beginPath(); c.moveTo(-rs * 0.55, -L + 1); c.lineTo(fx * 2, -L + 7 * s); c.lineTo(rs * 0.55, -L + 1); c.fill(); };
  const skirt = (len, w) => { c.fillStyle = look.s; c.strokeStyle = INK; c.lineWidth = 2.4; c.beginPath(); c.moveTo(-rh, -2 * s); c.lineTo(-rh * w, len * s); c.lineTo(rh * w, len * s); c.lineTo(rh, -2 * s); c.closePath(); c.stroke(); c.fill(); };
  switch (deco) {
    case 'torn': // ripped hem + stains
      c.fillStyle = shade(look.p || '#333333', 0.8);
      c.beginPath(); c.moveTo(-rh, 0); for (let i = 0; i <= 4; i++) c.lineTo(-rh + i * rh / 2, i % 2 ? -6 * s : -1.5 * s); c.lineTo(rh, 0); c.fill();
      c.fillStyle = 'rgba(120,20,20,.55)'; c.beginPath(); c.arc(fx * 3, -L * 0.55, 3.2 * s, 0, TAU); c.arc(-fx * 2, -L * 0.3, 2 * s, 0, TAU); c.fill(); break;
    case 'armor': // plated chest
      c.fillStyle = 'rgba(0,0,0,.2)'; for (let k = 1; k <= 3; k++) c.fillRect(-rs, -L * k / 4, rs * 2, 1.4 * s);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(-rs * 0.8, -L + 3 * s, rs * 1.6, 2 * s); belt('#3a3a40'); break;
    case 'fur': // hide tunic with spots and a shoulder strap
      c.fillStyle = dk; c.beginPath(); c.arc(fx * 3, -L * 0.6, 2.2 * s, 0, TAU); c.arc(-fx * 3, -L * 0.35, 1.8 * s, 0, TAU); c.arc(fx, -L * 0.2, 1.6 * s, 0, TAU); c.fill();
      c.strokeStyle = shade(look.s, 0.55); c.lineWidth = 2.4 * s; c.beginPath(); c.moveTo(-fx * 7, -L + 2 * s); c.lineTo(fx * 7, -4 * s); c.stroke(); break;
    case 'robe': // long robe over the thighs + rope belt
      skirt(22, 1.5); c.fillStyle = dk; c.fillRect(-rh * 1.5, 18 * s, rh * 3, 4 * s); c.fillStyle = '#c9a23a'; c.fillRect(-rh, -3 * s, rh * 2, 2 * s); break;
    case 'wrap': // mummy bandages
      c.strokeStyle = 'rgba(120,100,70,.4)'; c.lineWidth = 1.3 * s; c.beginPath();
      for (let k = 0; k < 5; k++) { const y = -L * (k + 0.5) / 5; c.moveTo(-rs, y + 3 * s); c.lineTo(rs, y - 3 * s); } c.stroke(); break;
    case 'stone': // cracks
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.2 * s; c.beginPath(); c.moveTo(-fx * 4, -L * 0.8); c.lineTo(fx, -L * 0.55); c.lineTo(-fx * 2, -L * 0.3); c.moveTo(fx * 5, -L * 0.45); c.lineTo(fx * 2, -L * 0.25); c.stroke(); break;
    case 'royal': // gold collar + belt
      c.fillStyle = '#e8c547'; c.beginPath(); c.arc(0, -L, rs * 0.95, 0, Math.PI); c.fill();
      c.fillStyle = '#1f4e8c'; for (let k = 0; k < 3; k++) c.fillRect(-rs * 0.9 + k * rs * 0.7, -L + 1.5 * s, rs * 0.3, 3 * s); belt('#1f4e8c'); break;
    case 'vest': { // open vest + star badge
      c.fillStyle = shade(look.s, 0.6); c.fillRect(-rs, -L, rs * 0.75, L); c.fillRect(rs * 0.25, -L, rs * 0.75, L);
      c.fillStyle = '#e8c547'; c.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 1.2 * s : 2.8 * s; c.lineTo(fx * 4 + Math.cos(a) * rr, -L * 0.62 + Math.sin(a) * rr); }
      c.fill(); belt(); break;
    }
    case 'sash': c.fillStyle = '#c0392b'; c.fillRect(-rh, -5 * s, rh * 2, 4.5 * s); c.fillRect(-fx * 2, -2 * s, 3 * s, 8 * s); collar(); break;
    case 'coat': // coat tails + gold buttons
      skirt(18, 1.3); c.fillStyle = '#e8c547';
      for (let k = 1; k <= 3; k++) { c.beginPath(); c.arc(fx * 2.5, -L * k / 4, 1.3 * s, 0, TAU); c.fill(); } collar(); break;
    case 'stripes': c.fillStyle = 'rgba(30,50,110,.55)'; for (let k = 0; k < 4; k++) c.fillRect(-rs, -L * (k * 2 + 1) / 8 - 1.5 * s, rs * 2, 2.6 * s); belt(); break;
    case 'robot': // panel seams + glowing core
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1.2 * s; c.strokeRect(-rs * 0.7, -L * 0.85, rs * 1.4, L * 0.55);
      c.fillStyle = '#39e1ff'; c.beginPath(); c.arc(fx, -L * 0.6, 2.4 * s, 0, TAU); c.fill(); c.fillStyle = '#e8ffff'; c.beginPath(); c.arc(fx, -L * 0.6, s, 0, TAU); c.fill();
      c.fillStyle = '#2a3140'; c.fillRect(-rh, -3 * s, rh * 2, 3 * s); break;
    case 'tactical': // plate carrier with pouches (player)
      c.fillStyle = '#1a2236'; c.fillRect(-rs * 0.85, -L * 0.88, rs * 1.7, L * 0.62);
      c.fillStyle = '#2d3a58'; for (let k = 0; k < 3; k++) c.fillRect(-rs * 0.75 + k * rs * 0.52, -L * 0.42, rs * 0.42, 5 * s);
      c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(-rs * 0.85, -L * 0.88, rs * 1.7, 1.4 * s); belt('#10141f'); break;
    default: collar(); belt();
  }
  c.restore();
}

// head in local frame: -y = "up" (away from neck)
function drawHead(c, rig, r, look, f, flash, hat, face) {
  const k = flash ? '#fff' : look.k, dark = '#15161c', fl = x => flash ? '#fff' : x;
  const lit = () => { if (flash) return; c.fillStyle = RIM; c.fillRect(-r, -r, 2 * r, r * 0.35); c.fillStyle = 'rgba(0,0,0,.14)'; c.fillRect(-r, r * 0.6, 2 * r, r * 0.4); };
  if (rig !== 'human') {
    if (rig === 'raptor') {
      obox(c, -r * 0.75, -r * 1.7, r * 1.5, r * 2.4, k);
      c.fillStyle = dark; c.fillRect(-f * r * 0.35 - r * 0.15, -r * 0.9, r * 0.3, r * 0.3);
      c.fillRect(f * r * 0.15, -r * 1.7, r * 0.12, r * 1.3);
    } else {
      obox(c, -r, -r, 2 * r, 2 * r, k); lit();
      c.fillStyle = INK; c.beginPath(); c.moveTo(-r * 0.55, -r - 1); c.lineTo(0, -r * 2.05); c.lineTo(r * 0.55, -r - 1); c.fill();
      c.fillStyle = fl('#e8b33a'); c.beginPath(); c.moveTo(-r * 0.4, -r); c.lineTo(0, -r * 1.85); c.lineTo(r * 0.4, -r); c.fill();
      c.fillStyle = dark; c.fillRect(-f * r * 0.3 - r * 0.15, -r * 0.3, r * 0.3, r * 0.3);
    }
    return;
  }
  obox(c, -r, -r, 2 * r, 2 * r, k); lit();
  const eye = () => { // eye + expression; faces point toward f
    const ex = f * r * 0.4 - r * 0.14, ey = -r * 0.3, es = r * 0.28;
    if (face === 'zombie') { // blank eye, gaping mouth
      c.fillStyle = '#f2efd2'; c.fillRect(ex - r * 0.05, ey - r * 0.05, es + r * 0.1, es + r * 0.1); c.fillStyle = dark; c.fillRect(ex + (f > 0 ? es * 0.5 : 0), ey + es * 0.4, es * 0.5, es * 0.5);
      c.fillStyle = '#4a1418'; c.fillRect(f > 0 ? r * 0.05 : -r * 0.75, r * 0.3, r * 0.7, r * 0.34); c.fillStyle = '#f2efd2'; c.fillRect(f > 0 ? r * 0.2 : -r * 0.34, r * 0.3, r * 0.14, r * 0.12);
      return;
    }
    c.fillStyle = dark; c.fillRect(ex, ey, es, es); c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(ex, ey, r * 0.1, r * 0.1);
    c.fillStyle = dark; c.beginPath(); // brow, angled down toward the nose
    c.moveTo(ex - f * r * 0.12, ey - r * 0.26); c.lineTo(ex + es * (f > 0 ? 1 : 0) + f * r * 0.12, ey - r * 0.1);
    c.lineTo(ex + es * (f > 0 ? 1 : 0) + f * r * 0.12, ey - r * 0.01); c.lineTo(ex - f * r * 0.12, ey - r * 0.16); c.fill();
    if (face !== 'hero') c.fillRect(f > 0 ? r * 0.15 : -r * 0.6, r * 0.45, r * 0.45, r * 0.1); // mouth
  };
  switch (hat) {
    case 'mask': {
      const t = performance.now() / 1000;
      c.fillStyle = fl('#1c1f2b'); c.strokeStyle = INK; c.lineWidth = 2;
      for (const [len, off] of [[r * 1.5, 0], [r * 1.1, 0.4]]) { // bandana tails trail behind and flutter
        const wv = Math.sin(t * 10 + off * 7) * r * 0.3;
        c.beginPath(); c.moveTo(-f * r * 0.9, -r * 0.4 + off * r * 0.3); c.lineTo(-f * (r + len), -r * 0.2 + off * r + wv);
        c.lineTo(-f * (r + len * 0.85), r * 0.25 + off * r + wv); c.lineTo(-f * r * 0.9, -r * 0.05 + off * r * 0.3); c.closePath(); c.stroke(); c.fill();
      }
      c.fillRect(-r, -r, 2 * r, 2 * r);
      c.fillStyle = fl('#f1c27d'); c.fillRect(f > 0 ? -r * 0.2 : -r, -r * 0.42, r * 1.2, r * 0.42);
      eye(); lit(); break;
    }
    case 'helmet':
      obox(c, -r * 1.1, -r * 1.2, r * 2.2, r * 2.25, fl('#7d8791'));
      c.fillStyle = dark; c.fillRect(f > 0 ? 0 : -r * 1.1, -r * 0.35, r * 1.1, r * 0.22);
      c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(-r * 1.1, -r * 1.2, r * 2.2, r * 0.28); break;
    case 'visor':
      c.fillStyle = fl('#39e1ff'); c.fillRect(f > 0 ? -r * 0.1 : -r * 1.02, -r * 0.45, r * 1.12, r * 0.4);
      c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(f > 0 ? -r * 0.1 : -r * 1.02, -r * 0.45, r * 1.12, r * 0.1);
      obox(c, -r * 0.1, -r * 1.7, r * 0.2, r * 0.7, k); break;
    case 'cowboy':
      eye(); obox(c, -r * 0.95, -r * 1.8, r * 1.9, r * 0.8, fl('#6b4423')); obox(c, -r * 1.7, -r * 1.05, r * 3.4, r * 0.3, fl('#6b4423'));
      c.fillStyle = '#2a1a10'; c.fillRect(-r * 0.95, -r * 1.2, r * 1.9, r * 0.16); break;
    case 'tricorn':
      eye(); c.fillStyle = fl('#1f1f25'); c.strokeStyle = INK; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(-r * 1.6, -r * 0.85); c.lineTo(r * 1.6, -r * 0.85); c.lineTo(r * 1.0, -r * 1.75); c.lineTo(0, -r * 1.35); c.lineTo(-r * 1.0, -r * 1.75); c.closePath(); c.stroke(); c.fill();
      c.fillStyle = '#d4af37'; c.fillRect(-r * 1.6, -r * 0.95, r * 3.2, r * 0.12); break;
    case 'crown':
      eye(); obox(c, -r * 1.2, -r * 1.05, r * 0.45, r * 2.3, fl('#1f4e8c')); obox(c, r * 0.75, -r * 1.05, r * 0.45, r * 2.3, fl('#1f4e8c'));
      obox(c, -r * 1.1, -r * 1.45, r * 2.2, r * 0.55, fl('#e8c547'));
      for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * r * 0.7 - r * 0.25, -r * 1.45); c.lineTo(i * r * 0.7, -r * 2.05); c.lineTo(i * r * 0.7 + r * 0.25, -r * 1.45); c.fill(); } break;
    case 'anubis':
      c.fillStyle = '#e8c547'; c.fillRect(f * r * 0.4 - r * 0.14, -r * 0.3, r * 0.28, r * 0.2);
      c.fillStyle = k; c.strokeStyle = INK; c.lineWidth = 2.5;
      for (const ex of [-0.7, 0.2]) { c.beginPath(); c.moveTo(ex * r, -r); c.lineTo((ex + 0.25) * r, -r * 2.3); c.lineTo((ex + 0.5) * r, -r); c.stroke(); c.fill(); } break;
    case 'hair':
      eye(); obox(c, -r * 1.15, -r * 1.3, r * 2.3, r * 0.65, fl('#3a2515')); c.fillRect(f > 0 ? -r * 1.15 : r * 0.35, -r * 1.3, r * 0.8, r * 1.7); break;
    case 'hood':
      eye(); obox(c, -r * 1.2, -r * 1.3, r * 2.4, r * 0.75, fl(shade(look.s, 0.85))); c.fillRect(f > 0 ? -r * 1.2 : r * 0.35, -r * 1.3, r * 0.85, r * 2.4); break;
    case 'bandana':
      eye(); c.fillStyle = fl('#c0392b'); c.fillRect(-r * 1.05, -r * 1.0, r * 2.1, r * 0.42); c.fillRect(-f * r * 1.05 - (f > 0 ? r * 0.4 : 0), -r * 0.8, r * 0.4, r * 0.7); break;
    case 'bandage':
      eye(); c.fillStyle = 'rgba(120,100,70,.35)'; for (let i = -0.8; i < 1; i += 0.45) c.fillRect(-r, i * r, 2 * r, r * 0.12); break;
    case 'horns':
      eye(); c.fillStyle = fl('#e8e2d0'); c.strokeStyle = INK; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-r, -r); c.lineTo(-r * 1.3, -r * 1.8); c.lineTo(-r * 0.4, -r); c.moveTo(r, -r); c.lineTo(r * 1.3, -r * 1.8); c.lineTo(r * 0.4, -r); c.stroke(); c.fill(); break;
    default: eye();
  }
}

// held items at the front hand (human rigs only)
function inkLine(c, x1, y1, x2, y2, w, color) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = INK; c.lineWidth = w + 2.6; c.stroke(); c.strokeStyle = color; c.lineWidth = w; c.stroke();
}
function drawHeld(c, held, p, s, f, look, shieldUp) {
  const h = p[6], el = p[5], dx = h[0] - el[0], dy = h[1] - el[1], d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d, px = f > 0 ? uy : -uy, py = f > 0 ? -ux : ux; // perpendicular, pointing "back/up"
  c.lineCap = 'round';
  switch (held) {
    case 'club': inkLine(c, h[0], h[1], h[0] + px * 26 * s, h[1] + py * 26 * s, 7 * s, '#6b4423'); break;
    case 'sword':
      inkLine(c, h[0], h[1], h[0] + px * 34 * s, h[1] + py * 34 * s, 3.5 * s, '#d5dae2');
      inkLine(c, h[0] - ux * 6 * s, h[1] - uy * 6 * s, h[0] + ux * 6 * s, h[1] + uy * 6 * s, 3 * s, '#4a3b2c'); break;
    case 'bomb':
      c.beginPath(); c.arc(h[0], h[1] - 4 * s, 7 * s, 0, TAU); c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke(); c.fillStyle = '#2a2a30'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(h[0] - 4 * s, h[1] - 9 * s, 3 * s, 3 * s);
      glow(c, h[0], h[1] - 13 * s, 7 * s, Math.random() < 0.5 ? '#ffd34d' : '#ff6a2b', 0.9); c.globalAlpha = 1; break;
    case 'bow':
      c.strokeStyle = INK; c.lineWidth = 5.5 * s; c.beginPath(); c.arc(h[0] - ux * 10 * s, h[1] - uy * 10 * s, 20 * s, Math.atan2(uy, ux) - 1.1, Math.atan2(uy, ux) + 1.1); c.stroke();
      c.strokeStyle = '#7a5530'; c.lineWidth = 3 * s; c.stroke(); break;
    case 'gun': c.lineCap = 'butt'; inkLine(c, h[0], h[1], h[0] + ux * 20 * s, h[1] + uy * 20 * s, 5 * s, '#30343e'); break;
    case 'shield': {
      if (!shieldUp) break;
      const x = h[0] + f * 5 * s - 5.5 * s, y = h[1] - 25 * s, col = look.sh || '#6d7c8c';
      obox(c, x, y, 11 * s, 50 * s, col);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x, y, 11 * s, 5 * s);
      c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x, y + 44 * s, 11 * s, 6 * s); c.fillRect(x + 4 * s, y + 15 * s, 3 * s, 20 * s);
    }
  }
}

// player guns: [part, x, y, w, h] along the barrel (+x); b body, d dark, w wood, g glow
const GUNS = {
  pistol:  [['b', -3, -3, 22, 6], ['d', -1, 2, 6, 9], ['d', 17, -2, 3, 3]],
  smg:     [['b', -4, -3.5, 26, 7], ['d', 21, -1.5, 9, 3], ['d', 8, 3, 5, 11], ['d', -2, 3, 5, 7]],
  shotgun: [['w', -15, -2.5, 13, 6], ['b', -3, -3, 24, 6], ['d', 20, -3, 22, 3.5], ['w', 22, 1, 13, 4], ['d', -1, 2, 5, 7]],
  rifle:   [['w', -15, -2.5, 13, 6], ['b', -3, -3.5, 28, 7], ['d', 24, -1.5, 20, 3], ['d', 11, 3, 6, 11], ['d', -1, 3, 5, 7], ['d', 6, -6.5, 10, 3]],
  sniper:  [['w', -16, -2.5, 14, 6], ['b', -3, -3, 30, 6], ['d', 26, -1.2, 34, 2.6], ['d', 6, -9.5, 20, 5], ['g', 24, -9, 2, 4], ['d', 4, 3, 5, 8]],
  rocket:  [['b', -12, -6, 60, 12], ['d', 46, -7, 8, 14], ['d', -14, -7, 5, 14], ['d', 8, 5, 5, 8], ['d', 14, -10, 8, 4]],
  laser:   [['d', -4, -4.5, 42, 9], ['g', 2, -1.2, 32, 2.4], ['b', 36, -5.5, 9, 11], ['d', -1, 3, 5, 8]],
};
function drawGun(c, id, color, glowCol) {
  const parts = GUNS[id] || GUNS.pistol;
  c.fillStyle = INK; for (const q of parts) c.fillRect(q[1] - 1.3, q[2] - 1.3, q[3] + 2.6, q[4] + 2.6);
  for (const q of parts) { c.fillStyle = q[0] === 'b' ? color : q[0] === 'd' ? shade(color, 0.65) : q[0] === 'w' ? '#6b4423' : glowCol; c.fillRect(q[1], q[2], q[3], q[4]); }
  c.fillStyle = 'rgba(255,255,255,.2)'; for (const q of parts) if (q[0] !== 'g') c.fillRect(q[1], q[2], q[3], Math.min(1.6, q[4] * 0.3));
}

// ===== verlet ragdolls =====
const RD_STEP = 1 / 120;
function makeRagdoll(rig, pts, look, s, f, hat, vx, vy) {
  const R = RIGS[rig], p = pts.map(q => [q[0], q[1]]), o = pts.map(q => [q[0] - vx * RD_STEP, q[1] - vy * RD_STEP]);
  const sticks = [...R.bones, ...R.extra].map(b => [b[0], b[1], Math.hypot(p[b[0]][0] - p[b[1]][0], p[b[0]][1] - p[b[1]][1])]);
  return { rig, p, o, sticks, look, s, f, hat, cut: -1, age: 0, still: 0, sleep: false, bb: [0, 0, 0, 0] };
}
function collidePoint(q, w, gy) {
  let G = gy(q[0]);
  if (q[1] <= G) return;
  if (w[1] > G + 2) { q[0] = w[0]; G = gy(q[0]); if (q[1] <= G) return; } // hit a step wall sideways
  const vy = q[1] - w[1]; q[1] = G; w[1] = G + vy * 0.3; // bounce
  w[0] = q[0] - (q[0] - w[0]) * 0.75; // friction
}
function stepRagdoll(r, gy) {
  if (r.sleep) return;
  const p = r.p, o = r.o, g = GRAV * RD_STEP * RD_STEP;
  let motion = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], w = o[i], vx = (q[0] - w[0]) * 0.998, vy = (q[1] - w[1]) * 0.998;
    w[0] = q[0]; w[1] = q[1]; q[0] += vx; q[1] += vy + g;
    motion += Math.abs(vx) + Math.abs(vy);
  }
  for (let k = 0; k < 3; k++) for (const st of r.sticks) {
    const a = p[st[0]], b = p[st[1]], dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-4, m = (d - st[2]) / d * 0.5;
    a[0] += dx * m; a[1] += dy * m; b[0] -= dx * m; b[1] -= dy * m;
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < p.length; i++) {
    collidePoint(p[i], o[i], gy);
    const q = p[i];
    if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
  }
  r.bb[0] = x0 - 14; r.bb[1] = y0 - 14; r.bb[2] = x1 + 14; r.bb[3] = y1 + 14;
  r.still = motion < 0.04 * p.length ? r.still + 1 : 0;
  if (r.still > 90) r.sleep = true;
}
// velocity impulse (units/s) with gaussian falloff around (x,y)
function pushRagdoll(r, x, y, vx, vy, rad) {
  for (let i = 0; i < r.p.length; i++) {
    const q = r.p[i], d2 = (q[0] - x) ** 2 + (q[1] - y) ** 2, w = Math.exp(-d2 / (2 * rad * rad));
    r.o[i][0] -= vx * RD_STEP * w; r.o[i][1] -= vy * RD_STEP * w;
  }
  r.sleep = false; r.still = 0;
}
function blastRagdoll(r, x, y, rad, power) {
  for (let i = 0; i < r.p.length; i++) {
    const q = r.p[i], dx = q[0] - x, dy = q[1] - y, d = Math.hypot(dx, dy) || 1;
    if (d > rad) continue;
    const v = power * (1 - d / rad);
    r.o[i][0] -= dx / d * v * RD_STEP; r.o[i][1] -= (dy / d * v - v * 0.6) * RD_STEP;
  }
  r.sleep = false; r.still = 0;
}
