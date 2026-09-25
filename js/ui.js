'use strict';
// DOM overlays: menu, HUD, modals.

const $ = id => document.getElementById(id);
const coinIc = '<span class="coin"></span>';
function tap() { Sfx.init(); Sfx.play('click'); }
function goFull() {
  if (Platform.sdk || !matchMedia('(pointer:coarse)').matches) return; // portals own fullscreen
  const d = document.documentElement;
  (d.requestFullscreen ? d.requestFullscreen() : Promise.resolve()).then(() => screen.orientation?.lock?.('landscape')).catch(() => { });
}
// gun = an upgrade of the equipped gun (WUP), otherwise a hero upgrade (UPGRADES)
function buyUp(u, gun) {
  const w = WEAPONS.find(x => x.id === save.eq), l = gun ? wl(u.id) : lv(u.id), c = gun ? wupCost(w, u, l) : upCost(u, l);
  if (l >= u.max || save.coins < c) return;
  save.coins -= c;
  if (gun) (save.wup[w.id] || (save.wup[w.id] = {}))[u.id] = l + 1; else save.up[u.id] = l + 1;
  persist(); Sfx.init(); Sfx.play('buy'); wep = computeWeapon(); UI.refresh();
}
const upName = (u, w) => w && w.beam ? { rate: 'Intensity', mag: 'Cooling', reload: 'Cooldown' }[u.id] || u.name : u.name; // the laser overheats instead of reloading
function gunSvg(w) {
  return `<svg viewBox="0 0 64 24" width="64" height="24"><rect x="4" y="${12 - w.w / 2}" width="${w.len}" height="${w.w}" rx="1" fill="${w.id === 'laser' ? '#39e1ff' : '#cfd6e2'}"/><rect x="7" y="12" width="6" height="9" fill="#cfd6e2"/></svg>`;
}

