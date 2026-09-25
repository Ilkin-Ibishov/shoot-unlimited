'use strict';
// World, combat, waves, input. Drawing lives in render.js.

const cvs = document.getElementById('game'), ctx = cvs.getContext('2d', { alpha: false });
let DPR = 1, SC = 1, viewW = 960;
function resize() {
  if (!innerWidth || !innerHeight) return; // hidden/zero-size frame: keep last good size
  DPR = Math.min(window.devicePixelRatio || 1, save.set.gfx === 'low' ? 1.25 : 2); // low graphics renders fewer pixels
  cvs.width = Math.round(innerWidth * DPR); cvs.height = Math.round(innerHeight * DPR);
  const old = SC; SC = cvs.height / VIEW_H; viewW = cvs.width / SC; G.sky = null;
  VIG = makeVignette('#000000', 0.5); HURTV = makeVignette('#c80000', 0.3);
  if (bg.length && Math.abs(clamp(SC, 1, 2) - BG_S) > 0.1) bg = makeBackground(era); // keep backgrounds crisp after rotate/resize
  if (old !== SC && G.amb) resetAmb();
}

// ===== save =====
// ?debug = test build: own save slot, no portal SDK, debug panel (js/debug.js). Never on CrazyGames.
const DEBUG = /[?&]debug\b/.test(location.search) && !/crazygames/.test((location.hostname || '') + (document.referrer || ''));
const DBG = { god: false, inf: false, oneHit: false, speed: 1, music: null }; // debug switches (music: [key, layer])
const SAVE_KEY = DEBUG ? 'shoot-unlimited-debug' : 'shoot-unlimited-v1';
function readSave(raw) {
  const d = { coins: 0, up: {}, wup: {}, owned: ['pistol'], eq: 'pistol', unlocked: 1, best: [], endless: 0,
    set: { sfx: true, shake: true, auto: true, aim: 'swipe', sens: 1, gfx: 'high', blood: true, music: true }, stats: { runs: 0, kills: 0, deaths: 0, heads: 0 } };
  try { const s = JSON.parse(raw); if (s) return refundGunUps({ ...d, ...s, set: { ...d.set, ...s.set }, stats: { ...d.stats, ...s.stats } }); } catch (e) { }
  return d;
}
// gun upgrades used to be global (Damage/Fire Rate/Magazine/Reload for every gun); they are per gun now, so old
// saves get back every coin they spent on them (old prices: base * growth^level)
const OLD_GUN_UPS = { dmg: [15, 1.32], rate: [15, 1.34], mag: [20, 1.35], reload: [20, 1.35] };
function refundGunUps(sv) {
  let back = 0;
  for (const [id, [b, g]] of Object.entries(OLD_GUN_UPS)) { for (let l = 0; l < (sv.up[id] || 0); l++) back += Math.round(b * Math.pow(g, l)); delete sv.up[id]; }
  if (back) { sv.coins += back; sv.refund = (sv.refund || 0) + back; } // the menu tells the player once
  return sv;
}
const save = readSave((() => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } })());
function persist() {
  if (G.wiped) return; const v = JSON.stringify(save);
  try { localStorage.setItem(SAVE_KEY, v); } catch (e) { }
  Platform.store(v); // CrazyGames cloud save (no-op elsewhere)
}
const lv = id => save.up[id] || 0;
const wl = (id, w = save.eq) => (save.wup[w] || {})[id] || 0; // weapon upgrade level of gun w
const wlSum = w => WUP.list.reduce((a, u) => a + wl(u.id, w), 0); // total levels bought on gun w

// ===== terrain: stepped tile columns, generated lazily in both directions =====
function makeGen(seed, flat) { return { r: mulberry32(seed), y: 420, mode: 0, left: flat, dir: 0, stepW: 1, sub: 1 }; }
function genCol(g) {
  if (g.left <= 0) {
    if (g.mode === 0 && g.r() < 0.75) {
      g.mode = 1; g.dir = g.y >= 440 ? -1 : g.y <= 340 ? 1 : (g.r() < 0.5 ? -1 : 1);
      g.left = 1 + (g.r() * 5 | 0); g.stepW = 1 + (g.r() * 2 | 0); g.sub = g.stepW;
    } else { g.mode = 0; g.left = 4 + (g.r() * 14 | 0); }
  }
  if (g.mode === 1) { if (--g.sub <= 0) { g.sub = g.stepW; g.y = clamp(g.y + g.dir * TILE, 320, 460); g.left--; } }
  else g.left--;
  return g.y;
}
const T = { R: [], L: [], gr: null, gl: null }; // R: columns 0,1,2...  L: columns -1,-2,-3...
function resetGround(seed) { T.R = []; T.L = []; T.gr = makeGen(seed, 24); T.gl = makeGen(seed ^ 0x5f3759df, 3); }
function ensureGround(x1, x0 = x1) { // columns covering [x0, x1]
  const i1 = Math.ceil(x1 / TILE) + 2, i0 = Math.floor(x0 / TILE) - 2;
  while (T.R.length < i1) T.R.push(genCol(T.gr));
  while (i0 < 0 && T.L.length < -i0) T.L.push(genCol(T.gl));
}
const colY = i => i >= 0 ? (T.R[i] ?? T.gr.y) : (T.L[-i - 1] ?? T.gl.y);
function groundY(x) { return colY(Math.floor(x / TILE)); }

// ===== state =====
const G = { state: 'menu', era: Math.min(save.unlocked, ERAS.length) - 1, time: 0, hitstop: 0, slowmo: 0, hurtFx: 0, flash: 0, acc: 0, sky: null, amb: [], punch: 0 };
const cam = { x: 0, shake: 0, z: 1, lx: 0 };
const player = { x: 160, y: 440, aim: -0.06, hp: 100, maxHp: 100, ammo: 6, reload: 0, cd: 0, recoil: 0, phase: 0, walkTo: 0,
  kick: 0, kickCd: 0, hurt: 0, heat: 0, over: false, beamOn: false, beamLen: 0, dead: false, flash: 0, mflash: 0, pts: [] };
const PLAYER_LOOK = { k: '#f1c27d', s: '#2b3a5c', p: '#1f2840', a: '#2b3a5c' }, PLAYER_OPT = { deco: 'tactical', face: 'hero' };
let run = null, wep = null, era = ERAS[0], bg = [];
const enemies = [], ragdolls = [], bullets = [], eprojs = [], parts = [], texts = [], crates = [], nades = [], coinFx = [];
const camLead = () => Math.min(170, viewW * 0.17);

// stats of gun `id` with its own upgrades (and the run's perks during a run)
function computeWeapon(id = save.eq) {
  const d = WEAPONS.find(w => w.id === id) || WEAPONS[0], P = run ? run.perks : {}, L = u => wl(u, d.id);
  const big = 1 + 0.5 * (P.bigmag || 0);
  return { ...d,
    dmg: (d.dmg || 0) * WUP.fx.dmg(L('dmg')) * BAL.bulletDmg, dps: (d.dps || 0) * WUP.fx.dmg(L('dmg')) * WUP.fx.rate(L('rate')) * BAL.bulletDmg, // a beam has no fire rate: that upgrade is its intensity
    rate: d.rate * WUP.fx.rate(L('rate')) * BAL.fireRate,
    mag: Math.max(1, Math.round(d.mag * WUP.fx.mag(L('mag')) * big)),
    heat: (d.heat || 0) * WUP.fx.mag(L('mag')) * big,
    reload: d.reload * WUP.fx.reload(L('reload')) / (1 + 0.35 * (P.quick || 0)),
    melee: d.tier * WUP.fx.dmg(L('dmg')), // kick + grenade scale with the gun's tier
    crit: UP.crit(lv('crit')), head: UP.head(lv('head')) * (1 + 0.25 * (P.hunter || 0)) };
}

