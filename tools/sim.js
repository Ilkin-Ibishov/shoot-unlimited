// Balance simulator: runs the REAL game code headless (canvas/DOM stubbed) with a bot that
// aims like a human (reaction delay, limited swipe speed, drifting aim error), then plays
// whole campaigns: run -> spend coins -> run ... until all eras are cleared.
// Usage: node tools/sim.js [skill=casual|avg|pro|all] [n=4] [maxRuns=150] [w=844] [h=390] [perks=off]
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const A = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));

const SKILLS = {
  // reaction s, swipe rad/s, aim error rad, head aim %, lead moving targets, nade when N in range, bullet time when N close,
  // perc: how often (s) the wanted aim angle is re-read -- in between, steps/target motion drift the shot like for a human
  casual: { react: 0.45, omega: 2.2, sigma: 0.07,  pHead: 0.15, lead: 0,   nade: 4, bt: 0, perk: 'random', perc: 0.35 },
  avg:    { react: 0.3,  omega: 3.5, sigma: 0.045, pHead: 0.35, lead: 0.5, nade: 3, bt: 5, perk: 'smart', perc: 0.25 },
  pro:    { react: 0.18, omega: 6,   sigma: 0.025, pHead: 0.7,  lead: 1,   nade: 3, bt: 4, perk: 'smart', perc: 0.15 },
};

