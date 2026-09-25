'use strict';
// Rendering: parallax backgrounds, weather, ground, characters, effects.

// ===== background art (procedural parallax silhouettes) =====
function hills(g, W, H, base, amp, r) {
  const a = r() * 6, b = r() * 6;
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, base - amp * (0.6 * Math.sin(x / W * TAU * 2 + a) + 0.4 * Math.sin(x / W * TAU * 5 + b)));
  g.lineTo(W, H); g.fill();
}
const rep = (W, x, w, fn) => { fn(x); if (x + w > W) fn(x - W); if (x < 0) fn(x + W); };
// --- vegetation silhouettes (single color; the layer adds haze). Params are pre-rolled so
// wrap-around copies drawn by rep() are identical.
const bez = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
function strip(g, pts, w) { // closed polygon along a polyline: w(i) = [leftOffset, rightOffset]
  const A = [], B = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dy = q[1] - o[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, [l, rr] = w(i);
    A.push([p[0] + nx * l, p[1] + ny * l]); B.push([p[0] - nx * rr, p[1] - ny * rr]);
  }
  g.beginPath(); A.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
  for (let i = B.length - 1; i >= 0; i--) g.lineTo(B[i][0], B[i][1]);
  g.closePath(); g.fill();
}
function palmSpec(r, h) {
  const n = 7 + (r() * 3 | 0), fr = [];
  for (let i = 0; i < n; i++) fr.push({ a: -Math.PI + 0.2 + (i / (n - 1)) * (Math.PI - 0.4) + (r() - 0.5) * 0.3, L: h * (0.32 + r() * 0.14), droop: 0.3 + r() * 0.25 });
  return { lean: (r() - 0.5) * 0.45 * h, fr };
}
function palm(g, x, base, h, sp) {
  const tx = x + sp.lean, ty = base - h, cx = x + sp.lean * 0.1, cy = base - h * 0.55, N = 14, pts = [];
  for (let i = 0; i <= N; i++) pts.push([bez(x, cx, tx, i / N), bez(base, cy, ty, i / N)]);
  strip(g, pts, i => { const w = lerp(6.5, 2.8, i / N) + (i % 2) * 0.7; return [w, w]; }); // tapered trunk with ring bumps
  for (const f of sp.fr) frond(g, tx, ty, f);
  g.beginPath(); for (const [ox, oy] of [[-3.5, 3], [3, 4], [0, 6.5]]) { g.moveTo(tx + ox + 3.5, ty + oy); g.arc(tx + ox, ty + oy, 3.5, 0, TAU); } g.fill();
}
function frond(g, x, y, f) { // arched, drooping leaf; the downward edge is serrated into leaflets
  const ca = Math.cos(f.a), sa = Math.sin(f.a), L = f.L;
  const ex = x + ca * L, ey = y + sa * L + L * f.droop * (0.3 + 0.7 * Math.abs(ca));
  const qx = x + ca * L * 0.55, qy = y + sa * L * 0.55 - L * 0.2, M = 14, pts = [];
  for (let i = 0; i <= M; i++) pts.push([bez(x, qx, ex, i / M), bez(y, qy, ey, i / M)]);
  const down = (ex - x) >= 0 ? 1 : -1, W = L * 0.13; // +1: the +normal side faces the ground
  strip(g, pts, i => {
    const w = W * Math.sin(Math.PI * i / M) ** 0.7, leaf = w * (i % 2 ? 1.5 : 0.5), top = w * 0.35;
    return down > 0 ? [leaf, top] : [top, leaf];
  });
}
function pine(g, x, base, h, n) { // trunk + n drooping tiers with notched sides
  const W = h * 0.3, yb = k => base - h + h * 0.86 * (k + 1) / n, hw = k => W * (0.3 + 0.7 * (k + 1) / n);
  g.fillRect(x - h * 0.03, base - h * 0.16, h * 0.06, h * 0.16 + 6);
  g.beginPath(); g.moveTo(x, base - h);
  for (let k = 0; k < n; k++) { g.lineTo(x + hw(k), yb(k) + h * 0.025); if (k < n - 1) g.lineTo(x + hw(k) * 0.4, yb(k) - h * 0.04); }
  for (let k = n - 1; k >= 0; k--) { g.lineTo(x - hw(k), yb(k) + h * 0.025); if (k > 0) g.lineTo(x - hw(k - 1) * 0.4, yb(k - 1) - h * 0.04); }
  g.closePath(); g.fill();
}
const blobSpec = (r, n, spread, rMin, rMax) => Array.from({ length: n }, (_, i) => [((i + 0.5) / n - 0.5) * spread + (r() - 0.5) * 6, (r() - 0.5) * 8, rMin + r() * (rMax - rMin)]);
function blob(g, x, y, lobes) { // union of circles (same winding -> clean silhouette)
  g.beginPath(); for (const [ox, oy, rr] of lobes) { g.moveTo(x + ox + rr, y + oy); g.arc(x + ox, y + oy, rr, 0, TAU); } g.fill();
}
function oak(g, x, base, h, lobes) {
  g.beginPath(); g.moveTo(x - h * 0.06, base + 6); g.quadraticCurveTo(x - h * 0.02, base - h * 0.3, x - h * 0.035, base - h * 0.58);
  g.lineTo(x + h * 0.035, base - h * 0.58); g.quadraticCurveTo(x + h * 0.02, base - h * 0.3, x + h * 0.06, base + 6); g.fill();
  blob(g, x, base - h * 0.66, lobes.map(([ox, oy, rr]) => [ox * h, oy * h, rr * h]));
}
const oakSpec = r => [[0, -0.16, 0.2], [-0.19, 0, 0.16], [0.19, -0.02, 0.17], [-0.08, 0.09, 0.15], [0.1, 0.1, 0.14]].map(([a, b, c]) => [a + (r() - 0.5) * 0.06, b + (r() - 0.5) * 0.06, c * (0.85 + r() * 0.3)]);
const PAINT = {
  city(g, li, r, W, H, E) {
    for (let x = -30; x < W;) {
      const w = 55 + r() * 110, h = (li ? 90 : 170) + r() * (li ? 150 : 200), top = H - 70 - h, tower = r() < 0.35, tx = w * (0.2 + r() * 0.4);
      rep(W, x, w, X => {
        g.fillRect(X, top, w, H);
        if (tower) { g.fillRect(X + tx + 3, top - 16, 3, 16); g.fillRect(X + tx + 19, top - 16, 3, 16); g.fillRect(X + tx, top - 38, 25, 24); g.beginPath(); g.moveTo(X + tx - 3, top - 38); g.lineTo(X + tx + 12.5, top - 50); g.lineTo(X + tx + 28, top - 38); g.fill(); }
        if (li) { const f = g.fillStyle; g.fillStyle = E.win; for (let wy = top + 14; wy < H - 80; wy += 22) for (let wx = X + 8; wx < X + w - 12; wx += 16) if (Math.random() < 0.6) g.fillRect(wx, wy, 7, 10); g.fillStyle = f; }
      });
      x += w + r() * 16;
    }
  },
  jungle(g, li, r, W, H) {
    if (!li) {
      for (let i = 0; i < 2; i++) { const x = r() * W, w = 260 + r() * 200, h = 220 + r() * 90; rep(W, x - w, w * 2, X => { g.beginPath(); g.moveTo(X, H); g.lineTo(X + w * 0.85, H - 70 - h); g.lineTo(X + w * 1.15, H - 70 - h); g.lineTo(X + w * 2, H); g.fill(); }); }
      hills(g, W, H, H - 110, 30, r);
    } else {
      hills(g, W, H, H - 80, 22, r);
      for (let x = 20; x < W; x += 90 + r() * 140) { const h = 110 + r() * 90, sp = palmSpec(r, h); rep(W, x - h * 0.7, h * 1.4, X => palm(g, X + h * 0.7, H - 70, h, sp)); }
      for (let x = 0; x < W; x += 45 + r() * 55) { const b = blobSpec(r, 3 + (r() * 2 | 0), 44, 9, 18); rep(W, x - 40, 80, X => blob(g, X + 40, H - 72, b)); }
    }
  },
  castle(g, li, r, W, H) {
    if (!li) {
      hills(g, W, H, H - 150, 40, r);
      for (let i = 0; i < 2; i++) {
        const x = 150 + r() * (W - 500), base = H - 160;
        g.fillRect(x, base - 90, 260, 90 + 200);
        for (const tx of [x - 20, x + 110, x + 240]) { const th = 150 + r() * 60; g.fillRect(tx, base - th, 40, th); g.beginPath(); g.moveTo(tx - 6, base - th); g.lineTo(tx + 20, base - th - 45); g.lineTo(tx + 46, base - th); g.fill(); }
        for (let cx = x; cx < x + 260; cx += 20) g.fillRect(cx, base - 102, 11, 12);
      }
    } else {
      hills(g, W, H, H - 90, 25, r);
      for (let x = 10; x < W; x += 30 + r() * 55) {
        const h = 75 + r() * 80;
        if (r() < 0.22) { const lb = oakSpec(r); rep(W, x - h * 0.45, h * 0.9, X => oak(g, X + h * 0.45, H - 82, h * 0.85, lb)); }
        else { const n = 4 + (r() * 2 | 0); rep(W, x - h * 0.3, h * 0.6, X => pine(g, X + h * 0.3, H - 82, h, n)); }
      }
    }
  },
  desert(g, li, r, W, H) {
    if (!li) {
      hills(g, W, H, H - 110, 18, r);
      for (let i = 0; i < 3; i++) { const x = r() * W, w = 160 + r() * 200; rep(W, x - w, w * 2, X => { g.beginPath(); g.moveTo(X, H - 100); g.lineTo(X + w, H - 100 - w * 0.9); g.lineTo(X + w * 2, H - 100); g.fill(); }); }
    } else {
      hills(g, W, H, H - 80, 16, r);
      for (let x = 60; x < W; x += 160 + r() * 220) {
        if (r() < 0.5) { const h = 120 + r() * 80; g.fillRect(x, H - 75 - h, 20, h); g.beginPath(); g.moveTo(x - 2, H - 75 - h); g.lineTo(x + 10, H - 95 - h); g.lineTo(x + 22, H - 75 - h); g.fill(); }
        else { const h = 90 + r() * 70, sp = palmSpec(r, h); rep(W, x - h * 0.7, h * 1.4, X => palm(g, X + h * 0.7, H - 72, h, sp)); }
      }
    }
  },
  west(g, li, r, W, H) {
    if (!li) {
      hills(g, W, H, H - 100, 15, r);
      for (let i = 0; i < 4; i++) { const x = r() * W, w = 120 + r() * 220, h = 90 + r() * 140; rep(W, x, w + 60, X => { g.beginPath(); g.moveTo(X, H - 100); g.lineTo(X + 25, H - 100 - h); g.lineTo(X + w + 35, H - 100 - h); g.lineTo(X + w + 60, H - 100); g.fill(); }); }
    } else {
      hills(g, W, H, H - 80, 14, r);
      g.lineCap = 'round';
      for (let x = 40; x < W; x += 130 + r() * 200) {
        const h = 80 + r() * 70, b = H - 75; g.lineWidth = 16;
        g.beginPath(); g.moveTo(x, b); g.lineTo(x, b - h); g.stroke(); g.lineWidth = 10;
        g.beginPath(); g.moveTo(x, b - h * 0.45); g.lineTo(x - 24, b - h * 0.45); g.lineTo(x - 24, b - h * 0.8); g.stroke();
        g.beginPath(); g.moveTo(x, b - h * 0.6); g.lineTo(x + 22, b - h * 0.6); g.lineTo(x + 22, b - h * 0.9); g.stroke();
      }
    }
  },
  sea(g, li, r, W, H) {
    if (!li) {
      g.fillRect(0, H - 150, W, 150);
      for (let i = 0; i < 3; i++) {
        const x = 100 + r() * (W - 300), b = H - 150;
        g.beginPath(); g.moveTo(x, b - 30); g.lineTo(x + 150, b - 30); g.lineTo(x + 130, b); g.lineTo(x + 20, b); g.fill();
        for (const mx of [x + 45, x + 100]) { g.fillRect(mx, b - 150, 4, 120); g.fillRect(mx - 26, b - 135, 56, 38); g.fillRect(mx - 22, b - 92, 48, 34); }
      }
    } else {
      hills(g, W, H, H - 85, 20, r);
      for (let x = 30; x < W; x += 120 + r() * 200) { const h = 100 + r() * 90, sp = palmSpec(r, h); rep(W, x - h * 0.7, h * 1.4, X => palm(g, X + h * 0.7, H - 78, h, sp)); }
    }
  },
  future(g, li, r, W, H, E) {
    for (let x = -20; x < W;) {
      const w = (li ? 50 : 30) + r() * (li ? 80 : 60), h = (li ? 120 : 200) + r() * (li ? 180 : 230), top = H - 70 - h;
      rep(W, x, w, X => {
        g.fillRect(X, top, w, H); g.fillRect(X + w / 2 - 1, top - 30, 3, 30);
        const f = g.fillStyle; g.fillStyle = E.win;
        for (let wy = top + 10; wy < H - 80; wy += 14) if (Math.random() < (li ? 0.35 : 0.2)) g.fillRect(X + 5, wy, w - 10, 3);
        if (li && Math.random() < 0.25) { g.fillStyle = 'rgba(255,79,216,0.5)'; g.fillRect(X + 6, top + 20, w - 12, 26); }
        g.fillStyle = f;
      });
      x += w + r() * 20;
    }
  },
};
// far mountain range / skyline, faded into the sky
function distant(g, r, W, H, E) {
  if (E.bg === 'city' || E.bg === 'future') {
    for (let x = 0; x < W;) { const w = 24 + r() * 60, h = 50 + r() * 150; rep(W, x, w, X => g.fillRect(X, H - 150 - h, w, H)); x += w + r() * 6; }
    return;
  }
  const n = 26, ys = Array.from({ length: n }, (_, i) => H - 185 - r() * (E.bg === 'sea' ? 40 : 130) * (i % 2 ? 0.55 : 1));
  g.beginPath(); g.moveTo(0, H);
  for (let i = 0; i <= n; i++) g.lineTo(i * W / n, ys[i % n]);
  g.lineTo(W, H); g.fill();
}
// flat cloud: base slab + dome bumps [center, radius] (fractions of w). Every sub-path winds
// clockwise so the nonzero fill unions them (mixed winding cut holes under each dome).
function cloud(g, x, y, w, bumps) {
  g.beginPath(); g.rect(x + w * 0.08, y - w * 0.09, w * 0.84, w * 0.09);
  for (const [c, r] of bumps) { const X = x + c * w, R = r * w; g.moveTo(X - R, y); g.arc(X, y, R, Math.PI, 0); }
  g.fill();
}
function cloudBumps(r) {
  const n = 3 + (r() * 3 | 0), out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), mid = 1 - Math.abs(t - 0.5) * 2; // bigger domes toward the middle
    out.push([0.12 + t * 0.76, 0.1 + mid * (0.1 + r() * 0.1) + r() * 0.03]);
  }
  return out;
}
let BG_S = 1;
function makeSky(E) {
  const W = 2000, H = 320, cv = document.createElement('canvas'); cv.width = W * BG_S; cv.height = H * BG_S;
  const g = cv.getContext('2d'), r = mulberry32(E.name.length * 31 + 7); g.setTransform(BG_S, 0, 0, BG_S, 0, 0);
  if (E.neon) { g.fillStyle = '#fff'; for (let i = 0; i < 140; i++) { g.globalAlpha = 0.25 + r() * 0.75; const s = r() < 0.12 ? 2 : 1; g.fillRect(r() * W, r() * H * 0.95, s, s); } }
  else {
    // opaque two-tone clouds tinted from the era sky; the whole layer gets one alpha, so overlaps stay clean
    const lit = mix(E.sky[1], '#ffffff', 0.65), dark = mix(E.sky[1], E.sky[0], 0.3);
    for (let i = 0; i < 9; i++) {
      const x = r() * W, y = 70 + r() * 180, w = 110 + r() * 200, b = cloudBumps(r);
      rep(W, x, w, X => { g.fillStyle = dark; cloud(g, X, y, w, b); g.fillStyle = lit; cloud(g, X, y - w * 0.05, w, b); });
    }
  }
  return { c: cv, w: W, h: H, par: 0.03, drift: E.neon ? 0 : 7, a: E.neon ? 1 : E.cloud };
}
function makeBackground(E) {
  BG_S = clamp(SC, 1, 2); // bake at device resolution so silhouettes stay crisp
  const W = 1600, H = VIEW_H, cols = [mix(E.sky[1], E.layers[0], 0.5), ...E.layers];
  const layers = cols.map((col, li) => {
    const cv = document.createElement('canvas'); cv.width = W * BG_S; cv.height = H * BG_S;
    const g = cv.getContext('2d'), r = mulberry32(li * 7919 + E.name.length * 104729);
    g.setTransform(BG_S, 0, 0, BG_S, 0, 0); g.fillStyle = col; g.strokeStyle = col;
    if (li === 0) distant(g, r, W, H, E); else PAINT[E.bg](g, li - 1, r, W, H, E);
    g.globalCompositeOperation = 'source-atop'; // atmospheric haze toward the horizon
    const hz = g.createLinearGradient(0, H * 0.3, 0, H);
    hz.addColorStop(0, rgba(E.sky[1], 0)); hz.addColorStop(1, rgba(E.sky[1], [0.6, 0.4, 0.15][li]));
    g.fillStyle = hz; g.fillRect(0, 0, W, H);
    return { c: cv, w: W, h: H, par: [0.06, 0.14, 0.32][li] };
  });
  return [makeSky(E), ...layers];
}