function setupWorld(i) {
  era = ERAS[i]; resetGround(Math.random() * 1e9 | 0);
  for (const a of [enemies, ragdolls, bullets, eprojs, parts, texts, crates, nades, coinFx]) a.length = 0;
  Object.assign(player, { x: 160, dead: false, recoil: 0, kick: 0, beamOn: false, heat: 0, over: false, reload: 0, cd: 0, flash: 0 });
  ensureGround(player.x + 2600); player.y = groundY(player.x); cam.x = player.x - camLead();
  bg = makeBackground(era); G.sky = null; resetAmb(); cam.lx = cam.x; posePlayer();
}
function spawnDummies() {
  [['walker', 0.6], ['shield', 0.74], ['flyer', 0.86]].forEach(([t, k]) => {
    const x = cam.x + viewW * k; ensureGround(x + 100); enemies.push(makeEnemy(t, x, true));
  });
}

// ===== enemies =====
function makeEnemy(type, x, idle) {
  const F = era.foes[type], A = ARCH[type], s = (A.scale || 1) * (F.scale || 1);
  const e = { type, F, A, rig: F.rig || 'human', look: F.look, hat: F.hat, held: F.held, x, y: groundY(x), f: -1, s,
    hp: 1, maxHp: 1, speed: A.speed * rand(0.85, 1.15), phase: Math.random() * TAU, kx: 0, flash: 0, slow: 0, burn: 0, burnT: 0, burnDps: 0,
    act: 0, atk: rand(0.3, 1), walking: !idle, engaged: false, mv: idle ? 0 : A.speed, reach: rand(40, 52) * s, pts: [], bb: [0, 0, 0, 0], dead: false, idle: !!idle,
    helmet: F.hat === 'helmet', shield: F.held === 'shield' ? 1 : 0, dmg: 0, acc: 0, accT: 0, charge: 0, flinch: 0, rate: rand(2.2, 3) };
  if (run) {
    e.maxHp = e.hp = A.hp * run.hpMul; e.dmg = A.dmg * run.dmgMul;
    if (e.shield) e.shield = A.shieldHp * run.hpMul;
  }
  if (type === 'flyer') { e.baseY = groundY(x) - rand(170, 260); e.y = e.baseY; e.mode = 'in'; e.diveX = rand(150, 260); }
  if (type === 'ranged') e.stop = Math.min(rand(260, 480), viewW - camLead() - 120);
  if (type === 'boss') { e.moveT = 3; e.reach = 30 * s; }
  if (e.rig === 'raptor') e.reach += 42 * s; // long snout: stop earlier
  poseEnemy(e); return e;
}
function poseEnemy(e) {
  if (e.rig === 'raptor') poseRaptor(e.pts, e.x, e.y, e.s, e.f, e.phase, e.act, e.walking);
  else if (e.rig === 'flyer') poseFlyer(e.pts, e.x, e.y, e.s, e.f, G.time + e.phase, e.F.fly);
  else {
    const arms = e.F.arms || 'swing', n = e.pts[1];
    const aim = n ? Math.atan2(player.y - 60 - n[1], player.x - n[0]) : Math.PI;
    poseHuman(e.pts, e.x, e.y, e.s, e.f, e.walking ? e.phase : G.time + e.phase, e.walking ? (e.F.legs || 'walk') : 'stand', arms, e.act, aim, e.flinch);
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of e.pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const pad = (e.shield > 0 ? 28 : 16) * e.s;
  e.bb[0] = x0 - pad; e.bb[1] = y0 - pad; e.bb[2] = x1 + pad; e.bb[3] = y1 + pad;
}
const inBB = (e, x, y) => x > e.bb[0] && x < e.bb[2] && y > e.bb[1] && y < e.bb[3];
function hitPart(e, x, y) {
  const R = RIGS[e.rig], p = e.pts, h = p[R.head], hr = R.headR * e.s + 3;
  if ((x - h[0]) ** 2 + (y - h[1]) ** 2 < hr * hr) return 'head';
  for (const b of R.bones) if (segDist(x, y, p[b[0]], p[b[1]]) < Math.max(b[2], b[6] || 0) * e.s + 3) return 'body';
  if (R.body && (x - p[1][0]) ** 2 + (y - p[1][1]) ** 2 < (R.body * e.s + 3) ** 2) return 'body';
  return null;
}
function inShield(e, x, y) {
  if (e.shield <= 0 || e.rig !== 'human') return false;
  const h = e.pts[6];
  return Math.abs(x - (h[0] + e.f * 5 * e.s)) < 9 * e.s && Math.abs(y - h[1]) < 27 * e.s;
}
function nearestEnemy(x, y, r, not) {
  let best = null, bd = r * r;
  for (const e of enemies) { if (e.dead || e.idle || e === not) continue; const c = e.pts[RIGS[e.rig].core], d = (c[0] - x) ** 2 + (c[1] - y) ** 2; if (d < bd) { bd = d; best = e; } }
  return best;
}

// ===== run flow =====
function startRun(endless) {
  Sfx.init();
  const i = endless ? 0 : G.era;
  setupWorld(i);
  run = { endless, era: i, wave: -1, total: endless ? Infinity : WAVES, kills: 0, heads: 0, coins: 0, perks: {}, bt: 0.4, btOn: false,
    combo: 0, comboT: 0, t: 0, nadeCd: 0, queue: [], spawnT: 0, size: 0, killedW: 0, state: 'fight', boss: null, pendingPerk: false,
    endT: 0, hpMul: 1, dmgMul: 1, coinMul: 1 };
  wep = computeWeapon();
  player.maxHp = UP.hp(lv('hp')); player.hp = player.maxHp; player.ammo = wep.mag; player.kickCd = 0;
  save.stats.runs++;
  G.state = 'play'; UI.startHud();
  nextWave();
}
// first-runs control tips, shown under the wave banner
const TOUCH = matchMedia('(pointer:coarse)').matches;
const HINTS = TOUCH ? ['Swipe up/down to aim', 'Aim for the head: bonus damage', 'Grenade & slow-mo buttons on the right']
  : ['Mouse to aim · hold click to fire', 'Aim for the head: bonus damage', 'G grenade · SPACE slow-mo · R reload'];
function weighted(pool) {
  let t = 0; for (const k of pool) t += ARCH[k].w;
  let x = Math.random() * t; for (const k of pool) { x -= ARCH[k].w; if (x <= 0) return k; }
  return pool[0];
}
function nextWave() {
  const r = run, w = ++r.wave;
  if (r.endless && w > 0 && w % 5 === 0) { // time rift: new era every 5 waves
    r.era = (w / 5) % ERAS.length; era = ERAS[r.era]; bg = makeBackground(era); G.sky = null; resetAmb(); G.flash = 1;
  }
  r.hpMul = r.endless ? Math.pow(1.13, w) : era.hp * (1 + BAL.waveHp * w);
  r.dmgMul = r.endless ? 1 + 0.07 * w : (1 + BAL.eraDmg * r.era) * (1 + BAL.waveDmg * w);
  r.coinMul = r.endless ? 1.2 * Math.pow(1.1, w) : era.coin;
  const boss = r.endless ? w % 10 === 9 : w === r.total - 1;
  const tier = r.endless ? Math.min(w, 9) : w;
  const pool = Object.keys(ARCH).filter(k => k !== 'boss' && ARCH[k].from <= tier);
  const n = boss ? BAL.bossEscort : Math.round(r.endless ? Math.min(6 + w * 1.4, 40) : BAL.waveBase + w * BAL.waveGrow);
  r.queue = []; for (let i = 0; i < n; i++) r.queue.push(weighted(pool));
  if (boss) r.queue.splice(1, 0, 'boss');
  r.size = r.queue.length; r.killedW = 0; r.spawnT = 1.2; r.state = 'fight'; r.crateT = rand(6, 10);
  if (r.endless && w > 0 && w % 5 === 0) UI.banner('TIME RIFT', era.name + ' · ' + era.year);
  else UI.banner(boss ? 'BOSS' : 'WAVE ' + (w + 1), boss ? era.foes.boss.name : r.endless ? era.name : save.stats.runs <= 2 && HINTS[w] || '');
  placeCrates(player.x + 260, cam.x + viewW - 60);
}
function updateSpawns(dt) {
  const r = run; if (r.state !== 'fight' || !r.queue.length) return;
  r.spawnT -= dt; if (r.spawnT > 0) return;
  const t = r.queue.shift(), x = cam.x + viewW + rand(30, 90);
  ensureGround(x + 200);
  const e = makeEnemy(t, x); enemies.push(e);
  if (t === 'boss') { r.boss = e; UI.boss(e); }
  r.spawnT = Math.max(BAL.spawnGapMin, BAL.spawnGap * (r.endless ? 0.75 : 1) - Math.min(r.wave, 12) * BAL.spawnGapWave) * rand(0.6, 1.4);
}
function progress() { return run.endless ? 0 : clamp((run.wave + (run.size ? run.killedW / run.size : 0)) / run.total, 0, 1); }
function waveCleared() {
  const r = run;
  addCoins(BAL.waveCoin * r.coinMul * (r.wave + 1) * UP.income(lv('income')), player.x + 40, player.y - 130);
  Sfx.play('wave'); persist(); eprojs.length = 0;
  if (!r.endless && r.wave >= r.total - 1) return eraCleared();
  r.state = 'walk'; player.walkTo = player.x - rand(200, 320); r.pendingPerk = r.wave % BAL.perkEvery === BAL.perkEvery - 1;
}
function arrive() {
  const r = run;
  if (!r.pendingPerk) return nextWave();
  r.pendingPerk = false; r.state = 'perk'; G.state = 'perk';
  const avail = PERKS.filter(p => (r.perks[p.id] || 0) < p.max), opts = [];
  while (opts.length < 3 && avail.length) opts.push(avail.splice(Math.random() * avail.length | 0, 1)[0]);
  UI.perks(opts, p => {
    r.perks[p.id] = (r.perks[p.id] || 0) + 1;
    if (p.id === 'medkit') { player.maxHp += 25; player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.5); }
    wep = computeWeapon(); player.ammo = wep.mag; player.reload = 0;
    G.state = 'play'; nextWave();
  });
}
function eraCleared() {
  const r = run; r.state = 'won'; r.endT = 2.2; G.slowmo = 1.5;
  addCoins(BAL.eraCoin * r.coinMul * UP.income(lv('income')), player.x + 40, player.y - 160);
  r.unlockedNew = save.unlocked < ERAS.length && save.unlocked === r.era + 1;
  if (r.unlockedNew) save.unlocked++;
  persist(); Platform.happy();
}
function playerDie() {
  const p = player; if (p.dead) return;
  p.dead = true; run.state = 'dead'; run.endT = 1.8; G.slowmo = 1;
  const rd = makeRagdoll('human', p.pts, PLAYER_LOOK, 1, 1, 'mask', -150, -200);
  rd.opt = PLAYER_OPT; pushRagdoll(rd, p.x, p.y - 80, -300, -250, 40); addRagdoll(rd);
  bleed(null, p.x, p.y - 60, -1, -0.3, 16);
  Sfx.play('die'); save.stats.deaths++;
}
function finish() {
  const r = run, won = r.state === 'won', pct = won ? 100 : Math.floor(progress() * 100);
  const prevBest = r.endless ? save.endless : save.best[r.era] || 0, score = r.endless ? r.wave + 1 : pct;
  if (r.endless) save.endless = Math.max(save.endless, r.wave + 1);
  else save.best[r.era] = Math.max(save.best[r.era] || 0, pct);
  save.stats.kills += r.kills; save.stats.heads += r.heads; persist();
  if (won && r.unlockedNew) G.era = Math.min(r.era + 1, ERAS.length - 1);
  G.state = 'over'; UI.boss(null);
  UI.result({ won, pct, kills: r.kills, heads: r.heads, coins: r.coins, endless: r.endless, wave: r.wave + 1,
    eraName: ERAS[r.era].name, time: r.t, total: save.coins, best: prevBest, record: !won && prevBest > 0 && score > prevBest,
    next: won && r.unlockedNew && r.era + 1 < ERAS.length ? ERAS[r.era + 1].name : '' });
}
function backToMenu() { run = null; G.state = 'menu'; G.slowmo = 0; setupWorld(G.era); spawnDummies(); wep = computeWeapon(); UI.menu(); }
function pause() { if (G.state !== 'play') return; G.state = 'pause'; UI.pauseMenu(); }
function resume() { if (G.state === 'pause') G.state = 'play'; }
function quitRun() { if (!run) return; run.state = 'dead'; finish(); }

