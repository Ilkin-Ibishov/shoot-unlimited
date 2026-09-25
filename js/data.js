'use strict';
// All content + balance knobs live here. Tweak numbers, not code.

const VIEW_H = 540, TILE = 20, GRAV = 1600, WAVES = 10, NADE_CD = 9, RD_LIFE = 9;

// combat pacing + economy knobs; measure changes with `node tools/sim.js`
const BAL = {
  waveBase: 7, waveGrow: 3, bossEscort: 10,            // enemies per wave = base + grow * wave
  spawnGap: 1.0, spawnGapWave: 0.06, spawnGapMin: 0.35, // seconds between spawns
  waveHp: 0.13, waveDmg: 0.04, eraDmg: 0.45,          // per-wave / per-era enemy scaling
  meleeGap: 1.0, bossGap: 1.4,                        // enemy melee attack interval
  kickDmg: 10, kickCd: 3.5, kickKnock: 700,           // auto-kick (x gun damage upgrade)
  nadeDmg: 40, knock: 0.25,                           // grenade (x gun damage upgrade), bullet knockback factor
  exploderBlast: 1.5,                                 // a bomber's blast hurts nearby enemies for N x walker HP (was 3: one pop cleared the wave)
  fireRate: 0.5,                                      // global multiplier on every weapon's fire rate (laser is continuous, unaffected)
  retreat: 32,                                        // player backpedal speed during a wave (units/s)
  perkEvery: 3,                                       // perk pick after every N waves
  bulletDmg: 0.7,                                     // global multiplier on every weapon's damage (and laser dps)
  waveCoin: 2, eraCoin: 60, comboCoin: 0.03, comboMax: 10,
};

// character upgrades (global): level -> value
const UP = {
  income: l => 1 + 0.08 * l,
  hp:     l => 100 + 15 * l,
  crit:   l => 0.02 * l,
  head:   l => 2 + 0.15 * l,
};
const UPGRADES = [
  { id: 'income', name: 'Income',      icon: '💰', color: '#3fc15b', base: 25, growth: 1.36, max: 30, show: l => 'x' + UP.income(l).toFixed(2) },
  { id: 'hp',     name: 'Armor',       icon: '🛡️', color: '#3a8ee6', base: 15, growth: 1.3, max: 30, show: l => UP.hp(l) + ' HP' },
  { id: 'crit',   name: 'Crit Chance', icon: '🎯', color: '#e84a5f', base: 40, growth: 1.38, max: 20, show: l => Math.round(UP.crit(l) * 100) + '%' },
  { id: 'head',   name: 'Headshot',    icon: '💀', color: '#6b7a90', base: 35, growth: 1.36,  max: 20, show: l => 'x' + UP.head(l).toFixed(2) },
];
const upCost = (u, l) => Math.round(u.base * Math.pow(u.growth, l));

// weapon upgrades: every gun levels on its own (L0 -> L10 is ~2.8x sustained dps). Level-l price of stat u on
// gun w = w.up * u.k * growth^l, so each gun's upgrades cost what the era it belongs to pays.
const WUP = {
  fx: { dmg: l => 1 + 0.08 * l, rate: l => 1 + 0.04 * l, mag: l => 1 + 0.1 * l, reload: l => 1 / (1 + 0.05 * l) },
  list: [
    { id: 'dmg',    name: 'Damage',    icon: '💥', color: '#f07b1d', k: 1,   growth: 1.27, max: 10, show: l => 'x' + WUP.fx.dmg(l).toFixed(2) },
    { id: 'rate',   name: 'Fire Rate', icon: '⏱️', color: '#f2c21b', k: 1,   growth: 1.27, max: 10, show: l => '+' + 4 * l + '%' },
    { id: 'mag',    name: 'Magazine',  icon: '🔋', color: '#9b6bea', k: 0.7, growth: 1.27, max: 10, show: l => '+' + 10 * l + '%' },
    { id: 'reload', name: 'Reload',    icon: '🔄', color: '#1fb5b0', k: 0.7, growth: 1.27, max: 10, show: l => (l ? '-' : '') + Math.round((1 - WUP.fx.reload(l)) * 100) + '%' },
  ],
  cost: (w, u) => w.up * u.k,
};
const wupCost = (w, u, l) => Math.round(WUP.cost(w, u) * Math.pow(u.growth, l));

