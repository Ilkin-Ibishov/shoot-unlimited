# Silah əsaslı upgrade-lər: balans hesabı və plan

Prototip `weapon-upgrades` branch-indədir (commit `aa37274`). Oyun məntiqi, data və simulyator hazırdır, UI hələ yoxdur.
Bütün rəqəmlər real oyun kodu ilə işləyən simulyatordan gəlir: `tools/sim.js`, `tools/econ.js`, silah testi `sim.js wtest=`.

## 1. İndiki sistemin analizi (baza xətti, hər bacarıq üçün 4 kampaniya)

| Bot | Kampaniya | Oyun vaxtı |
|---|---|---|
| Casual | 63 raund | 3.8 saat |
| Avg | 45 raund | 3.0 saat |
| Pro | 28.5 raund | 1.9 saat |

Tapıntılar:
1. **Silah pilləkəni sınıqdır.** Botlar oyunu SMG → Rifle ilə bitirir, Shotgun, Sniper və Rocket praktiki olaraq alınmır. Nəzəri güc (L0):

   | Silah | Güc (L0) | Əvvəlkinə nisbət |
   |---|---|---|
   | Pistol | 8.2 | — |
   | SMG | 13.8 | 1.68× |
   | Shotgun | 14.2 | 1.03× |
   | Rifle | 23.9 | 1.68× |
   | Sniper | 27 | 1.13× |
   | Rocket | 23.8 | 0.88× |
   | Laser | 97.5 | 4.1× |

2. **Güc upgrade-lərdən gəlir, silahdan yox.** Qlobal upgrade-lər istənilən silahı 53 dəfəyə qədər gücləndirir, silahlar arasındakı fərq isə 4 dəfədən azdır.
3. **Son eraları personaj statları daşıyır.** Era 3→7 arasında düşmən HP-si 4.7 dəfə artır, tələb olunan silah gücü isə cəmi 2.1 dəfə. Qalanını crit, headshot, HP və perk-lər örtür.

Nəticə: upgrade-ləri sadəcə silaha köçürmək işləmir. Silah pilləkəni və era çətinliyi birlikdə yenidən qurulmalıdır.

## 2. Yeni model

**Personaj (qlobal):** Income, Armor, Crit Chance, Headshot. Formullar və qiymətlər olduğu kimi qalır.

**Silah (hər silahın özünün, hər stat 10 səviyyə):**

| Stat | Hər səviyyədə | L10-da |
|---|---|---|
| Damage | +8% | ×1.8 |
| Fire Rate | +4% | ×1.4 |
| Magazine (Laser-də Cooling) | +10% | ×2 |
| Reload | −5% vaxt | −33% |

- Bir silah L0-dan L10-a real zərər/san-da təxminən **2.8 dəfə** böyüyür.
- Qiymət: `silah.up × k × 1.27^səviyyə`. Burada Damage və Fire Rate üçün k = 1, Magazine və Reload üçün k = 0.7. Hər silahın upgrade-ləri öz erasının gəlirinə uyğun qiymətdədir.
- **Kick və qumbara** zərəri silahın `tier`-i × Damage səviyyəsi ilə böyüyür. Əvvəl qlobal Damage upgrade-inə bağlı idi.

**Silah pilləkəni.** Hər silah əvvəlkindən təxminən 2 dəfə güclüdür. Yeni silahın L0 gücü əvvəlkinin təxminən L6–7 gücünə bərabərdir, ona görə yeni silaha keçid "cəza" deyil. Zərərlər nəzəri formula ilə yox, real oyun testləri ilə kalibrlənib: hər silah öz erasında L5-də boss-a çatır.

| Silah | Ev erası | Zərər (köhnə → yeni) | Qiymət (köhnə → yeni) | Upgrade bazası | Tier |
|---|---|---|---|---|---|
| Pistol | başlanğıc | 10 | 0 | 3 | 1 |
| SMG | 1 | 5 → 6 | 900 | 12 | 2 |
| Shotgun | 2 | 6 → 14 (×7 qəlpə) | 2500 → 1600 | 60 | 4 |
| Rifle | 3 | 11 → 30 | 6000 → 4000 | 100 | 8 |
| Sniper | 4 | 70 → 380, sürət 0.8 → 1.3, sursat 5 → 6, 3 düşməni deşib keçir | 15000 → 6500 | 150 | 16 |
| Rocket | 5 | 55 → 1300 | 20000 → 10000 | 260 | 30 |
| Laser | 6–7 | 95 → 600 dps | 35000 → 13000 | 450 | 60 |

