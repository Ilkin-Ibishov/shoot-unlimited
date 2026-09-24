# Backlog

## 1. Monetizasiya (əsas prioritet)

### 1.1 Prinsiplər
- **Ödəniş vaxta qənaət etdirir, bacarığı əvəz etmir.** Ödəyən oyunçu irəliləməyə tez çatır. Amma ödəyərək bir dalğanı zorla keçmək mümkün olmamalıdır: hər raunda kömək limiti var.
- **Məcburi reklam yoxdur.** Yalnız oyunçunun özü seçdiyi *rewarded* reklam olur (bax: 1.4). Interstitial reklam bu janrda oyunçunu tez itirir.
- **Pulsuz oyunçu da almaz qazanır.** Belə olmasa, almaz "divar" kimi hiss olunur.

### 1.2 Valyutalar
| | 🪙 Coin (mövcuddur) | 💎 Almaz (yeni) |
|---|---|---|
| Mənbə | Oyun zamanı (öldürmə, dalğa, era) | Gündəlik giriş, tapşırıqlar, nailiyyətlər, eranı ilk dəfə keçmək, reklam, IAP |
| Nəyə xərclənir | Upgrade, silah | Çatışmayan coin, əlavə helper, revive, kosmetika |
| Tempi | Hər raund yüzlərlə/minlərlə | Gündə ~20–30 pulsuz |

### 1.3 Almaz → coin (upgrade-də çatışmayan hissə)
- Almazla **yalnız çatışmayan məbləğ** ödənir, həm də yalnız oyunçunun qiymətin ən azı **50%-i** qədər coin-i varsa. Bu qayda coin-i dəyərli saxlayır və proqresi tamamilə satın almağa imkan vermir.
- Məzənnə oyunçunun ən yüksək açıq erasına bağlıdır: **1 💎 ≈ həmin erada orta bir raundun coin gəlirinin 1/10-u.** Deməli, 10 💎 ≈ bir raund grind-ə qənaət deməkdir.
  - Köhnə sim dump-ı (09-23, son balansdan əvvəl) orta raundda coin gəliri: era1 ≈ 680, era4 ≈ 4200, era7 ≈ 10 000. Deməli, 1 💎 ≈ 70 → 1000 coin.
  - Tətbiqdən əvvəl `tools/sim.js`-i yenidən işlət və `ERAS[i].gemRate` cədvəlini son balansdan hesabla. Formula: `diamonds = ceil(shortfall / gemRate(topEra))`.
- Silahlara da tətbiq olunur, amma məzənnə 1.5 dəfə baha olur. Silah ən böyük proqres sıçrayışıdır.

### 1.4 Helper power-lər (gündəlik limitli)
| Helper | Effekt | Pulsuz/gün | Əlavəsi | Raund limiti |
|---|---|---|---|---|
| ❄️ Time Freeze | Bütün düşmənlər 4 s donur (bosslar 50%) | 3 | 1 reklam və ya 8 💎 | 2 |
| 💣 Air Strike | Ekrandakı düşmənlərə böyük zərbə (bossa max HP-nin 15%-i) | 2 | 1 reklam və ya 10 💎 | 2 |
| ❤️ Revive | Öldükdən sonra 60% HP ilə davam, düşmənləri itələyir | — | 1-ci: reklam; 2-ci: 25 💎 | 2 |
| 🪙 x2 Coin | Nəticə ekranında raundun coin-ini ikiqat edir | — | reklam | 1 |

- Qeyd: mövcud *grenade* və *bullet time* bacarıqları cooldown ilə pulsuz qalır. Helper-lər ayrıca və daha güclü olan istehlak düymələridir.
- Revive monetizasiyanın ən güclü nöqtəsidir: ölüm anında "davam et?" sualı. Buna görə revive ekranı sadə və 5 saniyəlik geri sayımla olmalıdır.
- Gündəlik sıfırlanma yerli gecə yarısında olur. Yaddaşa `save.daily = { day, freeze, bomb, ads }` yazılır. Saatı dəyişib aldatmaq mümkündür. Ciddi problemə çevrilsə, serverdən vaxtı yoxlamaq lazımdır.