// era = index of the era that must be unlocked before it can be bought
const WEAPONS = [
  { id: 'pistol',  name: 'Pistol',          desc: 'Reliable. Boring. Yours.',             dmg: 10, rate: 3,   mag: 6,  reload: 1.1, spread: 0.012, pellets: 1, speed: 1800, pierce: 0, knock: 220, price: 0,     era: 0, tier: 1, up: 3, len: 20, w: 5,  color: '#2b2f3a', sfx: 'pistol',  shake: 2 },
  { id: 'smg',     name: 'SMG',             desc: 'Spray and pray.',                      dmg: 6,  rate: 10,  mag: 30, reload: 1.6, spread: 0.05,  pellets: 1, speed: 1900, pierce: 0, knock: 120, price: 900,   era: 0, tier: 2, up: 12, len: 30, w: 6,  color: '#3a3f4b', sfx: 'smg',     shake: 1.5 },
  { id: 'shotgun', name: 'Shotgun',         desc: '7 pellets, huge knockback.',           dmg: 14, rate: 1.2, mag: 5,  reload: 2.0, spread: 0.2,   pellets: 7, speed: 1700, pierce: 0, knock: 500, price: 1600,  era: 1, tier: 4, up: 60, len: 42, w: 6,  color: '#5a3b22', sfx: 'shotgun', shake: 6 },
  { id: 'rifle',   name: 'Assault Rifle',   desc: 'Fast, accurate, dependable.',          dmg: 30, rate: 8,   mag: 25, reload: 1.8, spread: 0.022, pellets: 1, speed: 2200, pierce: 0, knock: 200, price: 4000,  era: 2, tier: 8, up: 100, len: 44, w: 6,  color: '#2f3b2a', sfx: 'rifle',   shake: 2.5 },
  { id: 'sniper',  name: 'Sniper',          desc: 'Pierces 3 enemies. One shot, one ragdoll.', dmg: 380, rate: 1.3, mag: 6, reload: 2.0, spread: 0, pellets: 1, speed: 3600, pierce: 3, knock: 650, price: 6500,  era: 3, tier: 16, up: 150, len: 60, w: 5,  color: '#1f2530', sfx: 'sniper',  shake: 7 },
  { id: 'rocket',  name: 'Rocket Launcher', desc: 'Explodes. Obviously.',                 dmg: 1300, rate: 0.8, mag: 3,  reload: 2.2, spread: 0.01,  pellets: 1, speed: 900,  pierce: 0, knock: 0, explode: 140, price: 10000, era: 4, tier: 30, up: 260, len: 54, w: 11, color: '#4c5a2e', sfx: 'rocket', shake: 8 },
  { id: 'laser',   name: 'Laser Beam',      desc: 'Continuous beam, pierces all. Overheats.', dps: 600, heat: 3.2, reload: 1.6, rate: 1, mag: 1, beam: true, spread: 0, pellets: 1, speed: 0, pierce: 99, knock: 40, price: 13000, era: 5, tier: 60, up: 450, len: 45, w: 8, color: '#1b2a3a', sfx: 'laser', shake: 0 },
];

