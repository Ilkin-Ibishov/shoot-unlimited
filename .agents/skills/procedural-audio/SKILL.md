---
name: procedural-audio
description: Designing, judging, and tuning the game's procedural sound effects and music (js/dsp.js). Use when adding or changing any sound, music, mix levels, or when the user says audio sounds synthetic/"AI"/generic, too quiet, muddy, or harsh.
---

# Procedural Audio Guide: Səs Sintezi və Tənzimləmə

Oyun daxilindəki bütün səslər və musiqilər sıfırdan riyazi olaraq [`js/dsp.js`](file:///c:/Programming/Shoot%20Unlimited/js/dsp.js) daxilində sintez olunur. Heç bir audio faylı (WAV/MP3) yüklənmir.

Səsləri birbaşa eşidə bilmədiyimiz üçün, qiymətləndirmə **vizual spektroqram analizi** ilə aparılır:
`tools/listen.js` oyundakı eyni kodu (`js/dsp.js`) Node.js mühitində render edir və spektroqram PNG + WAV faylı yaradır. Heç vaxt spektroqrama baxmadan səs parametri dəyişməyin.

---

## 1. Səs Alətlərinin İşə Salınması
```bash
node tools/listen.js sfx all            # Bütün SFX-lərin spektroqram cədvəli və ölçüləri
node tools/listen.js sfx pistol 1       # Bir səs: variant 1, böyük spektroqram
node tools/listen.js music city bed     # Bir eranın musiqi layı (bed | groove | boss)
```
- Nəticə: `tools/out/<ad>-<run>.png` (şəkil baxıcısı keşləməsin deyə ad hər dəfə dəyişir).
- Spektroqram 40 Hz-dən 18 kHz-ə qədər loqarifmik oxdan istifadə edir.
  - Sian xətləri: 100 Hz, 1 kHz və 10 kHz.
  - Rənglər: qara (-96 dB) -> sarı (0 dB).
- **Əsas Metriklər:**
  - `peak / RMS / crest`: səsin gücü və sıxlığı (punch).
  - `attack`: pik həddə çatma vaxtı.
  - `decay`: 20 və 40 dB düşmə müddəti.
  - `spectral centroid`: ümumi parlaqlıq/itilik.
  - `bands`: sub (<60Hz), bass (60-250Hz), lowmid (250-1k), mid (1-4k), high (4-10k), air (>10k).

---

## 2. Audio Arxitekturası
1. **`js/dsp.js`:** Bütün sintezi oflayn rejimdə, nümunə-nümunə (sample-by-sample) `Float32Array` içinə yazır. Heç bir WebAudio asılılığı yoxdur, ona görə həm Node.js-də, həm də brauzer Worker-də işləyir.
2. **`js/audio-worker.js`:** Hər sorğu üçün arxa fonda bir render işi icra edir.
3. **`js/audio.js`:** Səsləri oxudur:
   - `Sfx.prep()`: Səhifə açılan kimi ən vacib səsləri (`SFX_FIRST`) növbə ilə render edir.
   - `Sfx.play(name)`: ±3% ton (pitch) və ±6% səs səviyyəsi dəyişkənliyi ilə təsadüfi variant seçir.
   - `Music`: Hər era üçün 3 stereo layı (`bed`, `groove`, `boss`) dövr edir və gərginliyə görə qarışdırır (`MUSIC_MIX`). Böyük partlayışlar musiqini bir qədər azaldır (ducking).
   - Səs səviyyələri: `SFX_LEVEL` və `MUSIC_VOL` daxilində tənzimlənir. Səslərin çıxışı -1 ilə -3 dBFS peak aralığında normallaşdırılmalıdır.

---

## 3. Realistik Səslərin Qaydaları ("Synthy" olmamaq üçün)
- **Silah Atəşləri Təbəqəli Olmalıdır (Layering):**
  1. `crack`: 1-2 ms yüksək tezlikli səs-küy partlayışı (high-pass noise).
  2. `body`: 4-qütblü aşağı tezlik filtrindən keçən səs-küy (4-6 kHz-dən 700 Hz-ə sürüşür, τ: 20-70 ms).
  3. `muzzle chirp`: aşağı tezlikli sinus (140 Hz-dən 45 Hz-ə düşür).
  4. `mechanics`: çaxmağın və ya tətiyin metal klikləri.
  5. `saturation`: `tanh` ilə zərif doydurma.
  6. `space`: əks-səda (reverb).
  * *Hədəflər:* centroid 1-2 kHz, bass <35%, sub <=15%, attack 0 ms.
- **Akustik Məkan (Space/Reverb):** Əks-sədaya göndərilən siqnalı əvvəlcə yüksək tezlik filtrindən (~220 Hz) keçirin, əks halda quyruq boğuq gurultuya çevrilir.
- **Partlayışlar:** Pik dərhal 0 ms-də baş verməlidir (yüksək şaqqıltı). Uçuşan qalıqlar (debris) musiqi notları deyil, qısa səs-küy dənəcikləri olmalıdır. Sub tezlik 25%-i keçməməlidir (telefon dinamikləri 250 Hz-dən aşağı çala bilmir).
- **Metal Zərbələri:** Harmonik olmayan ~16 qismi tezlik (partials) və qısa sönmə (15-120 ms). Təmiz, uzun tək ton = zəng səsi kimi səslənir və saxta təsir bağışlayır.
- **Pullar və UI:** Tez-tez səsləndiyi üçün zəngiltili (jingle) olmamalıdır:
  - 4 kHz-dən yuxarı enerjini kəsin, isti qısa taxta/marimba zərbəsi istifadə edin (τ ≈ 50 ms).
  - Pentatonik pillələrdən istifadə edin ki, ard-arda yığılanda kiçik melodiya yaratsın.
  - Uşaq bağçası təəssüratı yaradan arfalar, qlokenspillər və major fanfarları qadağandır.