const UI = {
  cache: {}, tab: 'gun', tgt: [0, 0],
  init() {
    $('btnFight').onclick = () => { tap(); if (G.era < save.unlocked) { goFull(); startRun(false); } };
    $('btnEndless').onclick = () => { tap(); goFull(); startRun(true); };
    $('eraPrev').onclick = () => this.era(-1);
    $('eraNext').onclick = () => this.era(1);
    $('btnArsenal').onclick = () => { tap(); this.arsenal(); };
    $('btnSettings').onclick = () => { tap(); this.settings(); };
    $('btnPause').onclick = () => { tap(); pause(); };
    const abil = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); });
    abil('btnNade', throwNade); abil('btnBT', toggleBT); abil('btnReload', startReload);
    $('ups').onclick = e => {
      const t = e.target.closest('[data-tab]'); if (t) { tap(); this.tab = t.dataset.tab; this.refresh(); return; }
      const b = e.target.closest('.buy'); if (b && !b.disabled) buyUp((this.tab === 'gun' ? WUP.list : UPGRADES)[+b.dataset.i], this.tab === 'gun');
    };
    this.menu();
    if (save.refund) { // one-time note for saves from before per-gun upgrades
      this.open(`<h2>WEAPON UPGRADES</h2><p class="quip">Every gun now levels up on its own. Your old gun upgrades were refunded:</p><div class="coins inl">${coinIc}<b>+${fmt(save.refund)}</b></div><button class="fight" data-close>GOT IT</button>`);
      delete save.refund; persist();
    }
  },
  menu() { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); this.close(); this.refresh(); },
  refresh() {
    $('menuCoins').textContent = fmt(save.coins);
    const E = ERAS[G.era], locked = G.era >= save.unlocked;
    $('eraYear').textContent = `ERA ${G.era + 1}/${ERAS.length} · ${E.year}`;
    $('eraName').textContent = E.name;
    $('eraBest').textContent = locked ? '🔒 Clear the previous era' : `BEST ${save.best[G.era] || 0}%`;
    $('btnFight').disabled = locked;
    $('eraPrev').disabled = G.era === 0; $('eraNext').disabled = G.era === ERAS.length - 1;
    const eb = $('btnEndless'); eb.disabled = save.unlocked < 2;
    eb.innerHTML = save.unlocked < 2 ? '🔒 ENDLESS' : 'ENDLESS' + (save.endless ? `<small>BEST ${save.endless}</small>` : '');
    // bottom bar: [gun | hero] switch + that side's four upgrades
    const gun = this.tab === 'gun', w = WEAPONS.find(x => x.id === save.eq) || WEAPONS[0];
    $('ups').innerHTML = `<div class="uptabs"><button class="tab${gun ? ' on' : ''}" data-tab="gun">🔫 ${w.name}</button><button class="tab${gun ? '' : ' on'}" data-tab="hero">🧍 Hero</button></div>`
      + (gun ? WUP.list : UPGRADES).map((u, i) => {
        const l = gun ? wl(u.id) : lv(u.id), max = l >= u.max, cost = gun ? wupCost(w, u, l) : upCost(u, l);
        return `<div class="up"><div class="ic" style="background:${u.color}">${u.icon}</div><div class="bd"><div class="nm">${upName(u, gun && w)}<span class="lv">${l}/${u.max}</span></div>`
          + `<div class="row2"><span class="eff">${u.show(l)}</span><button class="buy" data-i="${i}"${max || save.coins < cost ? ' disabled' : ''}>${max ? 'MAX' : coinIc + fmt(cost)}</button></div><div class="lb"><i style="width:${l / u.max * 100}%"></i></div></div></div>`;
      }).join('');
    this.cache = {};
  },
  era(d) {
    const n = clamp(G.era + d, 0, ERAS.length - 1);
    if (n === G.era) return;
    tap(); G.era = n; setupWorld(n); spawnDummies(); this.refresh();
  },
  startHud() {
    $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); this.close(); this.cache = {};
    $('keysHint').classList.toggle('hidden', matchMedia('(pointer:coarse)').matches);
    this.boss(null);
  },
  banner(title, sub) {
    const b = $('banner'); b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub || '';
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  boss(e) {
    $('bossBar').classList.toggle('hidden', !e);
    if (e) $('bossTxt').textContent = e.F.name;
  },
  coinTarget() {
    const el = $(G.state === 'menu' ? 'menuCoins' : 'hudCoins'), r = el.getBoundingClientRect();
    this.tgt[0] = r.left - 10; this.tgt[1] = r.top + r.height / 2;
    return this.tgt;
  },
  bump() { const el = $('hudCoins').parentElement; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); },
  set(id, v) { if (this.cache[id] !== v) { this.cache[id] = v; $(id).textContent = v; } },
  bar(id, f, prop = 'width') { const v = (Math.round(clamp(f, 0, 1) * 1000) / 10) + '%', k = id + prop; if (this.cache[k] !== v) { this.cache[k] = v; $(id).style[prop] = v; } },
  cls(id, c, on) { const k = id + c; if (this.cache[k] !== on) { this.cache[k] = on; $(id).classList.toggle(c, on); } },
  tick() {
    if (G.state !== 'play' || !run) return;
    const p = player, r = run;
    this.set('ammoTxt', wep.beam ? (p.over ? 'HOT!' : Math.round((1 - p.heat) * 100) + '%') : p.reload > 0 ? 'RELOAD' : p.ammo + '/' + wep.mag);
    this.bar('hpFill', p.hp / p.maxHp); this.set('hpTxt', Math.ceil(Math.max(0, p.hp)) + '');
    this.set('hudCoins', fmt(save.coins));
    const pr = progress();
    this.bar('progFill', r.endless ? (r.size ? r.killedW / r.size : 0) : pr);
    this.set('progTxt', r.endless ? '' : Math.floor(pr * 100) + '%');
    this.set('waveTxt', r.endless ? `ENDLESS · WAVE ${r.wave + 1}` : `${era.name} · WAVE ${Math.min(r.wave + 1, r.total)}/${r.total}`);
    if (r.boss) this.bar('bossFill', r.boss.hp / r.boss.maxHp);
    this.bar('btFill', r.bt, 'height'); this.cls('btnBT', 'on', r.btOn); this.cls('btnBT', 'ready', r.bt >= 0.2);
    this.bar('nadeCd', r.nadeCd / NADE_CD, 'height'); this.cls('btnNade', 'ready', r.nadeCd <= 0);
    this.set('combo', r.combo >= 3 ? `x${r.combo} COMBO` : '');
    this.cls('hud', 'low', p.hp < p.maxHp * 0.3);
  },
  // ===== modals =====
  open(html, onClick, dismiss) { // dismiss: a tap on the backdrop closes it too
    $('panel').innerHTML = html; $('modal').classList.remove('hidden');
    $('panel').onclick = e => { if (e.target.closest('[data-close]')) { tap(); this.close(); return; } onClick && onClick(e); };
    $('modal').onclick = e => { if (dismiss && e.target === e.currentTarget) { tap(); this.close(); } };
  },
  close() { $('modal').classList.add('hidden'); },
  arsenal() {
    const rows = WEAPONS.map(w => {
      const own = save.owned.includes(w.id), eq = save.eq === w.id, locked = save.unlocked <= w.era, c = computeWeapon(w.id), n = wlSum(w.id);
      const stats = (c.beam ? `DPS ${fmt(c.dps)} · HEAT ${+c.heat.toFixed(1)}s · PIERCE ALL`
        : `DMG ${fmt(c.dmg)}${c.pellets > 1 ? '×' + c.pellets : ''} · ${+c.rate.toFixed(2)}/s · MAG ${c.mag}${c.pierce ? ' · PIERCE ' + c.pierce : ''}${c.explode ? ' · BLAST' : ''}`)
        + (own ? ` · UPG ${n}/${WUP.list.length * 10}` : '');
      const act = eq ? '<button class="btn on" disabled>EQUIPPED</button>'
        : own ? `<button class="btn" data-eq="${w.id}">EQUIP</button>`
        : locked ? `<button class="btn" disabled>🔒 ERA ${w.era + 1}</button>`
        : `<button class="btn gold" data-buy="${w.id}" ${save.coins < w.price ? 'disabled' : ''}>${coinIc}${fmt(w.price)}</button>`;
      return `<div class="wrow${eq ? ' eq' : ''}"><div class="wic">${gunSvg(w)}</div><div class="wbd"><b>${w.name}</b><small>${stats}</small><p>${w.desc}</p></div>${act}</div>`;
    }).join('');
    this.open(`<div class="mhead"><h2>ARSENAL</h2><div class="coins inl">${coinIc}<b>${fmt(save.coins)}</b></div><button class="x" data-close aria-label="Close">✕</button></div><div class="list">${rows}</div>`, e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.eq) { tap(); save.eq = b.dataset.eq; }
      else if (b.dataset.buy) {
        const w = WEAPONS.find(x => x.id === b.dataset.buy); if (save.coins < w.price) return;
        save.coins -= w.price; save.owned.push(w.id); save.eq = w.id; Sfx.play('buy');
      } else return;
      persist(); wep = computeWeapon(); this.refresh(); this.arsenal();
    }, true);
  },
  settings() {
    const s = save.set, st = save.stats, tg = (k, label, on) => `<button class="btn tg${on ? ' on' : ''}" data-tg="${k}">${label}: ${on ? 'ON' : 'OFF'}</button>`;
    this.open(`<h2>SETTINGS</h2><div class="grid">
      ${tg('sfx', 'SOUND', s.sfx)}${tg('music', 'MUSIC', s.music)}${tg('shake', 'SCREEN SHAKE', s.shake)}${tg('auto', 'AUTO-FIRE', s.auto)}${tg('blood', 'BLOOD', s.blood)}
      <button class="btn tg${s.gfx === 'high' ? ' on' : ''}" data-gfx>GRAPHICS: ${s.gfx === 'high' ? 'HIGH' : 'LOW'}</button>
      <button class="btn tg on" data-aim>TOUCH AIM: ${s.aim === 'swipe' ? 'SWIPE' : 'POINT'}</button></div>
      <label class="sens">SWIPE SENSITIVITY <input type="range" id="sens" min="0.4" max="2.2" step="0.1" value="${s.sens}"></label>
      <p class="muted">Runs ${st.runs} · Kills ${fmt(st.kills)} · Headshots ${fmt(st.heads)} · Deaths ${st.deaths}</p>
      <p class="muted">Desktop: mouse aims · hold click to fire · R reload · G grenade · SPACE bullet time · P pause</p>
      <div class="row"><button class="btn danger" data-reset>RESET PROGRESS</button><button class="btn" data-close>CLOSE</button></div>`, e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tg) { s[b.dataset.tg] = !s[b.dataset.tg]; Sfx.on = s.sfx && !Platform.mute; Music.on = s.music && !Platform.mute; }
      else if ('gfx' in b.dataset) { s.gfx = s.gfx === 'high' ? 'low' : 'high'; GFX_LOW = s.gfx === 'low'; resize(); }
      else if ('aim' in b.dataset) s.aim = s.aim === 'swipe' ? 'point' : 'swipe';
      else if ('reset' in b.dataset) {
        if (b.textContent !== 'TAP AGAIN TO CONFIRM') { b.textContent = 'TAP AGAIN TO CONFIRM'; return; }
        G.wiped = true; localStorage.removeItem(SAVE_KEY); location.reload(); return;
      } else return;
      tap(); persist(); this.settings();
    });
    $('sens').oninput = e => { s.sens = +e.target.value; persist(); };
  },
  perks(opts, cb) {
    this.open(`<h2>CHOOSE A PERK</h2><div class="perks">${opts.map((p, i) => `<button class="perk" data-i="${i}"><em>${p.icon}</em><b>${p.name}</b><small>${p.desc}</small><i>${run.perks[p.id] ? 'LV ' + (run.perks[p.id] + 1) : 'NEW'}</i></button>`).join('')}</div>`, e => {
      const b = e.target.closest('.perk'); if (!b) return;
      Sfx.play('perk'); this.close(); cb(opts[+b.dataset.i]);
    });
  },
  pauseMenu() {
    this.open(`<h2>PAUSED</h2><div class="col"><button class="fight" data-resume>RESUME</button><button class="btn" data-quit>QUIT RUN</button></div>`, e => {
      if (e.target.closest('[data-resume]')) { tap(); this.close(); resume(); }
      else if (e.target.closest('[data-quit]')) { tap(); quitRun(); }
    });
  },
  result(d) {
    $('hud').classList.add('hidden');
    const time = `${Math.floor(d.time / 60)}:${String(Math.floor(d.time % 60)).padStart(2, '0')}`;
    const cmp = d.record ? '<em class="rec">NEW BEST!</em>' : d.best ? `<em>BEST ${d.best}${d.endless ? '' : '%'}</em>` : '';
    const main = d.won ? `<div><b>${time}</b><small>TIME</small></div>`
      : d.endless ? `<div><b>${d.wave}</b><small>WAVE</small>${cmp}</div>` : `<div><b>${d.pct}%</b><small>PROGRESS</small>${cmp}</div>`;
    this.open(`<h2 class="${d.won ? 'win' : 'die'}">${d.won ? d.eraName.toUpperCase() + ' CLEARED!' : 'YOU DIED'}</h2>
      <p class="quip">${d.won ? 'History has been rewritten.' : pick(QUIPS)}</p>
      <div class="stats">${main}<div><b>${d.kills}</b><small>KILLS</small></div><div><b>${d.heads}</b><small>HEADSHOT KILLS</small></div><div><b>${coinIc}${fmt(d.coins)}</b><small>EARNED</small><em>TOTAL ${fmt(d.total)}</em></div></div>
      ${d.next ? `<p class="unlock">🔓 ${d.next} unlocked</p>` : ''}
      ${Platform.ads && d.coins >= 1 ? `<button class="btn gold" data-x2>▶ WATCH AD: +${fmt(d.coins)} COINS</button>` : ''}
      <button class="fight" data-go>${d.won ? 'CONTINUE' : 'UPGRADE & RETRY'}</button>`, e => {
      const x2 = e.target.closest('[data-x2]');
      if (x2) { tap(); x2.disabled = true; Platform.ad('rewarded', ok => { if (ok) { save.coins += d.coins; persist(); x2.textContent = 'COINS DOUBLED!'; } else x2.remove(); }); }
      else if (e.target.closest('[data-go]')) { tap(); const b = e.target.closest('[data-go]'); b.disabled = true; Platform.ad('midgame', backToMenu); }
    });
  },
};

boot();
