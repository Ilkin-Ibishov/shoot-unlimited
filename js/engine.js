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
// standing: t is a clock used for breathing; flinch leans the torso back after a hit; hunch: zombie posture
// (torso bent forward, head thrust ahead of the shoulders, the back arm dangling)
function poseHuman(o, x, y, s, f, t, legs, arms, act, aim, flinch = 0, hunch = false) {
  const L = 21 * s, T = 30 * s, A = 15 * s, HD = 15 * s;
  const run = legs === 'run', walk = legs !== 'stand';
  const sw = Math.sin(t), amp = run ? 0.85 : walk ? 0.45 : 0;
  const lean = (run ? 0.28 : 0.03) + (arms === 'zombie' ? 0.08 : 0) + (hunch ? (run ? 0.1 : 0.32) : 0) - flinch * 0.7;
  const px = x, py = y - L * 1.96 - (walk ? Math.abs(Math.cos(t)) * 2.5 * s : (Math.sin(t * 2.2) + 1) * 0.8 * s);
  P(o, 2, px, py);
  const ls = Math.sin(lean), lc = Math.cos(lean), nx = px + f * ls * T, ny = py - lc * T;
  P(o, 1, nx, ny);
  if (hunch) { const ha = lean + 0.85; P(o, 0, nx + f * Math.sin(ha) * HD * 0.95, ny - Math.cos(ha) * HD * 0.95); } else P(o, 0, nx + f * ls * HD, ny - lc * HD);
  if (walk) {
    const kb = run ? 1.4 : 0.8, a1 = sw * amp, a2 = -sw * amp;
    limb(o, 7, 8, px, py, a1, a1 - Math.max(0, Math.sin(t + 1.6)) * kb, L, f);
    limb(o, 9, 10, px, py, a2, a2 - Math.max(0, -Math.sin(t + 1.6)) * kb, L, f);
  } else { limb(o, 7, 8, px, py, -0.18, -0.12, L, f); limb(o, 9, 10, px, py, 0.2, 0.05, L, f); }
  const as = run ? 1.4 : walk ? 0.7 : 0.1, bend = 0.4 + (run ? 0.9 : 0);
  switch (arms) {
    case 'zombie': if (hunch) limb(o, 3, 4, nx, ny, 0.2 + sw * 0.15, 0.3 + sw * 0.2, A, f); else limb(o, 3, 4, nx, ny, 1.45 + sw * 0.1, 1.55 + sw * 0.1, A, f);
      limb(o, 5, 6, nx, ny, 1.35 - sw * 0.1, 1.5 - sw * 0.1, A, f); break;
    case 'aim': aimArms(o, nx, ny, A, aim); break;
    case 'shield': limb(o, 3, 4, nx, ny, -sw * 0.5, -sw * 0.5 + 0.6, A, f); limb(o, 5, 6, nx, ny, 0.9, 1.6, A, f); break;
    case 'hold': limb(o, 3, 4, nx, ny, -sw * as * 0.6, -sw * as * 0.6 + bend, A, f); limb(o, 5, 6, nx, ny, 0.5, 2.1, A, f); break;
    default: limb(o, 3, 4, nx, ny, -sw * as * 0.6, -sw * as * 0.6 + bend, A, f); limb(o, 5, 6, nx, ny, sw * as * 0.6, sw * as * 0.6 + bend, A, f);
  }
  if (act > 0 && arms !== 'aim') { const a = 0.9 + 1.9 * act * act; limb(o, 5, 6, nx, ny, a, a + 0.3, A, f); }
}
// realistic shambling zombie pose: hunched spine, asymmetrical dragging limp, drooping heavy head,
// loose dangling back arm, reaching front arm with drooping wrist, and feral lunging grab/bite attack
function poseZombie(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 21 * s, T = 30 * s, A = 15 * s, HD = 15 * s;

  // Asymmetrical limping gait: step 1 (firm plant) vs step 2 (knee collapse & pelvis drop)
  const limpImpact = walking ? Math.max(0, -Math.sin(t)) : 0;
  const limpDrop = walking ? (limpImpact * limpImpact * 4.2 + Math.sin(t) * 1.2) * s : (Math.sin(t * 1.4) + 1) * 0.5 * s;

  // Attack forward lunging trajectory
  const attackLunge = act > 0 ? Math.sin(act * Math.PI) * 20 * s : 0;
  const px = x + f * (attackLunge * 0.45 + (walking ? Math.sin(t) * 1.8 * s : 0));
  const py = y - L * 1.95 + limpDrop;
  P(o, 2, px, py);

  // Hunched necrotic spine: lurches heavily forward on the collapsed limp step
  const lean = 0.30 + (walking ? limpImpact * 0.14 + Math.sin(t + 0.3) * 0.05 : 0) - flinch * 0.6 + (act > 0 ? Math.sin(act * Math.PI) * 0.28 : 0);
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  // Inertial head drop & uncanny neurological twitches
  const headLag = walking ? Math.cos(t - 0.4) * 0.15 : Math.sin(t * 1.3) * 0.04;
  const headDip = walking ? Math.max(0, -Math.sin(t - 0.5)) * 2.6 * s : 0;
  const spasm = (Math.sin(t * 1.7) > 0.82 ? Math.sin(t * 26) * 0.05 : 0) + Math.sin(t * 9.1) * 0.012;
  const attackThrust = act > 0 ? Math.sin(act * Math.PI) * 5.5 * s : 0;
  const headLean = lean + 0.34 + headLag + spasm + (act > 0 ? Math.sin(act * Math.PI) * 0.36 : 0);
  const headDist = HD * 0.95 + attackThrust;
  P(o, 0, nx + f * Math.sin(headLean) * headDist, ny - Math.cos(headLean) * headDist + headDip);

  // Legs: Asymmetrical shambling - good plant leg vs dragging, scraping dead leg
  if (walking) {
    let a1 = Math.sin(t) * 0.45 + 0.04;
    let k1 = a1 - Math.max(0, Math.sin(t + 1.0)) * 0.78;
    let a2 = -Math.sin(t) * 0.40 - 0.08;
    let k2 = a2 - Math.max(0, -Math.sin(t + 0.4)) * 0.26; // stiff dragged toe scraping ground

    if (act > 0) {
      const brace = Math.sin(act * Math.PI);
      a1 = a1 * (1 - brace) + 0.48 * brace;
      k1 = k1 * (1 - brace) + 0.22 * brace;
      a2 = a2 * (1 - brace) - 0.36 * brace;
      k2 = k2 * (1 - brace) - 0.48 * brace;
    }
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    limb(o, 7, 8, px, py, -0.14 + Math.sin(t * 1.4) * 0.02, -0.08, L, f);
    limb(o, 9, 10, px, py, 0.24 - Math.sin(t * 1.4) * 0.02, 0.36, L, f);
  }

  // Arms: Back arm loose/slack dead weight; Front arm reaching forward with drooping wrist
  let armBack1 = 0.12 + (walking ? -Math.sin(t) * 0.26 : Math.sin(t * 1.2) * 0.04);
  let armBack2 = armBack1 + 0.30 + (walking ? -Math.sin(t - 0.8) * 0.16 : 0);
  let armFront1 = 0.68 + (walking ? Math.sin(t - 0.4) * 0.12 : Math.sin(t * 1.2) * 0.03);
  let armFront2 = 0.26 + (walking ? Math.sin(t - 1.1) * 0.16 : Math.sin(t * 1.2) * 0.04);

  // Feral 2-handed lunge attack: windup, tearing claw swipe & clutch
  if (act > 0) {
    const swipe = Math.sin(act * Math.PI);
    const strike = Math.max(0, 0.5 - Math.abs(act - 0.35)) * 2;
    armBack1 = armBack1 * (1 - swipe) + (0.92 + strike * 0.15) * swipe;
    armBack2 = armBack2 * (1 - swipe) + (0.80 + strike * 0.35) * swipe;
    armFront1 = armFront1 * (1 - swipe) + (1.28 + strike * 0.22) * swipe;
    armFront2 = armFront2 * (1 - swipe) + (0.58 + strike * 0.42) * swipe;
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// rabid feral sprinter pose: aggressive low forward hunch, frantic high-knee sprint,
// clawing grasping arms, head thrust far forward, and flying tackle/bite pounce
function poseSprinter(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 21 * s, T = 30 * s, A = 15 * s, HD = 15 * s;

  // Violent bounding vertical bounce during sprint
  const bounce = walking ? Math.abs(Math.sin(t)) * 4.2 * s : (Math.sin(t * 1.8) + 1) * 0.6 * s;
  const pounceLunge = act > 0 ? Math.sin(act * Math.PI) * 26 * s : 0;
  const px = x + f * (pounceLunge * 0.55 + (walking ? Math.sin(t) * 2.2 * s : 0));
  const py = y - L * 1.95 + bounce - (act > 0 ? Math.sin(act * Math.PI) * 3.5 * s : 0);
  P(o, 2, px, py);

  // Deep predatory forward lean - hunting beast posture
  const baseLean = walking ? 0.44 + Math.sin(t * 2) * 0.06 : 0.22;
  const lean = baseLean - flinch * 0.6 + (act > 0 ? Math.sin(act * Math.PI) * 0.32 : 0);
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  // Head thrusts far ahead of torso, snarling forward with frantic jitter
  const jitter = (Math.sin(t * 17) * 0.02 + Math.sin(t * 29) * 0.015) * (walking ? 1 : 0.3);
  const headLean = lean + 0.36 + jitter + (act > 0 ? Math.sin(act * Math.PI) * 0.25 : 0);
  const headStretch = HD * 0.95 + (act > 0 ? Math.sin(act * Math.PI) * 6 * s : 0);
  P(o, 0, nx + f * Math.sin(headLean) * headStretch, ny - Math.cos(headLean) * headStretch);

  // Legs: frantic high-speed sprint bounding
  if (walking) {
    const sw = Math.sin(t);
    let a1 = sw * 0.72 + 0.12;
    let k1 = a1 - Math.max(0, Math.sin(t + 1.4)) * 1.35;
    let a2 = -sw * 0.72 + 0.12;
    let k2 = a2 - Math.max(0, -Math.sin(t + 1.4)) * 1.35;

    if (act > 0) {
      const pounce = Math.sin(act * Math.PI);
      a1 = a1 * (1 - pounce) + 0.65 * pounce;
      k1 = k1 * (1 - pounce) + 0.28 * pounce;
      a2 = a2 * (1 - pounce) - 0.52 * pounce;
      k2 = k2 * (1 - pounce) - 0.45 * pounce;
    }
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    // Restless twitching idle, coiled like a spring
    limb(o, 7, 8, px, py, -0.22 + Math.sin(t * 2) * 0.03, -0.15, L, f);
    limb(o, 9, 10, px, py, 0.28 - Math.sin(t * 2) * 0.03, 0.42, L, f);
  }

  // Arms: Pumping aggressively forward with greedy grasping claws
  let armBack1 = -Math.sin(t) * 0.75 + 0.45;
  let armBack2 = armBack1 + 0.65 - Math.sin(t - 0.5) * 0.35;
  let armFront1 = Math.sin(t) * 0.75 + 0.55;
  let armFront2 = armFront1 + 0.65 + Math.sin(t - 0.5) * 0.35;

  if (!walking) {
    armBack1 = 0.35 + Math.sin(t * 2) * 0.05;
    armBack2 = 0.75 + Math.sin(t * 2 + 0.5) * 0.08;
    armFront1 = 0.65 + Math.sin(t * 2) * 0.06;
    armFront2 = 0.95 + Math.sin(t * 2 + 0.5) * 0.08;
  }

  // Tackle / Pounce Attack: Both arms reach forward into a rabid double-claw grapple
  if (act > 0) {
    const swipe = Math.sin(act * Math.PI);
    armBack1 = armBack1 * (1 - swipe) + 1.25 * swipe;
    armBack2 = armBack2 * (1 - swipe) + 0.75 * swipe;
    armFront1 = armFront1 * (1 - swipe) + 1.45 * swipe;
    armFront2 = armFront2 * (1 - swipe) + 0.85 * swipe;
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// hulking mutated tank brute pose: massive hunched ape-like stance, heavy stomping sway,
// low swinging sledgehammer arms, sunken head, and devastating haymaker punch
function poseTank(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 21 * s, T = 30 * s, A = 16 * s, HD = 14 * s;

  // Heavy stomping gait: large vertical weight drop on foot plants
  const stepSway = walking ? Math.sin(t) : 0;
  const stompDrop = walking ? Math.abs(Math.sin(t)) * 3.8 * s : (Math.sin(t * 1.2) + 1) * 0.7 * s;

  // Continuous attack phase: u goes 0 -> 1 smoothly as act decays from 1 -> 0
  const u = act > 0 ? (1 - act) : 0;

  // Devastating Two-Handed Overhead Ground Pound / Sledgehammer Slam:
  // Phase 1 (0 <= u < 0.38): Terrifying Windup - Rears back, stands tall, raises both fists high overhead
  // Phase 2 (0.38 <= u < 0.68): Explosive Downward Smash - Lunges forward, drives both fists down into the ground
  // Phase 3 (0.68 <= u <= 1.0): Heavy Recovery - Impact shudder, then heaves back up into stance
  let attackLunge = 0;
  let attackDrop = 0;
  let attackLean = 0;
  let attackHead = 0;

  // Base walking / idle arms:
  let armBack1 = 0.22 - stepSway * 0.5;
  let armBack2 = armBack1 + 0.35 - Math.sin(t - 0.6) * 0.25;
  let armFront1 = 0.22 + stepSway * 0.5;
  let armFront2 = armFront1 + 0.35 + Math.sin(t - 0.6) * 0.25;

  if (!walking) {
    const breathe = Math.sin(t * 1.5) * 0.05;
    armBack1 = 0.25 + breathe; armBack2 = 0.55 + breathe;
    armFront1 = 0.35 - breathe; armFront2 = 0.65 - breathe;
  }

  // Attack stance legs override
  let aLeg1 = 0, aLeg2 = 0, kLeg1 = 0, kLeg2 = 0, legBlend = 0;

  if (u > 0) {
    if (u < 0.42) {
      // Phase 1: Heavy Windup - rears backward, chest arches back, raises both fists high overhead
      const p = Math.sin((u / 0.42) * Math.PI * 0.5);
      attackLunge = -12 * p * s;
      attackDrop = -5 * p * s; // stands tall
      attackLean = -0.52 * p;  // arches back: net lean goes from +0.34 to -0.18
      attackHead = -0.48 * p;  // head tilts back, roaring

      // Arms raise up and cock back behind head
      armBack1 = armBack1 * (1 - p) + 2.70 * p;
      armBack2 = armBack2 * (1 - p) + 3.70 * p;
      armFront1 = armFront1 * (1 - p) + 2.90 * p;
      armFront2 = armFront2 * (1 - p) + 3.85 * p;

      // Legs brace backwards
      legBlend = p;
      aLeg1 = -0.10; kLeg1 = -0.05;
      aLeg2 = -0.35; kLeg2 = -0.25;
    } else if (u < 0.70) {
      // Phase 2: Devastating Accelerating Downward Smash (starts from zero velocity at apex, accelerates to maximum impact)
      const p = (u - 0.42) / 0.28;
      const q = 1 - Math.cos(p * Math.PI * 0.5); // Ease-in: gravity + muscle acceleration
      attackLunge = (-12 + 38 * q) * s;
      attackDrop = (-5 + 21 * q) * s; // deep squat into ground impact (+16s)
      attackLean = -0.52 * (1 - q) + 0.36 * q; // crashes forward: net lean +0.70
      attackHead = -0.48 * (1 - q) + 0.35 * q; // head snaps down into impact

      // Arms whip over the top and crash down into the ground
      armBack1 = 2.70 * (1 - q) + 0.12 * q;
      armBack2 = 3.70 * (1 - q) + 0.25 * q;
      armFront1 = 2.90 * (1 - q) + 0.20 * q;
      armFront2 = 3.85 * (1 - q) + 0.35 * q;

      // Legs squat deep into slam
      legBlend = 1;
      aLeg1 = -0.10 * (1 - q) + 0.70 * q; kLeg1 = -0.05 * (1 - q) + 0.65 * q;
      aLeg2 = -0.35 * (1 - q) - 0.60 * q; kLeg2 = -0.25 * (1 - q) - 0.45 * q;
    } else {
      // Phase 3: Impact Shudder & Recovery
      const p = (u - 0.70) / 0.30;
      const q = p < 0.25 ? 0 : Math.sin(((p - 0.25) / 0.75) * Math.PI * 0.5);
      const shudder = (p < 0.25) ? Math.sin(p * 50) * 1.5 * s : 0;

      attackLunge = 26 * (1 - q) * s;
      attackDrop = (16 * (1 - q) + shudder) * s;
      attackLean = 0.36 * (1 - q);
      attackHead = 0.35 * (1 - q);

      armBack1 = 0.12 * (1 - q) + armBack1 * q;
      armBack2 = 0.25 * (1 - q) + armBack2 * q;
      armFront1 = 0.20 * (1 - q) + armFront1 * q;
      armFront2 = 0.35 * (1 - q) + armFront2 * q;

      legBlend = 1 - q;
      aLeg1 = 0.70; kLeg1 = 0.65;
      aLeg2 = -0.60; kLeg2 = -0.45;
    }
  }

  const px = x + f * (attackLunge + (walking ? Math.sin(t) * 1.5 * s : 0));
  const py = y - L * 1.90 + stompDrop + attackDrop;
  P(o, 2, px, py);

  // Hunched ape-like spine
  const lean = 0.34 + (walking ? Math.abs(stepSway) * 0.08 : 0) - flinch * 0.4 + attackLean;
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  // Sunken heavy skull between massive hunched shoulders
  const headLag = walking ? Math.cos(t) * 0.08 : 0;
  const headLean = lean + 0.26 + headLag + attackHead;
  P(o, 0, nx + f * Math.sin(headLean) * HD * 0.9, ny - Math.cos(headLean) * HD * 0.9);

  // Legs: wide, bowed, stomping strides with heavy heel plants
  if (walking) {
    const sw = Math.sin(t);
    let a1 = sw * 0.52;
    let k1 = a1 - Math.max(0, Math.sin(t + 1.2)) * 0.85;
    let a2 = -sw * 0.52;
    let k2 = a2 - Math.max(0, -Math.sin(t + 1.2)) * 0.85;

    if (legBlend > 0) {
      a1 = a1 * (1 - legBlend) + aLeg1 * legBlend;
      k1 = k1 * (1 - legBlend) + kLeg1 * legBlend;
      a2 = a2 * (1 - legBlend) + aLeg2 * legBlend;
      k2 = k2 * (1 - legBlend) + kLeg2 * legBlend;
    }
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    let a1 = -0.24, k1 = 0.08, a2 = 0.32, k2 = 0.48;
    if (legBlend > 0) {
      a1 = a1 * (1 - legBlend) + aLeg1 * legBlend;
      k1 = k1 * (1 - legBlend) + kLeg1 * legBlend;
      a2 = a2 * (1 - legBlend) + aLeg2 * legBlend;
      k2 = k2 * (1 - legBlend) + kLeg2 * legBlend;
    }
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// realistic sickly spitter pose: slouched hunchback, convulsing acidic retch/vomit projectile spit
function poseSpitter(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 21 * s, T = 29 * s, A = 15 * s, HD = 15 * s;
  const u = act > 0 ? (1 - act) : 0;
  let attackLunge = 0, attackDrop = 0, attackLean = 0, attackHead = 0;

  const wheeze = Math.sin(t * 3.5) * 0.04;
  const spasm = (Math.sin(t * 11) > 0.85 ? Math.sin(t * 33) * 0.03 : 0);

  if (u > 0) {
    if (u < 0.40) {
      const p = Math.sin((u / 0.40) * Math.PI * 0.5);
      attackLunge = -6 * p * s;
      attackDrop = 5 * p * s;
      attackLean = 0.22 * p;
      attackHead = -0.35 * p;
    } else if (u < 0.65) {
      const p = (u - 0.40) / 0.25;
      const q = Math.sin(p * Math.PI * 0.5);
      attackLunge = (-6 + 18 * q) * s;
      attackDrop = (5 - 3 * q) * s;
      attackLean = 0.22 * (1 - q) + 0.38 * q;
      attackHead = -0.35 * (1 - q) + 0.45 * q;
    } else {
      const p = (u - 0.65) / 0.35;
      const q = Math.sin(p * Math.PI * 0.5);
      const shudder = Math.sin(p * 20) * 1.0 * (1 - q) * s;
      attackLunge = 12 * (1 - q) * s;
      attackDrop = 2 * (1 - q) * s + shudder;
      attackLean = 0.38 * (1 - q);
      attackHead = 0.45 * (1 - q);
    }
  }

  const px = x + f * (attackLunge + (walking ? Math.sin(t) * 1.2 * s : 0));
  const py = y - L * 1.94 + attackDrop + (walking ? Math.abs(Math.cos(t)) * 2.2 * s : wheeze * 8 * s);
  P(o, 2, px, py);

  const lean = 0.32 + wheeze + spasm - flinch * 0.5 + attackLean;
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  const headLean = lean + 0.36 + spasm * 1.5 + attackHead;
  P(o, 0, nx + f * Math.sin(headLean) * HD * 0.95, ny - Math.cos(headLean) * HD * 0.95);

  if (walking) {
    const sw = Math.sin(t);
    const a1 = sw * 0.44;
    const k1 = a1 - Math.max(0, Math.sin(t + 1.4)) * 0.85;
    const a2 = -sw * 0.44;
    const k2 = a2 - Math.max(0, -Math.sin(t + 1.4)) * 0.85;
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    limb(o, 7, 8, px, py, -0.15, -0.05, L, f);
    limb(o, 9, 10, px, py, 0.22, 0.15, L, f);
  }

  let armBack1 = 0.18 + (walking ? Math.sin(t - 0.4) * 0.15 : wheeze * 2);
  let armBack2 = armBack1 + 0.32;
  let armFront1 = 0.75 + wheeze;
  let armFront2 = armFront1 + 0.95;

  if (u > 0) {
    if (u < 0.40) {
      const p = Math.sin((u / 0.40) * Math.PI * 0.5);
      armFront1 = armFront1 * (1 - p) + 0.45 * p;
      armFront2 = armFront2 * (1 - p) + 1.85 * p;
      armBack1 = armBack1 * (1 - p) + (-0.35) * p;
      armBack2 = armBack2 * (1 - p) + 0.15 * p;
    } else if (u < 0.65) {
      const p = (u - 0.40) / 0.25;
      const q = Math.sin(p * Math.PI * 0.5);
      armFront1 = 0.45 * (1 - q) + 1.35 * q;
      armFront2 = 1.85 * (1 - q) + 1.15 * q;
      armBack1 = (-0.35) * (1 - q) + (-0.65) * q;
      armBack2 = 0.15 * (1 - q) + 0.45 * q;
    } else {
      const p = (u - 0.65) / 0.35;
      const q = Math.sin(p * Math.PI * 0.5);
      armFront1 = 1.35 * (1 - q) + (0.75 + wheeze) * q;
      armFront2 = 1.15 * (1 - q) + (0.75 + 0.95) * q;
      armBack1 = (-0.65) * (1 - q) + 0.18 * q;
      armBack2 = 0.45 * (1 - q) + 0.50 * q;
    }
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// realistic bloated exploder pose: heavy grotesque waddling gait, throbbing toxic belly pressure, agonizing priming
function poseBloater(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 20 * s, T = 28 * s, A = 15 * s, HD = 14 * s;

  const waddle = walking ? Math.sin(t) * 0.14 : 0;
  const drop = walking ? Math.abs(Math.sin(t)) * 2.8 * s : Math.sin(t * 2) * 0.8 * s;
  const pulse = act > 0 ? Math.sin(t * 22) * 0.12 : 0;
  const primeRaise = act > 0 ? Math.sin(act * Math.PI) : 0;

  const px = x + (walking ? Math.cos(t) * 1.5 * s : 0);
  const py = y - L * 1.88 + drop - primeRaise * 4 * s;
  P(o, 2, px, py);

  const lean = 0.26 + waddle - flinch * 0.5 - primeRaise * 0.35;
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  const headLean = lean + 0.25 - primeRaise * 0.45 + (act > 0 ? Math.sin(t * 30) * 0.05 : 0);
  P(o, 0, nx + f * Math.sin(headLean) * HD * 0.95, ny - Math.cos(headLean) * HD * 0.95);

  if (walking) {
    const sw = Math.sin(t);
    const a1 = sw * 0.48 + 0.08;
    const k1 = a1 - Math.max(0, Math.sin(t + 1.2)) * 0.75;
    const a2 = -sw * 0.48 + 0.08;
    const k2 = a2 - Math.max(0, -Math.sin(t + 1.2)) * 0.75;
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    limb(o, 7, 8, px, py, -0.22, 0.12, L, f);
    limb(o, 9, 10, px, py, 0.28, 0.22, L, f);
  }

  let armBack1 = 0.35 - waddle * 1.5 + (primeRaise ? primeRaise * 1.8 : 0);
  let armBack2 = armBack1 + 0.55 + pulse;
  let armFront1 = 0.45 + waddle * 1.5 + (primeRaise ? primeRaise * 1.9 : 0);
  let armFront2 = armFront1 + 0.65 + pulse;

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// realistic riot zombie pose: braced defensive shield stance, tactical advance, and violent shield bash ram
function poseShieldZombie(o, x, y, s, f, t, walking, act = 0, flinch = 0) {
  o.act = act;
  const L = 21 * s, T = 30 * s, A = 15 * s, HD = 14 * s;

  const u = act > 0 ? (1 - act) : 0;
  let bashLunge = 0, bashLean = 0;

  if (u > 0) {
    if (u < 0.35) {
      const p = Math.sin((u / 0.35) * Math.PI * 0.5);
      bashLunge = -6 * p * s;
      bashLean = -0.15 * p;
    } else if (u < 0.65) {
      const p = (u - 0.35) / 0.30;
      const q = Math.sin(p * Math.PI * 0.5);
      bashLunge = (-6 + 24 * q) * s;
      bashLean = -0.15 * (1 - q) + 0.32 * q;
    } else {
      const p = (u - 0.65) / 0.35;
      const q = Math.sin(p * Math.PI * 0.5);
      bashLunge = 18 * (1 - q) * s;
      bashLean = 0.32 * (1 - q);
    }
  }

  const px = x + f * (bashLunge + (walking ? Math.sin(t) * 1.0 * s : 0));
  const py = y - L * 1.92 + (walking ? Math.abs(Math.cos(t)) * 2.0 * s : 0);
  P(o, 2, px, py);

  const lean = 0.24 - flinch * 0.25 + bashLean;
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  const headLean = lean + 0.16;
  P(o, 0, nx + f * Math.sin(headLean) * HD * 0.9, ny - Math.cos(headLean) * HD * 0.9);

  if (walking) {
    const sw = Math.sin(t);
    const a1 = sw * 0.45;
    const k1 = a1 - Math.max(0, Math.sin(t + 1.3)) * 0.75;
    const a2 = -sw * 0.45;
    const k2 = a2 - Math.max(0, -Math.sin(t + 1.3)) * 0.75;
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    limb(o, 7, 8, px, py, -0.20, 0.05, L, f);
    limb(o, 9, 10, px, py, 0.25, 0.20, L, f);
  }

  let armBack1 = 0.30 - (walking ? Math.sin(t) * 0.15 : 0);
  let armBack2 = 0.95;
  let armFront1 = 0.85;
  let armFront2 = 1.65;

  if (u > 0) {
    if (u < 0.35) {
      const p = Math.sin((u / 0.35) * Math.PI * 0.5);
      armFront1 = 0.85 * (1 - p) + 0.55 * p;
      armFront2 = 1.65 * (1 - p) + 1.85 * p;
    } else if (u < 0.65) {
      const p = (u - 0.35) / 0.30;
      const q = Math.sin(p * Math.PI * 0.5);
      armFront1 = 0.55 * (1 - q) + 1.55 * q;
      armFront2 = 1.85 * (1 - q) + 1.55 * q;
    } else {
      const p = (u - 0.65) / 0.35;
      const q = Math.sin(p * Math.PI * 0.5);
      armFront1 = 1.55 * (1 - q) + 0.85 * q;
      armFront2 = 1.55 * (1 - q) + 1.65 * q;
    }
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
}
// realistic apex boss pose: Patient Zero (scale 2.2), terrifying freight-train charge, blood-curdling summon roar, sweeping claw cleave
function poseBossZombie(o, x, y, s, f, t, walking, act = 0, flinch = 0, charge = 0) {
  o.act = act;
  const L = 22 * s, T = 31 * s, A = 17 * s, HD = 15 * s;

  const isCharging = charge > 0;
  const u = act > 0 ? (1 - act) : 0;
  const stomp = walking ? Math.abs(Math.sin(t)) * 4.0 * s : Math.sin(t * 1.5) * 1.0 * s;

  let attackLunge = 0, attackLean = 0, attackHead = 0;

  if (isCharging) {
    attackLean = 0.35;
    attackHead = 0.25;
  } else if (u > 0) {
    if (u < 0.40) {
      const p = Math.sin((u / 0.40) * Math.PI * 0.5);
      attackLunge = -10 * p * s;
      attackLean = -0.25 * p;
      attackHead = -0.20 * p;
    } else if (u < 0.68) {
      const p = (u - 0.40) / 0.28;
      const q = 1 - Math.cos(p * Math.PI * 0.5);
      attackLunge = (-10 + 32 * q) * s;
      attackLean = -0.25 * (1 - q) + 0.45 * q;
      attackHead = -0.20 * (1 - q) + 0.35 * q;
    } else {
      const p = (u - 0.68) / 0.32;
      const q = Math.sin(p * Math.PI * 0.5);
      attackLunge = 22 * (1 - q) * s;
      attackLean = 0.45 * (1 - q);
      attackHead = 0.35 * (1 - q);
    }
  }

  const px = x + f * (attackLunge + (walking ? Math.sin(t) * 1.8 * s : 0));
  const py = y - L * 1.90 + stomp - (isCharging ? 4 * s : 0);
  P(o, 2, px, py);

  const baseLean = isCharging ? 0.58 : 0.32;
  const lean = baseLean - flinch * 0.3 + attackLean;
  const nx = px + f * Math.sin(lean) * T;
  const ny = py - Math.cos(lean) * T;
  P(o, 1, nx, ny);

  const headLean = lean + (isCharging ? 0.20 : 0.30) + attackHead + (act > 0 ? Math.sin(t * 15) * 0.04 : 0);
  P(o, 0, nx + f * Math.sin(headLean) * HD * 0.95, ny - Math.cos(headLean) * HD * 0.95);

  if (walking || isCharging) {
    const sw = Math.sin(t * (isCharging ? 2.2 : 1.0));
    const amp = isCharging ? 0.75 : 0.54;
    const a1 = sw * amp;
    const k1 = a1 - Math.max(0, Math.sin((t * (isCharging ? 2.2 : 1.0)) + 1.2)) * (isCharging ? 1.2 : 0.85);
    const a2 = -sw * amp;
    const k2 = a2 - Math.max(0, -Math.sin((t * (isCharging ? 2.2 : 1.0)) + 1.2)) * (isCharging ? 1.2 : 0.85);
    limb(o, 7, 8, px, py, a1, k1, L, f);
    limb(o, 9, 10, px, py, a2, k2, L, f);
  } else {
    limb(o, 7, 8, px, py, -0.22, 0.08, L, f);
    limb(o, 9, 10, px, py, 0.28, 0.35, L, f);
  }

  let armBack1 = 0.35, armBack2 = 0.65;
  let armFront1 = 0.85, armFront2 = 1.45;

  if (isCharging) {
    const sw = Math.sin(t * 2.2);
    armBack1 = 0.75 - sw * 0.5;
    armBack2 = armBack1 + 0.8;
    armFront1 = 0.75 + sw * 0.5;
    armFront2 = armFront1 + 0.8;
  } else if (u > 0) {
    if (u < 0.40) {
      const p = Math.sin((u / 0.40) * Math.PI * 0.5);
      armFront1 = armFront1 * (1 - p) + (-0.55) * p;
      armFront2 = armFront2 * (1 - p) + 1.65 * p;
      armBack1 = armBack1 * (1 - p) + 0.85 * p;
      armBack2 = armBack2 * (1 - p) + 0.45 * p;
    } else if (u < 0.68) {
      const p = (u - 0.40) / 0.28;
      const q = 1 - Math.cos(p * Math.PI * 0.5);
      armFront1 = (-0.55) * (1 - q) + 1.65 * q;
      armFront2 = 1.65 * (1 - q) + 1.35 * q;
      armBack1 = 0.85 * (1 - q) + (-0.35) * q;
      armBack2 = 0.45 * (1 - q) + 0.25 * q;
    } else {
      const p = (u - 0.68) / 0.32;
      const q = Math.sin(p * Math.PI * 0.5);
      armFront1 = 1.65 * (1 - q) + 0.85 * q;
      armFront2 = 1.35 * (1 - q) + 1.45 * q;
      armBack1 = (-0.35) * (1 - q) + 0.35 * q;
      armBack2 = 0.25 * (1 - q) + 0.65 * q;
    }
  }

  limb(o, 3, 4, nx, ny, armBack1, armBack2, A, f);
  limb(o, 5, 6, nx, ny, armFront1, armFront2, A, f);
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

// ===== humans (human rig), "Earn to Die"-style: lanky profile limbs, thin dark ink under each layer (so joints union),
// two-tone cel shading (shadow along the back edge, light along the front), ink linework for folds/creases, hunched
// zombies with glowing eyes. Clip-free like the dinos; one ink stroke per layer, fills batched per color.
const INKD = '#1a1410', H_LW = 0.75;
const HLIMB = { // half-width profiles along a bone: [t, front, back]
  thigh: [[0, 6.4, 7.2], [0.35, 6.6, 6.2], [0.75, 5.2, 4.8], [1, 4.4, 4.2]],
  shin:  [[0, 4.3, 4.3], [0.3, 4, 5.4], [0.7, 3.1, 3.6], [1, 2.7, 2.7]],
  upper: [[0, 4.8, 5.6], [0.3, 4.4, 4.8], [0.7, 3.8, 3.8], [1, 3.3, 3.3]],
  fore:  [[0, 3.3, 3.3], [0.35, 3.6, 3.3], [1, 2.4, 2.3]],
  neck:  [[0, 3.8, 4.2], [1, 3.4, 3.6]],
};
// torso profiles: [y (hips 0, up negative), front, back]; zombies are slimmer than the living
const HT_Z = [[4, 5.5, 6.6], [0, 6.4, 7.2], [-6, 6.4, 7], [-12, 6.4, 6.6], [-18, 7.4, 7], [-24, 8.2, 7.6], [-28, 6.8, 7.2], [-31.5, 3.7, 4.5]];
const HT_H = [[4, 5.8, 6.8], [0, 6.8, 7.4], [-6, 6.8, 7.2], [-12, 7, 7], [-18, 8.6, 7.8], [-24, 9.8, 8.6], [-28, 8.8, 8.6], [-31.5, 5, 5.6]];
const sstep = x => x * x * (3 - 2 * x);
function profAt(tab, t, j) {
  if (t <= tab[0][0]) return tab[0][j];
  for (let i = 1; i < tab.length; i++) if (t <= tab[i][0]) { const a = tab[i - 1], b = tab[i]; return a[j] + (b[j] - a[j]) * sstep((t - a[0]) / (b[0] - a[0])); }
  return tab[tab.length - 1][j];
}
function htAt(T, y, j) { // torso profile at height y (rows run from +4 down to -31.5)
  if (y >= T[0][0]) return T[0][j];
  for (let i = 1; i < T.length; i++) if (y >= T[i][0]) { const a = T[i - 1], b = T[i]; return a[j] + (b[j] - a[j]) * sstep((a[0] - y) / (a[0] - b[0])); }
  return T[T.length - 1][j];
}
function closedSmooth(c, Q) { const m = [(Q[0][0] + Q[Q.length - 1][0]) / 2, (Q[0][1] + Q[Q.length - 1][1]) / 2]; c.moveTo(m[0], m[1]); smoothPath(c, [m, ...Q, m], false); c.closePath(); }
// limb outline A -> B from a profile; returns the outline and the sampled centre line for shading strips
function hLimb(A, B, prof, k, f) {
  const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d, nx = -uy, ny = ux, lf = nx * f - ny * 0.35 > 0;
  const L = [], R = [], C = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6, fr = profAt(prof, t, 1) * k, bk = profAt(prof, t, 2) * k, wl = lf ? fr : bk, wr = lf ? bk : fr, x = A[0] + dx * t, y = A[1] + dy * t;
    L.push([x + nx * wl, y + ny * wl]); R.push([x - nx * wr, y - ny * wr]); C.push([x, y, wl, wr]); }
  const e0 = (prof[0][1] + prof[0][2]) / 2 * k, e1 = (prof[prof.length - 1][1] + prof[prof.length - 1][2]) / 2 * k;
  R.reverse();
  return { Q: [...L, [B[0] + ux * e1 * 1.1, B[1] + uy * e1 * 1.1], ...R, [A[0] - ux * e0 * 1.1, A[1] - uy * e0 * 1.1]], C, nx, ny, lf };
}
function hCrescent(c, e, front, dIn) { // shading strip hugging one side, zero width at both ends
  const s = front === e.lf ? 1 : -1, A = [], B = [], N = e.C.length - 1;
  for (let i = 0; i <= N; i++) { const q = e.C[i], w = s > 0 ? q[2] : q[3], d = 1 - (1 - dIn) * Math.pow(Math.sin(Math.PI * i / N), 0.7);
    A.push([q[0] + s * e.nx * w, q[1] + s * e.ny * w]); B.push([q[0] + s * e.nx * w * d, q[1] + s * e.ny * w * d]); }
  smoothPath(c, A, true); smoothPath(c, B.reverse(), false); c.closePath();
}
// small static shapes as flat command lists, traced through a 2x3 matrix (no Path2D, so they batch into one path)
const svgCmds = d => d.match(/[MLQZ]|-?[\d.]+/g).map(t => /[MLQZ]/.test(t) ? t : +t);
const H_SHOE = svgCmds('M-4 -4.6 L2 -4.8 Q4 -2.6 7.6 -1.4 Q10.4 -0.4 10.4 1.4 L10.4 2.4 L-4.8 2.4 Q-5.6 2.4 -5.4 0 Z');
const H_BOOT = svgCmds('M-4.4 -7 L2.6 -7 L2.8 -3.6 Q5 -2.6 8 -1.8 Q10.8 -1 10.8 1.2 L10.8 2.4 L-5 2.4 Q-5.8 2.4 -5.6 0 Z');
const H_HAND = svgCmds('M-1.4 -2.8 Q3 -3.6 5 -1.6 Q6.6 0.6 4.8 2.6 Q1.6 4 -1.6 2.8 Z M0.2 -2.2 Q1.8 -5.4 4.2 -4.6 Q4.6 -3 2.6 -1.6 Z');
const H_BONY = svgCmds('M-1.4 -2.2 Q1.6 -3 3.4 -2.4 L7.6 -3.8 Q8.4 -3.4 7.8 -2.7 L4.8 -1.2 L8.4 -0.6 Q8.8 0.2 8 0.5 L4.8 0.6 L7.4 2.4 Q7.4 3.3 6.5 3 L3.6 1.8 Q1 3 -1.4 2.2 Z M0.8 -2 Q2 -4.8 4 -4.6 Q4 -3.4 2.8 -2 Z');
function traceCmds(c, K, m) {
  const X = (x, y) => m[0] * x + m[2] * y + m[4], Y = (x, y) => m[1] * x + m[3] * y + m[5];
  for (let i = 0; i < K.length;) {
    const k = K[i++];
    if (k === 'M') { c.moveTo(X(K[i], K[i + 1]), Y(K[i], K[i + 1])); i += 2; }
    else if (k === 'L') { c.lineTo(X(K[i], K[i + 1]), Y(K[i], K[i + 1])); i += 2; }
    else if (k === 'Q') { c.quadraticCurveTo(X(K[i], K[i + 1]), Y(K[i], K[i + 1]), X(K[i + 2], K[i + 3]), Y(K[i + 2], K[i + 3])); i += 4; }
    else c.closePath();
  }
}
const _hp = new Map(); // cached torso paths in torso-local units (Path2D is built on first use: the Node sim has none)
function hPath(key, build) { let P = _hp.get(key); if (!P) { P = new Path2D(); build(P); _hp.set(key, P); } return P; }
function drawHuman(c, p, look, s, f, flash, hat, cut, headAng, opt, lod) {
  const rich = !flash && !lod, W = flash ? '#fff' : null, deco = opt.deco, face = opt.face, zom = face === 'zombie', hero = face === 'hero';
  const cs = { k: look.k, s: look.s, p: look.p || shade(look.s, 0.6), a: look.a || look.s };
  const bare = zom || hero, LW = H_LW, T = zom ? HT_Z : HT_H, tid = zom ? 'z' : 'h', kL = zom ? 0.95 : 1;
  const Nk = p[1], Pl = p[2]; let ux = Nk[0] - Pl[0], uy = Nk[1] - Pl[1]; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const fx = -f * uy, fy = f * ux, Wd = (lx, ly) => [Pl[0] + (fx * lx - ux * ly) * s, Pl[1] + (fy * lx - uy * ly) * s]; // torso frame -> world
  const shoeCol = zom ? '#5b4331' : hero ? '#3a2e26' : deco === 'fur' ? '#6b4a2b' : deco === 'wrap' ? cs.p : deco === 'armor' || deco === 'robot' ? shade(cs.p, 0.8) : '#2e2a26';
  const handCol = hero ? '#26282e' : cs.k;
  c.lineCap = 'round'; c.lineJoin = 'round';
  // one layer = parts that share an ink pass; part: { tr: () => trace outline, col, e?, kind? }
  const layer = (parts, bk) => {
    c.beginPath(); for (const q of parts) q.tr(); c.strokeStyle = INKD; c.lineWidth = LW * 2; c.stroke();
    for (let i = 0; i < parts.length;) { const col = parts[i].col; c.beginPath(); while (i < parts.length && parts[i].col === col) parts[i++].tr(); c.fillStyle = W || (bk ? shade(col, 0.74) : col); c.fill(); }
    if (!rich) return;
    c.beginPath(); for (const q of parts) if (q.e) hCrescent(c, q.e, false, 0.45); c.fillStyle = 'rgba(0,0,0,.3)'; c.fill();
    if (bk) return;
    c.beginPath(); for (const q of parts) if (q.e) hCrescent(c, q.e, true, 0.8); c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
    c.beginPath(); for (const q of parts) if (q.e) folds(q); c.strokeStyle = 'rgba(26,20,16,.55)'; c.lineWidth = 0.45; c.stroke();
    for (const q of parts) if (q.e) extras(q);
  };
  const limbPart = (A, B, kind, col) => { const e = hLimb(A, B, HLIMB[kind], kL * s, f); return { tr: () => closedSmooth(c, e.Q), col, e, kind }; };
  const at = (e, i, front, d) => { const sg = front === e.lf ? 1 : -1, q = e.C[i], w = sg > 0 ? q[2] : q[3]; return [q[0] + sg * e.nx * w * d, q[1] + sg * e.ny * w * d]; };
  const folds = q => { // creases near the lower joint, a muscle line in front
    const e = q.e, N = 6, cr = (i, front, len) => { const a = at(e, i, front, 0.98), m = at(e, i, front, 1 - len * 0.6), b = at(e, i - 1, front, 1 - len); c.moveTo(a[0], a[1]); c.quadraticCurveTo(m[0], m[1], b[0], b[1]); };
    if (q.kind === 'thigh') { cr(N, false, 0.7); cr(N - 1, false, 0.45); cr(3, true, 0.35); const a = at(e, 1, true, 0.5), b = at(e, 4, true, 0.35); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
    else if (q.kind === 'shin') { cr(2, false, 0.55); cr(N, true, 0.5); cr(N - 1, false, 0.4); }
    else if (q.kind === 'upper') { cr(N, false, 0.6); cr(N - 1, true, 0.4); }
    else if (q.kind === 'fore' && bare) { const a = at(e, 2, true, 0.3), b = at(e, 5, true, 0.2); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  };
  const extras = q => {
    const e = q.e, ang = Math.atan2(e.ny, e.nx);
    if (q.kind === 'fore' && bare) { // rolled sleeve at the elbow (+ a wrist wrap on the player)
      const a = e.C[0], b = e.C[1]; c.beginPath(); c.ellipse(a[0] + (b[0] - a[0]) * 0.4, a[1] + (b[1] - a[1]) * 0.4, (a[2] + a[3]) * 0.62, 1.9 * s, ang, 0, TAU);
      c.fillStyle = mix(cs.a, '#ffffff', 0.12); c.fill(); c.strokeStyle = INKD; c.lineWidth = 0.5; c.stroke();
      if (hero) { const w = e.C[5]; c.beginPath(); c.ellipse(w[0], w[1], (w[2] + w[3]) * 0.55, 1.3 * s, ang, 0, TAU); c.fillStyle = '#2a2d33'; c.fill(); c.stroke(); }
    }
    if (q.kind === 'thigh' && zom) { // torn denim: a pale slash across the front
      const ux2 = (e.C[6][0] - e.C[0][0]), uy2 = (e.C[6][1] - e.C[0][1]), l = Math.hypot(ux2, uy2) || 1, tx = ux2 / l * 0.9 * s, ty = uy2 / l * 0.9 * s;
      c.beginPath(); const a0 = at(e, 4, true, 1); c.moveTo(a0[0] - tx, a0[1] - ty);
      const P = []; for (let j = 1; j <= 5; j++) { const b = at(e, 4, true, 1 - j * 0.13); P.push([b[0] + tx * (j % 2 ? 0.5 : -0.5), b[1] + ty * (j % 2 ? 0.5 : -0.5)]); }
      for (const v of P) c.lineTo(v[0] - tx * 0.6, v[1] - ty * 0.6); for (let j = P.length - 1; j >= 0; j--) c.lineTo(P[j][0] + tx * 0.7, P[j][1] + ty * 0.7); c.lineTo(a0[0] + tx, a0[1] + ty); c.closePath();
      c.fillStyle = '#d9dcd8'; c.fill(); c.strokeStyle = 'rgba(26,20,16,.7)'; c.lineWidth = 0.4; c.stroke();
    }
    if (q.kind === 'thigh' && deco === 'tactical') { // cargo pocket
      const P = [at(e, 2, true, 0.05), at(e, 4, true, 0.1), at(e, 4, false, 0.45), at(e, 2, false, 0.5)];
      c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let j = 1; j < 4; j++) c.lineTo(P[j][0], P[j][1]); c.closePath(); c.fillStyle = shade(cs.p, 0.86); c.fill();
      const m0 = at(e, 3, true, 0.1), m1 = at(e, 3, false, 0.48); c.moveTo((P[0][0] + m0[0]) / 2, (P[0][1] + m0[1]) / 2); c.lineTo((P[3][0] + m1[0]) / 2, (P[3][1] + m1[1]) / 2);
      c.strokeStyle = 'rgba(26,20,16,.8)'; c.lineWidth = 0.4; c.stroke();
    }
    if (q.kind === 'shin' && deco === 'tactical') { const a = at(e, 1, true, 0.35); c.beginPath(); c.ellipse(a[0], a[1], 3 * s, 3.8 * s, ang, 0, TAU); c.fillStyle = '#3e4652'; c.fill(); c.strokeStyle = INKD; c.lineWidth = 0.4; c.stroke(); }
  };
  const shoePart = (K, F) => { const ph = Math.atan2((F[0] - K[0]) * f, F[1] - K[1]), r = -ph * 0.5, u0 = f * Math.cos(r) * s * 1.15, u1 = Math.sin(r) * s * 1.15, m = [u0, u1, -f * u1, f * u0, F[0], F[1]];
    return { tr: () => traceCmds(c, hero ? H_BOOT : H_SHOE, m), col: shoeCol }; };
  const handPart = (E, H) => { const dx = H[0] - E[0], dy = H[1] - E[1], d = Math.hypot(dx, dy) || 1, u0 = dx / d * s * 1.2, u1 = dy / d * s * 1.2, m = [u0, u1, -f * u1, f * u0, H[0] - dx / d * s, H[1] - dy / d * s];
    return { tr: () => traceCmds(c, zom ? H_BONY : H_HAND, m), col: handCol }; };
  const arm = bk => { const E = p[bk ? 3 : 5], H = p[bk ? 4 : 6];
    layer([limbPart(Wd(bk ? -1.5 : 0.5, -27.5), E, 'upper', cs.a), limbPart(E, H, 'fore', bare ? cs.k : cs.a), handPart(E, H)], bk); };
  const leg = bk => { const K = p[bk ? 7 : 9], F = p[bk ? 8 : 10];
    layer([limbPart(Wd(bk ? -1.4 : 1.4, 1), K, 'thigh', cs.p), limbPart(K, F, 'shin', cs.p), shoePart(K, F)], bk); };
  // ---- torso in its own frame: +x forward, -y toward the neck, units of s
  const torso = () => {
    c.save(); c.transform(fx * s, fy * s, -ux * s, -uy * s, Pl[0], Pl[1]);
    const pr0 = y => htAt(T, y, 1), pr1 = y => htAt(T, y, 2), ys = (y0, y1, n) => { const a = []; for (let i = 0; i <= n; i++) a.push(y0 + (y1 - y0) * i / n); return a; };
    const silh = hPath('s' + tid, P => { const Y = ys(4, -31.5, 16), Q = [...Y.map(y => [pr0(y), y]), [0, -34], ...Y.reverse().map(y => [-pr1(y), y]), [0, 7]]; closedSmooth(P, Q); });
    const strip = (y0, y1, col, fr = 1) => { c.fillStyle = W || col; c.fill(hPath(`b${tid}${y0},${y1},${fr}`, P => { const Y = ys(y0, y1, 8);
      P.moveTo(pr0(Y[0]) * fr, Y[0]); for (const y of Y) P.lineTo(pr0(y) * fr, y); for (const y of Y.reverse()) P.lineTo(-pr1(y) * fr, y); P.closePath(); })); };
    const side = (y0, y1, dIn, front, col) => { c.fillStyle = col; c.fill(hPath(`e${tid}${y0},${y1},${dIn},${front}`, P => { const Y = ys(y0, y1, 10), A = [], B = [];
      Y.forEach((y, i) => { const w = front ? pr0(y) : -pr1(y), d = 1 - (1 - dIn) * Math.pow(Math.sin(Math.PI * i / 10), 0.7); A.push([w, y]); B.push([w * d, y]); });
      smoothPath(P, A, true); smoothPath(P, B.reverse(), false); P.closePath(); })); };
    const belt = (y, col) => { strip(y + 1.2, y - 1.4, col); if (!W) { c.fillStyle = '#b8a070'; c.fillRect(pr0(y) * 0.45, y - 1.5, 2.4, 3); } };
    const ink = (a = 0.6) => { c.strokeStyle = `rgba(26,20,16,${a})`; c.lineWidth = 0.45 / s; c.stroke(); };
    const dkS = shade(cs.s, 0.72);
    let hem = -8; if (deco === 'fur') hem = -4; else if (deco === 'robe' || deco === 'coat') hem = 3;
    c.fillStyle = W || cs.s; c.fill(silh);
    if (hem < 3) strip(4, hem, cs.p);
    if (rich) {
      switch (deco) {
        case 'torn': { // tucked work shirt: belt, placket, pocket, folds, grime
          belt(-7.6, '#4a3322');
          c.fillStyle = 'rgba(90,70,30,.28)'; c.beginPath(); c.arc(-2, -14, 2.4, 0, TAU); c.moveTo(4.6, -25); c.arc(3, -25, 1.6, 0, TAU); c.moveTo(1.2, -20); c.arc(0, -20, 1.2, 0, TAU); c.fill();
          c.fillStyle = 'rgba(110,20,22,.5)'; c.beginPath(); c.ellipse(2.6, -18, 2, 1.5, 0.4, 0, TAU); c.fill();
          c.beginPath(); c.moveTo(pr0(-28) * 0.5, -28); c.quadraticCurveTo(pr0(-18) * 0.6, -18, pr0(-9) * 0.6, -9);
          c.moveTo(1, -22.4); c.quadraticCurveTo(3, -22.8, 5, -22.2); c.moveTo(1.2, -22.4); c.quadraticCurveTo(1, -20, 1.4, -18.6); c.quadraticCurveTo(3, -18.2, 4.6, -18.8); c.moveTo(4.8, -22.2); c.quadraticCurveTo(4.8, -20.4, 4.6, -18.8);
          c.moveTo(-3.4, -25.5); c.quadraticCurveTo(-1.2, -19, 0.4, -13); c.moveTo(2, -11.6); c.quadraticCurveTo(4, -10.8, 5.4, -9.2); c.moveTo(-4.4, -12.4); c.quadraticCurveTo(-2.6, -10.6, -1.6, -9.2);
          c.moveTo(0, -31); c.quadraticCurveTo(2.6, -29, 4.6, -27.6); ink(0.65);
          c.fillStyle = INKD; c.beginPath(); for (const y of [-24, -19.5, -15, -10.6]) { const x = pr0(y) * 0.58; c.moveTo(x + 0.5, y); c.arc(x, y, 0.5, 0, TAU); } c.fill(); break;
        }
        case 'tactical': { // plate carrier over the shirt
          belt(-9.3, '#10141f'); strip(-11, -29.4, '#2e3524', 0.98); side(-11, -29.4, 0.45, false, 'rgba(0,0,0,.3)');
          c.fillStyle = '#2b3650'; c.beginPath(); for (const y of [-20.4, -15]) { const x = pr0(y) - 2.6; c.roundRect(x - 2.4, y - 2.4, 4.8, 5, 1); } c.fill(); ink(0.8);
          c.beginPath(); c.moveTo(-4.6, -29); c.quadraticCurveTo(-1, -22, 2.6, -11.4); c.moveTo(-5.6, -18); c.quadraticCurveTo(-2, -15.4, 1.2, -12.6); c.moveTo(0, -31); c.quadraticCurveTo(2.4, -29.6, 4.6, -29); ink(); break;
        }
        case 'armor': {
          strip(-12, -28, mix(cs.s, '#aab2bc', 0.5)); c.beginPath(); for (let k = 1; k <= 3; k++) { c.moveTo(-6.5, -12 - k * 4); c.lineTo(8.2, -12 - k * 4); } ink(0.5);
          strip(-27.6, -29.2, '#9aa3ad'); belt(-9.5, '#3a3a40'); break;
        }
        case 'fur': {
          c.beginPath(); c.moveTo(-8, -3); for (let i = 0; i <= 6; i++) c.lineTo(-7 + i * 2.3, i % 2 ? -1 : -6.4); c.lineTo(9, -3); c.closePath(); c.fillStyle = cs.s; c.fill();
          strip(-5, -6.6, cs.s); c.fillStyle = dkS; c.beginPath(); c.arc(3, -18, 2.1, 0, TAU); c.moveTo(-1.3, -11); c.arc(-3, -11, 1.7, 0, TAU); c.moveTo(2.5, -25); c.arc(1, -25, 1.5, 0, TAU); c.fill();
          c.strokeStyle = shade(cs.s, 0.5); c.lineWidth = 2.3; c.beginPath(); c.moveTo(-5, -28); c.lineTo(5, -6); c.stroke(); break;
        }
        case 'robe': strip(-9.8, -11.6, '#8a6a3a'); c.beginPath(); c.moveTo(0, -30); c.lineTo(1.4, -22); c.moveTo(-2.6, -28); c.lineTo(-1.4, -12); ink(0.4); break;
        case 'wrap': c.beginPath(); for (let k = 0; k < 6; k++) { const y = -4 - k * 4.6; c.moveTo(-8, y + 3); c.lineTo(9, y - 3); } ink(0.45); strip(4, hem, shade(cs.p, 0.92)); break;
        case 'stone': c.beginPath(); c.moveTo(-3, -26); c.lineTo(1, -19); c.lineTo(-2, -12); c.moveTo(4, -17); c.lineTo(1.5, -9); ink(0.6);
          c.fillStyle = 'rgba(0,0,0,.12)'; c.beginPath(); c.arc(4, -23, 2.2, 0, TAU); c.moveTo(-1.2, -16); c.arc(-3, -16, 1.8, 0, TAU); c.moveTo(4.6, -6); c.arc(3, -6, 1.6, 0, TAU); c.fill(); break;
        case 'royal': {
          strip(-9.5, -11, '#1f4e8c'); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(0.4, -29.5, 7.6, 0, Math.PI); c.fill();
          c.fillStyle = '#1f4e8c'; c.beginPath(); c.arc(0.4, -29.5, 5, 0, Math.PI); c.fill(); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(0.4, -29.5, 3, 0, Math.PI); c.fill(); break;
        }
        case 'vest': {
          strip(-9.5, -28.5, shade(cs.s, 0.62)); c.fillStyle = shade(cs.s, 1.12); c.fillRect(-1, -28.5, 2.6, 19); belt(-9.2, shade(cs.p, 0.7));
          c.fillStyle = '#e8c547'; c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 1.1 : 2.6; c.lineTo(4 + Math.cos(a) * rr, -21 + Math.sin(a) * rr); } c.fill(); break;
        }
        case 'sash': strip(-6, -11, '#c0392b'); c.beginPath(); c.moveTo(2, -6); c.lineTo(4.6, 3); c.lineTo(1.2, 1.4); c.lineTo(-0.6, 4); c.lineTo(-0.4, -6); c.closePath(); c.fillStyle = '#c0392b'; c.fill(); break;
        case 'coat': c.fillStyle = '#e8c547'; c.beginPath(); for (let k = 1; k <= 3; k++) { c.moveTo(4.8, -k * 6.6 - 3); c.arc(3.6, -k * 6.6 - 3, 1.2, 0, TAU); } c.fill();
          c.fillStyle = shade(cs.s, 1.3); c.beginPath(); c.moveTo(1, -30); c.lineTo(5, -22); c.lineTo(3, -12); c.lineTo(-0.5, -22); c.closePath(); c.fill(); strip(-9.8, -11, '#3a2a1c'); break;
        case 'stripes': for (let k = 0; k < 5; k++) strip(-6 - k * 4.6, -8.2 - k * 4.6, 'rgba(30,50,110,.6)'); belt(-9.2, '#2a2a3a'); break;
        case 'robot': {
          c.beginPath(); c.rect(-4.6, -25, 9.6, 12); c.moveTo(-6, -11); c.lineTo(7, -11); ink(0.6);
          c.fillStyle = '#39e1ff'; c.beginPath(); c.arc(3, -19, 2.3, 0, TAU); c.fill(); c.fillStyle = '#e8ffff'; c.beginPath(); c.arc(3, -19, 0.9, 0, TAU); c.fill();
          strip(-8.5, -11, '#2a3140'); break;
        }
        default: c.beginPath(); c.moveTo(-3, -31); c.lineTo(1, -26); c.moveTo(-3.4, -25.5); c.quadraticCurveTo(-1.2, -19, 0.4, -13); ink(0.5); belt(-9, shade(cs.p, 0.6));
      }
      side(3, -31, 0.45, false, 'rgba(0,0,0,.28)'); side(-10, -28, 0.8, true, deco === 'torn' ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.14)');
    } else if (hem < 3) belt(-9, shade(cs.p, 0.6));
    c.strokeStyle = INKD; c.lineWidth = LW * 1.5 / s; c.stroke(silh);
    if (cut === 0 && !flash) { c.fillStyle = '#7a1418'; c.beginPath(); c.ellipse(0.2, -31.6, 3.6, 1.3, 0, 0, TAU); c.fill(); c.fillStyle = '#e8dcc8'; c.beginPath(); c.arc(0.2, -31.6, 1, 0, TAU); c.fill(); }
    c.restore();
  };
  const skirt = (hemY, fl, col) => { // robe / coat tails over the thighs
    c.save(); c.transform(fx * s, fy * s, -ux * s, -uy * s, Pl[0], Pl[1]);
    c.beginPath(); c.moveTo(6.6, -9); c.quadraticCurveTo(7 + fl * 0.4, hemY * 0.5, 6.4 + fl, hemY); c.quadraticCurveTo(0, hemY + 2.2, -6.8 - fl, hemY); c.quadraticCurveTo(-7 - fl * 0.4, hemY * 0.5, -7, -9); c.closePath();
    c.fillStyle = W || col; c.fill(); c.strokeStyle = INKD; c.lineWidth = LW * 1.5 / s; c.stroke();
    if (rich) { c.beginPath(); c.moveTo(-1, -6); c.lineTo(-2 - fl * 0.2, hemY - 1); c.moveTo(3, -6); c.lineTo(3.6 + fl * 0.3, hemY - 1); c.strokeStyle = 'rgba(26,20,16,.4)'; c.lineWidth = 0.45 / s; c.stroke(); }
    c.restore();
  };
  // ---- assemble: far arm, far leg, neck, torso, near leg, skirt, head, near arm
  const h = p[0];
  arm(true); leg(true);
  if (cut !== 0) { const hx = h[0] - Nk[0], hy = h[1] - Nk[1], hl = Math.hypot(hx, hy) || 1; layer([limbPart(Wd(0.6, -28), [h[0] - hx / hl * 6 * s, h[1] - hy / hl * 6 * s], 'neck', cs.k)], false); }
  torso();
  leg(false);
  if (deco === 'robe') skirt(21, 3, cs.s); else if (deco === 'coat') skirt(14, 2.5, cs.s);
  { const tA = Math.atan2(uy, ux) + Math.PI / 2; let rel = Math.atan2(h[1] - Nk[1], h[0] - Nk[0]) + Math.PI / 2 - tA; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const ang = headAng ?? tA + rel * (zom ? 0.3 : 1), S = s * (zom ? 0.98 : 0.95);
    c.save(); c.translate(h[0], h[1]); c.rotate(ang); c.scale(f * S, S); c.translate(0, hero ? 3.4 : 1);
    humanHead(c, look, hat, face, flash, rich, LW / S, cut === 0, p.act || 0); c.restore(); }
  arm(false);
}
let HP = null; // head paths, built on first use (Path2D does not exist in the Node sim)
const headPaths = () => HP || (HP = Object.fromEntries(Object.entries({
  face: 'M-9 -1 C-9.6 -8.6 -4 -11.6 1.6 -11.4 C6.6 -11.2 9 -8 9 -4.4 L9.4 -2.6 L9 -1.6 L11 2.2 L9.4 3 L9.8 4.6 L9.1 5.4 L9.5 6.4 L8.5 7.2 C8.8 9.2 7.2 10 5.6 10.2 C2.6 10.6 0.4 9.6 -0.8 8 L-2.4 6 C-7 5.2 -8.8 3 -9 -1 Z',
  fsh: 'M-9 -1 C-9.6 -8.6 -4 -11.6 1.6 -11.4 C-3 -10 -5.6 -6 -5.2 -0.6 C-5 2.4 -3.6 4.6 -2.4 6 C-7 5.2 -8.8 3 -9 -1 Z',
  hair: 'M-9 -1 C-9.6 -8.6 -4 -11.6 1.6 -11.4 C5.6 -11.3 8 -9.6 8.6 -7.6 C6 -8.4 3 -8.6 0.4 -8 C-2.6 -7.4 -4.6 -5 -5.2 -1.6 C-6.2 0 -7.6 0.6 -9 -1Z',
  stub: 'M-2.6 1.8 C0 2.6 2 3.4 4.4 3.2 L6 4.8 L9.2 4.6 L9.8 5 L9.1 5.4 L9.5 6.4 L8.5 7.2 C8.8 9.4 7 10.6 5 10.6 C2 10.8 -0.4 9.6 -1.4 7.8 L-2.4 6 C-3 4.4 -3 3 -2.6 1.8Z',
  band: 'M-9.3 -3.4 C-8.6 -6.8 -4 -8.6 0.4 -8.8 C4 -9 7.6 -8.4 8.9 -7.4 L9 -5.4 C7.6 -6.4 4 -7 0.4 -6.8 C-4 -6.6 -8.2 -4.6 -9.1 -1.6Z',
  zup: 'M-8.6 -2 C-9.4 -9.6 -3.4 -12.8 2.4 -12 C7 -11.4 9.4 -8.4 9.2 -5 L10.2 -3.4 L9.3 -2.4 L11.4 1.6 L9.6 2.2 L9.4 3.4 L1 4.6 C-3 5.4 -6.6 4.6 -8.2 1.6 Z',
  zsh: 'M-8.6 -2 C-9.4 -9.6 -3.4 -12.8 2.4 -12 C-2 -10.8 -5 -7 -4.8 -2 C-4.6 1 -3 3.6 1 4.6 C-3 5.4 -6.6 4.6 -8.2 1.6 Z',
  zjaw: 'M-3.6 3.6 L9.2 3.6 C10.4 5.4 10.6 8.8 9.4 10.2 C7.6 11.6 3.6 11.2 0.6 9.6 C-1.6 8.4 -3.2 6.6 -3.6 3.6 Z',
  hairS: 'M8.6 -5.2 C8.8 -10.2 4 -12 -0.5 -11.8 C-6.6 -11.6 -11 -6.8 -10.2 0 C-10 2.8 -9.2 4.4 -8.2 5.6 L-6.8 3.6 C-6.8 -0.6 -5 -4 -1 -5.4 C3 -6.8 6 -5.6 8.6 -5.2Z',
  hairL: 'M9 -5 C9.4 -11 4 -13 -1 -12.6 C-8 -12 -12.6 -6.5 -12 2 C-11.8 6 -11 9.6 -8.6 11.4 L-7.4 7.4 L-6.2 10.6 L-5 4.6 C-5.6 0 -4 -4.4 0 -5.6 C3.4 -6.8 6.4 -5 9 -5Z',
  beard: 'M9.2 4.8 C10.4 8 8.4 11.8 4.6 12.3 C0 12.8 -4.2 9 -6.4 4.6 L-5 3.4 C-2.4 7 2 8.2 5 7.4 C7 6.8 8.6 6 9.2 4.8Z',
  helm: 'M-10.4 4.5 C-12 -5 -6 -12.6 1 -12.4 C7.6 -12.2 10.6 -7 10.4 -4.6 L4 -5 L-1 -4.6 L-6 -2 L-6.6 4.6Z',
  nasal: 'M7.2 -4.8 L9.6 -4.4 L9.6 1.6 L8 4.6 L7 4.6Z',
  cowl: 'M9.4 -5.5 C8 -12.5 -1 -14.6 -7 -11.6 C-13 -8 -13 2 -11 12 L-3 13 C-5 6 -5 -2 -2 -5 C1 -7 6 -6.2 9.4 -5.5Z',
  robot: 'M-8.6 -5 C-8.6 -10.4 -3 -11.4 1 -11.4 L5 -11.4 C8.8 -11.4 9.6 -8.4 9.6 -5 L9.6 6 C9.6 9 7.6 9.6 5 9.6 L-3.4 9.6 C-7 9.6 -8.6 8 -8.6 3.6Z',
  cape: 'M-9.4 -7 C-12 0 -11.5 9 -10 15 L-2.4 13.4 L-4.4 3 Z',
}).map(([k, d]) => [k, new Path2D(d)])));
function humanHead(c, look, hat, face, flash, rich, lw, cut, act = 0) {
  const Hd = headPaths(), K = look.k, zom = face === 'zombie', hero = hat === 'hero', fl = x => flash ? '#fff' : x, t = performance.now() / 1000;
  const hair = '#2e2219', ink = INKD;
  const P = (path, col) => { c.fillStyle = fl(col); path ? c.fill(path) : c.fill(); c.strokeStyle = ink; c.lineWidth = lw; path ? c.stroke(path) : c.stroke(); };
  const line = (a = 0.55, w = 0.4) => { c.strokeStyle = `rgba(26,20,16,${a})`; c.lineWidth = w; c.stroke(); };
  const tails = (col, x, y) => { const wv = Math.sin(t * 10) * 1.6, wv2 = Math.sin(t * 10 + 2) * 1.6; c.beginPath();
    c.moveTo(x, y); c.quadraticCurveTo(x - 6, y - 1 + wv * 0.5, x - 12, y + 2 + wv); c.lineTo(x - 10.6, y + 5 + wv); c.quadraticCurveTo(x - 6, y + 2, x, y + 2.6); c.closePath();
    c.moveTo(x, y + 1); c.quadraticCurveTo(x - 5, y + 4 + wv2 * 0.5, x - 8, y + 9 + wv2); c.lineTo(x - 5.6, y + 9.4 + wv2); c.quadraticCurveTo(x - 3, y + 5, x + 0.6, y + 2.6); c.closePath(); P(null, col); };
  // behind the head
  if (hero) tails('#8f2a24', -8.6, -4.4);
  if (hat === 'crown') { P(Hd.cape, '#1f4e8c'); if (!flash) { c.beginPath(); for (let k = 0; k < 4; k++) { c.moveTo(-10.6 + k * 0.8, 1 + k * 3.4); c.lineTo(-3.4 - k * 0.2, 0 + k * 3.4); } c.strokeStyle = '#e8c547'; c.lineWidth = 1.1; c.stroke(); } }
  if (hat === 'anubis') for (const [x0, x1, y1, x2] of [[-6.6, -8.4, -21, -1.6], [-1.6, 0.8, -22, 4.4]]) { c.beginPath(); c.moveTo(x0, -8); c.lineTo(x1, y1); c.lineTo(x2, -9.4); c.closePath(); P(null, K); if (!flash) { c.fillStyle = '#7a5a2a'; c.beginPath(); c.moveTo(x0 + 1.3, -9.6); c.lineTo(x1 + 0.4, y1 + 3.5); c.lineTo(x2 - 1.4, -10.4); c.fill(); } }
  if (hat === 'visor') { // robot head
    c.fillStyle = fl(K); c.fill(Hd.robot); if (rich) { c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(-6, -10.6, 12, 1.6); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(-8.4, 6.4, 18, 3); }
    c.strokeStyle = ink; c.lineWidth = lw; c.stroke(Hd.robot);
    if (!flash) { c.fillStyle = '#0d2a33'; c.fillRect(-1, -5.6, 10.6, 4.4); c.fillStyle = '#39e1ff'; c.fillRect(0, -4.8, 9.6, 2.6); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(0.4, -4.8, 8.8, 0.8);
      c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(3 + i * 1.8, 4); c.lineTo(3 + i * 1.8, 7.4); } line(0.5, 0.5);
      c.beginPath(); c.moveTo(-2, -11.4); c.lineTo(-2.6, -16.4); c.strokeStyle = ink; c.lineWidth = lw; c.stroke(); c.fillStyle = '#39e1ff'; c.beginPath(); c.arc(-2.6, -16.8, 1.1, 0, TAU); c.fill(); }
    if (cut) { c.fillStyle = '#5a1216'; c.beginPath(); c.ellipse(0, 9.4, 3.4, 1.1, 0, 0, TAU); c.fill(); }
    return;
  }
  if (zom) { // bald, gaunt skull, hanging jaw, glowing eyes
    const bite = act > 0 ? Math.sin(act * Math.PI) : 0;
    const jAng = 0.14 + (Math.sin(t * 3.2) > 0.3 ? 0.06 : 0) + (Math.sin(t * 1.7) > 0.82 ? Math.sin(t * 26) * 0.04 : 0) + bite * 0.34;
    c.save(); c.translate(-3, 3.6); c.rotate(jAng); c.translate(3, -3.6); P(Hd.zjaw, shade(K, 0.86));
    if (!flash) { c.fillStyle = '#e9e0bb'; c.beginPath(); for (const x of [4.4, 6, 7.6]) { c.moveTo(x, 3.9); c.lineTo(x + 0.7, 2.7); c.lineTo(x + 1.3, 3.9); } c.fill(); }
    c.restore();
    if (!flash) { c.fillStyle = '#22080a'; c.beginPath(); c.moveTo(-2, 3.8); c.lineTo(9.8, 3.2); c.lineTo(9.8, 5.8 + bite * 3.6); c.lineTo(-1.4, 6 + bite * 2.8); c.fill(); }
    c.fillStyle = fl(K); c.fill(Hd.zup);
    if (!flash) {
      c.fillStyle = shade(K, 0.68); c.fill(Hd.zsh);
      c.fillStyle = '#e9e0bb'; c.beginPath(); for (let x = 3.6; x < 9; x += 1.35) { const y = 3.2 + (9.4 - x) * 0.143; c.moveTo(x, y); c.lineTo(x + 0.6, y + 1.3 + (x % 2) * 0.3); c.lineTo(x + 1.1, y); } c.fill();
      c.fillStyle = 'rgba(40,25,10,.6)'; c.beginPath(); c.ellipse(5.9, -1.8, 3.2, 2.3, -0.1, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,225,74,.28)'; c.beginPath(); c.ellipse(6.4, -1.7, 3.4 + bite * 0.8, 2.5 + bite * 0.6, -0.1, 0, TAU); c.fill(); // glow halo (a sprite + 'lighter' cost 4x the whole zombie)
      c.fillStyle = '#fff45c'; c.beginPath(); c.ellipse(6.4, -1.7, 1.9 + bite * 0.5, 1.1 + bite * 0.4, -0.1, 0, TAU); c.fill();
      if (rich) {
        c.fillStyle = 'rgba(255,255,225,.28)'; c.beginPath(); c.moveTo(-5.4, -8.6); c.quadraticCurveTo(-1, -12.2, 5, -10.8); c.quadraticCurveTo(0, -10.6, -4.2, -7.4); c.fill();
        c.fillStyle = 'rgba(70,50,10,.32)'; c.beginPath(); c.moveTo(2, 1.4); c.quadraticCurveTo(5.4, 0.2, 8.8, 1.4); c.quadraticCurveTo(7.6, 3.8, 4, 4.2); c.quadraticCurveTo(2.4, 3.4, 2, 1.4); c.fill();
        c.beginPath(); c.moveTo(3.4, 1); c.quadraticCurveTo(6, -0.3, 9.2, 1.1); c.moveTo(3, -8.2); c.quadraticCurveTo(6, -9.2, 8.4, -7.8); c.moveTo(4, -6.7); c.quadraticCurveTo(6.4, -7.3, 8.8, -6.3); c.moveTo(-2.6, -9.6); c.quadraticCurveTo(-4.4, -6, -3.6, -3.4); line();
      }
      c.fillStyle = shade(K, 0.82); c.beginPath(); c.ellipse(-2.4, -0.4, 1.6, 2.4, 0.1, 0, TAU); c.fill(); c.strokeStyle = ink; c.lineWidth = lw * 0.6; c.stroke();
      c.beginPath(); c.moveTo(2.2, -4.4); c.quadraticCurveTo(6, -5.9, 10.2, -3.4); c.lineWidth = lw * 0.9; c.stroke();
    }
    c.strokeStyle = ink; c.lineWidth = lw; c.stroke(Hd.zup);
    if (cut && !flash) { c.fillStyle = '#7a1418'; c.beginPath(); c.ellipse(-0.4, 7.6, 3.4, 1.2, 0, 0, TAU); c.fill(); }
  } else { // living face in profile: brow, eye, ear, nose; hero gets a beard
    c.fillStyle = fl(K); c.fill(Hd.face);
    if (!flash) {
      c.fillStyle = shade(K, 0.8); c.fill(Hd.fsh);
      if (rich) { c.fillStyle = 'rgba(255,240,220,.3)'; c.beginPath(); c.moveTo(3.4, -6); c.quadraticCurveTo(7.6, -5.8, 8.8, -4.6); c.quadraticCurveTo(6, -5, 3.4, -4.8); c.fill(); }
      if (hero) { c.fillStyle = hair; c.fill(Hd.stub); if (rich) { c.beginPath(); for (const [x, y] of [[0, 4], [2, 6], [4, 8], [6, 9.4], [-1, 7], [3.4, 4.6]]) { c.moveTo(x, y); c.lineTo(x + 0.8, y + 1.4); } c.strokeStyle = 'rgba(255,230,200,.18)'; c.lineWidth = 0.35; c.stroke(); } }
      c.beginPath(); c.moveTo(6.6, 5.9); c.lineTo(9.2, 5.7); c.strokeStyle = hero ? shade(K, 0.5) : shade(K, 0.45); c.lineWidth = 0.5; c.stroke();
      c.fillStyle = '#f2ede2'; c.beginPath(); c.ellipse(6.3, -2.9, 1.7, 1.05, 0, 0, TAU); c.fill(); c.fillStyle = '#5a3a1e'; c.beginPath(); c.arc(6.9, -2.9, 0.85, 0, TAU); c.fill();
      c.fillStyle = '#0c0a08'; c.beginPath(); c.arc(7, -2.9, 0.45, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(6.6, -3.3, 0.25, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(4.6, -3.6); c.quadraticCurveTo(6.4, -4.3, 8.2, -3.4); c.strokeStyle = ink; c.lineWidth = lw * 0.6; c.stroke();
      c.beginPath(); c.moveTo(3.8, -4.9); c.quadraticCurveTo(6.4, -5.8, 9.2, -4.7); c.strokeStyle = hat === 'anubis' ? '#e8c547' : hair; c.lineWidth = lw * 1.5; c.stroke();
      if (rich) { c.beginPath(); c.moveTo(5, -1.4); c.quadraticCurveTo(6.6, -0.9, 8, -1.5); c.moveTo(9.6, 0.6); c.quadraticCurveTo(9, 1.8, 9.6, 2.6); line(0.5, 0.35); }
      c.fillStyle = shade(K, 0.86); c.beginPath(); c.ellipse(-2.2, 0.4, 1.5, 2.3, 0.1, 0, TAU); c.fill(); c.strokeStyle = ink; c.lineWidth = lw * 0.6; c.stroke();
    }
    c.strokeStyle = ink; c.lineWidth = lw; c.stroke(Hd.face);
    if (cut && !flash) { c.fillStyle = '#7a1418'; c.beginPath(); c.ellipse(1.6, 9.6, 3.4, 1.2, 0.2, 0, TAU); c.fill(); }
  }
  // headgear
  switch (hat) {
    case 'hero': c.fillStyle = fl(hair); c.fill(Hd.hair); P(Hd.band, '#8f2a24'); if (!flash) { c.fillStyle = '#8f2a24'; c.beginPath(); c.ellipse(-8.8, -3.4, 1.9, 1.6, 0, 0, TAU); c.fill(); c.strokeStyle = ink; c.lineWidth = lw * 0.6; c.stroke(); } break;
    case 'helmet': P(Hd.helm, mix('#7d8791', look.s, 0.3)); P(Hd.nasal, mix('#7d8791', look.s, 0.3));
      if (rich) { c.beginPath(); c.moveTo(-8, -9); c.quadraticCurveTo(-1, -13.4, 6, -9.6); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.2; c.stroke(); c.beginPath(); c.moveTo(-1, -12); c.lineTo(-1, -4.8); line(0.4, 0.6); } break;
    case 'cowboy': if (!zom) P(Hd.hairS, hair); c.beginPath(); c.moveTo(-6.6, -8.2); c.bezierCurveTo(-7, -14, -1.6, -16, 3.6, -15.4); c.bezierCurveTo(7.4, -14.8, 8, -11, 7.4, -8.2); c.closePath(); P(null, '#6b4423');
      c.beginPath(); c.moveTo(-15.5, -9.6); c.quadraticCurveTo(-8, -6.2, 0.5, -7.2); c.quadraticCurveTo(9, -6.2, 15.8, -10.6); c.quadraticCurveTo(9, -9.2, 0.5, -9.6); c.quadraticCurveTo(-8, -9.4, -15.5, -9.6); c.closePath(); P(null, '#7d5330');
      if (!flash) { c.fillStyle = '#2a1a10'; c.fillRect(-6.8, -10.4, 14.4, 1.7); c.beginPath(); c.moveTo(-3, -15.4); c.quadraticCurveTo(0.6, -13.6, 4, -15.2); line(0.4, 0.5); } break;
    case 'tricorn': if (!zom) P(Hd.hairS, hair); c.beginPath(); c.moveTo(-14, -5.8); c.quadraticCurveTo(-10, -11, -2, -12.4); c.quadraticCurveTo(1, -16.4, 5.6, -12.6); c.quadraticCurveTo(12, -10.4, 14.4, -5.6); c.quadraticCurveTo(6, -8.6, 0, -8.2); c.quadraticCurveTo(-8, -8.8, -14, -5.8); c.closePath(); P(null, '#1f1f25');
      if (!flash) { c.beginPath(); c.moveTo(-13.4, -6); c.quadraticCurveTo(-8, -8.6, 0, -8.4); c.quadraticCurveTo(6, -8.6, 13.8, -5.8); c.strokeStyle = '#d4af37'; c.lineWidth = 1; c.stroke(); } break;
    case 'crown': c.beginPath(); c.moveTo(-9.6, -6); c.bezierCurveTo(-10, -13, 8.6, -13.4, 9.6, -6.4); c.lineTo(9.4, -3.4); c.lineTo(-8.6, -3.4); c.closePath(); P(null, '#1f4e8c');
      if (!flash) { c.fillStyle = '#e8c547'; c.fillRect(-9.4, -7.6, 18.8, 2); c.beginPath(); c.moveTo(8.6, -8.6); c.lineTo(10.6, -6); c.lineTo(8.6, -5.4); c.fill(); c.beginPath(); c.moveTo(-3, -11.4); c.quadraticCurveTo(-4, -17, -1.6, -22); c.quadraticCurveTo(2, -22.4, 3.4, -18); c.quadraticCurveTo(4.6, -14, 4.4, -11.6); c.closePath(); c.fillStyle = '#f2eddc'; c.fill(); c.strokeStyle = ink; c.lineWidth = lw; c.stroke(); } break;
    case 'anubis': if (!flash) { c.fillStyle = '#e8c547'; c.fillRect(-9.6, -6.6, 19.2, 1.8);
        c.beginPath(); c.moveTo(7.4, -1); c.lineTo(17.4, 2.6); c.lineTo(17, 5.2); c.lineTo(8.6, 6.8); c.closePath(); P(null, K); c.fillStyle = '#e8c547'; c.beginPath(); c.arc(17, 2.8, 0.9, 0, TAU); c.fill(); } break;
    case 'hair': P(Hd.hairL, hair); P(Hd.beard, hair); if (rich) { c.beginPath(); c.moveTo(-8, -6); c.quadraticCurveTo(-2, -10.6, 4, -8.6); c.moveTo(-9, 2); c.lineTo(-8.4, 8); c.strokeStyle = shade(hair, 1.8); c.lineWidth = 0.5; c.stroke(); } break;
    case 'hood': if (!flash) { c.fillStyle = 'rgba(0,0,0,.34)'; c.fillRect(-3, -6, 12.6, 5); } P(Hd.cowl, shade(look.s, 0.85)); break;
    case 'bandana': if (!zom) P(Hd.hairS, hair); c.beginPath(); c.moveTo(-9.8, -5); c.bezierCurveTo(-6, -8, 5, -8, 9, -6); c.lineTo(9, -3.4); c.bezierCurveTo(5, -5, -6, -5.2, -9.8, -2.6); c.closePath(); P(null, '#c0392b');
      { const wv = Math.sin(t * 9) * 2; c.beginPath(); c.moveTo(-9.6, -3.4); c.quadraticCurveTo(-14, -2 + wv, -17, 0.4 + wv); c.lineTo(-15, 2.6 + wv); c.quadraticCurveTo(-12, 0, -9.4, -1.6); c.closePath(); P(null, '#c0392b'); } break;
    case 'bandage': if (!flash) { c.beginPath(); for (let i = 0; i < 4; i++) { c.moveTo(-8.6, 3.6 - i * 3); c.quadraticCurveTo(0, 0 - i * 3, 9, -1 - i * 3); } c.strokeStyle = 'rgba(110,90,60,.6)'; c.lineWidth = 0.9; c.stroke(); } break;
    case 'horns': P(Hd.hairS, shade(K, 0.6)); for (const [x, d] of [[-3.4, -1], [2, 1]]) { c.beginPath(); c.moveTo(x - 1.8, -10); c.bezierCurveTo(x - 4 * -d, -14, x - 3 * -d, -18, x + 1 * d, -21); c.bezierCurveTo(x - 1, -16, x + 1.6 * d, -13, x + 2.2, -10); c.closePath(); P(null, '#e8e2d0'); }
      if (!flash) { c.fillStyle = '#e8e2d0'; c.beginPath(); c.moveTo(5.6, 7.4); c.lineTo(6.6, 2.6); c.lineTo(8, 7); c.closePath(); c.fill(); } break;
    default: if (!zom) { c.fillStyle = fl(hair); c.fill(Hd.hair); }
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
  c.fillStyle = INKD; for (const q of parts) c.fillRect(q[1] - 0.7, q[2] - 0.7, q[3] + 1.4, q[4] + 1.4);
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