// ===== player =====
const playerFacing = () => run && run.state === 'walk' && !player.dead ? -1 : 1; // turned left while repositioning
const gunAim = () => run && run.state === 'won' ? 0.85 : player.aim - player.recoil * 0.07; // gun lowered after a win
function posePlayer() {
  const p = player;
  if (playerFacing() < 0) { // jog left, gun held low in the front hand
    poseHuman(p.pts, p.x, p.y, 1, -1, p.phase, 'run', 'swing', 0, 0);
    const n = p.pts[1]; limb(p.pts, 5, 6, n[0], n[1], 0.45, 1.25, 15, -1);
    return;
  }
  const walking = run && run.state === 'fight';
  poseHuman(p.pts, p.x, p.y, 1, 1, walking ? p.phase : G.time, walking ? 'walk' : 'stand', 'aim', 0, gunAim());
  if (p.kick > 0) { const pl = p.pts[2]; limb(p.pts, 9, 10, pl[0], pl[1], 1.35, 1.5, 21, 1); }
}
function muzzle() {
  const n = player.pts[1], c = Math.cos(player.aim), s = Math.sin(player.aim), r = 27 + wep.len - player.recoil * 5;
  return [n[0] + c * r, n[1] + s * r];
}
const targetsVisible = () => eprojs.length > 0 || enemies.some(e => !e.dead && e.x < cam.x + viewW - 10);
function updatePlayer(pdt) {
  const p = player, r = run;
  if (p.dead) return;
  if (r.state === 'fight') { p.x -= BAL.retreat * pdt; p.phase -= pdt * BAL.retreat / 13; } // backpedal while shooting
  else if (r.state === 'walk') { p.x = Math.max(p.walkTo, p.x - 150 * pdt); p.phase += pdt * 150 / 14; if (p.x <= p.walkTo) arrive(); }
  p.y += (groundY(p.x) - p.y) * Math.min(1, pdt * 20);
  if (input.mouse) {
    const n = p.pts[1], [wx, wy] = toWorld(input.mx * DPR, input.my * DPR);
    p.aim = Math.atan2(wy - n[1], Math.max(8, wx - n[0]));
  }
  p.aim = clamp(p.aim, -1.45, 0.95);
  p.cd -= pdt; p.recoil = Math.max(0, p.recoil - pdt * 8); p.kick -= pdt; p.kickCd -= pdt; p.flash -= pdt; p.mflash -= pdt;
  if (p.reload > 0) { p.reload -= pdt; if (p.reload <= 0) { p.ammo = wep.mag; Sfx.play('reload'); } }
  const want = r.state === 'fight' && (input.hold || (save.set.auto && targetsVisible()));
  if (wep.beam) beam(want, pdt);
  else if (want && p.cd <= 0 && p.reload <= 0 && p.ammo > 0) fire();
  // auto-kick: melee shove when something gets too close
  if (p.kickCd <= 0 && r.state === 'fight') {
    const near = e => !e.dead && e.type !== 'flyer' && (e.x - p.x < 70 || (e.engaged && e.type !== 'ranged'));
    if (enemies.some(near)) {
      p.kickCd = BAL.kickCd; p.kick = 0.25; Sfx.play('kick'); cam.shake = Math.max(cam.shake, 6);
      for (const e of enemies) if (near(e)) { const c = e.pts[2]; hurtEnemy(e, BAL.kickDmg * wep.melee, { src: 'kick', dx: 1, dy: -0.3, x: c[0], y: c[1], knock: BAL.kickKnock }); }
    }
  }
  posePlayer();
}
function fire() {
  const p = player, w = wep, [mx, my] = muzzle(), P = run.perks;
  const n = w.pellets + (P.twin || 0);
  for (let i = 0; i < n; i++) {
    const fan = n > 1 ? (i / (n - 1) - 0.5) * (w.pellets > 1 ? w.spread * 2 : 0.07 * n) : 0;
    const a = p.aim + fan + (Math.random() - 0.5) * (w.pellets > 1 ? w.spread * 0.5 : w.spread);
    bullets.push({ x: mx, y: my, px: mx, py: my, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg * (P.twin && w.pellets === 1 ? 0.6 : 1), pierce: w.pierce + (P.pierce || 0), bounce: P.ricochet || 0,
      hit: [], rd: [], life: 1.6, rocket: !!w.explode });
  }
  const rage = P.rage && p.hp < p.maxHp * 0.5 ? 1 + 0.4 * P.rage : 1;
  p.ammo--; p.cd = 1 / (w.rate * rage); p.recoil = 1; p.mflash = 0.05;
  const n1 = p.pts[1];
  for (let i = 0; i < 2; i++) part({ k: 'smoke', x: mx, y: my, vx: Math.cos(p.aim) * rand(20, 60), vy: rand(-40, -10), life: 0.6, max: 0.6, sz: 3, grow: 14, drag: 2, c: '#b8b8b8' });
  part({ k: 'shell', x: n1[0] + 20, y: n1[1] + 2, vx: rand(-160, -60), vy: rand(-280, -160), life: 2, max: 2, sz: 3, c: '#e8c547', g: 1 });
  Sfx.play(w.sfx); cam.shake = Math.max(cam.shake, w.shake);
  if (p.ammo <= 0) startReload();
}
function startReload() {
  const p = player;
  if (!run || wep.beam || p.reload > 0 || p.ammo >= wep.mag) return;
  p.reload = wep.reload; Sfx.play('magout');
}
function beam(want, dt) {
  const p = player;
  p.beamOn = false;
  if (p.over) { p.heat -= dt / wep.reload; if (p.heat <= 0) { p.heat = 0; p.over = false; } return; }
  if (!want) { p.heat = Math.max(0, p.heat - dt * 0.6); return; }
  p.beamOn = true; p.heat += dt / wep.heat;
  if (p.heat >= 1) { p.heat = 1; p.over = true; Sfx.play('click'); }
  Sfx.play('laser'); cam.shake = Math.max(cam.shake, 1.5);
  const [mx, my] = muzzle(), c = Math.cos(p.aim), s = Math.sin(p.aim), hit = new Set();
  let len = 0;
  for (; len < 1500; len += 8) {
    const x = mx + c * len, y = my + s * len;
    if (y > groundY(x)) break;
    let blocked = false;
    for (const e of enemies) {
      if (e.dead || e.idle || hit.has(e) || !inBB(e, x, y)) continue;
      if (inShield(e, x, y)) { hit.add(e); hitShield(e, wep.dps * dt, x, y); blocked = true; break; }
      const part = hitPart(e, x, y); if (!part) continue;
      hit.add(e); hurtEnemy(e, wep.dps * dt, { src: 'beam', head: part === 'head', dx: c, dy: s, x, y, knock: wep.knock });
    }
    if (blocked) break;
    for (const cr of crates) if (cr.fuse < 0 && x > cr.x && x < cr.x + cr.n * 26 && y > cr.y - 26 && y < cr.y) cr.fuse = 0.01;
    for (let j = eprojs.length - 1; j >= 0; j--) if (eprojs[j] && (eprojs[j].x - x) ** 2 + (eprojs[j].y - y) ** 2 < 144) shootDown(j);
  }
  p.beamLen = len;
  if (Math.random() < 0.5) sparks(mx + c * len, my + s * len, 1, '#9ff3ff');
}
function throwNade() {
  const r = run; if (!r || r.state !== 'fight' || r.nadeCd > 0 || player.dead) return;
  r.nadeCd = NADE_CD; const [mx, my] = muzzle(), a = player.aim - 0.25;
  nades.push({ x: mx, y: my, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, t: 1.1, rot: 0 });
  Sfx.play('throw');
}
function toggleBT() {
  const r = run; if (!r || r.state !== 'fight') return;
  if (r.btOn) { r.btOn = false; return; }
  if (r.bt >= 0.2) { r.btOn = true; Sfx.play('slow'); }
}
function addBT(v) { run.bt = Math.min(1, run.bt + v * (1 + (run.perks.focus || 0))); }
function hurtPlayer(d) {
  const p = player; if (p.dead || p.hurt > G.time || DBG.god) return;
  p.hp -= d; p.hurt = G.time + 0.2; p.flash = 0.1; G.hurtFx = 0.4;
  cam.shake = Math.max(cam.shake, 9); Sfx.play('hurt');
  popText(p.x, p.y - 110, '-' + fmt(Math.max(1, d)), '#ff5a5a', 18);
  run.combo = 0;
  if (p.hp <= 0) playerDie();
}

