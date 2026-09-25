---
name: crazygames-release
description: Preparing builds, testing SDK v3 integration, handling ads, cloud saves, PEGI compliance, and packaging for CrazyGames launch. Use when working on portal SDK, ads, release zip archives, or publishing requirements.
---

# CrazyGames Release & SDK v3 Guide

Bu bələdçi oyunun CrazyGames portalına göndərilməsi, SDK v3 inteqrasiyasının sınaqdan keçirilməsi və buraxılış paketinin (zip) hazırlanması qaydalarını ehtiva edir.

---

## 1. SDK İnteqrasiyası ([`js/platform.js`](file:///c:/Programming/Shoot%20Unlimited/js/platform.js))
- **Aktivləşmə:** SDK yalnız `crazygames.com` domenində və ya lokal test zamanı URL-ə `?cg` əlavə edildikdə yüklənir (`http://localhost:8123/?cg`). Digər hallarda bütün funksiyalar no-op (təsirsiz) qalır.
- **`gameplayStart()` və `gameplayStop()`:** Əsas dövr (`frame()`) oyun vəziyyətini (`G.state === 'play'`) izləyir. Pauza, perk seçimi, nəticə ekranı və menyuda `gameplayStop()` avtomatik çağırılır.
- **`happytime()`:** Boss öldürülüb era uğurla başa çatdıqda çağırılır.
- **Səslərin İdarəsi:** Reklam başlayan zaman `Sfx.ac?.suspend()`, bitdikdə `resume()` edilir. Platformanın özünün `muteAudio` ayarı dinlənilir.

---

## 2. Reklam Axını (Ad Placement)
- **Midgame Reklam:** Nəticə ekranında "CONTINUE" və ya "UPGRADE & RETRY" basıldıqda göstərilir. Tezliyi CrazyGames özü idarə edir (təxminən 3 dəqiqədən bir).
- **Rewarded Reklam:** Nəticə ekranındakı `▶ WATCH AD: +X COINS` düyməsidir (qazanılan pulu 2 dəfə artırır).
  - Xəta və ya imtina baş verərsə mükafat verilmir, düymə yox olur.
  - Basic Launch və ya AdBlock aşkarlandıqda düymə gizlədilir (`adsDisabledBasicLaunch` kodu).

---

## 3. Bulud Yaddaşı (Cloud Save)
- İstifadəçinin irəliləyişi `sdk.data.setItem(SAVE_KEY, json)` vasitəsilə CrazyGames hesabına sinxronlaşdırılır.
- `boot()` zamanı buluddakı save oxunur və lokal `localStorage`-ın üzərinə yazılır (bulud yaddaşı prioritetdir).
- Portalda "Progress Save" funksiyası aktivləşdirilməlidir.

---

## 4. PEGI 12 və Məzmun Tənzimləmələri
- Ayarlarda `BLOOD: ON/OFF` seçimi mövcuddur (`save.set.blood`).
- `OFF` olduqda:
  - Qan qırmızı rəng əvəzinə boz toza çevrilir.
  - Baş vuruşlarında (`headshot`) baş qopması (decapitation) tamamilə söndürülür.
- Əgər QA yoxlaması bunu PEGI 12 üçün sərt hesab edərsə, `readSave()` daxilində `blood`-un susmaya görə dəyərini `false` edin.

---

## 5. Buraxılış Paketinin Hazırlanması (Zip Build)
CrazyGames panelinə yükləmək üçün təmiz zip arxivi yaradın (artıq test faylları, git və alətlər xaric edilməklə):

```bash
git archive -o shoot-unlimited.zip HEAD index.html manifest.webmanifest icon.svg js
```

### Göndərişdən Əvvəl Yoxlama Siyahısı (Checklist):
1. [ ] `node tools/check.js` xətasız keçir.
2. [ ] `sw.js` daxilində `CACHE` nömrəsi artırılıb.
3. [ ] `http://localhost:8123/?cg` ilə SDK-nın düzgün yükləndiyi və konsolda xəta olmadığı yoxlanılıb.
4. [ ] Zip arxivi çıxarılıb ölçüsü yoxlanılıb (adətən 1 MB-dan xeyli kiçik olmalıdır).