// ===== ambient weather (view space) =====
const AMB = { city: ['dust', 30], jungle: ['ember', 24], castle: ['firefly', 12], desert: ['sand', 45], west: ['dust', 35], sea: ['dust', 26], future: ['rain', 110] };
function newAmb(k, anywhere) {
  const a = { k, x: rand(0, viewW), y: rand(0, VIEW_H), ph: rand(0, TAU), sz: rand(1.2, 3), vx: rand(-14, 4), vy: rand(-6, 6) };
  if (k === 'ember') { a.vx = rand(-25, 10); a.vy = rand(-45, -15); if (!anywhere) a.y = VIEW_H + 5; }
  else if (k === 'firefly') { a.vx = rand(-10, 10); a.vy = rand(-8, 8); a.y = rand(200, 480); }
  else if (k === 'sand') { a.vx = rand(-320, -180); a.vy = rand(-10, 15); a.sz = rand(8, 20); if (!anywhere) a.x = viewW + 10; }
  else if (k === 'rain') { a.vx = -140; a.vy = rand(650, 800); a.sz = rand(10, 18); if (!anywhere) a.y = -20; }
  return a;
}
function resetAmb() { const [k, n] = AMB[era.bg]; G.amb = Array.from({ length: n }, () => newAmb(k, true)); }
function updateAmb(dt, dcam) {
  for (let i = 0; i < G.amb.length; i++) {
    const a = G.amb[i];
    a.x += a.vx * dt - dcam * 0.8; a.y += a.vy * dt; a.ph += dt;
    if (a.k === 'firefly') { a.x += Math.sin(a.ph * 1.3) * 12 * dt; a.y += Math.cos(a.ph * 1.7) * 10 * dt; }
    if (a.x < -30) a.x += viewW + 60; else if (a.x > viewW + 30) a.x -= viewW + 60;
    if (a.y < -30 || a.y > VIEW_H + 30) G.amb[i] = newAmb(a.k, false);
  }
}
function drawAmb(c) {
  c.lineCap = 'round';
  const lines = new Path2D();
  for (const a of G.amb) {
    if (a.k === 'rain') { lines.moveTo(a.x, a.y); lines.lineTo(a.x - a.vx * 0.022, a.y - a.sz); }
    else if (a.k === 'sand') { lines.moveTo(a.x, a.y); lines.lineTo(a.x + a.sz, a.y - 1); }
    else if (a.k === 'dust') { c.globalAlpha = 0.22 + 0.18 * Math.sin(a.ph * 2); c.fillStyle = '#fff'; c.fillRect(a.x, a.y, a.sz, a.sz); }
  }
  c.globalAlpha = 0.35; c.strokeStyle = era.bg === 'future' ? '#9fd8ff' : '#f3dfae'; c.lineWidth = 1.3; c.stroke(lines);
  c.globalCompositeOperation = 'lighter';
  for (const a of G.amb) if (a.k === 'ember' || a.k === 'firefly') { // small core + faint halo
    const fl = 0.5 + 0.5 * Math.sin(a.ph * (a.k === 'ember' ? 9 : 3)), col = a.k === 'ember' ? '#ff9a3c' : '#d8ff7a', s = a.sz * 0.6;
    glow(c, a.x, a.y, a.sz * 1.8, col, 0.1 + 0.15 * fl);
    c.globalAlpha = 0.3 + 0.35 * fl; c.fillStyle = col; c.fillRect(a.x - s / 2, a.y - s / 2, s, s);
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
}

// ===== screen-space helpers (camera zoom about a focal point) =====
let VIG = null, HURTV = null;
function makeVignette(col, inner) {
  const v = document.createElement('canvas'); v.width = Math.max(1, cvs.width >> 2); v.height = Math.max(1, cvs.height >> 2);
  const g = v.getContext('2d'), R = Math.hypot(v.width, v.height) / 2;
  const gr = g.createRadialGradient(v.width / 2, v.height * 0.55, R * inner, v.width / 2, v.height * 0.55, R);
  gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, 1)); g.fillStyle = gr; g.fillRect(0, 0, v.width, v.height);
  return v;
}
const focus = () => [cvs.width * 0.5, cvs.height * 0.62];
function toWorld(X, Y) { const z = cam.z, [fx, fy] = focus(); return [(X - fx * (1 - z)) / (SC * z) + cam.x, (Y - fy * (1 - z)) / (SC * z)]; }
function toCss(x, y) { const z = cam.z, [fx, fy] = focus(); return [((x - cam.x) * SC * z + fx * (1 - z)) / DPR, (y * SC * z + fy * (1 - z)) / DPR]; }