// ===== combat =====
function hurtEnemy(e, dmg, o) {
  if (e.dead) return;
  let mult = 1, head = o.head, crit = false;
  if (head) {
    if (e.helmet) { e.helmet = false; head = false; mult = 0.6; popHelmet(e); }
    else mult = wep.head;
  }
  if (o.src === 'bullet' && Math.random() < wep.crit) { crit = true; mult *= 2; }
  const d = DBG.oneHit ? Math.max(dmg * mult, e.hp) : dmg * mult;
  e.hp -= d; e.flash = 0.07; e.flinch = Math.min(0.6, e.flinch + (o.src === 'burn' || o.src === 'beam' ? 0.04 : 0.3));
  if (o.knock) e.kx += o.dx * o.knock * BAL.knock * (e.type === 'boss' || e.type === 'brute' ? 0.25 : 1);
  if (o.src === 'beam') { e.acc += d; if (e.accT <= 0) e.accT = 0.3; }
  else if (o.src !== 'burn' || Math.random() < 0.3) dmgText(e, d, head, crit);
  if (o.src !== 'burn') bleed(e, o.x, o.y, o.dx, o.dy, head ? 9 : 4);
  if (head) { addBT(0.07); if (o.src === 'bullet') Sfx.play('head'); }
  else if (o.src === 'bullet') Sfx.play('hit');
  const P = run.perks;
  if (o.src === 'bullet' || (o.src === 'beam' && Math.random() < 0.08)) {
    if (P.frost) e.slow = 2;
    if (P.fire) { e.burn = 3; e.burnDps = Math.max(e.burnDps, dmg * 0.2 * P.fire); }
    if (P.chain) {
      const n = nearestEnemy(e.pts[2][0], e.pts[2][1], 170, e);
      if (n) { zap(e, n); hurtEnemy(n, dmg * 0.2 * P.chain, { src: 'chain', x: n.pts[2][0], y: n.pts[2][1], dx: 0, dy: 0 }); }
    }
    if (P.explosive && Math.random() < 0.08 * P.explosive) explode(o.x, o.y, 70, dmg * 1.2, 0, true);
  }
  if (e.hp <= 0) killEnemy(e, o, head, d);
}
function hitShield(e, dmg, x, y) {
  e.shield -= dmg; sparks(x, y, 3, '#fff'); Sfx.play('block');
  if (e.shield <= 0) { burst(x, y, e.look.sh || '#777', 10, 260); popText(x, y - 20, 'SHIELD BROKEN', '#9fe6ff', 14); }
}
function killEnemy(e, o, head, d) {
  const r = run;
  e.dead = true; r.kills++; r.killedW++; if (head) r.heads++; r.combo++; r.comboT = 2.5; addBT(0.03);
  const blast = o.src === 'blast', imp = (250 + (o.knock || 200)) * (blast ? 1 : 0.55);
  const vx = (o.dx || 0) * imp, vy = (o.dy || 0) * imp - (blast ? 350 : 140);
  if (e.type === 'exploder') explode(e.pts[2][0], e.pts[2][1], 110 * e.s, ARCH.walker.hp * r.hpMul * BAL.exploderBlast, 0, true);
  else {
    const rd = makeRagdoll(e.rig, e.pts, e.look, e.s, e.f, e.hat === 'helmet' && !e.helmet ? null : e.hat, e.walking ? -e.speed * 0.5 : 0, 0);
    rd.opt = e.F; pushRagdoll(rd, o.x ?? e.x, o.y ?? e.y - 50, vx, vy, 30 * e.s);
    if (e.held && e.held !== 'bomb' && (e.held !== 'shield' || e.shield > 0)) { // the weapon drops and tumbles
      const h = e.pts[6]; part({ k: 'item', held: e.held, look: e.look, s: e.s, x: h[0], y: h[1], vx: vx * 0.3 + rand(-60, 60), vy: rand(-320, -180), rot: 0, vr: rand(-9, 9), life: 4, max: 4, g: 1 });
    }
    if (head && save.set.blood) { // the killing shot was a headshot: pop the head off (HP scales per era, so no overkill threshold)
      const hi = RIGS[e.rig].head;
      rd.sticks = rd.sticks.filter(s => s[0] !== hi && s[1] !== hi);
      const nk = rd.p[RIGS[e.rig].neck]; rd.cut = hi; rd.spin = rand(-14, 14);
      rd.a0 = Math.atan2(rd.p[hi][1] - nk[1], rd.p[hi][0] - nk[0]) + Math.PI / 2;
      // small controlled pop (overrides the hit impulse, which would fling a lone point across the map)
      rd.o[hi][0] = rd.p[hi][0] - ((o.dx || 0) * 160 + rand(-40, 40)) * RD_STEP; rd.o[hi][1] = rd.p[hi][1] + 320 * RD_STEP;
      bleed(e, rd.p[hi][0], rd.p[hi][1], 0, -1, 14);
    }
    if (head) popText(e.x, e.bb[1] - 18, 'HEADSHOT!', '#ff4d4d', 20);
    addRagdoll(rd);
  }
  addCoins(e.A.coin * r.coinMul * UP.income(lv('income')) * (1 + 0.35 * (r.perks.greed || 0)) * (1 + Math.min(r.combo, BAL.comboMax) * BAL.comboCoin), e.pts[0][0], e.pts[0][1], true);
  if (r.perks.vamp) player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.02 * r.perks.vamp);
  if (e === r.boss) { r.boss = null; UI.boss(null); G.slowmo = 1.2; cam.shake = 22; G.punch = 0.12; for (let i = 0; i < 4; i++) burst(e.x + rand(-40, 40), e.y - rand(20, 120), '#ffd34d', 8, 400); }
  else if (head && o.src === 'bullet') G.hitstop = 0.045;
}
function selfDestruct(e) {
  e.dead = true; run.killedW++;
  explode(e.pts[2][0], e.pts[2][1], 100 * e.s, ARCH.walker.hp * run.hpMul * BAL.exploderBlast, e.dmg, true);
  burst(e.x, e.y - 50, e.look.s, 12, 380);
}
function bossAI(e, dt) {
  e.moveT -= dt; if (e.moveT > 0) return;
  e.moveT = rand(4, 6);
  const m = pick(e.F.moves || ['summon']);
  if (m === 'summon') {
    for (let i = 0; i < 3; i++) { enemies.push(makeEnemy(pick(['walker', 'runner']), e.x + rand(40, 170))); run.size++; }
    popText(e.x, e.bb[1] - 10, 'SUMMON!', '#ff5a5a', 22);
  } else if (m === 'charge') { e.charge = 1.3; popText(e.x, e.bb[1] - 10, 'CHARGE!', '#ff5a5a', 22); }
  else for (let i = -1; i <= 1; i++) shootAt(e, i);
}
function shootAt(e, k) {
  const kind = e.F.proj || era.foes.ranged.proj || 'rock', K = PROJ[kind];
  const h = e.rig === 'human' ? e.pts[6] : e.pts[0];
  const dx = player.x + rand(-10, 10) - h[0], dy = player.y - rand(40, 85) - h[1];
  let vx, vy;
  if (K.g) { const t = Math.max(0.35, Math.abs(dx) / K.speed); vx = dx / t; vy = dy / t - 0.5 * K.g * t; }
  else { const d = Math.hypot(dx, dy) || 1; vx = dx / d * K.speed; vy = dy / d * K.speed; }
  eprojs.push({ x: h[0], y: h[1], vx, vy: vy + k * 70, K, dmg: e.dmg, life: 6, rot: 0 });
  e.act = 1; Sfx.play(kind === 'arrow' ? 'bow' : kind === 'laser' ? 'elaser' : K.line ? 'eshot' : 'throw');
}
function shootDown(j) {
  const q = eprojs[j]; eprojs.splice(j, 1);
  if (q.K.explode) explode(q.x, q.y, q.K.explode, ARCH.walker.hp * run.hpMul * 1.5, 0, true);
  else { burst(q.x, q.y, q.K.color, 6, 200); Sfx.play('block'); }
  popText(q.x, q.y - 10, 'BLOCKED', '#9fe6ff', 13);
  addBT(0.05);
  addCoins(0.5 * run.coinMul * UP.income(lv('income')), q.x, q.y, true);
}
function explode(x, y, r, dmg, pdmg, quiet) {
  Sfx.play('boom'); cam.shake = Math.max(cam.shake, quiet ? 9 : 16); G.flash = Math.max(G.flash, quiet ? 0.1 : 0.25);
  part({ k: 'glow', x, y, sz: r * 2, life: 0.4, max: 0.4, c: '#ff9a3a', a: 0.6 });
  part({ k: 'ring', x, y, sz: 10, grow: r * 4, life: 0.3, max: 0.3, c: '#fff' });
  const gy = groundY(x); if (gy - y < r * 0.7) part({ k: 'scorch', x, y: gy, sz: r * 0.75, life: 8, max: 8, stuck: true, specks: Array.from({ length: 8 }, () => [rand(-r, r) * 0.6, rand(2, 5)]) });
  G.punch = Math.max(G.punch, quiet ? 0.015 : 0.04);
  const s = r / 130;
  for (let i = 0; i < 18; i++) part({ k: 'fire', x: x + rand(-r, r) * 0.3, y: y + rand(-r * 0.3, r * 0.1), vx: rand(-220, 220), vy: rand(-320, -40), life: rand(0.3, 0.8), max: 0.8, sz: rand(10, 24) * s, grow: 30, drag: 3 });
  for (let i = 0; i < 12; i++) part({ k: 'smoke', x: x + rand(-25, 25), y: y + rand(-25, 10), vx: rand(-90, 90), vy: rand(-110, -20), life: rand(1, 2.2), max: 2.2, sz: rand(12, 24) * s, grow: 22, drag: 2, c: '#5a5552' });
  burst(x, y, era.edge, 8, 500); sparks(x, y, 12, '#ffb13b');
  if (dmg > 0) for (const e of enemies) {
    if (e.dead || e.idle) continue;
    const c = e.pts[RIGS[e.rig].core], dx = c[0] - x, dy = c[1] - y, d = Math.hypot(dx, dy) || 1;
    if (d < r + 15 * e.s) hurtEnemy(e, dmg * (1 - 0.5 * Math.min(1, d / r)), { src: 'blast', dx: dx / d, dy: dy / d - 0.5, x: c[0], y: c[1], knock: 900 });
  }
  for (const rd of ragdolls) if (rd.bb[0] < x + r && rd.bb[2] > x - r && rd.bb[1] < y + r && rd.bb[3] > y - r) blastRagdoll(rd, x, y + 20, r * 1.4, 900);
  for (const c of crates) if (c.fuse < 0 && Math.abs(c.x + c.n * 13 - x) < r && Math.abs(c.y - 13 - y) < r) c.fuse = 0.12;
  for (let i = eprojs.length - 1; i >= 0; i--) if (Math.hypot(eprojs[i].x - x, eprojs[i].y - y) < r) eprojs.splice(i, 1);
  if (pdmg > 0 && Math.hypot(player.x - x, player.y - 50 - y) < r + 10) hurtPlayer(pdmg);
}
function zap(a, b) {
  const p = a.pts[2], q = b.pts[2];
  part({ k: 'zap', x: p[0], y: p[1], x2: q[0], y2: q[1], life: 0.12, max: 0.12, c: '#9ff3ff' });
}
function placeCrates(x0, x1) {
  if (x1 - x0 < 100) return;
  const n = Math.random() < 0.55 ? 1 : Math.random() < 0.5 ? 2 : 0;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rand(x0, x1) / TILE) * TILE, y = groundY(x);
    let k = 1 + (Math.random() * 3 | 0);
    while (k > 1 && groundY(x + k * 26 - 1) !== y) k--;
    crates.push({ x, y, n: k, fuse: -1 });
  }
}
function popHelmet(e) {
  const h = e.pts[RIGS[e.rig].head];
  part({ k: 'debris', x: h[0], y: h[1] - 8, vx: rand(80, 220), vy: rand(-420, -300), life: 3, max: 3, sz: 14 * e.s, c: '#7d8791', g: 1 });
  sparks(h[0], h[1], 6, '#fff'); Sfx.play('block');
  popText(h[0], h[1] - 20, 'HELMET OFF', '#cfd8e3', 13);
}

