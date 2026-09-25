---
name: character-art
description: Designing, drawing, and refining realistic procedural characters (dinos, humans, flyers, beasts). Use when modifying character rigs, updating art style from boxy to realistic, tuning GPU rendering performance, or previewing character animations.
---

# Procedural Character Art Guide ("Realistic, Not Boxy")

Bu təlimat personajların köhnə qutu (boxy) cizgi filmi üslubundan (kvadrat başlar, kapsul ətraflar, qalın qara kontur) yeni realistik üsluba keçirilməsi prosesini və performans qaydalarını izah edir.

## 1. Hazırkı Vəziyyət
- **Tamamlanıb:** Yura (Jurassic) erası dinozavrları (Raptor, Bonecrusher, T-Rex) — `js/engine.js` daxilində `DINO`, `drawDino`, `dinoHead` (`js/data.js`-də `dino: 'raptor' | 'crusher' | 'rex'`).
- **Gözləyən personajlar (Köhnə üslubda qalanlar):**
  1. **İnsanlar:** Bütün eraların piyada/qaçan/atıcı/partlayan/qalxanlı/brute/boss personajları və oyunçunun özü (`drawRig`, `drawHead`, `outfit`, `drawHeld`, `drawPlayer`).
  2. **Jackal (Misir) və Cyber Hound (Gələcək):** Raptor skeletindən istifadə edirlər, lakin xüsusi it/robot-it formalarına ehtiyacları var.
  3. **Uçanlar (Flyers):** Qarqoyl, pterodaktil, yarasa, leşyeyən, tutuquşu, dron (`FLY`, `drawFlyer`).

---

## 2. Rig Müqaviləsi (Dəyişdirilməsi Qadağan Olan Qaydalar)
Yeni forma çəkərkən skelet nöqtələrinin koordinatları və mənaları pozulmamalıdır:
- **Human:** 0 baş, 1 boyun, 2 çanaq, 3/4 arxa dirsək/əl, 5/6 ön dirsək/əl, 7/8 arxa diz/ayaq, 9/10 ön diz/ayaq.
- **Raptor:** 0 baş, 1 boyun, 2 döş, 3 bud, 4/5 quyruq orta/uc, 6/7 yaxın diz/ayaq, 8/9 uzaq diz/ayaq.
- **Əlavə oynaqlara ehtiyac olduqda:** Skeletə yeni nöqtə əlavə etməyin, onları çəkmə kodunda mövcud nöqtələrdən riyazi törədin (derive edin).
- **Vurulma Sahəsi (Hit Tests):** `RIGS[rig].bones` radiusları və 0 nöqtəsi ətrafındakı `headR` dəyərlərindən istifadə edir. Yeni çəkilən vizual forma bu sərhədlərdən kənara çıxmamalıdır.
- **Parametrlər:** `drawRig(c, rig, p, look, s, f, flash, hat, cut, headAng, opt, lod)`:
  - `flash`: ağ rəngli zərbə yanıb-sönməsi (konturu saxla).
  - `cut === 0`: baş qopub (bədən boyunda kəsik kötüyü ilə bitir, baş p[0]-da `headAng` ilə fırlanır).
  - `lod`: cəsədlər üçün detalları atlamaq.
  - `GFX_LOW`: zəif qrafika ayarında xırda detalları keçmək.
  - `f`: istiqamət aynalaması (±1).

---

## 3. Realistik Üslubun Qaydası (Recipe)
Dinozavrlarda uğurla işləyən yanaşma:
1. **Bədən Silueti:** Skelet nöqtələrindən keçən Catmull-Rom onurğası, yuxarı/aşağı profil qalınlıqları (`tw`/`bw`) və kənar nöqtələrdən `smoothPath`.
2. **Əzələli Ətraflar:** `muscle()` funksiyası ilə kvadratik əyrilər və yuvarlaq uclar.
3. **Baş:** Lokal koordinatlarda əllə qurulmuş SVG tipli `Path2D` və hərəkətli çənə.
4. **Kontur (Ink):** Qara `INK` (3px) əvəzinə hissənin öz rənginin tünd çaları (`shade(look.p, 0.32)`), təxminən 1.6-1.8px.
5. **Rəngləmə:** Qarın hissədə açıq rəng (countershading), işıqlı üst kənarda `RIM` zolağı, alt kənarda tünd kölgə, zolaqlar/xallar, dar göz bəbəyi və parıltı, dişlər.

---

## 4. Performans Qaydaları (Ölçülmüş və Məcburidir)
- **QƏTİ QADAĞANDIR: `clip()` istifadə etmək.** `clip()` GPU çəkmə vaxtını 3 dəfə artırır (30 raptorda: 12ms -> 36ms). Əvəzində əvvəlcə əsas rəngi çəkin, sonra konturları sonuncu çəkərək birləşmə xətlərini örtün.
- **Formaları Birləşdirmək (Batching):** Kiçik elementləri (zolaqlar, ləkələr, dişlər, barmaqlar) tək bir `Path2D` daxilində birləşdirin və tək bir `fill()` / `stroke()` ilə çəkin.
- **Hədəf:** Yeni sənətin kadr müddəti (frame time) köhnə üslubla eyni olmalıdır (10 düşmən üçün ~6.2ms, 30 düşmən üçün ~12.2ms).

---

## 5. Vizual Yoxlama (Testing & Preview)
1. **İri Rəsm Paneli:**
   `http://localhost:8123/tools/preview.html?era=1&foe=runner,brute,boss&z=2.2`
   Burada addımlama, hücum, vurulma yanıb-sönməsi, başı kəsilmiş cəsəd və köhnə görünüş yan-yana göstərilir.
2. **Playwright ilə Skrinşot:**
   İn-app pəncərəsi kiçik olduğundan, aydın rəsmlər üçün:
   - Brauzer ölçüsü: 1400x900
   - Skrinşot: `tools/out/<ad>-<n>.png` (hər dəfə yeni ad)
3. **Oyun İçi Sınaq:**
   `http://localhost:8123/?debug` ünvanında `startRun`, `makeEnemy` çağırıb `DBG.speed = 0.0001` ilə oyunu dondurun və dəyişiklikləri canlı yoxlayın.