Sniper-in xarakteri dəyişdi: yavaş və çox güclü atəş overkill üzündən işləmirdi, çünki bir atəş düşmənin HP-sindən 2–3 dəfə artıq zərər vururdu. Artıq daha tez atır və daha çox düşməni deşib keçir.

**Era çətinliyi (düşmən HP əmsalı):**

| Era | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Köhnə | 1 | 3.6 | 6 | 15 | 18 | 21 | 28 |
| Yeni | 0.7 | 1.8 | 3 | 8 | 13 | 20 | 40 |

Hər era təxminən bir silah pilləsi qədər çətinləşir. Raund başına gəlir (`era.coin`) dəyişməyib.

## 3. Nəticə (yeni sistem, hər bacarıq üçün 6 kampaniya)

| Bot | Baza xətti | Yeni sistem |
|---|---|---|
| Casual | 63 raund, 3.8 saat | 48.5 raund, 3.1 saat |
| Avg | 45 raund, 3.0 saat | 46.8 raund, 3.0 saat |
| Pro | 28.5 raund, 1.9 saat | 33 raund, 2.1 saat |

Casual üçün hər erada raund sayı (yeni → köhnə):

| Era | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Yeni | 6 | 3.7 | 6.7 | 5.7 | 10.7 | 7.3 | 8.5 |
| Köhnə | 6.8 | 6.8 | 11.3 | 8 | 10.3 | 10.8 | 9.3 |

- Tempo daha bərabərdir: hər era 4–11 raund.
- Hər erada yeni silah həqiqətən alınır və istifadə olunur. Botlar hər eranı həmin eranın silahı ilə keçir.
- Xərclər balanslıdır: hər erada silah + silah upgrade-ləri + personaj.

## 4. Risklər və açıq suallar
1. **Bacarıq fərqi azalır.** Pro və casual arasındakı fərq 2.2× idi, indi 1.5×-dir. Silah almaq üçün pul yığmaq hamı üçün eyni "divar"dır. Silah qiymətlərini aşağı salmaq bunu xeyli yaxşılaşdırdı. Daha çox fərq istənilsə, qiymətləri daha da endirib upgrade qiymətlərini qaldırmaq olar.
2. **Son eranın öz silahı yoxdur.** Era 7 maksimum Laser və personaj statları ilə keçilir. Tövsiyə: Neon Future üçün 8-ci silah (məsələn Plasma Cannon və ya Railgun). Ayrıca iş kimi.
3. **Casual üçün Rocket çətin silahdır.** Yavaş mərmi hərəkət edən hədəfə qabaqcadan nişan tələb edir. Era 5 casual üçün ən uzun eradır (10–15 raund). Qəbul edilə bilər, çünki "bacarıq silahı"dır. Lazım olsa, mərminin sürəti 900 → 1100 edilə bilər.
4. **Sim-in nəzəri güc formulu Sniper və Rocket-i şişirdirdi.** Pierce və partlayış bonusları real oyunda demək olar ki görünmədi. Balans real testlərlə aparıldı. Formula yalnız hesabat üçün qalır.

## 5. Tətbiq planı (təsdiqdən sonra)
1. **Data və məntiq:** prototipdən `main`-ə keçir. Branch-də hazırdır: `WUP`, `wupCost`, `save.wup`, `computeWeapon`, kick/qumbara, sim.
2. **Köhnə yaddaşın köçürülməsi:** Damage, Fire Rate, Magazine və Reload-a xərclənən bütün coin-lər geri qaytarılır. Qiymətləri köhnə formullarla hesablanır.
3. **UI:**
   - Menyunun altındakı uzun zolaq `[🔫 SİLAH | 🧍 QƏHRƏMAN]` keçidi və 4 kompakt kartla əvəz olunur, telefonda sürüşdürmə olmur.
   - Kartda ikon, ad, 10 səviyyə nöqtəsi və qiymət düyməsi olur.
   - Silah kartları seçilmiş silaha aiddir.
   - Arsenal ekranında hər silahın yanında səviyyələri və "L0 gücü → L10 gücü" görünür.
4. **Debug paneli:** "Silah upgrade-lərini max et / sıfırla", "hamısını max et".
5. **Simulyatorla yoxlama:** hər dəyişiklikdən sonra `node tools/sim.js skill=all n=6`. Hədəf: casual ~50, avg ~45, pro ~30 raund.
6. **Ayrıca iş:** 8-ci silah (Era 7), Rocket mərmisinin sürəti.