// ===== money =====
function addCoins(v, wx, wy, fly) {
  if (!run) return;
  run.coins += v; save.coins += v;
  if (fly) {
    const n = Math.min(5, 1 + Math.floor(Math.log2(1 + v)));
    for (let i = 0; i < n; i++) coinFx.push({ x: toCss(wx, wy)[0], y: toCss(wx, wy)[1], vx: rand(-140, 140), vy: rand(-300, -140), t: rand(0, 0.1) });
  } else popText(wx, wy, '+' + fmt(v), '#ffd34d', 22);
}

// ===== particles & text =====
function part(o) { if (parts.length > 700) parts.shift(); parts.push(o); }
function bleed(e, x, y, dx, dy, n) {
  const c = !save.set.blood ? '#8d8a82' : (e && e.F.blood) || '#b3262b'; // blood off: dust puffs (PEGI 12 portals)
  for (let i = 0; i < n; i++) part({ k: 'blood', x, y, vx: (dx || 0) * rand(60, 260) + rand(-80, 80), vy: (dy || 0) * rand(60, 260) + rand(-220, 40), life: rand(2, 4), max: 4, sz: rand(2.5, 4.5), c, g: 1 });
}
function burst(x, y, c, n, spd) { for (let i = 0; i < n; i++) part({ k: 'debris', x, y, vx: rand(-spd, spd), vy: rand(-spd * 1.4, -spd * 0.2), life: rand(1.5, 3), max: 3, sz: rand(3, 6), c, g: 1 }); }
function sparks(x, y, n, c) { for (let i = 0; i < n; i++) part({ k: 'spark', x, y, vx: rand(-400, 400), vy: rand(-400, 200), life: rand(0.1, 0.3), max: 0.3, c, drag: 4 }); }
function popText(x, y, t, c, sz) { if (texts.length > 60) texts.shift(); texts.push({ x, y, t, c, sz, life: 0.9, vy: -70 }); }
function dmgText(e, d, head, crit) {
  const h = e.pts[RIGS[e.rig].head];
  popText(h[0] + rand(-10, 10), h[1] - 22 * e.s, fmt(Math.max(1, d)) + (crit ? '!' : ''), head ? '#ff4d4d' : crit ? '#ffd34d' : '#fff', head || crit ? 19 : 15);
}
function addRagdoll(r) { ragdolls.push(r); if (ragdolls.length > 20) ragdolls.shift(); } // cap bounds the per-frame drawing cost