// in-run roguelite perks
const PERKS = [
  { id: 'pierce',    icon: '🏹', name: 'Piercing Rounds', desc: 'Bullets pass through +1 enemy',     max: 2 },
  { id: 'ricochet',  icon: '🎱', name: 'Ricochet',        desc: 'Bullets bounce off the ground',     max: 2 },
  { id: 'twin',      icon: '✌️', name: 'Twin Shot',       desc: '+1 bullet per shot (-40% dmg)',     max: 2 },
  { id: 'explosive', icon: '💥', name: 'Explosive Tips',  desc: '8% of hits explode',                max: 2 },
  { id: 'homing',    icon: '🧲', name: 'Smart Rounds',    desc: 'Bullets curve toward heads',        max: 2 },
  { id: 'chain',     icon: '⚡', name: 'Tesla Coil',      desc: 'Hits arc to a nearby enemy (20%)',  max: 2 },
  { id: 'frost',     icon: '❄️', name: 'Cryo Rounds',     desc: 'Hits slow enemies by 45%',          max: 1 },
  { id: 'fire',      icon: '🔥', name: 'Incendiary',      desc: 'Hits set enemies on fire',          max: 2 },
  { id: 'hunter',    icon: '💀', name: 'Headhunter',      desc: 'Headshots deal +25% damage',        max: 2 },
  { id: 'vamp',      icon: '🧛', name: 'Vampire',         desc: 'Kills heal 2% HP',                  max: 3 },
  { id: 'quick',     icon: '🤹', name: 'Quick Hands',     desc: 'Reload 35% faster',                 max: 3 },
  { id: 'bigmag',    icon: '🥁', name: 'Drum Mag',        desc: '+50% magazine size',                max: 3 },
  { id: 'rage',      icon: '😡', name: 'Adrenaline',      desc: '+40% fire rate below 50% HP',       max: 2 },
  { id: 'greed',     icon: '🤑', name: 'Greed',           desc: '+35% coins this run',               max: 3 },
  { id: 'focus',     icon: '⏳', name: 'Chrono Focus',    desc: 'Bullet time charges 2x faster',     max: 2 },
  { id: 'medkit',    icon: '➕', name: 'Field Medic',     desc: 'Heal 50% and +25 max HP',           max: 9 },
];

// enemy archetypes; `from` = first wave index they appear in, w = spawn weight
const ARCH = {
  walker:   { hp: 28,  speed: 100,  dmg: 12, coin: 2,  from: 0, w: 5 },
  runner:   { hp: 16,  speed: 190, dmg: 9,  coin: 2,  from: 1, w: 3 },
  flyer:    { hp: 12,   speed: 135,  dmg: 10,  coin: 3,  from: 2, w: 2 },
  ranged:   { hp: 22,  speed: 95,  dmg: 10,  coin: 4,  from: 3, w: 2 },
  exploder: { hp: 18,  speed: 160,  dmg: 35, coin: 4,  from: 4, w: 1.4 },
  shield:   { hp: 36,  speed: 85,  dmg: 14, coin: 6,  from: 5, w: 1.3, shieldHp: 90 },
  brute:    { hp: 150, speed: 75,  dmg: 30, coin: 10, from: 6, w: 0.9, scale: 1.4 },
  boss:     { hp: 900, speed: 62,  dmg: 40, coin: 120, scale: 2.2 },
};

const PROJ = {
  goo:    { speed: 330, g: 900, r: 8, color: '#8fd14f' },
  rock:   { speed: 320, g: 900, r: 9, color: '#8a8580' },
  arrow:  { speed: 560, g: 500, r: 6, color: '#6b4a2b', line: 1 },
  orb:    { speed: 260, g: 0,   r: 9, color: '#b36bff' },
  bullet: { speed: 650, g: 0,   r: 5, color: '#ffd34d', line: 1 },
  laser:  { speed: 560, g: 0,   r: 6, color: '#39e1ff', line: 1 },
  bomb:   { speed: 300, g: 900, r: 9, color: '#222', explode: 90 },
};

