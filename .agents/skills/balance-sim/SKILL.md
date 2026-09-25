---
name: balance-sim
description: Running balance simulations, tuning difficulty curves, weapon DPS, economy, and progression formulas. Use when changing enemy health/damage, weapon stats, upgrade costs, wave formulas, or verifying game balance with headless bot campaigns.
---

# Balance & Economy Simulator Guide

`Shoot Unlimited` layihəsində oyun balansı təxminlərlə deyil, **headless bot simulyasiyası** ilə ölçülür. Simulyator oyunun real kodunu (`step()`, `data.js`, `game.js`) ekransız işlədir. İnsan kimi nişan alan bot (reaksiya gecikməsi, hədəfi izləmə, nişangah sürüşməsi) bütün kampaniyanı avtomatik oynayır: döyüş -> mağaza -> döyüş.

Bütün balans rəqəmləri [`js/data.js`](file:///c:/Programming/Shoot%20Unlimited/js/data.js) faylında saxlanılır. **Kodu deyil, rəqəmləri dəyişin.**

---

## 1. Simulyasiyanın İşə Salınması
```bash
# Orta oyunçu üçün 1 və ya bir neçə kampaniya testi
node tools/sim.js skill=avg n=1

# Bütün bacarıq səviyyələri üzrə (casual, avg, pro) geniş test
node tools/sim.js skill=all n=3

# Müəyyən bir eranı konkret silahlarla və səviyyə ilə sınaqdan keçirmək
node tools/sim.js wtest=3 lv=5 guns=rifle,sniper
```

### Bot Profilləri (`SKILLS`):
- **`casual`:** Reaksiya 0.45s, yavaş sürüşdürmə, 15% başa nişanalma, qabaqlama (lead) yoxdur.
- **`avg`:** Reaksiya 0.3s, 35% başa nişanalma, orta qabaqlama (0.5), ağıllı perk seçimi.
- **`pro`:** Reaksiya 0.18s, sürətli nişanalma, 70% başa nişanalma, tam qabaqlama.

---

## 2. Nəticələrin Təhlili və Hədəflər
Cədvəldə əks olunan əsas göstəricilər:
- `runs`: Bu eranı keçmək üçün tələb olunan cəhd sayı. Hədəf: ortalama hər era üçün 4-7 run.
- `1st%`: Eranı ilk dəfə keçməyə çatanda dalğanın neçə faizinin tamamlandığı.
- `minutes`: Həmin erada keçirilən ümumi vaxt.
- `minHP`: Oyunçunun minimum qalan canı. Əgər 50%-dən yuxarıdırsa, era çox asandır; 0% çoxdursa, ölüm sayı yüksəkdir.
- `deaths`: Eradakı ölüm sayı.

### ⚠️ Balans Əyrisinin Tənzimlənməsi Qaydaları:
- **Heç bir era 1 run-a (ilk cəhddə 100%) keçilməməlidir.** Bu hal baş verirsə (məsələn, Sniper-in Era 4-ü dərhal təmizləməsi), ya həmin eranın düşmən HP/sayı azdır, ya da silah həddindən artıq güclüdür.
- **Divarların qarşısının alınması:** Heç bir era ardıcıl 8-10-dan çox ölümə səbəb olmamalıdır (oyunçunun oyunu tərk etmə riski).

---

## 3. İqtisadiyyat Analizi (`tools/econ.js`)
Oyunçunun qazandığı pulların hara xərcləndiyini və silah gücünü yoxlamaq üçün:
```bash
node tools/sim.js skill=all n=4 dump=tools/out/bal/base
node tools/econ.js tools/out/bal/base
```
Bu alət hər era üzrə:
- Orta gəliri (`coins/run`),
- İlkin və qələbə anındakı silah DPS gücünü (`gun power`),
- Xərclərin silahlara, silah upgrade-lərinə və qəhrəman xüsusiyyətlərinə bölünməsini göstərir.

---

## 4. Əsas Balans Parametrləri (`js/data.js`)
- `BAL.waveBase` və `BAL.waveGrow`: Hər dalğada gələn düşmən sayı.
- `BAL.waveHp`, `BAL.waveDmg`, `BAL.eraDmg`: Era və dalğa üzrə düşmən güclənmə əmsalları.
- `BAL.bulletDmg` və `BAL.fireRate`: Bütün silahlar üçün qlobal tənzimləmə multiplikatorları.
- `WEAPONS`: Hər silahın baza göstəriciləri (dmg, rate, mag, reload, pierce, explode).
- `WUP.fx` və `UP`: Upgrade artım funksiyaları.