// ===== update =====
function update(dt, rdt, pdt) {
  const r = run;
  updatePlayer(pdt);
  updateSpawns(dt);
  updateEnemies(dt);
  updateBullets(G.hitstop > 0 ? rdt * 0.05 : r.btOn ? rdt * 0.55 : rdt);
  updateEprojs(dt); updateNades(dt); updateCrates(dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  r.nadeCd = Math.max(0, r.nadeCd - pdt); if (!player.dead && r.state !== 'won') r.t += rdt;
  if (r.state === 'fight' && (r.crateT -= dt) <= 0) { r.crateT = rand(9, 14); placeCrates(cam.x - 220, cam.x - 40); }
  r.comboT -= pdt; if (r.comboT <= 0) r.combo = 0;
  if (r.btOn) { r.bt -= rdt * 0.3; if (r.bt <= 0) { r.bt = 0; r.btOn = false; } }
  if (r.state === 'fight' && !r.queue.length && !enemies.length) waveCleared();
  if (r.endT > 0) { r.endT -= rdt; if (r.endT <= 0) finish(); }
}
function updateEnemies(dt) {
  const p = player;
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.idle) { poseEnemy(e); continue; }
    e.flash -= dt; e.flinch *= Math.exp(-9 * dt); e.act = Math.max(0, e.act - dt * 2.8); e.slow -= dt; e.charge -= dt;
    if (e.accT > 0) { e.accT -= dt; if (e.accT <= 0 && e.acc > 0) { dmgText(e, e.acc, false, false); e.acc = 0; } }
    if (e.burn > 0) {
      e.burn -= dt; e.burnT -= dt;
      if (Math.random() < dt * 12) { const c = e.pts[RIGS[e.rig].core]; part({ k: 'fire', x: c[0] + rand(-8, 8), y: c[1] + rand(-15, 5), vx: 0, vy: -60, life: 0.4, max: 0.4, sz: 6, grow: 10 }); }
      if (e.burnT <= 0) { e.burnT = 0.3; const c = e.pts[2]; hurtEnemy(e, e.burnDps * 0.3, { src: 'burn', x: c[0], y: c[1], dx: 0, dy: 0 }); if (e.dead) continue; }
    }
    const spd = e.speed * (e.slow > 0 ? 0.55 : 1) * (e.charge > 0 ? 3.2 : 1);
    e.kx *= Math.exp(-7 * dt); e.x += e.kx * dt;
    if (e.type === 'flyer') flyerAI(e, dt, spd);
    else {
      // engaged enemies follow the retreating player at its pace instead of stop/start toggling every frame
      const gap = e.x - (p.x + (e.type === 'ranged' ? e.stop : e.reach));
      e.engaged = gap <= (e.engaged ? 40 : 2); // hysteresis: only a real knockback breaks contact
      const step = e.engaged ? Math.min(spd * dt, Math.max(0, gap)) : spd * dt;
      e.x -= step; e.phase += step / (13 * e.s);
      if (dt > 0) e.mv += (step / dt - e.mv) * Math.min(1, dt * 8);
      e.walking = e.mv > 10; // pose follows actual motion, smoothed
      if (e.engaged && !p.dead) {
        e.atk -= dt;
        if (e.type === 'exploder') { selfDestruct(e); continue; }
        if (e.atk <= 0) {
          if (e.type === 'ranged') { e.atk = e.rate; shootAt(e, 0); }
          else { e.atk = e.type === 'boss' ? BAL.bossGap : BAL.meleeGap; e.act = 1; hurtPlayer(e.dmg); }
        }
      }
      if (e.x < p.x + 14) e.x = p.x + 14;
      e.y += (groundY(e.x) - e.y) * Math.min(1, dt * 16);
      if (e.type === 'boss') bossAI(e, dt);
    }
    poseEnemy(e);
  }
}
function flyerAI(e, dt, spd) {
  const p = player, tx = p.x + 8, ty = p.y - 62;
  if (e.mode === 'in') {
    e.f = -1; e.x -= spd * dt; e.y = e.baseY + Math.sin(G.time * 3 + e.phase) * 14;
    if (e.x < p.x + e.diveX) e.mode = 'dive';
  } else if (e.mode === 'dive') {
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    e.x += dx / d * spd * 1.9 * dt; e.y += dy / d * spd * 1.9 * dt; e.f = dx < 0 ? -1 : 1;
    if (d < 24 * e.s) { if (!p.dead) hurtPlayer(e.dmg); e.mode = 'out'; e.outT = 1.1; }
  } else {
    e.f = 1; e.x += spd * 1.3 * dt; e.y = Math.max(70, e.y - spd * 0.8 * dt); e.outT -= dt;
    if (e.outT <= 0) { e.mode = 'in'; e.baseY = e.y; }
  }
}
function bulletHitsWorld(b) { // rockets blow up on anything
  if (b.rocket) explode(b.x, b.y, wep.explode, b.dmg, 0);
  return true;
}
function updateBullets(dt) {
  const P = run.perks;
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.life -= dt; b.px = b.x; b.py = b.y;
    let dead = b.life <= 0;
    if (P.homing && !b.rocket) {
      const t = nearestEnemy(b.x + b.vx * 0.12, b.y + b.vy * 0.12, 180);
      if (t) {
        const h = t.pts[RIGS[t.rig].head], want = Math.atan2(h[1] - b.y, h[0] - b.x), cur = Math.atan2(b.vy, b.vx);
        let da = ((want - cur + Math.PI * 3) % TAU) - Math.PI; da = clamp(da, -4 * P.homing * dt, 4 * P.homing * dt);
        const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(cur + da) * sp; b.vy = Math.sin(cur + da) * sp;
      }
    }
    const sp = Math.hypot(b.vx, b.vy), steps = Math.max(1, Math.ceil(sp * dt / 7));
    for (let k = 0; k < steps && !dead; k++) {
      b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
      if (b.rocket && Math.random() < 0.3) part({ k: 'smoke', x: b.x, y: b.y, vx: rand(-20, 20), vy: rand(-30, 0), life: 0.5, max: 0.5, sz: 5, grow: 18, drag: 1 });
      if (b.y > groundY(b.x)) {
        if (b.bounce > 0 && !b.rocket) { b.bounce--; b.y = groundY(b.x) - 1; b.vy = -Math.abs(b.vy) * 0.75; b.hit.length = 0; sparks(b.x, b.y, 3, '#ffd34d'); continue; }
        burst(b.x, b.y, era.line, 3, 120); part({ k: 'smoke', x: b.x, y: b.y - 3, vx: rand(-20, 20), vy: rand(-40, -10), life: 0.5, max: 0.5, sz: 4, grow: 14, drag: 2, c: shade(era.ground, 0.9) }); dead = bulletHitsWorld(b); break;
      }
      for (let j = eprojs.length - 1; j >= 0; j--) {
        const q = eprojs[j];
        if ((q.x - b.x) ** 2 + (q.y - b.y) ** 2 < (q.K.r + 6) ** 2) { shootDown(j); if (b.rocket || --b.pierce < 0) dead = bulletHitsWorld(b); break; }
      }
      if (dead) break;
      for (const c of crates) if (c.fuse < 0 && b.x > c.x && b.x < c.x + c.n * 26 && b.y > c.y - 26 && b.y < c.y) { c.fuse = 0.01; dead = bulletHitsWorld(b); break; }
      if (dead) break;
      for (const e of enemies) {
        if (e.dead || e.idle || b.hit.includes(e) || !inBB(e, b.x, b.y)) continue;
        if (inShield(e, b.x, b.y)) { b.hit.push(e); if (b.rocket) dead = bulletHitsWorld(b); else { hitShield(e, b.dmg, b.x, b.y); dead = true; } break; }
        const part = hitPart(e, b.x, b.y); if (!part) continue;
        b.hit.push(e);
        if (b.rocket) { dead = bulletHitsWorld(b); break; }
        hurtEnemy(e, b.dmg, { src: 'bullet', head: part === 'head', dx: b.vx / sp, dy: b.vy / sp, x: b.x, y: b.y, knock: wep.knock });
        if (--b.pierce < 0) { dead = true; break; }
      }
      if (dead) break;
      for (const r of ragdolls) {
        if (b.rd.includes(r) || b.x < r.bb[0] || b.x > r.bb[2] || b.y < r.bb[1] || b.y > r.bb[3]) continue;
        if (r.p.some(q => (q[0] - b.x) ** 2 + (q[1] - b.y) ** 2 < 160)) { b.rd.push(r); pushRagdoll(r, b.x, b.y, b.vx * 0.15, b.vy * 0.15, 22); bleed(null, b.x, b.y, b.vx / sp, b.vy / sp, 2); }
      }
    }
    if (dead || b.x > cam.x + viewW + 300 || b.x < cam.x - 200 || b.y < -300) bullets.splice(i, 1);
  }
}
function updateEprojs(dt) {
  const p = player;
  for (let i = eprojs.length - 1; i >= 0; i--) {
    const q = eprojs[i];
    if (!q) continue; // a bomb's explode() can remove other projectiles mid-loop
    q.vy += (q.K.g || 0) * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; q.rot += dt * 10;
    let gone = q.life <= 0;
    if (!gone && !p.dead && Math.abs(q.x - p.x) < 18 && q.y > p.y - 100 && q.y < p.y) {
      gone = true; if (q.K.explode) explode(q.x, q.y, q.K.explode, 0, q.dmg); else hurtPlayer(q.dmg);
    } else if (!gone && q.y > groundY(q.x)) {
      gone = true; if (q.K.explode) explode(q.x, q.y, q.K.explode, 0, q.dmg); else burst(q.x, q.y, q.K.color, 5, 150);
    }
    if (gone) { const k = eprojs.indexOf(q); if (k >= 0) eprojs.splice(k, 1); }
  }
}
function updateNades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    n.vy += 1400 * dt; n.x += n.vx * dt; n.y += n.vy * dt; n.rot += n.vx * dt * 0.05; n.t -= dt;
    const g = groundY(n.x);
    if (n.y > g) { n.y = g - 1; if (n.vy > 0) n.vy *= -0.4; n.vx *= 0.7; }
    if (n.t <= 0) { nades.splice(i, 1); explode(n.x, n.y, 150, BAL.nadeDmg * wep.melee, 0); }
  }
}
function updateCrates(dt) {
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];
    if (c.fuse >= 0) { c.fuse -= dt; if (c.fuse <= 0) { crates.splice(i, 1); explode(c.x + c.n * 13, c.y - 13, 120 + 15 * c.n, ARCH.walker.hp * run.hpMul * (2 + c.n), 0); continue; } }
    if (c.x > cam.x + viewW + 600 || c.x + c.n * 26 < cam.x - 400) crates.splice(i, 1);
  }
}
function updateAmbient(dt, rdt) {
  G.acc += dt; let n = 0;
  while (G.acc >= RD_STEP && n < 6) { G.acc -= RD_STEP; n++; for (const r of ragdolls) stepRagdoll(r, groundY); }
  if (n === 6) G.acc = 0;
  for (let i = ragdolls.length - 1; i >= 0; i--) { const r = ragdolls[i]; r.age += dt; if (r.age > RD_LIFE || r.p[1][0] < cam.x - 300) ragdolls.splice(i, 1); }
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.life -= dt;
    if (q.life <= 0) { parts.splice(i, 1); continue; }
    if (q.k === 'ring' || q.k === 'smoke' || q.k === 'fire') q.sz += q.grow * dt;
    if (q.stuck || q.k === 'zap') continue;
    if (q.g) q.vy += GRAV * q.g * dt * 0.8;
    if (q.drag) { q.vx *= 1 - Math.min(1, q.drag * dt); q.vy *= 1 - Math.min(1, q.drag * dt); }
    q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.vr) q.rot += q.vr * dt;
    if (q.g && q.y > groundY(q.x)) {
      if (q.k === 'item') { q.vr *= 0.5; if (Math.abs(q.vy) < 60) q.vr = 0; }
      q.y = groundY(q.x);
      if (q.k === 'blood') { q.stuck = true; q.life = Math.min(q.life, 5); q.sz *= 1.4; }
      else { q.vy *= -0.35; q.vx *= 0.6; if (Math.abs(q.vy) < 40) q.stuck = true; }
    }
  }
  for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.life -= rdt; t.y += t.vy * rdt; t.vy *= 1 - 2 * rdt; if (t.life <= 0) texts.splice(i, 1); }
  // coins fly to the HUD counter (CSS px space)
  if (coinFx.length) {
    const tg = UI.coinTarget();
    for (let i = coinFx.length - 1; i >= 0; i--) {
      const c = coinFx[i]; c.t += rdt;
      if (c.t < 0.4) { c.vy += 900 * rdt; c.x += c.vx * rdt; c.y += c.vy * rdt; }
      else { const k = Math.min(1, rdt * (6 + c.t * 14)); c.x += (tg[0] - c.x) * k; c.y += (tg[1] - c.y) * k; if (Math.abs(tg[0] - c.x) + Math.abs(tg[1] - c.y) < 14) { coinFx.splice(i, 1); UI.bump(); Sfx.play('coin'); } }
    }
  }
  const tx = player.x - camLead();
  cam.x += (tx - cam.x) * Math.min(1, rdt * 5);
  ensureGround(cam.x + viewW + 600, cam.x - 400);
  cam.shake = Math.max(0, cam.shake - rdt * 40); G.hurtFx -= rdt; G.flash -= rdt * 2;
  G.punch = Math.max(0, G.punch - rdt * 0.25);
  cam.z += ((run && run.btOn ? 1.07 : 1) + G.punch - cam.z) * Math.min(1, rdt * 6);
  updateAmb(dt, cam.x - cam.lx); cam.lx = cam.x;
  if (G.state === 'over' && !player.dead) posePlayer();
  if (G.state === 'menu') {
    player.aim = -0.06 + Math.sin(G.time * 0.8) * 0.05; posePlayer();
    for (const e of enemies) poseEnemy(e);
  }
}