// ===== render =====
function render() {
  if (!VIG) return; // no real size yet (iframe/tab loaded hidden); resize() fills this in
  const c = ctx;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  if (!G.sky) { G.sky = c.createLinearGradient(0, 0, 0, cvs.height); G.sky.addColorStop(0, era.sky[0]); G.sky.addColorStop(1, era.sky[1]); }
  c.fillStyle = G.sky; c.fillRect(0, 0, cvs.width, cvs.height);
  c.setTransform(SC, 0, 0, SC, 0, 0);
  if (era.sun) {
    const sx = viewW * 0.72, sy = 120;
    c.globalCompositeOperation = 'lighter'; glow(c, sx, sy, 200, era.sun, 0.4); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.fillStyle = era.sun; c.beginPath(); c.arc(sx, sy, 46, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,.28)'; c.beginPath(); c.arc(sx - 9, sy - 9, 30, 0, TAU); c.fill();
  }
  for (const L of bg) {
    const off = cam.x * L.par + (L.drift ? G.time * L.drift : 0);
    let ox = -(off % L.w); if (ox > 0) ox -= L.w;
    c.globalAlpha = L.a ?? 1;
    for (let x = ox; x < viewW; x += L.w) c.drawImage(L.c, x, 0, L.w, L.h);
  }
  c.globalAlpha = 1;
  // world (zoom + smooth noise shake)
  const sh = save.set.shake ? cam.shake : 0, t = G.time;
  const sx = sh * (Math.sin(t * 53.1) + Math.sin(t * 31.7 + 1.7)) * 0.5, sy = sh * (Math.sin(t * 47.3 + 0.5) + Math.sin(t * 27.1 + 2.3)) * 0.5;
  const z = cam.z, [fx, fy] = focus();
  c.setTransform(SC * z, 0, 0, SC * z, -cam.x * SC * z + fx * (1 - z) + sx * SC, fy * (1 - z) + sy * SC);
  drawGround(c);
  if (!GFX_LOW) drawProps(c);
  for (const q of parts) if (q.stuck && (q.k === 'blood' || q.k === 'scorch')) {
    c.globalAlpha = clamp(q.life / 2, 0, 1);
    if (q.k === 'blood') { c.fillStyle = q.c; c.fillRect(q.x - q.sz / 2, q.y - q.sz / 3, q.sz, q.sz / 1.5); }
    else drawScorch(c, q);
  }
  c.globalAlpha = 1;
  drawShadows(c);
  drawCrates(c);
  const k = G.acc / RD_STEP; // extrapolate ragdolls between 120 Hz physics steps
  for (const r of ragdolls) {
    const ip = r.ip || (r.ip = r.p.map(() => [0, 0]));
    for (let i = 0; i < ip.length; i++) { ip[i][0] = r.p[i][0] + (r.p[i][0] - r.o[i][0]) * k; ip[i][1] = r.p[i][1] + (r.p[i][1] - r.o[i][1]) * k; }
    c.globalAlpha = clamp(RD_LIFE - r.age, 0, 1); drawRig(c, r.rig, ip, r.look, r.s, r.f, false, r.hat, r.cut, r.cut >= 0 ? r.a0 + r.spin * Math.min(r.age, 0.7) : undefined, r.opt, true);
  }
  c.globalAlpha = 1;
  for (const e of enemies) if (!e.dead) drawEnemy(c, e);
  if (!player.dead) drawPlayer(c);
  if (!GFX_LOW) drawFront(c);
  for (const n of nades) {
    c.save(); c.translate(n.x, n.y); c.rotate(n.rot); obox(c, -6, -6, 12, 12, '#4a5a32'); obox(c, -2, -9, 4, 3, '#9aa'); c.restore();
    if (n.t < 0.4 && Math.sin(G.time * 60) > 0) { c.globalCompositeOperation = 'lighter'; glow(c, n.x, n.y, 12, '#ff3b3b', 1); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
  }
  for (const b of bullets) if (b.rocket) {
    c.save(); c.translate(b.x, b.y); c.rotate(Math.atan2(b.vy, b.vx)); obox(c, -14, -4, 18, 8, '#56663a'); obox(c, 4, -4, 5, 8, '#d33'); c.restore();
  }
  for (const q of eprojs) if (!q.K.line) {
    c.beginPath(); c.arc(q.x, q.y, q.K.r, 0, TAU); c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke(); c.fillStyle = q.K.color; c.fill();
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(q.x - q.K.r * 0.5, q.y - q.K.r * 0.6, q.K.r * 0.45, q.K.r * 0.45);
  }
  // soft/normal particles
  c.lineCap = 'round';
  for (const q of parts) {
    if (q.stuck && (q.k === 'blood' || q.k === 'scorch')) continue;
    const a = clamp(q.life / q.max, 0, 1);
    switch (q.k) {
      case 'item': c.save(); c.globalAlpha = Math.min(1, q.life); c.translate(q.x, q.y); c.rotate(q.rot); drawItem(c, q); c.restore(); break;
      case 'blood': case 'debris': case 'shell': c.globalAlpha = Math.min(1, q.life); c.fillStyle = q.c; c.fillRect(q.x - q.sz / 2, q.y - q.sz / 2, q.sz, q.k === 'shell' ? q.sz * 0.6 : q.sz); break;
      case 'smoke': glow(c, q.x, q.y, q.sz * 1.8, q.c || '#6e6e6e', a * 0.6); break;
      case 'ring': c.globalAlpha = a; c.strokeStyle = q.c; c.lineWidth = 5 * a + 1; c.beginPath(); c.arc(q.x, q.y, q.sz, 0, TAU); c.stroke(); break;
    }
  }
  // additive light: tracers, glows, fire, sparks, beams
  c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1;
  const tr = new Path2D();
  for (const b of bullets) if (!b.rocket) { tr.moveTo(b.px, b.py); tr.lineTo(b.x, b.y); }
  c.strokeStyle = 'rgba(255,180,60,0.35)'; c.lineWidth = 6; c.stroke(tr);
  c.strokeStyle = '#fff4c8'; c.lineWidth = 2; c.stroke(tr);
  for (const b of bullets) if (b.rocket) { const d = Math.hypot(b.vx, b.vy) || 1; glow(c, b.x - b.vx / d * 18, b.y - b.vy / d * 18, 16 + Math.random() * 6, '#ffa53a', 1); }
  for (const q of eprojs) if (q.K.line || q.K === PROJ.orb || q.K === PROJ.goo) {
    if (q.K.line) { const d = Math.hypot(q.vx, q.vy) || 1; c.globalAlpha = 1; c.strokeStyle = q.K.color; c.lineWidth = q.K === PROJ.arrow ? 2.5 : 4; c.beginPath(); c.moveTo(q.x - q.vx / d * 16, q.y - q.vy / d * 16); c.lineTo(q.x, q.y); c.stroke(); }
    if (q.K !== PROJ.arrow) glow(c, q.x, q.y, q.K.r * 3, q.K.color, 0.7);
  }
  if (player.beamOn) {
    const [mx, my] = muzzle(), ex = mx + Math.cos(player.aim) * player.beamLen, ey = my + Math.sin(player.aim) * player.beamLen;
    c.globalAlpha = 1; c.beginPath(); c.moveTo(mx, my); c.lineTo(ex, ey);
    c.strokeStyle = 'rgba(57,225,255,0.25)'; c.lineWidth = 16 + Math.random() * 6; c.stroke();
    c.strokeStyle = 'rgba(57,225,255,0.6)'; c.lineWidth = 7; c.stroke();
    c.strokeStyle = '#f2ffff'; c.lineWidth = 2.5; c.stroke();
    glow(c, mx, my, 22, '#39e1ff', 0.9); glow(c, ex, ey, 30 + Math.random() * 10, '#39e1ff', 0.9);
  }
  for (const q of parts) {
    const a = clamp(q.life / q.max, 0, 1);
    switch (q.k) {
      case 'fire': glow(c, q.x, q.y, q.sz * 1.7, a > 0.55 ? '#ffc94a' : a > 0.25 ? '#ff7a2b' : '#a2321e', a * 0.7); break;
      case 'glow': glow(c, q.x, q.y, q.sz * (0.6 + a * 0.4), q.c, a * (q.a || 1)); break;
      case 'scorch': { // smouldering specks for the first seconds
        const t = q.max - q.life; if (t > 2.5) break;
        for (const [dx, sz] of q.specks) { const x = q.x + dx, y = groundY(x); if (Math.abs(y - q.y) < 40) glow(c, x + sz / 2, y + 1, 4 + sz, '#ff7a2b', (1 - t / 2.5) * (0.55 + 0.45 * Math.sin(G.time * 11 + dx))); }
        break;
      }
      case 'spark': c.globalAlpha = a; c.strokeStyle = q.c; c.lineWidth = 2; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); c.stroke(); break;
      case 'zap': c.globalAlpha = a; c.strokeStyle = q.c; c.lineWidth = 2.5; c.beginPath(); c.moveTo(q.x, q.y);
        for (let k = 1; k < 6; k++) c.lineTo(lerp(q.x, q.x2, k / 6) + rand(-8, 8), lerp(q.y, q.y2, k / 6) + rand(-8, 8));
        c.lineTo(q.x2, q.y2); c.stroke(); break;
    }
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  c.textAlign = 'center'; c.lineJoin = 'round';
  for (const tx of texts) {
    const pop = 1 + Math.max(0, tx.life - 0.75) * 3;
    c.globalAlpha = clamp(tx.life * 2, 0, 1); c.font = `${Math.round(tx.sz * pop)}px 'Russo One', 'Arial Black', sans-serif`;
    c.strokeStyle = INK; c.lineWidth = 4.5; c.strokeText(tx.t, tx.x, tx.y); c.fillStyle = tx.c; c.fillText(tx.t, tx.x, tx.y);
  }
  c.globalAlpha = 1;
  // foreground weather
  c.setTransform(SC, 0, 0, SC, 0, 0);
  if (!GFX_LOW) drawAmb(c);
  // screen fx
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (run && run.btOn) { c.fillStyle = 'rgba(60,110,255,0.12)'; c.fillRect(0, 0, cvs.width, cvs.height); }
  if (!GFX_LOW) { c.globalAlpha = run && run.btOn ? 0.75 : 0.42; c.drawImage(VIG, 0, 0, cvs.width, cvs.height); }
  const low = run && !player.dead && player.hp < player.maxHp * 0.3 ? 0.22 + 0.12 * Math.sin(G.time * 6) : 0;
  const hurt = Math.max(low, G.hurtFx * 1.4);
  if (hurt > 0) { c.globalAlpha = Math.min(0.85, hurt); c.drawImage(HURTV, 0, 0, cvs.width, cvs.height); }
  c.globalAlpha = 1;
  if (G.flash > 0) { c.fillStyle = `rgba(255,255,255,${Math.min(0.8, G.flash) * 0.45})`; c.fillRect(0, 0, cvs.width, cvs.height); }
  if (coinFx.length) {
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const q of coinFx) {
      c.beginPath(); c.arc(q.x, q.y, 7, 0, TAU); c.fillStyle = '#b8860b'; c.fill();
      c.beginPath(); c.arc(q.x, q.y - 0.8, 5.8, 0, TAU); c.fillStyle = '#ffd34d'; c.fill();
      c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(q.x - 3, q.y - 4, 2, 2);
    }
  }
}
// burn mark painted into the ground surface: follows each step, multiplies the ground color
let SCORCH = null;
function drawScorch(c, q) {
  if (!SCORCH) {
    SCORCH = document.createElement('canvas'); SCORCH.width = 1; SCORCH.height = 32;
    const g = SCORCH.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 32);
    gr.addColorStop(0, 'rgba(45,30,22,1)'); gr.addColorStop(0.35, 'rgba(70,50,36,.5)'); gr.addColorStop(1, 'rgba(70,50,36,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 32);
  }
  const fade = clamp(q.life / 2, 0, 1);
  c.globalCompositeOperation = 'multiply';
  for (let x = q.x - q.sz; x < q.x + q.sz; x += 5) {
    const y = groundY(x), d = (x + 2.5 - q.x) / q.sz, w = (1 - d * d) * clamp(1 - Math.abs(y - q.y) / 60, 0, 1);
    if (w <= 0.02) continue;
    const n = 0.5 + 0.28 * Math.sin(x * 0.19 + q.x) + 0.22 * Math.sin(x * 0.53 + 1.3); // smooth organic edge
    c.globalAlpha = fade * w * (0.7 + 0.25 * n); c.drawImage(SCORCH, x, y - 1.5, 5, (6 + 18 * w) * (0.7 + 0.6 * n));
  }
  c.fillStyle = '#2b1f18';
  for (const [dx, sz] of q.specks) { const x = q.x + dx, y = groundY(x); if (Math.abs(y - q.y) > 40) continue; c.globalAlpha = fade * 0.8; c.fillRect(x, y + 1 + sz * 0.3, sz, sz * 0.7); }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
}
function drawShadows(c) {
  c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath();
  const sh = (x, rx) => { const y = groundY(x) - 0.5; c.moveTo(x + rx, y); c.ellipse(x, y, rx, rx * 0.2, 0, 0, TAU); };
  if (!player.dead) sh(player.x + 4, 20);
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.rig === 'flyer') sh(e.x, 14 * e.s * clamp(1 - (groundY(e.x) - e.y) / 450, 0.25, 1));
    else sh(e.x + (e.rig === 'raptor' ? e.f * 12 * e.s : 0), (e.rig === 'raptor' ? 30 : 19) * e.s);
  }
  for (const cr of crates) sh(cr.x + cr.n * 13, cr.n * 15 + 4);
  c.fill();
}
// embedded stones, cracks and grit; hashed per column so nothing flickers or repeats while scrolling
const GDETAIL = { city: [3, 4, 1], jungle: [3, 5, 1.15], castle: [2, 4, 1.3], desert: [5, 7, 0.75], west: [3, 4, 1], sea: [6, 8, 0.7], future: [3, 6, 1] }; // stone every N cols, crack every M, size
function drawGroundDetail(c, i0, i1) {
  const [sN, cN, sz] = GDETAIL[era.bg] || [4, 5, 1], g = era.ground, tech = era.bg === 'future';
  const dark = new Path2D(), light = new Path2D(), hi = new Path2D(), lo = new Path2D(), crack = new Path2D(), grit = new Path2D();
  for (let i = i0 - 1; i <= i1 + 1; i++) {
    const h = colHash(i ^ 0x1f3d5b79), top = colY(i);
    if (h % sN === 0) {
      const r = mulberry32(h), x = i * TILE + r() * TILE, y = top + 12 + r() * r() * 150, rad = (3 + r() * 6) * sz;
      if (tech) { light.moveTo(x + 2.4, y); light.arc(x, y, 2.4, 0, TAU); hi.moveTo(x - 1.5, y - 0.8); hi.lineTo(x + 0.8, y - 1.6); } // bolts
      else {
        const p = r() < 0.6 ? dark : light, n = 6 + (r() * 3 | 0), a0 = r() * TAU;
        for (let k = 0; k < n; k++) {
          const a = a0 + k / n * TAU, rr = rad * (0.75 + r() * 0.35), px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.7;
          if (k) p.lineTo(px, py); else p.moveTo(px, py);
        }
        p.closePath();
        hi.moveTo(x - rad * 0.55, y - rad * 0.3); hi.quadraticCurveTo(x, y - rad * 0.72, x + rad * 0.45, y - rad * 0.38); // lit upper edge
        lo.moveTo(x - rad * 0.6, y + rad * 0.45); lo.quadraticCurveTo(x, y + rad * 0.85, x + rad * 0.65, y + rad * 0.4); // shade where it sits in the soil
      }
    }
    if ((h >>> 8) % cN === 0) { // crack: jagged, heading down, one short branch
      const r = mulberry32(h ^ 0xabc), dir = r() < 0.5 ? -1 : 1, segs = 3 + (r() * 3 | 0);
      let x = i * TILE + r() * TILE, y = top + 4 + r() * 60;
      crack.moveTo(x, y);
      for (let k = 0; k < segs; k++) {
        x += dir * (2 + r() * 6) * (r() < 0.3 ? -1 : 1); y += 5 + r() * 8; crack.lineTo(x, y);
        if (k === 1) { crack.lineTo(x + dir * 7, y + 4); crack.moveTo(x, y); }
      }
    }
    if ((h >>> 16) % 2 === 0) grit.rect(i * TILE + (h >>> 20) % TILE, top + 8 + (h >>> 5) % 90, 1.6, 1.6);
  }
  c.fillStyle = shade(g, 0.8); c.fill(dark);
  c.fillStyle = shade(g, tech ? 1.35 : 1.05); c.fill(light);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = shade(g, 0.68); c.lineWidth = 1.6; c.stroke(lo);
  c.strokeStyle = shade(g, 1.18); c.lineWidth = 1.2; c.stroke(hi);
  c.strokeStyle = shade(g, tech ? 0.75 : 0.62); c.lineWidth = 1.3; c.stroke(crack);
  c.fillStyle = shade(g, 0.72); c.fill(grit);
}
function drawGround(c) {
  const i0 = Math.floor(cam.x / TILE) - 1, i1 = Math.ceil((cam.x + viewW) / TILE) + 1;
  ensureGround(i1 * TILE + TILE, i0 * TILE);
  const top = new Path2D(); top.moveTo(i0 * TILE, colY(i0));
  for (let i = i0; i <= i1; i++) { const y = colY(i); top.lineTo(i * TILE, y); top.lineTo(i * TILE + TILE, y); }
  const fill = new Path2D(top); fill.lineTo(i1 * TILE + TILE, VIEW_H + 40); fill.lineTo(i0 * TILE, VIEW_H + 40); fill.closePath();
  if (G.gEra !== era) { G.gEra = era; RIM = rgba(mix(era.sky[1], '#ffffff', 0.35), 0.3); G.gGrad = c.createLinearGradient(0, 300, 0, VIEW_H); G.gGrad.addColorStop(0, era.ground); G.gGrad.addColorStop(1, shade(era.ground, 0.7)); }
  c.fillStyle = G.gGrad; c.fill(fill);
  c.save(); c.clip(fill);
  if (!GFX_LOW) drawGroundDetail(c, i0, i1);
  c.translate(0, 9); c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = 14; c.stroke(top); // soft shade under the lip
  c.restore();
  c.lineCap = 'butt'; c.lineJoin = 'miter';
  c.strokeStyle = era.edge; c.lineWidth = 3; c.stroke(top);
  c.save(); c.translate(0, 2.5); c.strokeStyle = shade(era.ground, 1.2); c.lineWidth = 1.5; c.stroke(top); c.restore();
  if (era.neon) {
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = 'rgba(120,130,255,0.35)'; c.lineWidth = 8; c.stroke(top);
    c.strokeStyle = '#a9b0ff'; c.lineWidth = 1.5; c.stroke(top);
    c.globalCompositeOperation = 'source-over';
  }
  // surface detail: grass tufts / pebbles, stable per column
  const tuft = new Path2D(); c.fillStyle = shade(era.ground, 0.82);
  for (let i = i0; i <= i1; i++) {
    let h = Math.imul(i ^ 0x5bd1e995, 2654435761) >>> 0; h ^= h >>> 15;
    const x = i * TILE + (h % 13) + 3, y = colY(i);
    if (era.tuft && h % 5 < 2) { tuft.moveTo(x - 3, y); tuft.lineTo(x - 5, y - 6); tuft.moveTo(x, y); tuft.lineTo(x, y - 8); tuft.moveTo(x + 3, y); tuft.lineTo(x + 5, y - 5); }
  }
  if (era.tuft) { c.lineCap = 'round'; c.strokeStyle = era.tuft; c.lineWidth = 2; c.stroke(tuft); }
}
// ===== era props (flat, ink-outlined), placed per column so they stay put while scrolling =====
const PROPS = { city: ['lamp', 'hydrant', 'bin', 'rock'], jungle: ['bones', 'rock', 'fern', 'fern'], castle: ['fence', 'barrel', 'rock'],
  desert: ['column', 'skull', 'rock'], west: ['cactus', 'barrel', 'wheel', 'rock'], sea: ['barrel', 'anchor', 'wcrate', 'rock'], future: ['neon', 'pipe', 'bin'] };
