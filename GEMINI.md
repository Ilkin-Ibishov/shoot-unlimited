# Shoot Unlimited: Agent Təlimatları və Qaydaları

Bu sənəd Google Antigravity agenti üçün `Shoot Unlimited` layihəsinin əsas iş axını, arxitektura məhdudiyyətləri və daxili qaydalarını müəyyən edir.

---

## 1. Əsas Prinsiplər və Texnoloji Məhdudiyyətlər
- **Texnologiya:** Saf HTML5 Canvas + ES6 JavaScript. Heç bir kənar kitabxana (npm, build tool, bundler) və asset faylı yoxdur.
- **Top-Level DOM/Canvas Qadağası:** Node.js simulyatorunun (`tools/sim.js`) skriptləri headless işlədə bilməsi üçün heç vaxt skriptin ən yuxarı səviyyəsində (top-level) `Path2D`, `canvas`, `document` və ya brauzerə xas obyektlər yaratma. Onları yalnız ilk istifadə zamanı (lazy) və ya funksiya daxilində yarat.
- **Dil:** İstifadəçi ilə ünsiyyət Azərbaycan dilində aparılır.

---

## 2. İş Axını (Workflow)
- **Lokal işə salma:** `python -m http.server 8123` -> `http://localhost:8123`
- **Debug rejimi:** URL-də `?debug` parametri ilə açılır (`http://localhost:8123/?debug`). Özünün ayrıca yaddaşı var, bütün silahlar və eralar açıqdır, 🐞 paneli ilə dalğaları dəyişmək və sazlamaq mümkündür.
- **Yoxlama (Sanity Check):** Hər hansı dəyişiklikdən sonra mütləq `node tools/check.js` əmrini işlət.
- **Service Worker və Kəş:** İstehsalata (production) göndərilən hər hansı fayl dəyişdikdə, [`sw.js`](file:///c:/Programming/Shoot%20Unlimited/sw.js) daxilindəki `CACHE` versiyasını artır (`shoot-unlimited-vN`).
- **Brauzer kəşini yeniləmək:** Əgər səhifə köhnə kəşdə qalıbsa, URL sorğusuna yeni versiya əlavə et (`?debug&v=N`).

---

## 3. Auto-Mode və Qərar Qəbuletmə Qaydaları
Tapşırıq aldıqda mürəkkəbliyi daxilən analiz et və müvafiq rejimi tətbiq et:
1. **Sadə tapşırıq:** Birbaşa və sürətli şəkildə həll et.
2. **Mürəkkəb, çoxmərhələli və ya arxitektura qərarı tələb edən tapşırıq:** Avtomatik dərin düşünmə rejiminə keç. Detallı icra planı qur, istifadəçidən təsdiq al və addım-addım irəlilə.
3. **Çoxlu fərqli fayllarda və fərqli kontekstlərdə eyni anda işləmək lazımdırsa:** `invoke_subagent` alətindən istifadə edərək işi məntiqi hissələrə böl və alt-agentlərə tapşır.

### Antigravity Customization Anti-Pattern Qadağası
- **QƏTİ QADAĞANDIR:** İstifadəçi sorğusunu analiz edib agentin iş rejimini seçmək üçün `PreInvocation` və ya hər hansı başqa Hook-dan (xarici skriptdən) istifadə etmək. Bu, interfeysdə gecikmə (latency) yaradır.
- **TƏLƏB:** Bütün bu cür avtomatlaşdırmalar yalnız daxili sistem qaydaları (`GEMINI.md` / `AGENTS.md`) vasitəsilə agentə birbaşa təlimat verilərək tənzimlənir.

---

## 4. Modulyar Bacarıqlar (.agents/skills/)
Kontekst pəncərəsini yükləməmək üçün spesifik sahələrə dair təlimatlar modulyar skill-lərdə saxlanılır. Lazım olduqda müvafiq skill-i aktivləşdir:

- **`character-art`** ([`.agents/skills/character-art/SKILL.md`](file:///c:/Programming/Shoot%20Unlimited/.agents/skills/character-art/SKILL.md)): Personajların qutu (boxy) stilindən yeni realistik üsluba keçirilməsi, Catmull-Rom onurğa və əzələ çəkilişi, GPU büdcəsi və Playwright vizual yoxlama qaydaları.
- **`procedural-audio`** ([`.agents/skills/procedural-audio/SKILL.md`](file:///c:/Programming/Shoot%20Unlimited/.agents/skills/procedural-audio/SKILL.md)): Səs effektləri və musiqinin (`js/dsp.js`) sintezi, spektroqram analizi (`tools/listen.js`), səs təbəqələri və akustika.
- **`balance-sim`** ([`.agents/skills/balance-sim/SKILL.md`](file:///c:/Programming/Shoot%20Unlimited/.agents/skills/balance-sim/SKILL.md)): Oyun balansı, bot simulyasiyası (`tools/sim.js`), iqtisadiyyat analizi (`tools/econ.js`) və silah effektivliyi.
- **`crazygames-release`** ([`.agents/skills/crazygames-release/SKILL.md`](file:///c:/Programming/Shoot%20Unlimited/.agents/skills/crazygames-release/SKILL.md)): CrazyGames SDK v3 qaydaları, bulud yaddaşı, reklam axını, PEGI 12 tənzimləmələri və paketləmə.
