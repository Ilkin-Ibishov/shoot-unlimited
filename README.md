# Shoot Unlimited

"Shoot Die Repeat"-dən ilhamlanmış, zaman səyahətli ragdoll shooter. Saf HTML5 Canvas + JS: dependency, build və asset yoxdur (qrafika və səslər proqramla yaradılır).

## İşə salmaq
```bash
python -m http.server 8123
```
Sonra `http://localhost:8123` açın. Telefonda eyni Wi‑Fi-da `http://<kompüter-IP>:8123` açıb "Add to Home screen" etmək olar (PWA, offline işləyir).

Dev cheat: `?rich` URL-ə əlavə etsəniz +1M coin verir.
Yoxlama: `node tools/check.js`

## Balans simulyatoru
```bash
node tools/sim.js skill=all n=3
```
Oyunun real kodunu ekransız işlədir. İnsan kimi nişan alan bot (casual / avg / pro) bütün kampaniyanı oynayır: run → mağaza → run. Hər era üçün neçə run lazım olduğunu, ilk cəhdin faizini, ölümləri və minimum HP-ni göstərir. Bütün balans rəqəmləri `js/data.js`-də (`BAL`, `ARCH`, `ERAS`, `UPGRADES`, `WEAPONS`) saxlanılır. Hər dəyişiklikdən sonra simulyatoru yenidən işə salın.

## İdarəetmə
- **Mobil:** barmağı yuxarı/aşağı sürüşdürüb nişan alın (swipe). Silah avtomatik atır. 💣 qumbara, ⏳ bullet time, 🔄 reload.
- **PC:** siçan nişan alır, klik atəş açır, `R` reload, `G` qumbara, `SPACE` bullet time, `P` pauza.

## Orijinaldan fərqlər
| Orijinal | Shoot Unlimited |
|---|---|
| 3 upgrade | 8 upgrade (damage, fire rate, income, armor, magazine, reload, crit, headshot) |
| ~7 level, sonra başa qayıdır | 7 era, hərəsinin bossu var + **Endless Time Rift** (hər 5 dalğada era dəyişir) |
| Upgrade etdikcə düşmən də güclənir | Düşmən gücü sabitdir, yalnız era/dalğadan asılıdır |
| Bir səhv = ölüm | HP bar, laser sight, auto-kick (melee), bullet time |
| Reklam | Reklam yoxdur |
| — | Run içində 16 roguelite perk (ricochet, tesla, homing, vampire…) |
| — | 7 silah: pistol, SMG, shotgun, rifle, sniper (pierce), rocket, laser beam |
| — | Düşmən növləri: runner, qalxanlı, dəbilqəli, uçan, uzaqdan atan (mərmisi vurula bilir), partlayan, brute |
| — | Headshot, crit, başın qopması, combo coin multiplier, TNT zəncirvari partlayışlar |

## Fayllar
- `js/data.js`: bütün balans və kontent (era, düşmən, silah, perk). Oyunu tənzimləmək üçün bura baxın.
- `js/engine.js`: səs sintezi, skelet/poza, verlet ragdoll fizikası
- `js/game.js`: dünya, döyüş, dalğalar, input; `step()` bir oyun addımıdır (simulyator da onu istifadə edir)
- `js/render.js`: bütün çəkiliş (fon, relyef, personajlar, effektlər)
- `js/ui.js`: menyu, HUD, modallar
