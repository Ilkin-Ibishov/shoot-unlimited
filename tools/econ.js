// Economy analysis of a sim dump: per era, how strong the equipped gun is, what a run earns and where the coins go.
//   node tools/sim.js skill=all n=4 dump=tools/out/bal/base      (writes base-<skill>.json)
//   node tools/econ.js tools/out/bal/base
// Weapon power = sustained single-target dps (the same score the sim's shop uses).
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = vm.createContext({ console });
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'); // top-level consts are only visible to the same script
vm.runInContext(src + '\nthis.D = { WEAPONS, UP, UPGRADES, BAL, ERAS, upCost, WUP: typeof WUP !== "undefined" ? WUP : null };', ctx);
const { WEAPONS, UP, UPGRADES, BAL, ERAS, upCost, WUP } = ctx.D;

// gun power for either upgrade model: global levels (lv) or per-weapon levels (wlv[id])
function power(id, lv, wlv) {
  const d = WEAPONS.find(w => w.id === id), L = WUP ? (wlv && wlv[id]) || {} : lv, M = WUP ? WUP.fx : UP;
  const dm = M.dmg(L.dmg || 0), rt = M.rate(L.rate || 0), mg = M.mag(L.mag || 0), rl = M.reload(L.reload || 0);
  const crowd = 1; // single-target sustained dps
  if (d.beam) { const dps = d.dps * dm * rt * BAL.bulletDmg, heat = d.heat * mg, rel = d.reload * rl; return dps * heat / (heat + rel) * crowd; }
  const dmg = d.dmg * dm * BAL.bulletDmg, rate = d.rate * rt * BAL.fireRate, mag = Math.max(1, Math.round(d.mag * mg)), rel = d.reload * rl;
  return dmg * d.pellets * mag / (mag / rate + rel) * crowd;
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const spent = (u, a, b) => { let c = 0; for (let l = a; l < b; l++) c += upCost(u, l); return c; };

function analyse(file) {
  const logs = JSON.parse(fs.readFileSync(file, 'utf8')), rows = [];
  for (let e = 0; e < ERAS.length; e++) {
    const per = logs.map(l => ({ l, i0: l.findIndex(r => r.era === e) })).filter(x => x.i0 >= 0);
    if (!per.length) continue;
    const S = { runs: [], inc: [], p0: [], pWin: [], wep: {}, buyW: [], buyGun: [], buyChar: [] };
    for (const { l, i0 } of per) {
      const rs = l.filter(r => r.era === e), win = rs.find(r => r.won) || rs.at(-1);
      S.runs.push(rs.length); S.inc.push(med(rs.map(r => r.coins)));
      S.p0.push(power(rs[0].weapon, rs[0].lv, rs[0].wlv)); S.pWin.push(power(win.weapon, win.lv, win.wlv)); S.wep[win.weapon] = (S.wep[win.weapon] || 0) + 1;
      // coins spent while in this era: from the levels/weapon before its first run to the levels at its last run
      const prev = i0 > 0 ? l[i0 - 1] : { lv: {}, weapon: 'pistol', wlv: {} }, last = rs.at(-1);
      let gun = 0, chr = 0, wpn = 0;
      if (WUP) {
        for (const w of WEAPONS) for (const u of WUP.list) gun += spent({ base: WUP.cost(w, u), growth: u.growth }, (prev.wlv?.[w.id] || {})[u.id] || 0, (last.wlv?.[w.id] || {})[u.id] || 0);
      }
      for (const u of UPGRADES) { const c = spent(u, prev.lv[u.id] || 0, last.lv[u.id] || 0); if (['dmg', 'rate', 'mag', 'reload'].includes(u.id)) gun += c; else chr += c; }
      const owned = new Set(l.slice(0, i0).map(r => r.weapon)); for (const r of rs) if (!owned.has(r.weapon)) { owned.add(r.weapon); wpn += WEAPONS.find(w => w.id === r.weapon).price; }
      S.buyW.push(wpn); S.buyGun.push(gun); S.buyChar.push(chr);
    }
    rows.push({ era: e + 1, runs: med(S.runs), inc: med(S.inc), p0: med(S.p0), pWin: med(S.pWin), weps: Object.entries(S.wep).map(([k, v]) => k + '×' + v).join(' '),
      wpn: med(S.buyW), gun: med(S.buyGun), chr: med(S.buyChar) });
  }
  return { rows, runs: med(logs.map(l => l.length)) };
}
const f = n => n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : n.toFixed(n < 10 ? 1 : 0);
const base = process.argv[2] || 'tools/out/bal/base';
for (const sk of ['casual', 'avg', 'pro']) {
  const file = `${base}-${sk}.json`; if (!fs.existsSync(file)) continue;
  const { rows, runs } = analyse(file);
  console.log(`\n${sk}: median campaign ${runs} runs`);
  console.log('era | runs | coins/run | gun power start -> clear | cleared with      | spent: weapons  gun-ups  character');
  for (const r of rows) console.log(`${String(r.era).padStart(3)} | ${String(r.runs).padStart(4)} | ${f(r.inc).padStart(9)} | ${f(r.p0).padStart(8)} -> ${f(r.pWin).padEnd(7)} | ${r.weps.padEnd(17)} | ${f(r.wpn).padStart(8)} ${f(r.gun).padStart(8)} ${f(r.chr).padStart(9)}`);
}
module.exports = { power };