const colHash = i => { let h = Math.imul(i ^ 0x2c1b3c6d, 0x297a2d39) >>> 0; h ^= h >>> 13; return Math.imul(h, 0x85ebca6b) >>> 0; };
function drawProps(c) {
  const i0 = Math.floor(cam.x / TILE) - 2, i1 = Math.ceil((cam.x + viewW) / TILE) + 2, list = PROPS[era.bg];
  for (let i = i0; i <= i1; i++) {
    const h = colHash(i);
    if (h % 11 || colY(i - 1) !== colY(i) || colY(i + 1) !== colY(i)) continue; // ~1 in 11 flat columns
    drawProp(c, list[(h >>> 8) % list.length], i * TILE + 10, colY(i), (h >>> 16) % 2 ? 1 : -1);
  }
}
function drawProp(c, kind, x, y, m) {
  const g = era.ground, dk = shade(g, 0.62), c2 = (a, b, w, col) => inkLine(c, a[0], a[1], b[0], b[1], w, col);
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (kind) {
    case 'lamp': c2([x, y], [x, y - 95], 4, '#3a3f4b'); c2([x, y - 95], [x + m * 16, y - 99], 3, '#3a3f4b'); obox(c, x + m * 16 - 5, y - 99, 10, 6, '#ffe9a8'); obox(c, x - 5, y - 8, 10, 8, '#3a3f4b'); break;
    case 'hydrant': obox(c, x - 5, y - 17, 10, 17, '#c0392b'); obox(c, x - 7, y - 11, 14, 3, '#a93226'); obox(c, x - 4, y - 21, 8, 4, '#c0392b'); break;
    case 'bin': obox(c, x - 8, y - 20, 16, 20, '#4d5b4e'); obox(c, x - 9, y - 23, 18, 4, '#3d4a3e'); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x - 3, y - 17, 2, 14); c.fillRect(x + 2, y - 17, 2, 14); break;
    case 'rock': c.beginPath(); c.moveTo(x - 14, y); c.lineTo(x - 11, y - 9); c.lineTo(x - 3, y - 14); c.lineTo(x + 8, y - 11); c.lineTo(x + 13, y); c.closePath();
      c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke(); c.fillStyle = dk; c.fill(); c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(x - 8, y - 11, 9, 3); break;
    case 'bones': for (let k = 0; k < 4; k++) { c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(x + m * k * 6, y, 11 - k * 1.5, Math.PI, Math.PI * 1.9); c.stroke(); c.strokeStyle = '#e8e2d0'; c.lineWidth = 2.5; c.stroke(); }
      c2([x - 6 * m, y - 1], [x + 26 * m, y - 1], 3, '#e8e2d0'); break;
    case 'fern': for (let k = -2; k <= 2; k++) c2([x, y], [x + k * 7, y - 20 + Math.abs(k) * 5], 2.5, era.tuft || '#5f8a34'); break;
    case 'fence': for (let k = 0; k < 3; k++) c2([x - 14 + k * 14, y], [x - 14 + k * 14, y - 24], 3.5, '#6b4a2b'); c2([x - 17, y - 16], [x + 17, y - 16], 2.5, '#7a5530'); c2([x - 17, y - 8], [x + 17, y - 8], 2.5, '#7a5530'); break;
    case 'barrel': obox(c, x - 9, y - 22, 18, 22, '#8a5a2b'); c.fillStyle = '#4a3b2c'; c.fillRect(x - 9, y - 18, 18, 2.5); c.fillRect(x - 9, y - 6, 18, 2.5); c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x - 6, y - 22, 3, 22); break;
    case 'column': obox(c, x - 8, y - 34, 16, 34, shade(g, 0.9)); c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(x - 3, y - 34, 2, 34); c.fillRect(x + 3, y - 34, 2, 34);
      c.fillStyle = INK; c.beginPath(); c.moveTo(x - 9, y - 34); c.lineTo(x - 3, y - 41); c.lineTo(x + 2, y - 36); c.lineTo(x + 9, y - 39); c.lineTo(x + 9, y - 34); c.fill(); break;
    case 'skull': c.beginPath(); c.arc(x, y - 6, 6, 0, TAU); c.strokeStyle = INK; c.lineWidth = 2.5; c.stroke(); c.fillStyle = '#e8e2d0'; c.fill(); c.fillStyle = INK; c.fillRect(x - 3.5 + m, y - 8, 2.5, 2.5); c.fillRect(x + 1 + m, y - 8, 2.5, 2.5); break;
    case 'cactus': c2([x, y], [x, y - 30], 8, '#5a8a3a'); c2([x, y - 14], [x + m * 9, y - 14], 5, '#5a8a3a'); c2([x + m * 9, y - 14], [x + m * 9, y - 24], 5, '#5a8a3a'); break;
    case 'wheel': c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.arc(x, y - 14, 14, 0, TAU); c.stroke(); c.strokeStyle = '#7a5530'; c.lineWidth = 2.5; c.stroke();
      for (let k = 0; k < 4; k++) c2([x - Math.cos(k * 0.8) * 13, y - 14 - Math.sin(k * 0.8) * 13], [x + Math.cos(k * 0.8) * 13, y - 14 + Math.sin(k * 0.8) * 13], 1.5, '#7a5530'); break;
    case 'anchor': c2([x, y - 2], [x, y - 30], 3.5, '#3a4250'); c2([x - 8, y - 24], [x + 8, y - 24], 3, '#3a4250'); c.strokeStyle = INK; c.lineWidth = 6; c.beginPath(); c.arc(x, y - 12, 10, 0.2, Math.PI - 0.2); c.stroke(); c.strokeStyle = '#3a4250'; c.lineWidth = 3; c.stroke(); break;
    case 'wcrate': obox(c, x - 11, y - 20, 22, 20, '#9a6b3b'); c2([x - 9, y - 18], [x + 9, y - 2], 2, '#6b4423'); c2([x + 9, y - 18], [x - 9, y - 2], 2, '#6b4423'); break;
    case 'neon': c2([x, y], [x, y - 70], 3.5, '#2a3140'); obox(c, x - 4, y - 78, 8, 12, '#ff4fd8');
      c.globalCompositeOperation = 'lighter'; glow(c, x, y - 72, 22, '#ff4fd8', 0.5); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; break;
    case 'pipe': obox(c, x - 18, y - 10, 36, 10, '#4a5566'); obox(c, x - 20, y - 12, 5, 14, '#5a6478'); obox(c, x + 15, y - 12, 5, 14, '#5a6478'); break;
  }
}
// low grass / rubble clumps drawn in front of the characters for depth
function drawFront(c) {
  const i0 = Math.floor(cam.x / TILE) - 1, i1 = Math.ceil((cam.x + viewW) / TILE) + 1, col = era.tuft ? shade(era.tuft, 0.8) : shade(era.ground, 0.72);
  const path = new Path2D();
  for (let i = i0; i <= i1; i++) {
    const h = colHash(i ^ 0x55);
    if (h % 9) continue;
    const x = i * TILE + (h >>> 8) % 14, y = colY(i) + 3;
    if (era.tuft) for (let k = -2; k <= 2; k++) { path.moveTo(x + k * 3, y); path.lineTo(x + k * 5, y - 11 + Math.abs(k) * 3); }
    else { path.moveTo(x - 6, y); path.lineTo(x - 3, y - 5); path.lineTo(x + 2, y - 3); path.lineTo(x + 6, y); }
  }
  c.lineCap = 'round'; c.strokeStyle = col; c.lineWidth = era.tuft ? 2.4 : 3; c.stroke(path);
}
// weapon dropped by a dying enemy (local frame, spun by the particle)
function drawItem(c, q) {
  const s = q.s;
  switch (q.held) {
    case 'club': obox(c, -13 * s, -3.5 * s, 26 * s, 7 * s, '#6b4423'); break;
    case 'sword': obox(c, -17 * s, -1.7 * s, 34 * s, 3.5 * s, '#d5dae2'); obox(c, -11 * s, -5 * s, 3 * s, 10 * s, '#4a3b2c'); break;
    case 'bow': c.strokeStyle = INK; c.lineWidth = 5 * s; c.beginPath(); c.arc(0, 10 * s, 20 * s, -2.3, -0.8); c.stroke(); c.strokeStyle = '#7a5530'; c.lineWidth = 3 * s; c.stroke(); break;
    case 'gun': obox(c, -10 * s, -2.5 * s, 20 * s, 5 * s, '#30343e'); obox(c, -8 * s, 2 * s, 4 * s, 5 * s, '#30343e'); break;
    case 'shield': obox(c, -25 * s, -5.5 * s, 50 * s, 11 * s, q.look.sh || '#6d7c8c'); break;
  }
}