// ===== main loop =====
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
  step(rdt);
  Platform.gameplay(G.state === 'play');
  Music.set(...DBG.music || [era.bg, G.state !== 'play' ? 0 : run && run.boss ? 2 : 1]);
  render();
  UI.tick();
}
// one simulation tick (real seconds); shared with tools/sim.js so balance tests run the exact game loop
function step(rdt) {
  rdt *= DBG.speed;
  G.time += rdt;
  let ts = 1;
  if (G.hitstop > 0) { G.hitstop -= rdt; ts = 0.05; }
  else if (run && run.btOn) ts = 0.3;
  if (G.slowmo > 0) { G.slowmo -= rdt; ts = Math.min(ts, 0.3); }
  const dt = rdt * ts, pdt = G.hitstop > 0 ? 0 : rdt;
  if (G.state === 'play') { update(dt, rdt, pdt); updateAmbient(dt, rdt); }
  else if (G.state === 'menu' || G.state === 'over') updateAmbient(dt, rdt);
}

// ===== input =====
const input = { hold: false, mouse: false, mx: 0, my: 0, tid: null, ty: 0 };
function pointAim(x, y) { const n = player.pts[1], [wx, wy] = toWorld(x * DPR, y * DPR); player.aim = Math.atan2(wy - n[1], Math.max(8, wx - n[0])); }
cvs.addEventListener('pointerdown', e => {
  Sfx.init();
  if (e.pointerType === 'mouse') { input.mouse = true; input.mx = e.clientX; input.my = e.clientY; if (e.button === 0) input.hold = true; if (e.button === 2) startReload(); return; }
  input.mouse = false;
  if (input.tid !== null) return;
  input.tid = e.pointerId; input.ty = e.clientY; input.hold = !save.set.auto;
  if (save.set.aim === 'point') pointAim(e.clientX, e.clientY);
});
cvs.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { input.mouse = true; input.mx = e.clientX; input.my = e.clientY; return; }
  if (e.pointerId !== input.tid) return;
  if (save.set.aim === 'point') pointAim(e.clientX, e.clientY);
  else player.aim = clamp(player.aim + (e.clientY - input.ty) * 0.0065 * save.set.sens, -1.45, 0.95);
  input.ty = e.clientY;
});
const pointerUp = e => {
  if (e.pointerType === 'mouse') { if (e.button === 0) input.hold = false; return; }
  if (e.pointerId === input.tid) { input.tid = null; input.hold = false; }
};
cvs.addEventListener('pointerup', pointerUp); cvs.addEventListener('pointercancel', pointerUp);
cvs.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ') e.preventDefault();
  if (e.repeat) return;
  if (G.state === 'play') {
    if (k === 'r') startReload();
    else if (k === 'g' || k === 'q') throwNade();
    else if (k === ' ' || k === 'e' || k === 'shift') toggleBT();
    else if (k === 'escape' || k === 'p') pause();
  } else if (G.state === 'pause' && (k === 'escape' || k === 'p')) { UI.close(); resume(); }
  else if (G.state === 'menu' && k === 'enter' && G.era < save.unlocked) startRun(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { pause(); persist(); Sfx.ac?.suspend(); } // no music from a background tab
  else if (!Platform.inAd) Sfx.ac?.resume();
});

async function boot() {
  await Platform.init(raw => { if (raw) Object.assign(save, readSave(raw)); }); // cloud save wins on CrazyGames
  G.era = Math.min(save.unlocked, ERAS.length) - 1;
  Sfx.prep(); Music.load(ERAS[G.era].bg); // render audio while the player looks at the menu
  resize(); addEventListener('resize', resize);
  Sfx.on = save.set.sfx && !Platform.mute; Music.on = save.set.music && !Platform.mute; GFX_LOW = save.set.gfx === 'low';
  setupWorld(G.era); spawnDummies(); wep = computeWeapon();
  UI.init();
  requestAnimationFrame(t => { last = t; frame(t); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !Platform.sdk) navigator.serviceWorker.register('sw.js').catch(() => { });
}
