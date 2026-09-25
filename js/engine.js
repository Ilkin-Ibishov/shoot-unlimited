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
// Flyers share one rig (0 head, 1 body, 2 back wing tip, 3 front wing tip, 4 tail) so hits and ragdolls work the
// same; each era's kind has its own flight style and silhouette. lift raises the wings into a soaring V.
const FLY = {
  gargoyle: { rate: 11, amp: 18, span: 13, lift: 6,  chord: 10, wing: 'skin',    hx: 11, hy: -4, tx: -14, ty: 3 },
  ptero:    { rate: 6,  amp: 18, span: 20, lift: 8,  chord: 12, wing: 'skin',    hx: 12, hy: -3, tx: -10, ty: 0 },
  bat:      { rate: 21, amp: 16, span: 10, lift: 4,  chord: 8,  wing: 'skin',    hx: 9,  hy: -3, tx: -7,  ty: 1 },
  vulture:  { rate: 4,  amp: 8,  span: 19, lift: 13, chord: 11, wing: 'feather', hx: 14, hy: -5, tx: -13, ty: 2 },
  parrot:   { rate: 16, amp: 15, span: 11, lift: 4,  chord: 8,  wing: 'feather', hx: 10, hy: -4, tx: -12, ty: 3 },
  drone:    { rate: 0,  amp: 0,  span: 0,  lift: 0,  chord: 0,  wing: 'rotor',   hx: 8,  hy: 4,  tx: -9,  ty: 0 },
};
function poseFlyer(o, x, y, s, f, t, kind) {
  const K = FLY[kind] || FLY.gargoyle;
  if (K.wing === 'rotor') { // hovers, no flapping; points 2/3 are the rotors
    y += Math.sin(t * 3) * 1.5 * s;
    P(o, 1, x, y); P(o, 0, x + f * K.hx * s, y + K.hy * s); P(o, 2, x - f * 10 * s, y - 8 * s); P(o, 3, x + f * 10 * s, y - 8 * s); P(o, 4, x + f * K.tx * s, y + K.ty * s);
    return;
  }
  const flap = Math.sin(t * K.rate);
  if (kind === 'bat') y += Math.sin(t * 7.3) * 2.5 * s; // fluttery
  P(o, 1, x, y); P(o, 0, x + f * K.hx * s, y + K.hy * s);
  P(o, 2, x - f * K.span * s, y - (K.amp * flap + K.lift + 2) * s);
  P(o, 3, x - f * (K.span * 0.4 - 3) * s, y - (K.amp * 0.9 * flap + K.lift * 0.8 - 2) * s);
  P(o, 4, x + f * K.tx * s, y + K.ty * s);
}
// frame helper: origin o, forward unit (ux, uy); draws with +x forward and +y down, mirrored for f < 0
function flyFrame(c, o, ux, uy, f) { const vx = f * uy, vy = -f * ux; c.transform(ux, uy, -vx, -vy, o[0], o[1]); }
function flyWing(c, T, kind, K, s, col, back) {
  const Sh = [2 * s, -3 * s], Rt = [-K.chord * s, 0.5 * s], fill = col('a', back);
  let nx = T[1] - Rt[1], ny = Rt[0] - T[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl; // trailing-edge normal
  if (nx * ((T[0] + Rt[0]) / 2 - Sh[0]) + ny * ((T[1] + Rt[1]) / 2 - Sh[1]) < 0) { nx = -nx; ny = -ny; } // point it away from the shoulder
  const L = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const E = L(Sh, T, 0.45); E[0] -= nx * 2.5 * s; E[1] -= ny * 2.5 * s; // wrist: leading edge bows forward
  c.beginPath(); c.moveTo(Sh[0], Sh[1]); c.quadraticCurveTo(E[0], E[1], T[0], T[1]);
  const Q = [];
  if (K.wing === 'skin') { // membrane between finger bones, scalloped inward
    let prev = T;
    const nS = kind === 'bat' ? 4 : 3;
    for (let k = 1; k <= nS; k++) {
      const q = L(T, Rt, k / nS), m = L(prev, q, 0.5), cp = L(m, Sh, 0.3);
      c.quadraticCurveTo(cp[0], cp[1], q[0], q[1]); Q.push(q); prev = q;
    }
  } else { // feathers: deep primary "fingers" at the tip, soft scallops toward the body
    for (let k = 0; k < 4; k++) {
      const tip = L(T, Rt, 0.06 + k * 0.09), notch = L(T, Rt, 0.1 + k * 0.09);
      c.lineTo(tip[0] + nx * (4 - k * 0.5) * s, tip[1] + ny * (4 - k * 0.5) * s); c.lineTo(notch[0] - nx * 0.4 * s, notch[1] - ny * 0.4 * s);
    }
    let prev = L(T, Rt, 0.37);
    for (let k = 1; k <= 3; k++) {
      const q = L(L(T, Rt, 0.37), Rt, k / 3), m = L(prev, q, 0.5);
      c.quadraticCurveTo(m[0] + nx * 2.2 * s, m[1] + ny * 2.2 * s, q[0], q[1]); prev = q;
    }
  }
  c.closePath(); c.strokeStyle = INK; c.lineWidth = back ? 2.2 : 2.6; c.stroke(); c.fillStyle = fill; c.fill();
  if (K.wing === 'skin') { // finger bones from the wrist
    c.strokeStyle = col('a', true) === '#fff' ? '#fff' : shade(fill, 0.62); c.lineWidth = 1.4 * s; c.beginPath();
    for (const q of Q.slice(0, -1)) { c.moveTo(E[0], E[1]); c.lineTo(q[0], q[1]); }
    c.stroke();
    if (kind === 'gargoyle') { c.fillStyle = INK; c.beginPath(); c.moveTo(E[0], E[1]); c.lineTo(E[0] + 3 * s, E[1] - 3 * s); c.lineTo(E[0] + 1 * s, E[1]); c.fill(); } // wrist claw
  } else { // covert feathers: a second tone near the shoulder (red on the parrot)
    const a = L(Sh, T, 0.55), b = L(Sh, Rt, 0.65);
    c.beginPath(); c.moveTo(Sh[0], Sh[1]); c.quadraticCurveTo(E[0], E[1], a[0], a[1]); c.quadraticCurveTo((a[0] + b[0]) / 2 + nx * s, (a[1] + b[1]) / 2 + ny * s, b[0], b[1]); c.closePath();
    c.fillStyle = kind === 'parrot' ? col('s', back) : shade(fill, 1.22); c.fill();
  }
}
function flyBody(c, kind, s, col, lit) {
  const ell = (x, y, rx, ry, fill) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.strokeStyle = INK; c.lineWidth = 2.6; c.stroke(); c.fillStyle = fill; c.fill(); };
  const shine = (x, y, rx, ry) => { if (!lit) return; c.save(); c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.clip(); c.fillStyle = RIM; c.fillRect(x - rx, y - ry, rx * 2, ry * 0.7); c.restore(); };
  const talons = (x) => { c.strokeStyle = INK; c.lineWidth = 1.8 * s; c.beginPath(); c.moveTo(x, 4 * s); c.lineTo(x - 1.5 * s, 8 * s); c.moveTo(x + 3 * s, 4 * s); c.lineTo(x + 2 * s, 8 * s); c.stroke(); };
  switch (kind) {
    case 'gargoyle': { // stone body, spade-tipped tail
      c.strokeStyle = INK; c.lineWidth = 5 * s; c.beginPath(); c.moveTo(-6 * s, 1 * s); c.quadraticCurveTo(-14 * s, -4 * s, -19 * s, 5 * s); c.stroke();
      c.strokeStyle = col('s'); c.lineWidth = 2.6 * s; c.stroke();
      c.fillStyle = col('s'); c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(-17 * s, 3 * s); c.lineTo(-24 * s, 5 * s); c.lineTo(-19 * s, 9 * s); c.closePath(); c.stroke(); c.fill();
      talons(-1 * s); ell(0, 0, 9 * s, 7 * s, col('s')); shine(0, 0, 9 * s, 7 * s);
      c.strokeStyle = shade(col('s'), 0.7); c.lineWidth = 1.2; c.beginPath(); c.moveTo(-3 * s, -3 * s); c.lineTo(0, 0); c.lineTo(-1 * s, 3 * s); c.moveTo(3 * s, 2 * s); c.lineTo(5 * s, 4 * s); c.stroke();
      break;
    }
    case 'ptero':
      c.fillStyle = col('s'); c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(-6 * s, -1 * s); c.lineTo(-12 * s, 0); c.lineTo(-6 * s, 2 * s); c.closePath(); c.stroke(); c.fill();
      c.strokeStyle = INK; c.lineWidth = 1.8 * s; c.beginPath(); c.moveTo(-4 * s, 3 * s); c.lineTo(-10 * s, 5 * s); c.moveTo(-3 * s, 3.5 * s); c.lineTo(-9 * s, 7 * s); c.stroke(); // feet tucked back
      ell(0, 0, 9 * s, 4 * s, col('s')); shine(0, 0, 9 * s, 4 * s); break;
    case 'bat':
      talons(-3 * s); ell(0, 0, 7 * s, 6 * s, col('s')); shine(0, 0, 7 * s, 6 * s);
      c.strokeStyle = shade(col('s'), 1.35); c.lineWidth = 1.2; c.beginPath(); for (let k = 0; k < 3; k++) { c.moveTo((1 + k * 1.6) * s, 1 * s); c.lineTo((1.8 + k * 1.6) * s, 3 * s); } c.stroke(); // fur
      break;
    case 'vulture': case 'parrot': {
      const parrot = kind === 'parrot';
      if (parrot) for (const [k, dy, len] of [['a', 0, 26], ['s', 2.5, 23]]) { // long tail feathers
        c.beginPath(); c.moveTo(-6 * s, (dy - 1) * s); c.lineTo(-len * s, (dy + 5) * s); c.lineTo(-6 * s, (dy + 2) * s); c.closePath(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke(); c.fillStyle = col(k); c.fill();
      } else { c.beginPath(); c.moveTo(-6 * s, -2 * s); c.lineTo(-17 * s, -2 * s); c.lineTo(-17 * s, 4 * s); c.lineTo(-6 * s, 4 * s); c.closePath(); c.strokeStyle = INK; c.lineWidth = 2; c.stroke(); c.fillStyle = col('s', true); c.fill(); }
      talons(-1 * s);
      const bc = parrot ? col('k') : col('s');
      ell(0, 0, (parrot ? 8.5 : 10) * s, (parrot ? 6.5 : 7) * s, bc); shine(0, 0, (parrot ? 8.5 : 10) * s, 7 * s);
      if (!parrot) { c.fillStyle = col('s') === '#fff' ? '#fff' : '#efe8dc'; c.strokeStyle = INK; c.lineWidth = 1.6; for (const [x, y] of [[5, -5], [7, -3.5], [3, -6]]) { c.beginPath(); c.arc(x * s, y * s, 2 * s, 0, TAU); c.stroke(); c.fill(); } } // neck ruff
      else { c.fillStyle = shade(bc, 1.2); c.beginPath(); c.ellipse(3 * s, 2.5 * s, 4 * s, 3 * s, 0, 0, TAU); c.fill(); } // lighter belly
      break;
    }
  }
}
function flyDrone(c, W2, W3, s, col, flash, lit) {
  const dk = col('a'), bd = col('s');
  c.strokeStyle = INK; c.lineCap = 'round';
  for (const W of [W2, W3]) { c.lineWidth = 4.4 * s; c.beginPath(); c.moveTo(0, -2 * s); c.lineTo(W[0], W[1]); c.stroke(); c.strokeStyle = dk; c.lineWidth = 2.2 * s; c.stroke(); c.strokeStyle = INK; }
  c.lineWidth = 2; c.beginPath(); c.moveTo(-6 * s, 4 * s); c.lineTo(-7 * s, 8 * s); c.moveTo(6 * s, 4 * s); c.lineTo(7 * s, 8 * s); c.moveTo(-10 * s, 8 * s); c.lineTo(10 * s, 8 * s); c.stroke(); // skids
  c.beginPath(); c.roundRect ? c.roundRect(-10 * s, -5 * s, 20 * s, 10 * s, 3 * s) : c.rect(-10 * s, -5 * s, 20 * s, 10 * s);
  c.lineWidth = 2.6; c.stroke(); c.fillStyle = bd; c.fill();
  if (lit) { c.fillStyle = RIM; c.fillRect(-8 * s, -4.5 * s, 16 * s, 2.4 * s); }
  c.fillStyle = dk; c.fillRect(-8 * s, 1 * s, 16 * s, 2 * s);
  const t = performance.now() / 1000;
  c.fillStyle = flash ? '#fff' : Math.sin(t * 6) > 0 ? '#ff4d4d' : '#5a1f24'; c.fillRect(-8 * s, -2.5 * s, 2.4 * s, 2.4 * s); // status LED
  for (const W of [W2, W3]) { // spinning rotors: a blur disc plus two moving blade glints
    c.fillStyle = 'rgba(230,240,255,.35)'; c.beginPath(); c.ellipse(W[0], W[1] - 1.5 * s, 9 * s, 1.8 * s, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.4; c.beginPath();
    for (const ph of [0, Math.PI]) { const x = Math.cos(t * 40 + ph + W[0]) * 8.5 * s; c.moveTo(W[0] + x, W[1] - 2.5 * s); c.lineTo(W[0] + x * 0.6, W[1] - 1 * s); }
    c.stroke();
    obox(c, W[0] - 1.5 * s, W[1] - 2 * s, 3 * s, 3 * s, dk);
  }
}
function flyHead(c, kind, look, s, flash, col) {
  const ink = (w = 2.2) => { c.strokeStyle = INK; c.lineWidth = w; c.stroke(); };
  const dot = (x, y, r, fill) => { c.fillStyle = flash ? '#fff' : fill; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  switch (kind) {
    case 'bat':
      for (const dx of [-3, 0.5]) { c.beginPath(); c.moveTo((dx - 1.5) * s, -3 * s); c.lineTo((dx - 3.5) * s, -13 * s); c.lineTo((dx + 2.5) * s, -3.5 * s); c.closePath(); ink(); c.fillStyle = col('k'); c.fill(); c.fillStyle = flash ? '#fff' : '#b0707a'; c.beginPath(); c.moveTo((dx - 0.5) * s, -4 * s); c.lineTo((dx - 2.6) * s, -10.5 * s); c.lineTo((dx + 1.2) * s, -4.2 * s); c.fill(); } // ears
      c.beginPath(); c.arc(0, 0, 5.5 * s, 0, TAU); ink(); c.fillStyle = col('k'); c.fill();
      dot(2.4 * s, -1.2 * s, 1.1 * s, '#ff4d4d');
      c.fillStyle = flash ? '#fff' : '#f2efd2'; c.beginPath(); c.moveTo(2 * s, 3.5 * s); c.lineTo(2.8 * s, 6 * s); c.lineTo(3.6 * s, 3.3 * s); c.fill(); // fang
      break;
    case 'gargoyle':
      c.fillStyle = flash ? '#fff' : '#d8d0c0'; // horns sweep back
      for (const dy of [0, 2]) { c.beginPath(); c.moveTo(-1 * s, (-4 + dy) * s); c.quadraticCurveTo(-7 * s, (-5 + dy) * s, -10 * s, (-11 + dy) * s); c.quadraticCurveTo(-6 * s, (-7 + dy) * s, -3 * s, (-2 + dy) * s); c.closePath(); ink(1.8); c.fill(); }
      c.beginPath(); c.rect(-5 * s, -5 * s, 10 * s, 9 * s); ink(); c.fillStyle = col('k'); c.fill();
      c.beginPath(); c.rect(4 * s, -1 * s, 5 * s, 4.5 * s); ink(); c.fill(); // snout
      c.fillStyle = flash ? '#fff' : shade(look.k, 0.6); c.fillRect(-1 * s, -3.4 * s, 6 * s, 1.4 * s); // brow
      c.fillStyle = flash ? '#fff' : '#ffd34d'; c.fillRect(1.4 * s, -2 * s, 2.2 * s, 1.6 * s); // glowing eye
      c.fillStyle = flash ? '#fff' : '#f2efd2'; c.fillRect(5 * s, 3.5 * s, 1.2 * s, 1.6 * s); c.fillRect(7.3 * s, 3.5 * s, 1.2 * s, 1.6 * s); // teeth
      break;
    case 'ptero':
      c.beginPath(); c.moveTo(0.5 * s, -3.6 * s); c.lineTo(-14 * s, -12 * s); c.lineTo(-4.5 * s, -0.5 * s); c.closePath(); ink(); c.fillStyle = flash ? '#fff' : '#e07b39'; c.fill(); // crest, back and up off the skull
      c.beginPath(); c.moveTo(3 * s, -2.5 * s); c.lineTo(18 * s, 0.5 * s); c.lineTo(3 * s, 2.5 * s); c.closePath(); ink(); c.fillStyle = flash ? '#fff' : shade(look.k, 1.18); c.fill(); // beak
      c.beginPath(); c.ellipse(0, 0, 5.5 * s, 4 * s, 0, 0, TAU); ink(); c.fillStyle = col('k'); c.fill();
      c.strokeStyle = INK; c.lineWidth = 1; c.beginPath(); c.moveTo(4 * s, 0.6 * s); c.lineTo(15 * s, 0.9 * s); c.stroke(); // bill line
      dot(1.2 * s, -1.2 * s, 1 * s, '#15161c');
      break;
    case 'vulture': case 'parrot': {
      const parrot = kind === 'parrot';
      c.beginPath(); c.arc(0, 0, (parrot ? 5.5 : 4.2) * s, 0, TAU); ink(); c.fillStyle = col('k'); c.fill();
      if (parrot) { c.fillStyle = flash ? '#fff' : '#f4f1e6'; c.beginPath(); c.ellipse(1.8 * s, 0.3 * s, 2.8 * s, 3.2 * s, 0, 0, TAU); c.fill(); }
      const bx = parrot ? 3.5 : 2.8, len = parrot ? 6 : 5.5; // hooked beak
      c.beginPath(); c.moveTo(bx * s, -2.8 * s); c.quadraticCurveTo((bx + len + 1.5) * s, -3 * s, (bx + len) * s, 3.2 * s); c.lineTo((bx + len - 1.5) * s, 1.4 * s); c.lineTo(bx * s, 1.8 * s); c.closePath();
      ink(); c.fillStyle = flash ? '#fff' : parrot ? '#efe6c8' : '#d8cfa8'; c.fill();
      if (parrot) { c.fillStyle = flash ? '#fff' : '#2a2a2a'; c.beginPath(); c.moveTo(bx * s, 1.8 * s); c.lineTo((bx + 3) * s, 1.6 * s); c.lineTo(bx * s, 3.6 * s); c.fill(); }
      dot((parrot ? 1.6 : 1) * s, -1 * s, 0.95 * s, '#15161c');
      break;
    }
    case 'drone': // camera module: the "head" that pops on a headshot
      c.beginPath(); c.arc(0, 0, 3.8 * s, 0, TAU); ink(); c.fillStyle = flash ? '#fff' : '#1b2230'; c.fill();
      dot(0.8 * s, 0, 2.2 * s, look.k); dot(1.6 * s, -0.8 * s, 0.7 * s, 'rgba(255,255,255,.85)');
      break;
  }
}
function drawFlyer(c, p, look, s, f, flash, cut, headAng, kind, lod) {
  kind = FLY[kind] ? kind : 'gargoyle';
  const K = FLY[kind], col = (k, back) => flash ? '#fff' : shade(look[k] || look.s, back ? 0.76 : 1), lit = !flash && !lod && !GFX_LOW;
  const o = p[1]; let ux = o[0] - p[4][0], uy = o[1] - p[4][1]; const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d;
  const vx = f * uy, vy = -f * ux, loc = q => { const dx = q[0] - o[0], dy = q[1] - o[1]; return [dx * ux + dy * uy, -(dx * vx + dy * vy)]; };
  const W2 = loc(p[2]), W3 = loc(p[3]);
  c.save(); flyFrame(c, o, ux, uy, f); c.lineCap = 'round'; c.lineJoin = 'round';
  if (K.wing === 'rotor') flyDrone(c, W2, W3, s, col, flash, lit);
  else {
    flyWing(c, W2, kind, K, s, col, true);
    if (cut !== 0 && (kind === 'ptero' || kind === 'vulture')) { // neck
      const h = loc(p[0]); c.strokeStyle = INK; c.lineWidth = 5.5 * s; c.beginPath(); c.moveTo(4 * s, -2 * s); c.lineTo(h[0], h[1]); c.stroke();
      c.strokeStyle = kind === 'vulture' ? col('k') : col('s'); c.lineWidth = 3 * s; c.stroke();
    }
    flyBody(c, kind, s, col, lit);
    flyWing(c, W3, kind, K, s, col, false);
  }
  c.restore();
  // head in its own frame (direction neck -> head, or the tumbling angle once it is shot off)
  const h = p[0]; let hx, hy;
  if (headAng != null) { hx = Math.sin(headAng); hy = -Math.cos(headAng); }
  else { hx = h[0] - o[0]; hy = h[1] - o[1]; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l; }
  c.save(); flyFrame(c, h, hx, hy, f); c.lineCap = 'round'; c.lineJoin = 'round'; flyHead(c, kind, look, s, flash, col); c.restore();
}

// ===== dinosaurs (raptor rig): one smooth silhouette through the spine points (tail tip -> hip -> chest -> neck ->
// head), a modelled skull with a working jaw, digitigrade legs with toes, small clawed arms. Painted with
// countershading (dark back, pale belly), dorsal stripes, skin speckles and a lit top edge.
// tw/bw: half-thickness above/below the spine at points 5,4,3,2,1,0; belly: sag between hip and chest.
const DINO = {
  raptor:  { tw: [0.5, 3, 6.5, 6.5, 3.2, 3], bw: [0.5, 3.4, 7.5, 8.5, 3.8, 3.4], belly: 2.6, head: 1,    arm: 1,    sickle: 1, stripes: 1, eye: '#e0a93a' },
  crusher: { tw: [0.7, 3.8, 8, 8, 4, 3.6],     bw: [0.7, 4.2, 9, 10.5, 4.6, 4],   belly: 3,   head: 1.15, arm: 0.9,  sickle: 1, stripes: 1, quills: 1, eye: '#e8c547' },
  rex:     { tw: [0.8, 4.6, 8.5, 9, 6.2, 5.6],  bw: [0.8, 4.8, 9.5, 12, 7, 6.4],   belly: 3.5, head: 1.7,  arm: 0.45, sickle: 0, stripes: 0, spots: 1, eye: '#d8742a' },
};
// quadratic curves through the midpoints of a polyline (smooth, passes through the ends)
function smoothPath(c, Q, move) {
  if (move) c.moveTo(Q[0][0], Q[0][1]); else c.lineTo(Q[0][0], Q[0][1]);
  for (let i = 1; i < Q.length - 1; i++) c.quadraticCurveTo(Q[i][0], Q[i][1], (Q[i][0] + Q[i + 1][0]) / 2, (Q[i][1] + Q[i + 1][1]) / 2);
  c.lineTo(Q[Q.length - 1][0], Q[Q.length - 1][1]);
}
// a muscled limb A -> B: radius r0 -> r1 with an outward bulge at 40 %
function muscle(c, A, B, r0, r1, bulge = 0, keep = false) { // keep: add to the current path (same winding, so parts union)
  const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, rm = ((r0 + r1) / 2 + bulge) * 1.2;
  const M = [A[0] + dx * 0.4, A[1] + dy * 0.4], a = Math.atan2(ny, nx);
  if (!keep) c.beginPath();
  c.moveTo(A[0] + nx * r0, A[1] + ny * r0); c.quadraticCurveTo(M[0] + nx * rm, M[1] + ny * rm, B[0] + nx * r1, B[1] + ny * r1);
  c.arc(B[0], B[1], r1, a, a - Math.PI, true); // round end at B
  c.quadraticCurveTo(M[0] - nx * rm, M[1] - ny * rm, A[0] - nx * r0, A[1] - ny * r0);
  c.arc(A[0], A[1], r0, a + Math.PI, a, true);
  c.closePath();
}
const _hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function drawDino(c, p, look, s, f, flash, cut, headAng, kind, lod) {
  const K = DINO[kind] || DINO.raptor, rich = !flash && !lod && !GFX_LOW;
  const W = flash ? '#fff' : null, body = W || look.s, line = shade(look.p, 0.32);
  const belly = W || mix(look.k, '#efe2bd', 0.55), mid = W || mix(body, belly, 0.45), stripe = rgba(shade(look.p, 0.55), 0.75);
  // --- spine: Catmull-Rom through the rig points, sampled; v = point index + t
  const Q = cut === 0 ? [p[5], p[4], p[3], p[2], p[1]] : [p[5], p[4], p[3], p[2], p[1], p[0]], S = [], N = 5;
  for (let i = 0; i < Q.length - 1; i++) {
    const a = Q[Math.max(0, i - 1)], b = Q[i], e = Q[i + 1], d = Q[Math.min(Q.length - 1, i + 2)];
    for (let k = 0; k < N; k++) {
      const t = k / N, t2 = t * t, t3 = t2 * t, cr = j => 0.5 * (2 * b[j] + (e[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * e[j] - d[j]) * t2 + (3 * b[j] - a[j] - 3 * e[j] + d[j]) * t3);
      S.push([cr(0), cr(1), i + t]);
    }
  }
  S.push([Q[Q.length - 1][0], Q[Q.length - 1][1], Q.length - 1]);
  const T = [], B = [], U = [], sm = x => x * x * (3 - 2 * x);
  for (let i = 0; i < S.length; i++) {
    const A = S[Math.max(0, i - 1)], C = S[Math.min(S.length - 1, i + 1)];
    let tx = C[0] - A[0], ty = C[1] - A[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const ux = f * ty, uy = -f * tx, v = S[i][2], j = Math.min(4, Math.floor(v)), fr = sm(v - j), sag = j === 2 ? Math.sin(Math.PI * (v - j)) : 0;
    const tw = lerp(K.tw[j], K.tw[j + 1], fr) * s + sag * 0.6 * s, bw = lerp(K.bw[j], K.bw[j + 1], fr) * s + sag * K.belly * s;
    T.push([S[i][0] + ux * tw, S[i][1] + uy * tw]); B.push([S[i][0] - ux * bw, S[i][1] - uy * bw]); U.push([ux, uy, tw, bw, tx, ty]);
  }
  const at = v => Math.min(S.length - 1, Math.round(v * N)); // sample index of spine position v
  const silhouette = new Path2D(), e = S.length - 1;
  smoothPath(silhouette, T, true); // back, round cap at the head end, belly
  silhouette.quadraticCurveTo(S[e][0] + U[e][4] * U[e][3] * 0.8, S[e][1] + U[e][5] * U[e][3] * 0.8, B[e][0], B[e][1]);
  smoothPath(silhouette, B.slice().reverse(), false); silhouette.closePath();
  c.lineCap = 'round'; c.lineJoin = 'round';
  // --- legs: hip -> knee is the thigh; the lower leg bends back at a derived ankle, then long foot + toes
  const thigh = (H, Kn) => muscle(c, H, Kn, 8 * s, 3.4 * s, 1 * s);
  const lower = (H, Kn, F, back) => {
    const col = W || shade(body, back ? 0.72 : 1), dk = W || shade(body, back ? 0.6 : 0.8);
    const dx = F[0] - Kn[0], dy = F[1] - Kn[1], l = Math.hypot(dx, dy) || 1; let nx = -dy / l, ny = dx / l;
    if (nx * (H[0] - Kn[0]) + ny * (H[1] - Kn[1]) < 0) { nx = -nx; ny = -ny; } // the ankle sits on the hip's side of knee->foot
    const An = [Kn[0] + dx * 0.55 + nx * l * 0.26, Kn[1] + dy * 0.55 + ny * l * 0.26];
    const ax = F[0] - An[0], ay = F[1] - An[1], al = Math.hypot(ax, ay) || 1, D = [f * ay / al, -f * ax / al], G = [-f * D[1], f * D[0]]; // toes forward, G toward the sole
    const ft = (a, b) => [F[0] + D[0] * a * s + G[0] * b * s, F[1] + D[1] * a * s + G[1] * b * s];
    c.beginPath(); // two toes in one path
    for (const [len, dn] of [[6.5, 2.2], [5, 2.6]]) { const m = ft(len * 0.6, dn * 0.2), t = ft(len, dn); c.moveTo(F[0], F[1]); c.quadraticCurveTo(m[0], m[1], t[0], t[1]); }
    c.strokeStyle = line; c.lineWidth = 3.8 * s; c.stroke(); c.strokeStyle = dk; c.lineWidth = 2.2 * s; c.stroke();
    if (K.sickle && !flash) { // the raised killing claw on the second toe
      const q = [ft(0.7, -1.2), ft(3.9, -3.8), ft(4.9, 1), ft(3.3, -2), ft(2.4, -1.2)];
      c.beginPath(); c.moveTo(q[0][0], q[0][1]); c.quadraticCurveTo(q[1][0], q[1][1], q[2][0], q[2][1]); c.quadraticCurveTo(q[3][0], q[3][1], q[4][0], q[4][1]); c.closePath();
      c.fillStyle = back ? '#2a2520' : '#3b342c'; c.fill(); c.strokeStyle = line; c.lineWidth = 1.2; c.stroke();
    }
    muscle(c, An, F, 2.2 * s, 1.7 * s); c.fillStyle = dk; c.fill(); c.strokeStyle = line; c.lineWidth = 1.6; c.stroke(); // foot (metatarsus)
    muscle(c, Kn, An, 3.4 * s, 2.2 * s, 0.7 * s); c.fillStyle = col; c.fill(); c.stroke(); // shin
  };
  // --- arm from the base of the neck: upper arm down/back, forearm forward, three hooked fingers
  const arm = back => {
    const i = at(3.25), [ux, uy, , bw, tx, ty] = U[i], sc = K.arm * s, dk = W || shade(body, back ? 0.7 : 0.9);
    const Sh = [S[i][0] - ux * bw * 0.3, S[i][1] - uy * bw * 0.3], E = [Sh[0] - ux * 5.5 * sc - tx * 2 * sc, Sh[1] - uy * 5.5 * sc - ty * 2 * sc];
    const Wr = [E[0] + tx * 5.5 * sc - ux * 1.2 * sc, E[1] + ty * 5.5 * sc - uy * 1.2 * sc];
    c.beginPath();
    for (let k = 0; k < 3; k++) { const a = -0.5 + k * 0.45, dx = tx * Math.cos(a) - ux * Math.sin(a) * 1.4, dy = ty * Math.cos(a) - uy * Math.sin(a) * 1.4;
      c.moveTo(Wr[0], Wr[1]); c.quadraticCurveTo(Wr[0] + dx * 3 * sc, Wr[1] + dy * 3 * sc, Wr[0] + dx * 3.2 * sc - ux * 1.8 * sc, Wr[1] + dy * 3.2 * sc - uy * 1.8 * sc); }
    c.lineWidth = 1.1 * sc + 1.2; c.strokeStyle = line; c.stroke(); c.lineWidth = 1.1 * sc; c.strokeStyle = W || '#3b342c'; c.stroke();
    c.lineWidth = 1.3; c.strokeStyle = line; c.fillStyle = dk;
    muscle(c, E, Wr, 1.2 * sc, 0.9 * sc); c.fill(); c.stroke();
    muscle(c, Sh, E, 1.9 * sc, 1.2 * sc, 0.3 * sc); c.fill(); c.stroke();
  };
  // far side, behind the body
  lower(p[3], p[8], p[9], true); thigh(p[3], p[8]); c.fillStyle = W || shade(body, 0.72); c.fill(); c.strokeStyle = line; c.lineWidth = 1.6; c.stroke();
  arm(true);
  // the near thigh's ink goes down first: the body covers it where they overlap, so the thigh is outlined only below the belly
  thigh(p[3], p[6]); c.strokeStyle = line; c.lineWidth = 3.4; c.stroke();
  // --- body: base fill, paint, ink edge on top (no clip: every painted strip ends exactly on the silhouette edge)
  c.fillStyle = body; c.fill(silhouette);
  if (!flash) {
    const band = (k0, k1, from, to, fill) => { // strip between two relative depths (1 = top edge, -1 = bottom edge)
      const d = (i, k) => k >= 0 ? U[i][2] * k : U[i][3] * k, P0 = [], P1 = [];
      for (let i = from; i <= to; i++) { P0.push([S[i][0] + U[i][0] * d(i, k0), S[i][1] + U[i][1] * d(i, k0)]); P1.push([S[i][0] + U[i][0] * d(i, k1), S[i][1] + U[i][1] * d(i, k1)]); }
      c.beginPath(); smoothPath(c, P0, true); smoothPath(c, P1.reverse(), false); c.closePath(); c.fillStyle = fill; c.fill();
    };
    band(-0.05, -0.45, 0, e, mid); band(-0.4, -1, 0, e, belly); // countershading
    if (rich) {
      if (K.stripes) { // dorsal stripes, slanting back
        c.beginPath();
        for (let v = 0.25; v < 3.4; v += 0.3 + _hash(v * 7) * 0.12) {
          const i = at(v), j = Math.min(e, i + 1), w = 0.35 + _hash(v) * 0.35, dep = -0.1 - _hash(v * 3) * 0.35;
          c.moveTo(T[i][0], T[i][1]); c.lineTo(T[j][0] + (T[j][0] - T[i][0]) * w, T[j][1] + (T[j][1] - T[i][1]) * w); c.lineTo(S[i][0] + U[i][0] * U[i][3] * dep, S[i][1] + U[i][1] * U[i][3] * dep); c.closePath();
        }
        c.fillStyle = stripe; c.fill();
      }
      c.beginPath(); // skin speckles / mottling
      for (let i = 2; i < e - 1; i++) for (let k = 0; k < (K.spots ? 3 : 2); k++) {
        const h = _hash(i * 3 + k), dep = (h - 0.25) * 1.1, r = (K.spots ? 1.1 + h * 1.4 : 0.5 + h * 0.5) * s, d = dep >= 0 ? U[i][2] * dep : U[i][3] * dep;
        const x = S[i][0] + U[i][0] * d + U[i][4] * h * 3 * s, y = S[i][1] + U[i][1] * d + U[i][5] * h * 3 * s;
        c.moveTo(x + r, y); c.ellipse(x, y, r, r * 0.7, 0, 0, TAU);
      }
      c.fillStyle = rgba(shade(look.p, 0.4), 0.35); c.fill();
      band(1, 0.72, 1, e, RIM); // light on the back
      band(-0.82, -1, 2, e, 'rgba(0,0,0,.18)'); // underside in shadow
    }
  }
  c.strokeStyle = line; c.lineWidth = 1.8; c.stroke(silhouette);
  if (K.quills && rich) { // a crest of dark quills along the neck and shoulders
    c.beginPath();
    for (let v = 2.4; v < 4.6; v += 0.18) { const i = at(v), [ux, uy, tw, , tx, ty] = U[i], l = (2.6 + _hash(v) * 1.6) * s;
      c.moveTo(S[i][0] + ux * tw * 0.8, S[i][1] + uy * tw * 0.8); c.lineTo(S[i][0] + ux * (tw + l) - tx * l * 0.9, S[i][1] + uy * (tw + l) - ty * l * 0.9); }
    c.strokeStyle = shade(look.p, 0.45); c.lineWidth = 1.3; c.stroke();
  }
  lower(p[3], p[6], p[7], false);
  thigh(p[3], p[6]); c.fillStyle = body; c.fill(); // near thigh over the body and the knee
  if (rich) {
    c.strokeStyle = rgba(line, 0.3); c.lineWidth = 1; c.stroke(); // soft muscle contour
    const H = p[3], Kn = p[6], l = Math.hypot(Kn[0] - H[0], Kn[1] - H[1]) || 1; let nx = (H[1] - Kn[1]) / l, ny = (Kn[0] - H[0]) / l;
    if (nx * f < 0) { nx = -nx; ny = -ny; } // n: toward the front of the thigh
    const off = (P, k) => [P[0] + nx * k * s, P[1] + ny * k * s];
    muscle(c, off(H, -2.6), off(Kn, -0.9), 4.6 * s, 1.6 * s); c.fillStyle = 'rgba(0,0,0,.16)'; c.fill(); // shaded back (stays inside the thigh)
    muscle(c, off(H, 2.4), off(Kn, 0.9), 3.6 * s, 1 * s); c.fillStyle = RIM; c.fill(); // lit front
  }
  arm(false);
  if (cut === 0 && !flash) { const [, , tw, bw, tx, ty] = U[e]; // neck stump
    c.save(); c.translate(S[e][0] + tx * 0.5 * s, S[e][1] + ty * 0.5 * s); c.rotate(Math.atan2(ty, tx)); c.beginPath(); c.ellipse(0, 0, 1.4 * s, (tw + bw) / 2 * 0.9, 0, 0, TAU);
    c.fillStyle = '#7a1418'; c.fill(); c.fillStyle = '#e8dcc8'; c.beginPath(); c.arc(0, 0, 0.9 * s, 0, TAU); c.fill(); c.restore(); }
  // --- head in its own frame: +x along the snout, +y toward the jaw; open jaw while lunging (neck stretched)
  const h = p[0], nb = p[1]; let hx, hy;
  if (headAng != null) { hx = Math.sin(headAng); hy = -Math.cos(headAng); } else { hx = h[0] - nb[0]; hy = h[1] - nb[1]; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l; }
  const jaw = lod ? 0.3 : clamp((Math.hypot(h[0] - nb[0], h[1] - nb[1]) / s - 13) / 8, 0, 1);
  c.save(); flyFrame(c, h, hx, hy, f); c.rotate(0.28); const z = s * K.head; c.scale(z, z);
  dinoHead(c, K, flash, rich, jaw, { body, belly, line, stripe }, 1.6 / z);
  c.restore();
}
// skull in local units (1 = s): back of the head at x = -7, snout tip at x = 17.5; details stay inside the outline,
// which is inked last (no clipping)
let SKULL = null; // built on first use (Path2D does not exist in the Node sim)
function dinoHead(c, K, flash, rich, jaw, C, lw) {
  const [up, lowJ, lip, lit] = SKULL || (SKULL = [
    'M-6 3 Q-8 -1 -4 -5 Q0 -6.4 4 -4.8 L10 -3.6 Q15 -3.4 17 -1.6 Q18 0.4 16.4 1.6 L6 2.6 L-1 3.1 Z',
    'M-3 2.4 L15.6 2.1 Q16.4 2.6 15.6 3.3 Q10 4.9 3 5.5 Q-2 6.6 -5.5 5.4 Q-6.8 4 -3 2.4 Z',
    'M-6 3 Q2 1.2 16.9 0.2 Q17.4 1 16.4 1.6 L6 2.6 L-1 3.1 Z',
    'M-6.4 -0.8 Q-6.6 -3.4 -4 -5 Q0 -6.4 4 -4.8 L10 -3.6 Q13.5 -3.4 15.5 -2.5 Q12.5 -2.6 10 -2.7 L4 -3.9 Q0 -5.3 -3.4 -4.1 Q-5.5 -2.9 -6.4 -0.8 Z',
  ].map(d => new Path2D(d)));
  const teeth = (x0, x1, y, dir) => { c.beginPath(); for (let x = x0; x < x1; x += 1.45) { c.moveTo(x, y); c.lineTo(x + 0.45, y + dir * (1.1 + (x % 3) * 0.12)); c.lineTo(x + 0.9, y); } c.fillStyle = '#efe7cf'; c.fill(); };
  const a = jaw * 0.5;
  if (a > 0.02 && !flash) { // mouth interior behind the jaws
    c.beginPath(); c.moveTo(-3, 2.6); c.lineTo(16, 1.8); c.lineTo(-3 + 18.6 * Math.cos(a), 2.6 + 18.6 * Math.sin(a)); c.closePath(); c.fillStyle = '#5a1b1f'; c.fill();
  }
  c.save(); c.translate(-3, 2.4); c.rotate(a); c.translate(3, -2.4); // lower jaw hinges behind the eye
  c.fillStyle = C.belly; c.fill(lowJ);
  if (!flash) { teeth(2, 15, 2.4, -1); if (rich) { c.strokeStyle = rgba(C.line, 0.5); c.lineWidth = lw * 0.6; c.beginPath(); c.moveTo(-2, 4.4); c.quadraticCurveTo(6, 4.6, 13, 3.4); c.stroke(); } }
  c.strokeStyle = C.line; c.lineWidth = lw; c.stroke(lowJ);
  c.restore();
  if (!flash) teeth(2.6, 16, 2.3, 1);
  c.fillStyle = C.body; c.fill(up);
  if (!flash) {
    c.fillStyle = C.belly; c.fill(lip); // pale upper lip
    if (rich) {
      c.fillStyle = RIM; c.fill(lit);
      if (K.stripes) { c.beginPath(); c.moveTo(-6.1, -1); c.lineTo(-3.5, -5.2); c.lineTo(-2.6, -2.2); c.closePath(); c.moveTo(5, -4.6); c.lineTo(7, -4.2); c.lineTo(5.4, -2.2); c.closePath(); c.fillStyle = C.stripe; c.fill(); }
      c.beginPath(); for (const [x, y, r] of [[8, -2.3, 0.5], [10.5, -2.6, 0.45], [12, -1.6, 0.4], [3, -3.2, 0.5], [-4, 0.5, 0.6]]) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fillStyle = rgba(C.line, 0.3); c.fill();
    }
  }
  c.strokeStyle = C.line; c.lineWidth = lw; c.stroke(up);
  if (flash) return;
  c.fillStyle = shade(C.line, 1.4); c.beginPath(); c.ellipse(15.2, -1.5, 1.1, 0.55, -0.2, 0, TAU); c.fill(); // nostril
  c.fillStyle = shade(C.body, 0.55); c.beginPath(); c.ellipse(-0.6, -2, 2.5, 1.9, 0, 0, TAU); c.fill(); // eye socket
  c.fillStyle = K.eye; c.beginPath(); c.ellipse(-0.5, -2, 1.7, 1.3, 0, 0, TAU); c.fill();
  c.fillStyle = '#120d0a'; c.beginPath(); c.ellipse(-0.3, -2, 0.42, 1.15, 0, 0, TAU); c.fill(); // slit pupil
  c.fillStyle = 'rgba(255,255,255,.85)'; c.beginPath(); c.arc(-1.1, -2.6, 0.38, 0, TAU); c.fill();
  c.strokeStyle = C.line; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-3.8, -3.4); c.quadraticCurveTo(-0.6, -4.7, 2.6, -3.5); c.stroke(); // brow ridge
  if (rich) { c.strokeStyle = rgba(C.line, 0.55); c.lineWidth = 0.5; c.beginPath(); c.moveTo(-5.4, 0.6); c.quadraticCurveTo(-4.2, 2.2, -2.2, 2.6); c.moveTo(-4.8, -0.6); c.quadraticCurveTo(-3.8, 1, -1.8, 1.4); c.stroke(); } // jaw-muscle creases
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
  if (rig === 'flyer') return drawFlyer(c, p, look, s, f, flash, cut, headAng, opt.fly, lod);
  if (opt.dino) return drawDino(c, p, look, s, f, flash, cut, headAng, opt.dino, lod);
  if (rig === 'human' && !opt.old && !GFX_LOW) return drawHuman(c, p, look, s, f, flash, hat, cut, headAng, opt, lod);
  const R = RIGS[rig], col = (k, back) => flash ? '#fff' : shade(look[k] || look.s, back ? 0.76 : 1);
  c.lineCap = 'round'; c.lineJoin = 'round';
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
  if (rig === 'raptor') {
    obox(c, -r * 0.75, -r * 1.7, r * 1.5, r * 2.4, k);
    c.fillStyle = dark; c.fillRect(-f * r * 0.35 - r * 0.15, -r * 0.9, r * 0.3, r * 0.3);
    c.fillRect(f * r * 0.15, -r * 1.7, r * 0.12, r * 1.3);
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

// ===== humans (human rig): smooth torso, jointed tapered limbs (one union path per limb, so no seam at the knee/elbow),
// shoes, hands, a modelled head with faces and headgear. Same clip-free recipe as the dinos.
// torso profile: [y (up is negative, hips at 0), half-thickness in front, half-thickness behind] in units of s
const HT = [[3, 4.5, 5.5], [0, 6, 7], [-5, 6.2, 7], [-11, 5.3, 5.4], [-17, 6.8, 6], [-22, 8.2, 6.4], [-26, 7, 6.6], [-29, 4.8, 5.8], [-31.5, 3.3, 3.8]];
function htProf(y) {
  for (let i = 0; i < HT.length - 1; i++) { const a = HT[i], b = HT[i + 1]; if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; } }
  return y > 0 ? [HT[0][1], HT[0][2]] : [HT[HT.length - 1][1], HT[HT.length - 1][2]];
}
function drawHuman(c, p, look, s, f, flash, hat, cut, headAng, opt, lod) {
  const rich = !flash && !lod, W = flash ? '#fff' : null, deco = opt.deco, LW = 1.7;
  const cs = { k: look.k, s: look.s, p: look.p || shade(look.s, 0.6), a: look.a || look.s };
  const fill = (k, bk) => W || shade(cs[k], bk ? 0.74 : 1), ink = (k, bk) => shade(cs[k], bk ? 0.26 : 0.34);
  const Nk = p[1], Pl = p[2]; let ux = Nk[0] - Pl[0], uy = Nk[1] - Pl[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const fx = -f * uy, fy = f * ux, Wd = (lx, ly) => [Pl[0] + (fx * lx - ux * ly) * s, Pl[1] + (fy * lx - uy * ly) * s]; // torso frame -> world
  c.lineCap = 'round'; c.lineJoin = 'round';
  const lit = (A, B, r0, r1, C, r2) => { // thin light line on the sky side of a two-segment limb (one stroke)
    c.beginPath();
    for (const [a, b, q0, q1] of [[A, B, r0, r1], [B, C, r1, r2]]) {
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1; let nx = -dy / d, ny = dx / d; if (nx > 0.05 || (Math.abs(nx) <= 0.05 && ny > 0)) { nx = -nx; ny = -ny; }
      c.moveTo(a[0] + nx * q0 * 0.5, a[1] + ny * q0 * 0.5); c.lineTo(b[0] + nx * q1 * 0.5, b[1] + ny * q1 * 0.5);
    }
    c.strokeStyle = RIM; c.lineWidth = 1.3 * s; c.stroke();
  };
  const shoe = (Kn, Ft, bk) => {
    const phi = Math.atan2((Ft[0] - Kn[0]) * f, Ft[1] - Kn[1]), col = deco === 'fur' ? '#6b4a2b' : deco === 'wrap' ? cs.p : '#2a2d38';
    c.save(); c.translate(Ft[0], Ft[1]); c.scale(f * s, s); c.rotate(-phi * 0.5);
    const SP = SHOE || (SHOE = new Path2D('M-4.6 -3.6 L1.4 -3.8 Q3.6 -2 6.4 -0.2 Q9 0.8 9 2.2 Q9 3.2 7.8 3.2 L-4 3.2 Q-5 3.2 -4.9 1.6Z'));
    c.fillStyle = W || shade(col, bk ? 0.8 : 1); c.fill(SP);
    if (rich) { c.beginPath(); c.moveTo(-4.9, 1.8); c.lineTo(9, 1.8); c.lineTo(9, 3.2); c.lineTo(-4.9, 3.2); c.fillStyle = 'rgba(0,0,0,.4)'; c.fill(); }
    c.strokeStyle = shade(col, 0.3); c.lineWidth = LW / s; c.stroke(SP); c.restore();
  };
  const leg = (Kn, Ft, bk) => {
    const Hp = Wd(bk ? -1.5 : 1, 2);
    c.beginPath(); muscle(c, Hp, Kn, 6.6 * s, 4.3 * s, 0.9 * s, true); muscle(c, Kn, Ft, 4.3 * s, 2.6 * s, 1.2 * s, true);
    c.strokeStyle = ink('p', bk); c.lineWidth = LW * 2; c.stroke(); c.fillStyle = fill('p', bk); c.fill();
    if (rich && !bk) lit(Hp, Kn, 6.6 * s, 4.3 * s, Ft, 2.6 * s);
    shoe(Kn, Ft, bk);
  };
  const hand = (E, Hd, bk) => {
    const dx = Hd[0] - E[0], dy = Hd[1] - E[1], d = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
    const cx = Hd[0] + dx / d * 1.3 * s, cy = Hd[1] + dy / d * 1.3 * s;
    c.beginPath(); c.ellipse(cx, cy, 3.5 * s, 2.6 * s, a, 0, TAU);
    c.moveTo(cx + (dx / d) * 1 * s + (-dy / d * f) * 2.2 * s + 1.1 * s, cy + (dy / d) * 1 * s + (dx / d * f) * 2.2 * s); c.ellipse(cx + dx / d * 0.8 * s - dy / d * f * 2.3 * s, cy + dy / d * 0.8 * s + dx / d * f * 2.3 * s, 1.5 * s, 1.1 * s, a, 0, TAU);
    c.strokeStyle = ink('k', bk); c.lineWidth = LW * 1.8; c.stroke(); c.fillStyle = fill('k', bk); c.fill();
  };
  const arm = (E, Hd, bk) => {
    const S = Wd(bk ? -1.5 : 0.5, -27);
    c.beginPath(); muscle(c, S, E, 4.4 * s, 3.4 * s, 0.5 * s, true); muscle(c, E, Hd, 3.4 * s, 2.4 * s, 0.6 * s, true);
    c.strokeStyle = ink('a', bk); c.lineWidth = LW * 2; c.stroke(); c.fillStyle = fill('a', bk); c.fill();
    if (rich && !bk) lit(S, E, 4.4 * s, 3.4 * s, Hd, 2.4 * s);
    hand(E, Hd, bk);
  };
  // ---- torso (drawn in its own local frame: +x forward, -y toward the neck, units of s)
  const torso = () => {
    c.save(); c.transform(fx * s, fy * s, -ux * s, -uy * s, Pl[0], Pl[1]);
    const lw = LW / s, ls = f > 0 ? -1 : 1, n = HT.length;
    const silh = () => { const Q = []; for (let i = 0; i < n; i++) Q.push([HT[i][1], HT[i][0]]); for (let i = n - 1; i >= 0; i--) Q.push([-HT[i][2], HT[i][0]]); c.beginPath(); smoothPath(c, Q, true); c.closePath(); };
    const strip = (y0, y1, col) => { // band between two heights, edges on the silhouette
      const ys = [y0]; for (const h of HT) if (h[0] < y0 && h[0] > y1) ys.push(h[0]); ys.push(y1);
      c.beginPath(); ys.forEach((y, i) => { const x = htProf(y)[0]; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      for (let i = ys.length - 1; i >= 0; i--) c.lineTo(-htProf(ys[i])[1], ys[i]);
      c.closePath(); c.fillStyle = W || col; c.fill();
    };
    const edge = (y0, y1, dep, col) => { // strip along one side, dep deep
      c.beginPath(); const ys = [y0]; for (const h of HT) if (h[0] < y0 && h[0] > y1) ys.push(h[0]); ys.push(y1);
      const ex = y => ls < 0 ? -htProf(y)[1] : htProf(y)[0];
      ys.forEach((y, i) => i ? c.lineTo(ex(y), y) : c.moveTo(ex(y), y)); for (let i = ys.length - 1; i >= 0; i--) c.lineTo(ex(ys[i]) - ls * dep, ys[i]);
      c.closePath(); c.fillStyle = col; c.fill();
    };
    const belt = (y, col) => { strip(y + 1.2, y - 1.4, col); if (!W) { c.fillStyle = '#c9a23a'; c.fillRect(2, y - 1.6, 3.4, 3.2); } };
    const dkS = shade(cs.s, 0.72), pants = cs.p;
    let hem = -8.5; if (deco === 'fur') hem = -4; else if (deco === 'robe' || deco === 'coat') hem = 3;
    silh(); c.fillStyle = W || cs.s; c.fill();
    if (hem < 3) strip(3, hem, pants);
    if (rich) {
      switch (deco) {
        case 'torn': { // ragged shirt hem, stains, a chest wound
          c.beginPath(); c.moveTo(-8, -3); for (let i = 0; i <= 6; i++) c.lineTo(-7 + i * 2.3, i % 2 ? -3.4 : -9.6); c.lineTo(9, -3); c.closePath(); c.fillStyle = cs.p; c.fill();
          strip(-8.6, -10.2, cs.p); c.beginPath(); c.moveTo(-8, -10.2); for (let i = 0; i <= 6; i++) c.lineTo(-7 + i * 2.3, i % 2 ? -7 : -10.6); c.lineTo(9, -10.2); c.closePath(); c.fillStyle = cs.s; c.fill();
          c.fillStyle = 'rgba(120,20,20,.55)'; c.beginPath(); c.ellipse(3, -20, 3.2, 2.4, 0.4, 0, TAU); c.ellipse(-2, -14, 2, 1.6, 0, 0, TAU); c.fill();
          c.fillStyle = '#5a1216'; c.beginPath(); c.ellipse(2, -22, 1.9, 1.2, -0.5, 0, TAU); c.fill(); break;
        }
        case 'armor': {
          strip(-12, -28, mix(cs.s, '#aab2bc', 0.5)); c.beginPath(); for (let k = 1; k <= 3; k++) { c.moveTo(-6.5, -12 - k * 4); c.lineTo(8.2, -12 - k * 4); }
          c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 1; c.stroke(); strip(-27.6, -29.2, '#9aa3ad'); belt(-9.5, '#3a3a40');
          c.beginPath(); c.moveTo(-3.2, -26); c.lineTo(-3.2, -14); c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1.5; c.stroke(); break;
        }
        case 'fur': {
          c.beginPath(); c.moveTo(-8, -3); for (let i = 0; i <= 6; i++) c.lineTo(-7 + i * 2.3, i % 2 ? -1 : -6.4); c.lineTo(9, -3); c.closePath(); c.fillStyle = cs.s; c.fill();
          strip(-5, -6.6, cs.s); c.fillStyle = dkS; c.beginPath(); c.arc(3, -18, 2.1, 0, TAU); c.arc(-3, -11, 1.7, 0, TAU); c.arc(1, -25, 1.5, 0, TAU); c.fill();
          c.strokeStyle = shade(cs.s, 0.5); c.lineWidth = 2.3; c.beginPath(); c.moveTo(-5, -28); c.lineTo(5, -6); c.stroke(); break;
        }
        case 'robe': strip(-9.8, -11.6, '#8a6a3a'); c.beginPath(); c.moveTo(0, -30); c.lineTo(1.4, -22); c.moveTo(-2.6, -28); c.lineTo(-1.4, -12); c.strokeStyle = 'rgba(0,0,0,.16)'; c.lineWidth = 1; c.stroke(); break;
        case 'wrap': {
          c.beginPath(); for (let k = 0; k < 6; k++) { const y = -4 - k * 4.6; c.moveTo(-8, y + 3); c.lineTo(9, y - 3); } c.strokeStyle = 'rgba(110,90,60,.5)'; c.lineWidth = 1.3; c.stroke();
          strip(3, hem, shade(cs.p, 0.92)); break;
        }
        case 'stone': c.beginPath(); c.moveTo(-3, -26); c.lineTo(1, -19); c.lineTo(-2, -12); c.moveTo(4, -17); c.lineTo(1.5, -9); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.1; c.stroke();
          c.fillStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.arc(4, -23, 2.2, 0, TAU); c.arc(-3, -16, 1.8, 0, TAU); c.arc(3, -6, 1.6, 0, TAU); c.fill(); break;
        case 'royal': {
          strip(-9.5, -11, '#1f4e8c'); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(0.4, -29.5, 7.6, 0, Math.PI); c.fill();
          c.fillStyle = '#1f4e8c'; c.beginPath(); c.arc(0.4, -29.5, 5, 0, Math.PI); c.fill(); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(0.4, -29.5, 3, 0, Math.PI); c.fill();
          c.fillStyle = '#c9a23a'; c.fillRect(2, -11.6, 3.4, 3.2); strip(-9.5, -3, '#f2eddc'); break;
        }
        case 'vest': {
          strip(-9.5, -28.5, shade(cs.s, 0.62)); c.fillStyle = shade(cs.s, 1.12); c.fillRect(-1, -28.5, 2.6, 19); belt(-9.5, shade(cs.p, 0.7));
          c.fillStyle = '#e8c547'; c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 1.1 : 2.6; c.lineTo(4 + Math.cos(a) * rr, -21 + Math.sin(a) * rr); } c.fill(); break;
        }
        case 'sash': strip(-6, -11, '#c0392b'); c.beginPath(); c.moveTo(2, -6); c.lineTo(4.6, 3); c.lineTo(1.2, 1.4); c.lineTo(-0.6, 4); c.lineTo(-0.4, -6); c.closePath(); c.fillStyle = '#c0392b'; c.fill(); belt(-5.4, '#4a3320'); break;
        case 'coat': for (let k = 1; k <= 3; k++) { c.fillStyle = '#e8c547'; c.beginPath(); c.arc(3.6, -k * 6.6 - 3, 1.2, 0, TAU); c.fill(); }
          c.fillStyle = shade(cs.s, 1.3); c.beginPath(); c.moveTo(1, -30); c.lineTo(5, -22); c.lineTo(3, -12); c.lineTo(-0.5, -22); c.closePath(); c.fill(); strip(-9.8, -11, '#3a2a1c'); break;
        case 'stripes': c.fillStyle = 'rgba(30,50,110,.6)'; for (let k = 0; k < 5; k++) strip(-6 - k * 4.6, -8.2 - k * 4.6, 'rgba(30,50,110,.6)'); belt(-9.5, '#2a2a3a'); break;
        case 'robot': {
          c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.strokeRect(-4.6, -25, 9.6, 12); c.beginPath(); c.moveTo(-6, -11); c.lineTo(7, -11); c.stroke();
          c.fillStyle = '#39e1ff'; c.beginPath(); c.arc(3, -19, 2.3, 0, TAU); c.fill(); c.fillStyle = '#e8ffff'; c.beginPath(); c.arc(3, -19, 0.9, 0, TAU); c.fill();
          strip(-8.5, -11, '#2a3140'); break;
        }
        case 'tactical': {
          strip(-12.5, -29.5, '#1a2236'); c.fillStyle = '#2d3a58'; c.fillRect(2.4, -20.5, 3.6, 5.2); c.fillRect(2.4, -14.4, 3.6, 5); c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(-6, -29.5, 12, 1.4);
          c.beginPath(); c.moveTo(-1.6, -28); c.lineTo(-1.6, -13); c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 1.1; c.stroke(); belt(-10, '#10141f'); break;
        }
        default: c.fillStyle = dkS; c.beginPath(); c.moveTo(-3, -31); c.lineTo(2, -25); c.lineTo(3.2, -31); c.fill(); belt(-9, shade(cs.p, 0.6));
      }
      edge(-4, -28, 1.9, RIM); // light on the sky side
    } else if (hem < 3) belt(-9, shade(cs.p, 0.6));
    silh(); c.strokeStyle = shade(cs.s, 0.3); c.lineWidth = lw; c.stroke();
    if (cut === 0 && !flash) { c.fillStyle = '#7a1418'; c.beginPath(); c.ellipse(0.2, -31.4, 3.6, 1.3, 0, 0, TAU); c.fill(); c.fillStyle = '#e8dcc8'; c.beginPath(); c.arc(0.2, -31.4, 1, 0, TAU); c.fill(); }
    c.restore();
  };
  const skirt = (hemY, fl, col) => { // robe / coat tails over the thighs
    c.save(); c.transform(fx * s, fy * s, -ux * s, -uy * s, Pl[0], Pl[1]);
    c.beginPath(); c.moveTo(6.6, -9); c.quadraticCurveTo(7 + fl * 0.4, hemY * 0.5, 6.4 + fl, hemY); c.quadraticCurveTo(0, hemY + 2.2, -6.8 - fl, hemY); c.quadraticCurveTo(-7 - fl * 0.4, hemY * 0.5, -7, -9); c.closePath();
    c.fillStyle = W || col; c.fill(); c.strokeStyle = shade(col, 0.3); c.lineWidth = LW / s; c.stroke();
    if (rich) { c.beginPath(); c.moveTo(-1, -6); c.lineTo(-2 - fl * 0.2, hemY - 1); c.moveTo(3, -6); c.lineTo(3.6 + fl * 0.3, hemY - 1); c.strokeStyle = 'rgba(0,0,0,.14)'; c.lineWidth = 1 / s * s; c.stroke();
      c.beginPath(); c.moveTo(6.5 + fl, hemY - 0.2); c.quadraticCurveTo(0, hemY + 2, -6.8 - fl, hemY - 0.2); c.strokeStyle = shade(col, 0.6); c.lineWidth = 2; c.stroke(); }
    c.restore();
  };
  // ---- assemble: far arm, far leg, neck, torso, near leg, skirt, head, near arm
  const h = p[0], sk = fill('k', false);
  arm(p[3], p[4], true); leg(p[7], p[8], true);
  const upH = [h[0] - Nk[0], h[1] - Nk[1]], ul2 = Math.hypot(upH[0], upH[1]) || 1;
  if (cut !== 0) { const Nb = Wd(0.4, -29), Nt = [h[0] - upH[0] / ul2 * 7 * s, h[1] - upH[1] / ul2 * 7 * s];
    muscle(c, Nb, Nt, 3.4 * s, 3.1 * s); c.strokeStyle = ink('k'); c.lineWidth = LW * 2; c.stroke(); c.fillStyle = sk; c.fill(); }
  torso();
  leg(p[9], p[10], false);
  if (deco === 'robe') skirt(21, 3, cs.s); else if (deco === 'coat') skirt(14, 2.5, cs.s);
  { const ang = headAng ?? Math.atan2(h[1] - Nk[1], h[0] - Nk[0]) + Math.PI / 2, S = s * 0.92;
    c.save(); c.translate(h[0], h[1]); c.rotate(ang); c.scale(f * S, S); c.translate(0, -1.6);
    humanHead(c, look, hat, opt.face, flash, rich, LW / S, cut === 0); c.restore(); }
  arm(p[5], p[6], false);
}
let SHOE = null;
let HP = null; // head paths, built on first use (Path2D does not exist in the Node sim)
const headPaths = () => HP || (HP = {
  face: new Path2D('M-0.5 -10.6 C5.2 -10.8 8.8 -7 8.9 -2.6 L9.1 -1.2 L9 0.2 L10.8 3.4 L9 4.2 L9.3 5.2 L8.5 6 L9 6.9 L8.2 7.8 Q8.4 9.6 6.2 10.3 Q3 10.8 -1.5 9.3 Q-5 7.8 -6.5 4 C-9.5 2.5 -9.8 -3.5 -7.5 -7.2 C-5.8 -9.8 -3 -10.6 -0.5 -10.6Z'),
  jaw: new Path2D('M-6.4 3.6 Q-4.5 8.6 -1 9.4 Q3 10.6 6.2 10.3 Q8.2 9.6 8.2 7.8 Q3 8.4 -0.6 7.6 Q-4 6.6 -6.4 3.6Z'),
  top: new Path2D('M-6.6 -7.4 Q-2 -10.8 4 -9.8 Q0 -9.4 -3.4 -7.6 Q-5.4 -6.6 -6.6 -7.4Z'),
  hairS: new Path2D('M8.6 -5.2 C8.8 -10.2 4 -12 -0.5 -11.8 C-6.6 -11.6 -11 -6.8 -10.2 0 C-10 2.8 -9.2 4.4 -8.2 5.6 L-6.8 3.6 C-6.8 -0.6 -5 -4 -1 -5.4 C3 -6.8 6 -5.6 8.6 -5.2Z'),
  hairL: new Path2D('M9 -5 C9.4 -11 4 -13 -1 -12.6 C-8 -12 -12.6 -6.5 -12 2 C-11.8 6 -11 9.6 -8.6 11.4 L-7.4 7.4 L-6.2 10.6 L-5 4.6 C-5.6 0 -4 -4.4 0 -5.6 C3.4 -6.8 6.4 -5 9 -5Z'),
  beard: new Path2D('M8.7 4.8 C9.8 8 8 11.8 4.4 12.3 C0 12.8 -4.2 9 -6.4 4.6 L-5 3.4 C-2.4 7 2 8.2 5 7.4 C7 6.8 8.2 6 8.7 4.8Z'),
  helm: new Path2D('M-10.4 4.5 C-12 -5 -6 -12.6 1 -12.4 C7.6 -12.2 10.6 -7 10.4 -4.6 L4 -5 L-1 -4.6 L-6 -2 L-6.6 4.6Z'),
  nasal: new Path2D('M7.2 -4.8 L9.6 -4.4 L9.6 1.6 L8 4.6 L7 4.6Z'),
  cowl: new Path2D('M9.4 -5.5 C8 -12.5 -1 -14.6 -7 -11.6 C-13 -8 -13 2 -11 12 L-3 13 C-5 6 -5 -2 -2 -5 C1 -7 6 -6.2 9.4 -5.5Z'),
  robot: new Path2D('M-8.6 -5 C-8.6 -10.4 -3 -11.4 1 -11.4 L5 -11.4 C8.8 -11.4 9.6 -8.4 9.6 -5 L9.6 6 C9.6 9 7.6 9.6 5 9.6 L-3.4 9.6 C-7 9.6 -8.6 8 -8.6 3.6Z'),
  cape: new Path2D('M-9.4 -7 C-12 0 -11.5 9 -10 15 L-2.4 13.4 L-4.4 3 Z'),
});
function humanHead(c, look, hat, face, flash, rich, lw, cut) {
  const Hd = headPaths(), K = look.k, zom = face === 'zombie', hero = face === 'hero', fl = x => flash ? '#fff' : x;
  const hair = zom ? shade(K, 0.5) : '#33241a', t = performance.now() / 1000;
  const P = (path, col) => { c.fillStyle = fl(col); path ? c.fill(path) : c.fill(); c.strokeStyle = shade(col, 0.3); c.lineWidth = lw; path ? c.stroke(path) : c.stroke(); };
  const eye = (x = 4.9, y = -2.4) => {
    if (flash) return;
    if (zom) { c.fillStyle = '#2b1f2b'; c.beginPath(); c.ellipse(x, y, 2.5, 2.1, 0, 0, TAU); c.fill(); c.fillStyle = '#e5e2b4'; c.beginPath(); c.arc(x + 0.3, y, 1.25, 0, TAU); c.fill(); c.fillStyle = '#b02a2a'; c.beginPath(); c.arc(x + 0.7, y + 0.1, 0.55, 0, TAU); c.fill(); return; }
    c.fillStyle = '#f4f0e6'; c.beginPath(); c.ellipse(x, y, 1.9, 1.3, 0, 0, TAU); c.fill();
    c.fillStyle = '#4a3320'; c.beginPath(); c.arc(x + 0.6, y, 1, 0, TAU); c.fill(); c.fillStyle = '#0d0d10'; c.beginPath(); c.arc(x + 0.75, y, 0.55, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 0.2, y - 0.5, 0.3, 0, TAU); c.fill();
    c.strokeStyle = '#2a1c12'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - 2.5, y - 2.1); c.lineTo(x + 2.9, y - 1); c.stroke(); // brow, angled down toward the nose
  };
  const mouth = () => { if (flash) return;
    if (zom) { c.fillStyle = '#4a1418'; c.beginPath(); c.ellipse(6.4, 6.6, 2.5, 1.5, 0.15, 0, TAU); c.fill(); c.fillStyle = '#e8e4c8'; c.fillRect(4.6, 5.4, 1.1, 1), c.fillRect(6.8, 5.5, 1.1, 1); c.fillRect(5.6, 7.3, 1, 0.9); return; }
    if (!hero) { c.strokeStyle = shade(K, 0.4); c.lineWidth = 0.8; c.beginPath(); c.moveTo(8.5, 6.1); c.lineTo(5.6, 6.4); c.stroke(); } };
  const ear = () => { if (flash) return; c.fillStyle = shade(K, 0.9); c.beginPath(); c.ellipse(-1.8, 1.6, 1.4, 2.2, 0.1, 0, TAU); c.fill(); };
  const face_ = (col) => { // skull with jaw shade and lit crown; inked last
    c.fillStyle = fl(col); c.fill(Hd.face);
    if (rich) { c.fillStyle = 'rgba(0,0,0,.14)'; c.fill(Hd.jaw); c.fillStyle = RIM; c.fill(Hd.top); }
    c.strokeStyle = shade(col, 0.3); c.lineWidth = lw; c.stroke(Hd.face);
  };
  // behind the head
  if (hat === 'mask') for (const [len, off] of [[13, 0], [9.5, 0.5]]) {
    const wv = Math.sin(t * 10 + off * 7) * 2.6; c.beginPath(); c.moveTo(-8, -3.4 + off * 2); c.quadraticCurveTo(-8 - len * 0.5, -3 + off * 3 + wv * 0.5, -8 - len, -2 + off * 5 + wv); c.lineTo(-8 - len * 0.88, 1.2 + off * 5 + wv); c.quadraticCurveTo(-13, 0 + off * 2, -8.6, 0.4 + off * 2); c.closePath(); P(null, '#1c1f2b');
  }
  if (hat === 'crown') { P(Hd.cape, '#1f4e8c'); if (!flash) { c.beginPath(); for (let k = 0; k < 4; k++) { c.moveTo(-10.6 + k * 0.8, 1 + k * 3.4); c.lineTo(-3.4 - k * 0.2, 0 + k * 3.4); } c.strokeStyle = '#e8c547'; c.lineWidth = 1.1; c.stroke(); } }
  if (hat === 'anubis') for (const [x0, x1, y1, x2] of [[-6.6, -8.4, -21, -1.6], [-1.6, 0.8, -22, 4.4]]) { c.beginPath(); c.moveTo(x0, -8); c.lineTo(x1, y1); c.lineTo(x2, -9.4); c.closePath(); P(null, K); if (!flash) { c.fillStyle = '#7a5a2a'; c.beginPath(); c.moveTo(x0 + 1.3, -9.6); c.lineTo(x1 + 0.4, y1 + 3.5); c.lineTo(x2 - 1.4, -10.4); c.fill(); } }
  if (hat === 'visor') { // robot head
    c.fillStyle = fl(K); c.fill(Hd.robot); if (rich) { c.fillStyle = RIM; c.fillRect(-6, -10.6, 12, 1.6); c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(-8.4, 6.4, 18, 3); }
    c.strokeStyle = shade(K, 0.3); c.lineWidth = lw; c.stroke(Hd.robot);
    if (!flash) { c.fillStyle = '#0d2a33'; c.fillRect(-1, -5.6, 10.6, 4.4); c.fillStyle = '#39e1ff'; c.fillRect(0, -4.8, 9.6, 2.6); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(0.4, -4.8, 8.8, 0.8);
      c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.8; c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(3 + i * 1.8, 4); c.lineTo(3 + i * 1.8, 7.4); } c.stroke();
      c.strokeStyle = shade(K, 0.3); c.lineWidth = lw; c.beginPath(); c.moveTo(-2, -11.4); c.lineTo(-2.6, -16.4); c.stroke(); c.fillStyle = '#39e1ff'; c.beginPath(); c.arc(-2.6, -16.8, 1.1, 0, TAU); c.fill(); }
    if (cut) { c.fillStyle = '#5a1216'; c.beginPath(); c.ellipse(0, 9.4, 3.4, 1.1, 0, 0, TAU); c.fill(); }
    return;
  }
  // head
  if (hat === 'mask') {
    face_('#1c1f2b'); c.beginPath(); c.moveTo(-3, -5.6); c.lineTo(8.9, -4.8); c.lineTo(9.1, 0.3); c.lineTo(-3, 0.6); c.closePath(); c.fillStyle = fl(K); c.fill();
    c.strokeStyle = '#1c1f2b'; c.lineWidth = lw; c.stroke(Hd.face); eye(4.6, -2.4);
  } else { face_(hat === 'wrapx' ? K : K); ear(); eye(); mouth(); }
  if (rich && zom && hat !== 'bandage') { c.fillStyle = 'rgba(30,10,30,.22)'; c.beginPath(); c.ellipse(3, 4.6, 3.4, 2, -0.3, 0, TAU); c.fill(); } // sunken cheek
  if (cut && !flash) { c.fillStyle = '#7a1418'; c.beginPath(); c.ellipse(-0.6, 10, 3.6, 1.2, 0, 0, TAU); c.fill(); }
  // headgear
  switch (hat) {
    case 'mask': if (rich) { c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-6, -7); c.quadraticCurveTo(-1, -9.6, 4, -8.6); c.stroke(); } break;
    case 'helmet': P(Hd.helm, mix('#7d8791', look.s, 0.3)); P(Hd.nasal, mix('#7d8791', look.s, 0.3));
      if (rich) { c.beginPath(); c.moveTo(-8, -9); c.quadraticCurveTo(-1, -13.4, 6, -9.6); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.6; c.stroke(); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-1, -12); c.lineTo(-1, -4.8); c.stroke(); } break;
    case 'cowboy': P(Hd.hairS, hair); c.beginPath(); c.moveTo(-6.6, -8.2); c.bezierCurveTo(-7, -14, -1.6, -16, 3.6, -15.4); c.bezierCurveTo(7.4, -14.8, 8, -11, 7.4, -8.2); c.closePath(); P(null, '#6b4423');
      c.beginPath(); c.moveTo(-15.5, -9.6); c.quadraticCurveTo(-8, -6.2, 0.5, -7.2); c.quadraticCurveTo(9, -6.2, 15.8, -10.6); c.quadraticCurveTo(9, -9.2, 0.5, -9.6); c.quadraticCurveTo(-8, -9.4, -15.5, -9.6); c.closePath(); P(null, '#7d5330');
      if (!flash) { c.fillStyle = '#2a1a10'; c.fillRect(-6.8, -10.4, 14.4, 1.7); c.beginPath(); c.moveTo(-3, -15.4); c.quadraticCurveTo(0.6, -13.6, 4, -15.2); c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 1; c.stroke(); } break;
    case 'tricorn': P(Hd.hairS, hair); c.beginPath(); c.moveTo(-14, -5.8); c.quadraticCurveTo(-10, -11, -2, -12.4); c.quadraticCurveTo(1, -16.4, 5.6, -12.6); c.quadraticCurveTo(12, -10.4, 14.4, -5.6); c.quadraticCurveTo(6, -8.6, 0, -8.2); c.quadraticCurveTo(-8, -8.8, -14, -5.8); c.closePath(); P(null, '#1f1f25');
      if (!flash) { c.beginPath(); c.moveTo(-13.4, -6); c.quadraticCurveTo(-8, -8.6, 0, -8.4); c.quadraticCurveTo(6, -8.6, 13.8, -5.8); c.strokeStyle = '#d4af37'; c.lineWidth = 1.2; c.stroke(); } break;
    case 'crown': c.beginPath(); c.moveTo(-9.6, -6); c.bezierCurveTo(-10, -13, 8.6, -13.4, 9.6, -6.4); c.lineTo(9.4, -3.4); c.lineTo(-8.6, -3.4); c.closePath(); P(null, '#1f4e8c');
      if (!flash) { c.fillStyle = '#e8c547'; c.fillRect(-9.4, -7.6, 18.8, 2); c.beginPath(); c.moveTo(8.6, -8.6); c.lineTo(10.6, -6); c.lineTo(8.6, -5.4); c.fill(); c.beginPath(); c.moveTo(-3, -11.4); c.quadraticCurveTo(-4, -17, -1.6, -22); c.quadraticCurveTo(2, -22.4, 3.4, -18); c.quadraticCurveTo(4.6, -14, 4.4, -11.6); c.closePath(); c.fillStyle = '#f2eddc'; c.fill(); c.strokeStyle = '#8a7a4a'; c.lineWidth = lw; c.stroke(); } break;
    case 'anubis': if (!flash) { c.fillStyle = '#e8c547'; c.fillRect(-9.6, -6.6, 19.2, 1.8);
        c.beginPath(); c.moveTo(7.4, -1); c.lineTo(17.4, 2.6); c.lineTo(17, 5.2); c.lineTo(8.6, 6.8); c.closePath(); P(null, K); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(17, 2.8, 0.9, 0, TAU); c.fill();
        c.strokeStyle = '#e8c547'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(3, -2.4); c.lineTo(7.6, -1.6); c.stroke(); } break;
    case 'hair': P(Hd.hairL, hair); P(Hd.beard, hair); if (rich) { c.strokeStyle = shade(hair, 1.7); c.lineWidth = 0.7; c.beginPath(); c.moveTo(-8, -6); c.quadraticCurveTo(-2, -10.6, 4, -8.6); c.moveTo(-9, 2); c.lineTo(-8.4, 8); c.stroke(); } break;
    case 'hood': c.fillStyle = 'rgba(0,0,0,.34)'; c.fillRect(-3, -6, 12.6, 5); P(Hd.cowl, shade(look.s, 0.85)); break;
    case 'bandana': P(Hd.hairS, hair); c.beginPath(); c.moveTo(-9.8, -5); c.bezierCurveTo(-6, -8, 5, -8, 9, -6); c.lineTo(9, -3.4); c.bezierCurveTo(5, -5, -6, -5.2, -9.8, -2.6); c.closePath(); P(null, '#c0392b');
      { const wv = Math.sin(t * 9) * 2; c.beginPath(); c.moveTo(-9.6, -3.4); c.quadraticCurveTo(-14, -2 + wv, -17, 0.4 + wv); c.lineTo(-15, 2.6 + wv); c.quadraticCurveTo(-12, 0, -9.4, -1.6); c.closePath(); P(null, '#c0392b'); } break;
    case 'bandage': if (!flash) { c.strokeStyle = 'rgba(110,90,60,.55)'; c.lineWidth = 1.1; c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(-8.6, 4.6 - i * 2.8); c.quadraticCurveTo(0, 1 - i * 2.8, 8.6, 0 - i * 2.8); } c.stroke(); } break;
    case 'horns': P(Hd.hairS, shade(K, 0.6)); for (const [x, d] of [[-3.4, -1], [2, 1]]) { c.beginPath(); c.moveTo(x - 1.8, -10); c.bezierCurveTo(x - 4 * -d, -14, x - 3 * -d, -18, x + 1 * d, -21); c.bezierCurveTo(x - 1, -16, x + 1.6 * d, -13, x + 2.2, -10); c.closePath(); P(null, '#e8e2d0'); }
      if (!flash) { c.fillStyle = '#e8e2d0'; c.beginPath(); c.moveTo(5.6, 7.4); c.lineTo(6.6, 2.6); c.lineTo(8, 7); c.closePath(); c.fill(); } break;
    default: if (!zom) P(Hd.hairS, hair); else if (rich) { c.strokeStyle = hair; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-7, -9); c.lineTo(-9.6, -5); c.moveTo(-3, -10.6); c.lineTo(-4.4, -7); c.moveTo(1, -10.8); c.lineTo(1.4, -8); c.stroke(); }
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
  c.lineCap = 'round'; c.lineJoin = 'round';
  const ln = (col) => shade(col, 0.3), Fp = (col, w = 1.6) => { c.fillStyle = col; c.fill(); c.strokeStyle = ln(col); c.lineWidth = w; c.stroke(); };
  switch (held) {
    case 'club': { // knobbed wooden club
      const A = [h[0] - px * 4 * s, h[1] - py * 4 * s], B = [h[0] + px * 30 * s, h[1] + py * 30 * s];
      taper(c, A, B, 2 * s, 5.2 * s); Fp('#7a5030');
      c.beginPath(); c.moveTo(h[0] + px * 8 * s - py * 1.2 * s, h[1] + py * 8 * s + px * 1.2 * s); c.lineTo(B[0] - py * 2 * s, B[1] + px * 2 * s); c.strokeStyle = 'rgba(255,240,210,.3)'; c.lineWidth = 1.2; c.stroke();
      c.beginPath(); c.arc(h[0] + px * 20 * s, h[1] + py * 20 * s, 1.1 * s, 0, TAU); c.arc(B[0] - px * 3 * s, B[1] - py * 3 * s, 1.2 * s, 0, TAU); c.fillStyle = '#3f2a16'; c.fill(); break;
    }
    case 'sword': {
      const A = [h[0] + px * 4 * s, h[1] + py * 4 * s], B = [h[0] + px * 36 * s, h[1] + py * 36 * s], nx = -py, ny = px;
      c.beginPath(); c.moveTo(A[0] + nx * 2.2 * s, A[1] + ny * 2.2 * s); c.lineTo(B[0] + nx * 1.2 * s, B[1] + ny * 1.2 * s); c.lineTo(B[0] + px * 3.5 * s, B[1] + py * 3.5 * s); c.lineTo(B[0] - nx * 1.2 * s, B[1] - ny * 1.2 * s); c.lineTo(A[0] - nx * 2.2 * s, A[1] - ny * 2.2 * s); c.closePath(); Fp('#dfe4ec');
      c.beginPath(); c.moveTo(A[0] + px * 2 * s, A[1] + py * 2 * s); c.lineTo(B[0] - px * 4 * s, B[1] - py * 4 * s); c.strokeStyle = 'rgba(80,90,110,.5)'; c.lineWidth = 1; c.stroke();
      c.beginPath(); c.moveTo(A[0] + nx * 6 * s, A[1] + ny * 6 * s); c.lineTo(A[0] - nx * 6 * s, A[1] - ny * 6 * s); c.strokeStyle = ln('#8a6a3a'); c.lineWidth = 4 * s + 1.6; c.stroke(); c.strokeStyle = '#c9a23a'; c.lineWidth = 4 * s; c.stroke();
      c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(h[0] - px * 4 * s, h[1] - py * 4 * s); c.strokeStyle = ln('#4a3b2c'); c.lineWidth = 3.4 * s + 1.4; c.stroke(); c.strokeStyle = '#4a3b2c'; c.lineWidth = 3.4 * s; c.stroke();
      c.beginPath(); c.arc(h[0] - px * 5 * s, h[1] - py * 5 * s, 2.2 * s, 0, TAU); Fp('#c9a23a'); break;
    }
    case 'bomb': {
      const cx = h[0], cy = h[1] - 5 * s;
      c.beginPath(); c.arc(cx, cy, 7 * s, 0, TAU); Fp('#2b2b33'); c.beginPath(); c.arc(cx, cy, 7 * s, 3.4, 4.6); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.6; c.stroke();
      c.beginPath(); c.arc(cx - 2.2 * s, cy - 2.4 * s, 1.6 * s, 0, TAU); c.fillStyle = 'rgba(255,255,255,.4)'; c.fill();
      c.fillStyle = '#5a5a64'; c.fillRect(cx - 2 * s, cy - 8.4 * s, 4 * s, 2.4 * s);
      c.beginPath(); c.moveTo(cx, cy - 8 * s); c.quadraticCurveTo(cx + 4 * s, cy - 13 * s, cx + 1 * s, cy - 15 * s); c.strokeStyle = '#c9b48a'; c.lineWidth = 1.6; c.stroke();
      glow(c, cx + 1 * s, cy - 15 * s, 7 * s, Math.random() < 0.5 ? '#ffd34d' : '#ff6a2b', 0.9); c.globalAlpha = 1; break;
    }
    case 'bow': {
      const cx = h[0] - ux * 10 * s, cy = h[1] - uy * 10 * s, a0 = Math.atan2(uy, ux) - 1.1, a1 = Math.atan2(uy, ux) + 1.1, R = 20 * s;
      c.beginPath(); c.arc(cx, cy, R, a0, a1); c.strokeStyle = ln('#7a5530'); c.lineWidth = 4.6 * s; c.stroke(); c.strokeStyle = '#8a6238'; c.lineWidth = 3 * s; c.stroke();
      c.beginPath(); c.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); c.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); c.strokeStyle = 'rgba(240,235,220,.8)'; c.lineWidth = 1; c.stroke();
      c.beginPath(); c.arc(h[0], h[1], 2.2 * s, 0, TAU); Fp('#3a2a1c'); break;
    }
    case 'gun': {
      const a = Math.atan2(uy, ux); c.save(); c.translate(h[0], h[1]); c.rotate(a); if (f < 0) c.scale(1, -1); c.scale(s, s);
      c.beginPath(); c.moveTo(-2, -2.6); c.lineTo(13, -2.6); c.lineTo(13, -1); c.lineTo(20, -1); c.lineTo(20, 1.6); c.lineTo(9, 1.6); c.lineTo(-2, 1.6); c.closePath(); Fp('#3a3f4b', 1.4 / s);
      c.beginPath(); c.moveTo(-1.6, 1.4); c.lineTo(3.4, 1.4); c.lineTo(2.4, 8); c.lineTo(-3.2, 8); c.closePath(); Fp('#6b4423', 1.4 / s);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, -2.4, 12, 0.9); c.restore(); break;
    }
    case 'shield': {
      if (!shieldUp) break;
      const x = h[0] + f * 5 * s, y = h[1] - 25 * s, col = look.sh || '#6d7c8c', w = 5.5 * s;
      c.beginPath(); c.moveTo(x - w, y + 2 * s); c.quadraticCurveTo(x, y - 3 * s, x + w, y + 2 * s); c.lineTo(x + w, y + 38 * s); c.quadraticCurveTo(x, y + 54 * s, x - w, y + 38 * s); c.closePath(); Fp(col, 1.8);
      c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(x - w * 0.8, y + 4 * s, w * 0.5, 34 * s); c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x + w * 0.2, y + 4 * s, w * 0.6, 36 * s);
      c.beginPath(); c.ellipse(x, y + 22 * s, 3 * s, 6 * s, 0, 0, TAU); Fp(shade(col, 1.3), 1.4); break;
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