// look keys: k skin, s shirt, p pants, a forearm (defaults to s), sh shield
const ERAS = [
  { name: 'Zombie City', year: '2026 AD', hp: 0.7, coin: 1, bg: 'city', cloud: 0.75,
    sky: ['#7fa9c6', '#c5dbe8'], layers: ['#9dbbd1', '#7aa0bb'], ground: '#c6c9cd', line: '#aeb2b8', edge: '#8f949b', win: 'rgba(255,255,255,0.10)',
    foes: {
      walker:   { name: 'Zombie',      deco: 'torn', face: 'zombie', arms: 'zombie', look: { k: '#8fd14f', s: '#f0f0f0', p: '#2e3445' } },
      runner:   { name: 'Sprinter',    deco: 'torn', face: 'zombie', legs: 'run',    look: { k: '#9ad65a', s: '#d9534f', p: '#394055' } },
      flyer:    { name: 'Gargoyle',    rig: 'flyer', fly: 'gargoyle',   look: { k: '#8e949c', s: '#767c85', a: '#5f646c' }, blood: '#666' },
      ranged:   { name: 'Spitter',     deco: 'torn', face: 'zombie', arms: 'aim',    look: { k: '#b5de6a', s: '#6d8b3c', p: '#2e3445' }, proj: 'goo' },
      exploder: { name: 'Bloater',     deco: 'torn', face: 'zombie', arms: 'zombie', look: { k: '#c9e56e', s: '#e5dca0', p: '#3a3f55' }, scale: 1.15, blood: '#9acd32' },
      shield:   { name: 'Riot Zombie', deco: 'armor', face: 'zombie', arms: 'shield', look: { k: '#8fd14f', s: '#223a5e', p: '#1b2436', sh: '#5d6d80' }, hat: 'helmet', held: 'shield' },
      brute:    { name: 'Tank',        deco: 'torn', face: 'zombie', arms: 'zombie', look: { k: '#78b843', s: '#8b8b8b', p: '#3b3b3b' } },
      boss:     { name: 'Patient Zero', deco: 'torn', face: 'zombie', arms: 'zombie', look: { k: '#6aa935', s: '#f4f4f4', p: '#2e3445' }, moves: ['summon', 'charge'] },
    } },
  { name: 'Jurassic', year: '65M BC', hp: 1.8, coin: 1.5, bg: 'jungle', sun: '#ffd27a', cloud: 0.6, tuft: '#5f8a34',
    sky: ['#f3a35c', '#fbe0a6'], layers: ['#d6a174', '#94704f'], ground: '#b89a74', line: '#a08463', edge: '#7d6448',
    foes: {
      walker:   { name: 'Caveman',     deco: 'fur', arms: 'hold', look: { k: '#d9a066', s: '#8a5a2b', p: '#6b4423' }, hat: 'hair', held: 'club' },
      runner:   { name: 'Raptor',      rig: 'raptor', scale: 1.2, look: { k: '#6f9a3c', s: '#5d8a33', p: '#4a6e28' } },
      flyer:    { name: 'Pterodactyl', rig: 'flyer', fly: 'ptero', look: { k: '#a0674a', s: '#8e5a3f', a: '#7a4b33' } },
      ranged:   { name: 'Rock Thrower', deco: 'fur', arms: 'aim', look: { k: '#d9a066', s: '#7a4f2a', p: '#5a3a1d' }, hat: 'hair', proj: 'rock' },
      exploder: { name: 'Firestarter', deco: 'fur', legs: 'run', look: { k: '#d9a066', s: '#a33', p: '#5a3a1d' }, hat: 'hair', held: 'bomb' },
      shield:   { name: 'Stone Guard', deco: 'fur', arms: 'shield', look: { k: '#c98f5a', s: '#6b5a4a', p: '#4a3b2c', sh: '#8d8a84' }, hat: 'hair', held: 'shield' },
      brute:    { name: 'Bonecrusher', rig: 'raptor', scale: 1.25, look: { k: '#6d7f9a', s: '#5b6e8a', p: '#4a5a70' } },
      boss:     { name: 'T-Rex',       rig: 'raptor', scale: 1.35, look: { k: '#7a5a3a', s: '#6b4d31', p: '#553b25' }, moves: ['charge', 'summon'], proj: 'rock' },
    } },
  { name: 'Dark Ages', year: '1350 AD', hp: 3, coin: 2.2, bg: 'castle', sun: '#ffe3c2', cloud: 0.5, tuft: '#5d7d44',
    sky: ['#6f5a8f', '#d7a9b8'], layers: ['#9d88ae', '#6a5780'], ground: '#9d9a8c', line: '#88857a', edge: '#6b6960',
    foes: {
      walker:   { name: 'Footman',     deco: 'armor', arms: 'hold', look: { k: '#e0b48a', s: '#8a2f2f', p: '#3a3a48' }, hat: 'helmet', held: 'sword' },
      runner:   { name: 'Rogue',       deco: 'belt', legs: 'run', look: { k: '#e0b48a', s: '#2f4f3a', p: '#2a2a2a' }, hat: 'hood' },
      flyer:    { name: 'Bat',         rig: 'flyer', fly: 'bat', look: { k: '#3b2f45', s: '#2e2438', a: '#221a2b' } },
      ranged:   { name: 'Archer',      deco: 'fur', arms: 'aim', look: { k: '#e0b48a', s: '#3f6b3a', p: '#4a3b2c' }, hat: 'hood', held: 'bow', proj: 'arrow' },
      exploder: { name: 'Powder Monk', deco: 'robe', legs: 'run', look: { k: '#e0b48a', s: '#6b4a2b', p: '#6b4a2b' }, hat: 'hood', held: 'bomb' },
      shield:   { name: 'Knight',      deco: 'armor', arms: 'shield', look: { k: '#b8c0c8', s: '#9aa3ad', p: '#6d7680', sh: '#b33a3a' }, hat: 'helmet', held: 'shield' },
      brute:    { name: 'Ogre',        deco: 'fur', arms: 'hold', look: { k: '#7a9a4a', s: '#6b4a2b', p: '#4a3320' }, hat: 'horns', held: 'club' },
      boss:     { name: 'Black Knight', deco: 'armor', arms: 'hold', look: { k: '#2a2a30', s: '#1f1f25', p: '#15151a' }, hat: 'helmet', held: 'sword', moves: ['charge', 'throw'], proj: 'arrow' },
    } },
  { name: 'Ancient Egypt', year: '1300 BC', hp: 8, coin: 3.1, bg: 'desert', sun: '#fff3c4', cloud: 0.5,
    sky: ['#e9b75f', '#f8e2b0'], layers: ['#e2c08a', '#c19a60'], ground: '#d9c08f', line: '#c4aa78', edge: '#a88f5f',
    foes: {
      walker:   { name: 'Mummy',       deco: 'wrap', face: 'zombie', arms: 'zombie', look: { k: '#e2d6b5', s: '#d8cba6', p: '#cbbd96' }, hat: 'bandage', blood: '#c9b88a' },
      runner:   { name: 'Jackal',      rig: 'raptor', look: { k: '#3a3530', s: '#2f2a26', p: '#25211e' } },
      flyer:    { name: 'Vulture',     rig: 'flyer', fly: 'vulture', look: { k: '#e8d8c8', s: '#5a4638', a: '#4a382c' } },
      ranged:   { name: 'Cultist',     deco: 'robe', arms: 'aim', look: { k: '#b07a4a', s: '#e9e0c9', p: '#e9e0c9' }, hat: 'hood', proj: 'orb' },
      exploder: { name: 'Scarab Carrier', deco: 'belt', legs: 'run', look: { k: '#b07a4a', s: '#2b6f6a', p: '#e9e0c9' }, held: 'bomb' },
      shield:   { name: 'Anubis Guard', deco: 'armor', arms: 'shield', look: { k: '#1f1f1f', s: '#c9a23a', p: '#1f1f1f', sh: '#c9a23a' }, hat: 'anubis', held: 'shield' },
      brute:    { name: 'Stone Golem', deco: 'stone', arms: 'zombie', look: { k: '#9a8f7f', s: '#8a7f6f', p: '#7a6f5f' }, blood: '#8a7f70' },
      boss:     { name: 'Pharaoh',     deco: 'royal', arms: 'aim', look: { k: '#e2d6b5', s: '#d4af37', p: '#1f4e8c' }, hat: 'crown', moves: ['summon', 'throw'], proj: 'orb' },
    } },
  { name: 'Wild West', year: '1880 AD', hp: 13, coin: 4.3, bg: 'west', sun: '#ffdd88', cloud: 0.55, tuft: '#8a7a3a',
    sky: ['#e8793f', '#f6c77a'], layers: ['#d08a5c', '#a0603d'], ground: '#c9955e', line: '#b3814f', edge: '#8f6538',
    foes: {
      walker:   { name: 'Undead Cowboy', deco: 'vest', face: 'zombie', arms: 'zombie', look: { k: '#a7c48a', s: '#8a5a3a', p: '#3f4b6b' }, hat: 'cowboy' },
      runner:   { name: 'Bandit',      deco: 'vest', legs: 'run', look: { k: '#d9a577', s: '#6b2f2f', p: '#2f2f3a' }, hat: 'bandana' },
      flyer:    { name: 'Buzzard',     rig: 'flyer', fly: 'vulture', look: { k: '#c9563f', s: '#4a3a2e', a: '#3a2c22' } },
      ranged:   { name: 'Gunslinger',  deco: 'vest', arms: 'aim', look: { k: '#d9a577', s: '#3a4a6b', p: '#2f2f3a' }, hat: 'cowboy', held: 'gun', proj: 'bullet' },
      exploder: { name: 'Dynamite Dan', deco: 'belt', legs: 'run', look: { k: '#d9a577', s: '#b33', p: '#3a2f2a' }, hat: 'cowboy', held: 'bomb' },
      shield:   { name: 'Barricader',  deco: 'vest', arms: 'shield', look: { k: '#d9a577', s: '#5a5a5a', p: '#2f2f3a', sh: '#8a5a2b' }, hat: 'cowboy', held: 'shield' },
      brute:    { name: 'Big Ox',      deco: 'belt', look: { k: '#c98f5a', s: '#4a6b8a', p: '#3a3a3a' }, hat: 'cowboy' },
      boss:     { name: 'Outlaw King', deco: 'vest', arms: 'aim', look: { k: '#d9a577', s: '#1f1f1f', p: '#1f1f1f' }, hat: 'cowboy', held: 'gun', moves: ['throw', 'summon'], proj: 'bullet' },
    } },
  { name: 'Pirate Cove', year: '1715 AD', hp: 20, coin: 5.8, bg: 'sea', sun: '#fff6d0', cloud: 0.85,
    sky: ['#58b4c9', '#bfe8ef'], layers: ['#8ccbd7', '#4f9db0'], ground: '#d8c49a', line: '#c2ad82', edge: '#a38e62',
    foes: {
      walker:   { name: 'Drowned Sailor', deco: 'torn', face: 'zombie', arms: 'zombie', look: { k: '#8fbfa8', s: '#3a5a8a', p: '#6b4a2b' }, hat: 'bandana' },
      runner:   { name: 'Cutthroat',   deco: 'sash', legs: 'run', arms: 'hold', look: { k: '#d9a577', s: '#b33', p: '#2a2a2a' }, hat: 'bandana', held: 'sword' },
      flyer:    { name: 'Parrot',      rig: 'flyer', fly: 'parrot', look: { k: '#2fbf4f', s: '#e63b2e', a: '#2f7fe6' } },
      ranged:   { name: 'Musketeer',   deco: 'coat', arms: 'aim', look: { k: '#d9a577', s: '#2f3f6b', p: '#e8e2d0' }, hat: 'tricorn', held: 'gun', proj: 'bullet' },
      exploder: { name: 'Powder Monkey', deco: 'sash', legs: 'run', look: { k: '#d9a577', s: '#6b4a2b', p: '#6b4a2b' }, held: 'bomb' },
      shield:   { name: 'Boarder',     deco: 'sash', arms: 'shield', look: { k: '#d9a577', s: '#5a3a2a', p: '#2a2a2a', sh: '#7a5230' }, hat: 'bandana', held: 'shield' },
      brute:    { name: 'First Mate',  deco: 'stripes', look: { k: '#c98f5a', s: '#f0f0f0', p: '#2a2a3a' }, hat: 'tricorn' },
      boss:     { name: 'Captain Dreadtide', deco: 'coat', arms: 'hold', look: { k: '#d9a577', s: '#8a1f1f', p: '#1f1f1f' }, hat: 'tricorn', held: 'sword', moves: ['summon', 'throw', 'charge'], proj: 'bomb' },
    } },
  { name: 'Neon Future', year: '2199 AD', hp: 40, coin: 7.6, bg: 'future', sun: '#ff4fd8', neon: true,
    sky: ['#1a1036', '#4a2a6b'], layers: ['#3a2a5e', '#271c47'], ground: '#3b3f58', line: '#50568a', edge: '#6b73c0', win: 'rgba(57,225,255,0.35)',
    foes: {
      walker:   { name: 'Droid',       deco: 'robot', arms: 'zombie', look: { k: '#aab4c4', s: '#6b7a90', p: '#4a5566' }, hat: 'visor', blood: '#39e1ff' },
      runner:   { name: 'Cyber Hound', rig: 'raptor', look: { k: '#8a94a6', s: '#5a6478', p: '#3a4254' }, blood: '#39e1ff' },
      flyer:    { name: 'Drone',       rig: 'flyer', fly: 'drone', look: { k: '#39e1ff', s: '#4a5566', a: '#2a3140' }, blood: '#39e1ff' },
      ranged:   { name: 'Laser Trooper', deco: 'robot', arms: 'aim', look: { k: '#dfe6ee', s: '#e0e6ee', p: '#3a4254' }, hat: 'visor', held: 'gun', proj: 'laser', blood: '#39e1ff' },
      exploder: { name: 'Kamikaze Bot', deco: 'robot', legs: 'run', look: { k: '#ff5a5a', s: '#4a5566', p: '#2a3140' }, hat: 'visor', held: 'bomb', blood: '#39e1ff' },
      shield:   { name: 'Aegis Unit',  deco: 'robot', arms: 'shield', look: { k: '#aab4c4', s: '#2a6bb3', p: '#1f2a44', sh: '#39e1ff' }, hat: 'visor', held: 'shield', blood: '#39e1ff' },
      brute:    { name: 'Heavy Mech',  deco: 'robot', arms: 'zombie', look: { k: '#7a8496', s: '#5a6478', p: '#3a4254' }, hat: 'visor', blood: '#39e1ff' },
      boss:     { name: 'Overlord Mk.IX', deco: 'robot', arms: 'aim', look: { k: '#c0c8d4', s: '#b33a6b', p: '#2a3140' }, hat: 'visor', held: 'gun', moves: ['throw', 'summon', 'charge'], proj: 'laser', blood: '#39e1ff' },
    } },
];

const QUIPS = [
  'That went exactly as expected.',
  'History repeats. So do you.',
  'You learned nothing. But you got coins.',
  'The past fights back.',
  'Time travel is harder than it looks.',
  'Death: 1. You: 0. Coins: some.',
  'Maybe next time. Probably not.',
  'Have you tried shooting their heads?',
];
