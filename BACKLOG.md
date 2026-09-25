# Backlog

## 0. Qərar: yayım strategiyası (2026-09-25)
**Əvvəlcə CrazyGames, sonra Play Store.**
- **Səbəb:** oyun artıq HTML5-dir və yoxlama 1–2 gün çəkir. Basic Launch real oyunçu datasını (oynama vaxtı, geri qayıtma) pulsuz verir. Eksklüzivlik tələbi yoxdur.
- **Play Store sonraya qalır.** Yeni şəxsi hesab üçün 12 testçi × 14 gün qapalı test tələb olunur. Bunu CrazyGames ilə paralel başlatmaq olar. Paket Capacitor ilə qurulacaq, reklam AdMob, satış Google Play Billing ilə olacaq.
- **Gəlir gözləntisi** (bazar datasına əsasən):
  - CrazyGames-də 1000 oynamaya ~€1–3; orta ssenaridə ayda €200–600.
  - Play Store-da reklamsız, özü tapılaraq ayda $100–400.
  - Pullu reklam yalnız ARPDAU ≥ $0.15 olandan sonra.

### 0.1 CrazyGames: kodda hazır olanlar
- `js/platform.js`: SDK yalnız CrazyGames-də yüklənir (`?cg` ilə lokal test olunur). Başqa yerdə heç nə etmir.
- Oyun başlayıb-dayananda `gameplayStart/Stop` göndərilir. Hər iki halı loop özü aşkarlayır, ona görə pauza, perk ekranı və nəticə ekranı avtomatik əhatə olunur.
- Boss öldürülüb era keçiləndə `happytime` çağırılır.
- Midgame reklam nəticə ekranında CONTINUE basılanda göstərilir. Tezliyi CrazyGames özü idarə edir (max 3 dəqiqədə bir).
- Rewarded reklam nəticə ekranındakı "▶ WATCH AD: +X COINS" düyməsidir (x2 coin). Xəta olsa mükafat verilmir, düymə yox olur. AdBlock olanda və Basic Launch-da düymə göstərilmir.
- Reklam oynayanda səs dayanır. Platformanın `muteAudio` ayarına əməl olunur.
- Yaddaş `SDK.data` ilə CrazyGames hesabına bağlanır (buluddakı versiya üstündür). Göndərişdə "Progress Save" açarını aç.
- Ayarlarda "BLOOD: ON/OFF" var (PEGI 12). OFF olanda qan boz toza çevrilir, baş qopmur.
- CrazyGames-də özümüzün fullscreen funksiyası və service worker söndürülür.

### 0.2 CrazyGames: qalan əl işləri
- [ ] developer.crazygames.com-da hesab aç və Basic Launch üçün göndər.
- [ ] Yükləmə üçün zip: `git archive -o shoot-unlimited.zip HEAD index.html manifest.webmanifest icon.svg js`
- [ ] Kapak şəkilləri (1920×1080, 800×450), qısa təsvir. Təsvirdə fərqləri vurğula: 7 era, perk-lər, endless rift. Məqsəd "kopya" şübhəsini aradan qaldırmaqdır.
- [ ] QA qan və ya baş qopmasını PEGI 12 üçün çox görsə: `blood` ayarının susmaya görə dəyərini `false` et (`readSave` içində).
- [ ] Full Launch dəvəti gəlsə: 1.4-dəki revive ekranını CrazyGames rewarded reklamı ilə tətbiq et. Qayda: hər ölümdən sonra yox, arabir.
- [ ] Basic Launch datasına bax: orta oynama vaxtı və D1. Sonra `BAL`-ı tənzimlə (bənd 3).


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
1. **Faza 1: yalnız rewarded reklam, server yoxdur.** CrazyGames-də reklam yalnız onların SDK-sı ilə göstərilir (`Platform.ad`). Oyundaxili satış (IAP) orada yalnız dəvət alan oyunlara Xsolla ilə açılır. Öz saytımızda (GitHub Pages) reklam yoxdur. Hər şey `localStorage`-da saxlanır. Oyunçu aldatsa, yalnız özünə zərər verir, çünki real pul yoxdur.
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
- [x] İlk 2 raundda dalğa bannerinin altında idarəetmə ipucuları (toxunuş/siçan üçün ayrı-ayrı).
- [ ] Daha tam təlimat lazım olsa: Basic Launch-da oyunçuların ilk raundda nə qədər tez öldüyünə bax.
- Gündəlik tapşırıqlar və nailiyyətlər (1.6 ilə birgə).
- Qəhrəman üçün geyim/papaq seçimi: prosedur çəkilir, ucuz başa gəlir. 💎 ilə kosmetika satmaq olar.

## 5. Səs
- [x] Səs mühərriki yenidən yazıldı (`js/dsp.js`): real atəş səsi layları, partlayış, metal, Karplus-Strong simli alətlər, FM brass, humanize. Hər eranın öz janrı var: city rock, jungle tribal, castle orkestr, desert hijaz, west spaghetti-western, sea shanty 6/8, future synthwave. Musiqi 3 layda çalır (menyu, döyüş, boss). Yoxlama aləti: `tools/listen.js`.
- [ ] Oyunçulardan səs haqqında rəy topla; lazım olsa `SFX_LEVEL` / `MUSIC_VOL` (`js/audio.js`) tənzimlənsin.
- [ ] Səs səviyyəsi üçün slayder (SFX/MUSIC ayrı), əgər oyunçular istəsə.

## 6. Texniki sığorta
- Yaddaşın ixracı/idxalı. CrazyGames-də artıq lazım deyil: orada yaddaş SDK buludunda saxlanır. Yalnız GitHub Pages/PWA üçün qalır.
- [x] GitHub Actions: hər push-da `tools/check.js` və qısa sim (`.github/workflows/check.yml`).

## Hələlik lazım deyil
- Onlayn liderlər cədvəli (server lazımdır, oyunçu bazası yoxdur).
- Play Store versiyası: Faza 2 IAP-a qədər PWA kifayətdir.