### 1.5 Reklam limitləri
- Gündə maksimum **12 rewarded reklam** (bütün növlər birlikdə). Limitdən sonra düymələr yalnız 💎 ilə işləyir.
- Reklamdan pulsuz almaz: gündə 3 dəfə, hər biri 5 💎.

### 1.6 Pulsuz almaz mənbələri (~20–30 💎/gün)
- Gündəlik giriş seriyası: 5 / 5 / 10 / 10 / 15 / 15 / 30 💎 (7-ci gün).
- 3 gündəlik tapşırıq (məs. "30 headshot", "boss öldür", "5 dalğanı zərər almadan keç"): hər biri 5 💎.
- Eranı ilk dəfə keçmək: 20 💎 × era nömrəsi.
- Nailiyyətlər: birdəfəlik 10–50 💎.

### 1.7 Mağaza (IAP)
| Paket | Qiymət | 💎 | Qeyd |
|---|---|---|---|
| Kiçik | $0.99 | 80 | |
| Orta | $4.99 | 450 | +12% |
| Böyük | $9.99 | 1000 | +25% |
| Starter pack | $1.99 | 200 + 3 freeze + 3 bomb | birdəfəlik, ilk 3 gün |
| VIP | $4.99 birdəfəlik | — | Rewarded düymələri reklamsız işləyir, x2 coin həmişə aktivdir |

### 1.8 Texniki plan
1. **Faza 1: yalnız rewarded reklam, server yoxdur.** PWA üçün Google H5 Games Ads (Ad Placement API, `adBreak({type:'reward'})`) istifadə olunur. Hər şey `localStorage`-da saxlanır. Oyunçu aldatsa, yalnız özünə zərər verir, çünki real pul yoxdur.
2. **Faza 2: IAP.** Real pulla alınan almazlar üçün server tərəfdə balans və çek (receipt) yoxlaması **mütləqdir**, çünki `localStorage` asan dəyişdirilir. Seçimlər:
   - Capacitor ilə Play Store-a çıxarmaq (Google Play Billing + AdMob);
   - veb-də qalmaq (Stripe + backend, məs. Supabase).
3. Balans: `BAL`-a `gem*` açarlarını əlavə etmək. `tools/sim.js`-ə "helper istifadə edən bot" rejimini qoşub pulsuz və ödəyən oyunçunun kampaniya müddətini müqayisə etmək.
   - Hədəf: ödəyən oyunçu ~30–40% tez bitirir, 3 dəfə tez yox.

## 2. Real telefonda sınaq
- Orta və zəif Android-də FPS, toxunuşla nişan almanın rahatlığı, düymələrin ölçüsü.
- Ekran kəsiyi (notch) və jest paneli düymələri örtməsin (`env(safe-area-inset-*)`).

## 3. Balansı real oyunçularla dəqiqləşdirmək
- Simulyasiya bot üçün təxmindir: orta oyunçu ~37 cəhd, ~2.5 saat.
- 2–3 nəfər oynasın. Qeyd et: harada ilişirlər, nə alırlar, harada oyunu buraxırlar. Sonra `BAL`-ı buna görə düzəlt.

## 4. Oyunçunu saxlamaq
- İlk girişdə qısa təlimat: nişan, təpik, qumbara.
- Gündəlik tapşırıqlar və nailiyyətlər (1.6 ilə birgə).
- Qəhrəman üçün geyim/papaq seçimi: prosedur çəkilir, ucuz başa gəlir. 💎 ilə kosmetika satmaq olar.

## 5. Səs
- Hər eraya qısa, dövri fon musiqisi.

## 6. Texniki sığorta
- Yaddaşın ixracı/idxalı (hazırda yalnız `localStorage`).
- GitHub Actions: hər push-da `tools/check.js` və qısa sim.

## Hələlik lazım deyil
- Onlayn liderlər cədvəli (server lazımdır, oyunçu bazası yoxdur).
- Play Store versiyası: Faza 2 IAP-a qədər PWA kifayətdir.
