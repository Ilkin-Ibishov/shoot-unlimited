# Shoot Unlimited: notes for Claude

The user writes in Azerbaijani; answer in Azerbaijani. What the game is, how to run it and the tools are in README.md;
the product backlog and monetization design are in BACKLOG.md.

## Workflow
- Run locally: `.claude/launch.json` → `shoot-unlimited` (python http.server on :8123). The user tests there too.
- `?debug` = debug mode with its own save (panel: era, wave, weapons, cheats, spawn, perks, upgrades, sound, music).
- Finished changes are committed and pushed to `main` (GitHub Pages deploys it). When any shipped file changes, bump
  `CACHE` in `sw.js` (`shoot-unlimited-vN`).
- Before pushing: `node tools/check.js`. The sim (`tools/sim.js`) runs the real game code in Node without canvas/DOM:
  never create `Path2D` (or anything browser-only) at script top level, create it lazily on first use (see `SKULL`).
- Stale page in the browser pane: reload with a new query (`?debug&v=N`).
- Sound work: follow the `procedural-audio` skill (`.claude/skills/`, local only).

## Character art (in progress: "realistic, not boxy")
The user wants the whole cast moved from boxy cartoon (square heads, capsule limbs, thick black ink) to a more
realistic look. **Done: the Jurassic dinos** (Raptor, Bonecrusher, T-Rex) in `js/engine.js` → `DINO`, `drawDino`,
`dinoHead`; picked by `dino: 'raptor' | 'crusher' | 'rex'` on the foe in `js/data.js`. The user liked it and wants the
same treatment for the other characters, one group at a time.

**Done: humans, "Earn to Die" style** (the user picked it after a style study against Earn to Die Rogue screenshots):
`drawHuman`, `humanHead` in `js/engine.js`; `opt.old` / `GFX_LOW` still draw the old boxy rig. What defines the look:
lanky profile limbs (`HLIMB`) and torso (`HT_Z` slim zombies, `HT_H` broad living), thin dark ink `INKD` 0.75 px
stroked under each layer, two-tone cel shading (dark strip on the back edge, light strip on the front), thin fold/crease
lines, rolled sleeves, torn denim. Zombies are hunched (`poseHuman(..., hunch)` when `face === 'zombie'`: torso bent,
head thrust forward, back arm dangling), bald, with glowing yellow eyes; the head only follows 30 % of the neck tilt
so the face looks ahead. The player (`hat: 'hero'`) has a beard and a red headband with fluttering tails. Style study
page (not shipped): `tools/out/styles.html?s=3` + `styles-d.js` (gitignored).
Perf: JS path building 0.09 ms per human; CPU raster ~3x the old rig, GPU not yet measured (pane was hidden). A glow
sprite with 'lighter' on the eyes cost 4x the whole zombie in raster: use a translucent halo ellipse instead.

**Still old style:**
1. Player guns (`GUNS` / `drawGun`, boxes with a thin ink border now) and held items (`drawHeld`) are not redrawn in the
   new style yet.
2. Jackal (Egypt) and Cyber Hound (Neon Future): they use the raptor rig without a `dino` kind, so they still get the
   old raptor look. They need their own designs (a dog / robot-dog shape on the same points).
3. Flyers (`FLY`, `drawFlyer`: gargoyle, ptero, bat, vulture, parrot, drone): cartoon, INK outlines.

**Rules that must keep working when redrawing a rig:**
- Rig points are the contract (pose, hit tests, ragdoll sticks). Human: 0 head, 1 neck, 2 pelvis, 3/4 back elbow/hand,
  5/6 front elbow/hand, 7/8 back knee/foot, 9/10 front knee/foot. Raptor: 0 head, 1 neck, 2 chest, 3 hip,
  4/5 tail mid/tip, 6/7 near knee/foot, 8/9 far knee/foot. Derive extra joints (ankles, shoulders) in the draw code
  instead of adding points.
- Hit tests use `RIGS[rig].bones` radii and `headR` around point 0: keep the new art roughly inside them.
- `drawRig(c, rig, p, look, s, f, flash, hat, cut, headAng, opt, lod)`: `flash` = white hit flash (keep the outline),
  `cut === 0` = head shot off (the body ends at the neck with a stump, the head is drawn at p[0] turned by `headAng`),
  `lod` = corpse (skip details), `GFX_LOW` = low-graphics setting (skip details). Mirroring by `f` (±1).
- Local frames: `flyFrame(c, origin, ux, uy, f)` gives +x forward and +y down for either facing.

**Recipe that worked (dinos):**
- One smooth silhouette per body: a Catmull-Rom spine through the rig points, sampled, with a half-thickness profile
  above/below (`tw`/`bw`) and `smoothPath` through the edge points. Muscled limbs with `muscle()` (quadratic sides,
  round ends). The head is a hand-made SVG-style `Path2D` in local units, with a hinged jaw.
- Outline = a dark shade of the part's own color (`shade(look.p, 0.32)`), about 1.6-1.8 px, not the black `INK` 3 px.
- Paint: countershading bands (mid tone, pale belly), a `RIM` band on the lit top edge, a dark band on the underside,
  stripes/speckles, eye with slit pupil and glint, teeth.

**Performance rules (measured, not guessed):**
- Never use `clip()`: it tripled the GPU frame time (30 raptors: 12 → 30-36 ms). Instead fill the base, paint strips
  whose edges lie exactly on the silhouette, then stroke the outline last to hide the seams. To keep a front limb's
  ink only outside the body: stroke the limb thick, fill the body, then fill the limb again on top.
- Batch small shapes (stripes, spots, toes, fingers, teeth) into one path and one fill/stroke. Build static shapes
  once (`Path2D`, cached).
- Target: the new art's frame time matches the old art's. Final dinos: 10 → 6.2 ms and 30 → 12.2 ms, the same as the
  old rig.
- How to measure: in the visible in-app browser pane (real GPU), emulate 844×390, spawn N enemies with `?debug`, and
  take the median of the requestAnimationFrame intervals over about 90 frames, new art vs old (toggle the foe's
  `dino`/kind field). `performance.now()` around canvas calls and Playwright timings are misleading: the pane runs in
  the background at 1 fps, and `getImageData` forces CPU raster.

**How to look at the art:**
- `tools/preview.html?era=1&foe=runner,brute,boss&z=2.2` draws big renders. The columns are walk, attack, hit flash,
  corpse with the head cut off, and the old look.
- Use Playwright for sharp images, since the in-app pane is only about 360 px wide: `browser_resize` 1400×900,
  `browser_navigate` to the preview, `browser_take_screenshot` with `filename: tools/out/<name>-<n>.png` (a new name
  each time), then `Read` the PNG.
- For the in-game check, use the same Playwright page at 1280×640 on `/?debug`: `startRun`, `makeEnemy` + push into
  `enemies`, then set `DBG.speed = 0.0001` to freeze. Take before/after screenshots and send them to the user with
  SendUserFile.