function drawCrates(c) {
  c.font = "9px 'Russo One', 'Arial Black', sans-serif"; c.textAlign = 'center';
  for (const cr of crates) for (let j = 0; j < cr.n; j++) {
    const x = cr.x + j * 26, y = cr.y - 26, blink = cr.fuse >= 0 && Math.sin(G.time * 60) > 0;
    obox(c, x + 0.5, y + 1, 24, 25, blink ? '#fff' : '#d8262c');
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x + 0.5, y + 1, 24, 4);
    c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x + 0.5, y + 7, 24, 3); c.fillRect(x + 0.5, y + 20, 24, 3);
    c.fillStyle = '#fff'; c.fillText('TNT', x + 12.5, y + 18);
  }
}
function drawEnemy(c, e) {
  drawRig(c, e.rig, e.pts, e.look, e.s, e.f, e.flash > 0, e.hat === 'helmet' && !e.helmet ? null : e.hat, -1, undefined, e.F);
  if (e.held) drawHeld(c, e.held, e.pts, e.s, e.f, e.look, e.shield > 0);
  if (e.slow > 0) { const q = e.pts[RIGS[e.rig].core]; c.globalCompositeOperation = 'lighter'; glow(c, q[0], q[1], 45 * e.s, '#6fd0ff', 0.45); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
  if (!e.idle && e.type !== 'boss' && e.hp < e.maxHp) {
    const w = 34 * Math.max(1, e.s), x = e.x - w / 2, y = e.bb[1] - 2;
    obox(c, x, y, w, 4, '#3a1515'); c.fillStyle = '#ff4d4d'; c.fillRect(x, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
}
function drawPlayer(c) {
  const p = player, pts = p.pts;
  const f = playerFacing();
  drawRig(c, 'human', pts, PLAYER_LOOK, 1, f, p.flash > 0, 'mask', -1, undefined, PLAYER_OPT);
  const h = pts[6], a = f > 0 ? gunAim() : Math.PI - 0.35; // low-ready while jogging left
  c.save(); c.translate(h[0] - Math.cos(a) * p.recoil * 4, h[1] - Math.sin(a) * p.recoil * 4); c.rotate(a);
  if (f < 0) c.scale(1, -1); // keep the grip under the barrel when pointing left
  drawGun(c, wep.id, wep.color, wep.id === 'laser' ? (p.over ? '#ff5a5a' : '#39e1ff') : '#9ff3ff');
  c.restore();
  c.beginPath(); c.arc(h[0], h[1], 3.1, 0, TAU); c.fillStyle = PLAYER_LOOK.k; c.fill(); c.strokeStyle = shade(PLAYER_LOOK.k, 0.34); c.lineWidth = 1.6; c.stroke();
  const [mx, my] = muzzle();
  if (p.mflash > 0) {
    c.save(); c.translate(mx, my); c.rotate(a); c.fillStyle = '#fff1a8';
    c.beginPath(); c.moveTo(0, -6); c.lineTo(22 + Math.random() * 8, 0); c.lineTo(0, 6); c.lineTo(6, 0); c.fill(); c.restore();
    c.globalCompositeOperation = 'lighter'; glow(c, mx, my, 38, '#ffc24a', 0.95); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  if (G.state !== 'over' && (!run || run.state === 'fight')) { // laser sight
    const ca = Math.cos(p.aim), sa = Math.sin(p.aim);
    c.strokeStyle = 'rgba(255,50,50,.5)'; c.lineWidth = 1.5; c.setLineDash([8, 6]); c.beginPath(); c.moveTo(mx, my); c.lineTo(mx + ca * 240, my + sa * 240); c.stroke(); c.setLineDash([]);
    c.globalCompositeOperation = 'lighter'; glow(c, mx + ca * 240, my + sa * 240, 6, '#ff3030', 0.9); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  }
  if (run && p.reload > 0) { obox(c, p.x - 20, p.y - 122, 40, 4, '#2a2d38'); c.fillStyle = '#ffd34d'; c.fillRect(p.x - 20, p.y - 122, 40 * (1 - p.reload / wep.reload), 4); }
}
