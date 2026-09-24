// Sanity checks for content data + ragdoll physics. Run: node tools/check.js
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ctx = vm.createContext({ console, Math, window: {} });
for (const f of ['data.js', 'engine.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });

vm.runInContext(`
  const ok = (c, m) => { if (!c) throw new Error(m); };
  const finite = pts => pts.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  for (const E of ERAS) for (const k of Object.keys(ARCH)) {
    const F = E.foes[k]; ok(F, E.name + ' missing ' + k);
    ok(RIGS[F.rig || 'human'], E.name + '/' + k + ' bad rig');
    ok(F.look && F.look.k && F.look.s, E.name + '/' + k + ' look');
    if (k === 'ranged' || k === 'boss') ok(!F.proj || PROJ[F.proj], E.name + '/' + k + ' bad proj');
    if (F.held === 'shield') ok(F.arms === 'shield', E.name + '/' + k + ' shield needs shield arms');
    for (const m of F.moves || []) ok(['summon', 'charge', 'throw'].includes(m), 'bad move ' + m);
  }
  ok(new Set(WEAPONS.map(w => w.id)).size === WEAPONS.length, 'dup weapon id');
  for (const u of UPGRADES) { ok(UP[u.id], 'no curve ' + u.id); for (let l = 1; l <= u.max; l++) ok(upCost(u, l) > upCost(u, l - 1), 'cost not rising ' + u.id); }
  // every rig poses to finite points and a ragdoll settles on flat ground without exploding
  const o = [];
  poseHuman(o, 100, 440, 1, -1, 1.3, 'run', 'zombie', 0.5, 0); ok(o.length === 11 && finite(o), 'human pose');
  const rp = []; poseRaptor(rp, 100, 440, 1.2, -1, 2, 0, true); ok(rp.length === 10 && finite(rp), 'raptor pose');
  const f = []; poseFlyer(f, 100, 250, 1, -1, 3); ok(f.length === 5 && finite(f), 'flyer pose');
  const h = []; poseHuman(h, 100, 440, 1, -1, 0.7, 'walk', 'aim', 0, 3);
  const r = makeRagdoll('human', h, {}, 1, -1, null, 300, -400);
  for (let i = 0; i < 1200; i++) stepRagdoll(r, x => x > 160 ? 420 : 440); // with a step up
  ok(finite(r.p), 'ragdoll NaN');
  ok(r.p.every(q => q[1] <= 440.01 && q[1] > 300), 'ragdoll left the ground band: ' + JSON.stringify(r.p.map(q => q[1] | 0)));
  ok(r.sleep, 'ragdoll never settled');
  console.log('ok: ' + ERAS.length + ' eras, ' + WEAPONS.length + ' weapons, ' + PERKS.length + ' perks');
`, ctx);
