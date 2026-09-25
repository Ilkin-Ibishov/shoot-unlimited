'use strict';
// Debug panel. Open the game with ?debug (never on CrazyGames): separate save slot, everything unlocked, and a
// panel (🐞 button or the ` key) to jump to any era/wave, equip any weapon mid-run, spawn enemies, flip cheats,
// add perks/upgrades and audition every sound and music layer. The switches live in DBG (game.js).
if (DEBUG) (() => {
  Object.assign(save, { coins: Math.max(save.coins, 1e7), unlocked: ERAS.length, owned: WEAPONS.map(w => w.id) });
  persist();

  const css = document.createElement('style');
  css.textContent = `
    #dbgBtn { position: fixed; left: max(8px, env(safe-area-inset-left)); top: 42%; z-index: 60; width: 42px; height: 42px; border-radius: 10px;
      background: #33405e; border: 3px solid var(--line); box-shadow: 0 3px 0 var(--line); font-size: 20px; pointer-events: auto; }
    #dbg { position: fixed; left: max(8px, env(safe-area-inset-left)); top: 8px; bottom: 8px; z-index: 61; width: min(330px, calc(100vw - 16px)); overflow-y: auto;
      background: rgba(16, 20, 31, .94); border: 3px solid var(--line); border-radius: 12px; padding: 10px; font-size: 12px; pointer-events: auto; touch-action: pan-y; }
    #dbg.hidden { display: none; }
    #dbg h4 { margin: 10px 0 5px; color: var(--yellow); font-size: 12px; letter-spacing: 1px; font-weight: normal; }
    #dbg h4:first-child { margin-top: 0; display: flex; justify-content: space-between; align-items: center; }
    #dbg .g { display: flex; flex-wrap: wrap; gap: 5px; }
    #dbg button { padding: 6px 8px; border-radius: 7px; background: #33405e; border: 2px solid var(--line); font-size: 11px; color: #fff; }
    #dbg button.on { background: var(--green); color: #10141f; }
    #dbg button.sel { background: var(--yellow); color: #10141f; }
    #dbg button.red { background: #7a2d35; }
    #dbg .info { font-family: ui-monospace, monospace; color: #9fe6ff; line-height: 1.5; white-space: pre-wrap; }
    #dbg .msg { color: var(--yellow); min-height: 14px; margin-top: 6px; }`;
  document.head.appendChild(css);
  const btn = document.createElement('button'), pan = document.createElement('div');
  btn.id = 'dbgBtn'; btn.textContent = '🐞'; pan.id = 'dbg'; pan.className = 'hidden';
  document.body.append(btn, pan);

  let selEra = G.era, selWave = 1, msg = '', msgT = 0;
  const say = m => { msg = m; msgT = 3; const el = pan.querySelector('.msg'); if (el) el.textContent = m; };
  const toggle = () => { pan.classList.toggle('hidden'); if (!pan.classList.contains('hidden')) draw(); };
  btn.onclick = toggle;
  addEventListener('keydown', e => { if (e.key === '`') toggle(); });

  function jumpWave(n) { // clear the field and start wave n (1-based)
    enemies.length = 0; eprojs.length = 0; run.queue = []; run.boss = null; UI.boss(null);
    run.state = 'fight'; run.wave = n - 2; nextWave();
  }
  function go(endless) {
    UI.close(); run = null; G.slowmo = 0;
    if (!endless) G.era = selEra;
    startRun(endless);
    if (selWave > 1) jumpWave(selWave);
    say(`${endless ? 'Endless' : ERAS[G.era].name} · wave ${selWave}`);
  }
  function equip(id) {
    save.eq = id; if (!save.owned.includes(id)) save.owned.push(id);
    wep = computeWeapon(); Object.assign(player, { ammo: wep.mag, reload: 0, heat: 0, over: false }); persist();
    if (G.state === 'menu') UI.refresh();
  }
  function killAll() { for (const e of enemies) if (!e.dead && !e.idle) killEnemy(e, { src: 'debug', dx: 1, dy: -0.4, x: e.x, y: e.y - 50 }, false, 0); }
  function setUps(max) {
    save.up = max ? Object.fromEntries(UPGRADES.map(u => [u.id, u.max])) : {}; persist();
    wep = computeWeapon();
    if (run) { player.maxHp = UP.hp(lv('hp')); player.hp = Math.min(player.hp, player.maxHp); }
    if (G.state === 'menu') UI.refresh();
  }
  function addPerk(p) {
    if ((run.perks[p.id] || 0) >= p.max) return say(p.name + ' is maxed');
    run.perks[p.id] = (run.perks[p.id] || 0) + 1;
    if (p.id === 'medkit') { player.maxHp += 25; player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.5); }
    wep = computeWeapon();
  }
  const needRun = f => (...a) => run && G.state !== 'over' ? f(...a) : say('Start a run first');
  const b = (act, label, cls = '') => `<button data-a="${act}" class="${cls}">${label}</button>`;

  function draw() {
    const P = run ? run.perks : {}, mk = DBG.music;
    pan.innerHTML = `
      <h4>🐞 DEBUG ${b('close', '✕')}</h4>
      <div class="info"></div><div class="msg">${msg}</div>
      <h4>ERA</h4><div class="g">${ERAS.map((e, i) => b('era:' + i, `${i + 1}. ${e.name}`, i === selEra ? 'sel' : '')).join('')}</div>
      <h4>START AT WAVE</h4><div class="g">${Array.from({ length: WAVES }, (_, i) => b('wave:' + (i + 1), i + 1 === WAVES ? `${i + 1} BOSS` : i + 1, i + 1 === selWave ? 'sel' : '')).join('')}</div>
      <div class="g" style="margin-top:6px">${b('go', '▶ START ERA', 'on')}${b('endless', '∞ ENDLESS')}${b('menu', '⌂ MENU')}</div>
      <h4>WEAPON (works mid-run)</h4><div class="g">${WEAPONS.map(w => b('wep:' + w.id, w.name, save.eq === w.id ? 'sel' : '')).join('')}</div>
      <h4>CHEATS</h4><div class="g">${b('god', 'GOD MODE', DBG.god ? 'on' : '')}${b('inf', 'INF AMMO + COOLDOWNS', DBG.inf ? 'on' : '')}${b('oneHit', 'ONE-HIT KILL', DBG.oneHit ? 'on' : '')}</div>
      <h4>GAME SPEED</h4><div class="g">${[0.1, 0.25, 0.5, 1, 2, 4].map(s => b('speed:' + s, s + 'x', DBG.speed === s ? 'sel' : '')).join('')}</div>
      <h4>RUN</h4><div class="g">${b('kill', 'KILL ALL')}${b('clear', 'CLEAR WAVE')}${b('win', 'WIN ERA')}${b('heal', 'HEAL')}${b('die', 'DIE', 'red')}${b('coins', '+100K COINS')}</div>
      <h4>SPAWN</h4><div class="g">${Object.keys(ARCH).map(t => b('spawn:' + t, era.foes[t].name)).join('')}</div>
      <h4>PERKS (this run)</h4><div class="g">${PERKS.map(p => b('perk:' + p.id, `${p.icon} ${p.name}${P[p.id] ? ' ' + P[p.id] : ''}`, P[p.id] ? 'on' : '')).join('')}</div>
      <h4>UPGRADES</h4><div class="g">${b('upmax', 'MAX ALL')}${b('upreset', 'RESET ALL')}</div>
      <h4>SOUND</h4><div class="g">${DSP.SFX.map(n => b('sfx:' + n, n)).join('')}</div>
      <h4>MUSIC</h4><div class="g">${DSP.SONGS.map(k => b('mus:' + k, k, mk && mk[0] === k ? 'sel' : '')).join('')}</div>
      <div class="g" style="margin-top:5px">${['MENU', 'FIGHT', 'BOSS'].map((l, i) => b('lay:' + i, l, mk && mk[1] === i ? 'sel' : '')).join('')}${b('musauto', 'AUTO', mk ? '' : 'on')}</div>
      <h4>SAVE</h4><div class="g">${b('wipe', 'RESET DEBUG SAVE', 'red')}</div>`;
    info();
  }
  const acts = {
    close: toggle, go: () => go(false), endless: () => go(true), menu: () => { UI.close(); backToMenu(); },
    era: i => { selEra = +i; if (!run) { G.era = selEra; setupWorld(G.era); spawnDummies(); UI.menu(); } },
    wave: n => { selWave = +n; if (run && !run.endless && G.state === 'play') jumpWave(selWave); },
    wep: equip,
    god: () => { DBG.god = !DBG.god; }, inf: () => { DBG.inf = !DBG.inf; }, oneHit: () => { DBG.oneHit = !DBG.oneHit; },
    speed: s => { DBG.speed = +s; },
    kill: needRun(killAll), clear: needRun(() => { run.queue = []; killAll(); }),
    win: needRun(() => { if (run.endless) return say('Endless has no end'); run.queue = []; run.wave = run.total - 1; killAll(); }),
    heal: needRun(() => { player.hp = player.maxHp; }), die: needRun(() => { DBG.god = false; playerDie(); }),
    coins: () => { save.coins += 1e5; persist(); UI.refresh(); },
    spawn: needRun(t => {
      const x = cam.x + viewW + 30; ensureGround(x + 200);
      const e = makeEnemy(t, x); enemies.push(e); if (t === 'boss') { run.boss = e; UI.boss(e); }
    }),
    perk: needRun(id => addPerk(PERKS.find(p => p.id === id))),
    upmax: () => setUps(true), upreset: () => setUps(false),
    sfx: n => { Sfx.init(); Sfx.play(n); },
    mus: k => { Sfx.init(); DBG.music = [k, DBG.music ? DBG.music[1] : 1]; }, lay: i => { Sfx.init(); DBG.music = [DBG.music ? DBG.music[0] : era.bg, +i]; },
    musauto: () => { DBG.music = null; },
    wipe: () => { G.wiped = true; localStorage.removeItem(SAVE_KEY); location.reload(); },
  };
  pan.addEventListener('click', e => {
    const el = e.target.closest('[data-a]'); if (!el) return;
    const [a, arg] = el.dataset.a.split(':');
    say(el.textContent + ' ✓'); acts[a](arg); // an action may replace the message
    if (a !== 'close' && a !== 'wipe') draw();
  });

  // per frame: keep cheats applied, refresh the live readout
  let last = performance.now(), fps = 60, infoT = 0;
  function info() {
    const el = pan.querySelector('.info'); if (!el) return;
    const w = wep || {}, r = run;
    el.textContent = `FPS ${fps.toFixed(0)} · state ${G.state}${r ? ` · wave ${r.wave + 1}/${r.endless ? '∞' : r.total}` : ''}
${ERAS[r ? r.era : G.era].name} · ${w.name} dmg ${fmt(w.beam ? w.dps : w.dmg)} rate ${(w.rate || 0).toFixed(2)}/s
HP ${Math.ceil(player.hp)}/${player.maxHp} · enemies ${enemies.length} · queue ${r ? r.queue.length : 0}
ragdolls ${ragdolls.length} · particles ${parts.length} · bullets ${bullets.length}`;
  }
  (function tick(now) {
    requestAnimationFrame(tick);
    const dt = (now - last) / 1000; last = now; if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (DBG.inf && run) { Object.assign(player, { ammo: wep.mag, heat: 0, over: false }); run.nadeCd = 0; run.bt = 1; }
    if (msgT > 0 && (msgT -= dt) <= 0) say('');
    if ((infoT -= dt) <= 0 && !pan.classList.contains('hidden')) { infoT = 0.25; info(); }
  })(last);
})();