function makeGame(w, h) {
  const grad = { addColorStop() {} }, noop = () => grad;
  const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
  const el = () => ({ getContext: ctx2d, addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  const store = {};
  const g = vm.createContext({
    console, document: { getElementById: el, createElement: el, addEventListener() {}, hidden: false },
    innerWidth: w, innerHeight: h, devicePixelRatio: 2, addEventListener() {}, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    location: { search: '', protocol: 'file:' }, navigator: {}, requestAnimationFrame() {},
  });
  vm.runInContext('var window = globalThis;', g);
  for (const f of ['data.js', 'engine.js', 'audio.js', 'platform.js', 'game.js', 'render.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), g, { filename: f });
  vm.runInContext('(' + harness + ')()', g);
  return g;
}

// ---- everything below runs inside the game's context ----
function harness() {
  resize();
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  const PERK_ORDER = ['hunter', 'twin', 'pierce', 'explosive', 'chain', 'rage', 'fire', 'quick', 'bigmag', 'medkit', 'homing', 'vamp', 'frost', 'ricochet', 'focus', 'greed'];
  let S = null, st = null, last = null;
  globalThis.UI = {
    startHud() {}, banner() {}, boss() {}, menu() {}, close() {}, pauseMenu() {}, bump() {}, tick() {}, refresh() {},
    coinTarget: () => [0, 0], result(d) { last = d; },
    perks(opts, cb) { cb(globalThis.NO_PERKS ? { id: 'none' } : S.perk === 'random' ? pick(opts) : opts.slice().sort((a, b) => PERK_ORDER.indexOf(a.id) - PERK_ORDER.indexOf(b.id))[0]); },
  };
  // instrument (function declarations are globals, so wrapping them is seen by game code)
  const wrap = (name, fn) => { const o = globalThis[name]; globalThis[name] = function () { fn.apply(this, arguments); return o.apply(this, arguments); }; };
  wrap('fire', () => { st.shots += wep.pellets + (run.perks.twin || 0); });
  wrap('hurtPlayer', d => { if (!player.dead && player.hurt <= G.time) st.dmgTaken += d; });
  wrap('killEnemy', (e, o) => { st.src[o.src] = (st.src[o.src] || 0) + 1; });
  wrap('hurtEnemy', (e, d, o) => { if (o.src === 'bullet' && !e.dead) { st.hits++; if (o.head && !e.helmet) st.bHeads++; } }); // bullets only (laser ticks excluded)

  const bot = { tgt: null, react: 0, errT: 0, err: 0, head: false, percT: 0, want: 0 };
  function botStep(dt) {
    input.mouse = false; input.hold = false;
    if (!run || run.state !== 'fight' || player.dead) return;
    let tgt = null, best = 1e9;
    for (const e of enemies) {
      if (e.dead || e.idle || e.x > cam.x + viewW - 20) continue;
      let d = Math.abs(e.x - player.x);
      if (e.type === 'exploder') d *= 0.6; else if (e.type === 'flyer' && e.mode === 'dive') d *= 0.5; else if (e.type === 'ranged' && !e.walking) d *= 0.8;
      if (d < best) { best = d; tgt = e; }
    }
    if (tgt !== bot.tgt) { bot.tgt = tgt; bot.react = S.react * (0.7 + Math.random() * 0.6); bot.head = Math.random() < S.pHead; bot.percT = 0; }
    if (!tgt || (bot.react -= dt) > 0) return;
    if ((bot.errT -= dt) <= 0) { bot.errT = 0.25 + Math.random() * 0.2; bot.err = gauss() * S.sigma; }
    const R = RIGS[tgt.rig], q = tgt.pts[bot.head ? R.head : R.core], n = player.pts[1];
    let tx = q[0];
    if (S.lead && !wep.beam && tgt.walking) tx -= tgt.speed * (tgt.slow > 0 ? 0.55 : 1) * Math.hypot(q[0] - n[0], q[1] - n[1]) / wep.speed * S.lead;
    if ((bot.percT -= dt) <= 0) { bot.percT = S.perc; bot.want = Math.atan2(q[1] - n[1], tx - n[0]) + bot.err; }
    const stp = S.omega * dt;
    player.aim += clamp(bot.want - player.aim, -stp, stp);
    if (S.nade && run.nadeCd <= 0 && enemies.filter(e => !e.dead && e.x - player.x > 240 && e.x - player.x < 520).length >= S.nade) throwNade();
    if (S.bt && !run.btOn && run.bt >= 0.5 && enemies.filter(e => !e.dead && e.x - player.x < 350).length >= S.bt) toggleBT();
  }

  const DT = 1 / 60;
  function playRun(eraIdx) {
    G.era = eraIdx; startRun(false);
    st = { shots: 0, hits: 0, bHeads: 0, dmgTaken: 0, src: {}, minHp: 1, t: 0 }; last = null;
    let f = 0;
    while (G.state === 'play' && f < 60 * 60 * 15) {
      botStep(DT);
      step(DT);
      ragdolls.length = 0; parts.length = 0; texts.length = 0; coinFx.length = 0; // cosmetic only
      if (!player.dead) st.minHp = Math.min(st.minHp, player.hp / player.maxHp);
      f++;
    }
    const timeout = G.state === 'play';
    if (timeout) quitRun();
    const d = last || { won: false, pct: 0, coins: 0, kills: 0, heads: 0 };
    const out = { era: eraIdx, won: d.won, pct: d.pct, coins: d.coins, kills: d.kills, heads: d.heads, timeout, ...st, t: f / 60 };
    backToMenu();
    return out;
  }

  // sustained dps x crowd factor (enemies come in a line, so pierce/blast hit several)
  const score = w => (w.beam ? w.dps * w.heat / (w.heat + w.reload) : w.dmg * w.pellets * w.rate * w.mag / (w.mag + w.rate * w.reload))
    * (1 + Math.min(w.pierce, 4) * 0.3) * (w.explode ? 2 : 1);
  function shop(avgIncome) {
    const cur = WEAPONS.find(w => w.id === save.eq);
    for (const w of WEAPONS) if (save.owned.includes(w.id) && score(w) > score(WEAPONS.find(x => x.id === save.eq))) save.eq = w.id;
    const next = WEAPONS.filter(w => !save.owned.includes(w.id) && save.unlocked > w.era && score(w) > score(cur) * 1.25).sort((a, b) => a.price - b.price)[0];
    if (next && save.coins >= next.price) { save.coins -= next.price; save.owned.push(next.id); save.eq = next.id; }
    else if (next && next.price <= avgIncome * 3) return; // save up for it
    const W = { dmg: 1, rate: 0.8, hp: 0.8, income: 0.5, mag: 0.35, reload: 0.35, crit: 0.3, head: S.pHead };
    for (;;) {
      let best = null, bs = 0;
      for (const u of UPGRADES) { const l = lv(u.id), c = upCost(u, l); if (l < u.max && c <= save.coins && W[u.id] / c > bs) { bs = W[u.id] / c; best = u; } }
      if (!best) break;
      save.coins -= upCost(best, lv(best.id)); save.up[best.id] = lv(best.id) + 1;
    }
  }

  globalThis.campaign = (skill, maxRuns) => {
    S = skill;
    Object.assign(save, { coins: 0, up: {}, owned: ['pistol'], eq: 'pistol', unlocked: 1, best: [], endless: 0 });
    const log = []; let inc = 0;
    for (let i = 0; i < maxRuns; i++) {
      shop(inc);
      const e = Math.min(save.unlocked, ERAS.length) - 1, r = playRun(e);
      inc = inc ? inc * 0.7 + r.coins * 0.3 : r.coins;
      r.lv = { ...save.up }; r.weapon = save.eq; log.push(r);
      if (r.won && e === ERAS.length - 1) break;
    }
    return log;
  };
}

// ---- reporting ----
const pad = (v, n) => String(v).padStart(n), pc = v => isNaN(v) ? '-' : (v * 100).toFixed(0) + '%';
function report(name, logs) {
  const N = logs.length, E = 7, rows = [];
  for (let e = 0; e < E; e++) {
    const per = logs.map(l => l.filter(r => r.era === e)).filter(a => a.length);
    if (!per.length) continue;
    const runs = per.map(a => a.length), first = per.map(a => a[0]);
    const all = per.flat(), avg = f => all.reduce((s, r) => s + f(r), 0) / all.length;
    const shot = all.filter(r => r.shots), gun = f => shot.length ? shot.reduce((s, r) => s + f(r), 0) / shot.length : NaN; // runs that fired bullets
    const cleared = per.filter(a => a.some(r => r.won)).length;
    rows.push({ e, runs: runs.reduce((a, b) => a + b) / per.length, cleared: `${cleared}/${N}`, firstPct: first.reduce((s, r) => s + r.pct, 0) / first.length,
      firstWin: first.filter(r => r.won).length, min: all.reduce((s, r) => s + r.t, 0) / per.length / 60, runT: avg(r => r.t), acc: gun(r => r.hits / r.shots),
      hs: gun(r => r.bHeads / Math.max(1, r.hits)), dmgLv: avg(r => r.lv.dmg || 0), minHp: avg(r => r.minHp), deaths: all.filter(r => !r.won).length / per.length,
      kick: avg(r => (r.src.kick || 0) / Math.max(1, r.kills)) });
  }
  const tot = logs.map(l => l.reduce((s, r) => s + r.t, 0) / 3600), done = logs.filter(l => l.at(-1).won && l.at(-1).era === 6).length;
  console.log(`\n=== ${name}: ${N} campaigns, finished all eras: ${done}/${N}, avg runs ${(logs.reduce((s, l) => s + l.length, 0) / N).toFixed(1)}, avg play time ${(tot.reduce((a, b) => a + b) / N).toFixed(2)} h`);
  console.log('era | runs | clear | 1st% | 1st win | minutes | run s | deaths | acc  | head/hit | dmgLv | minHP | kick kills');
  for (const r of rows) console.log(`${pad(r.e + 1, 3)} | ${pad(r.runs.toFixed(1), 4)} | ${pad(r.cleared, 5)} | ${pad(r.firstPct.toFixed(0), 4)} | ${pad(r.firstWin + '/' + N, 7)} | ${pad(r.min.toFixed(1), 7)} | ${pad(r.runT.toFixed(0), 5)} | ${pad(r.deaths.toFixed(1), 6)} | ${pad(pc(r.acc), 4)} | ${pad(pc(r.hs), 8)} | ${pad(r.dmgLv.toFixed(1), 5)} | ${pad((r.minHp * 100).toFixed(0) + '%', 5)} | ${pad((r.kick * 100).toFixed(0) + '%', 5)}`);
}

// every campaign runs in its own worker thread (all skills x n in parallel)
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
if (!isMainThread) {
  const g = makeGame(+(A.w || 844), +(A.h || 390));
  if (workerData.noPerks) g.NO_PERKS = true;
  parentPort.postMessage(g.campaign(SKILLS[workerData.sk], workerData.maxRuns));
} else {
  const n = +(A.n || 4), maxRuns = +(A.maxRuns || 150), skills = A.skill && A.skill !== 'all' ? [A.skill] : Object.keys(SKILLS);
  const jobs = skills.flatMap(sk => Array.from({ length: n }, () => new Promise((res, rej) => {
    const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: { sk, maxRuns, noPerks: A.perks === 'off' } });
    w.once('message', log => res({ sk, log })); w.once('error', rej);
  })));
  Promise.all(jobs).then(all => {
    for (const sk of skills) {
      const logs = all.filter(j => j.sk === sk).map(j => j.log);
      report(sk, logs);
      if (A.dump) fs.writeFileSync(A.dump + '-' + sk + '.json', JSON.stringify(logs));
    }
  });
}
