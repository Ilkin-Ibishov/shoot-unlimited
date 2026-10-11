'use strict';
// Unified Ad & Platform Bridge: CrazyGames SDK, Google H5/AdMob Ads, and In-Game Ad Simulation.

const Platform = {
  sdk: null,
  ads: false,
  mute: false,
  playing: false,
  inAd: false,
  provider: null, // 'crazygames' | 'google' | 'sim'
  lastAdTime: 0,
  adCooldown: 60000, // 60s minimum interval for midgame interstitials (Google Better Ads standard)

  // Configure your Google AdSense / AdMob client ID here when approved (e.g. 'ca-pub-XXXXXXXXXXXXXXXX')
  googleClientId: '',

  async init(onSave) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const hostname = location.hostname || '';
    const referrer = document.referrer || '';
    const isCrazyGames = (!DEBUG && /crazygames/.test(hostname + referrer)) || location.search.includes('cg');
    const isTWA = /android-app:\/\//.test(referrer) || location.search.includes('twa');
    const isAdTest = /[?&](ads|testads)\b/.test(location.search);

    // 1. CrazyGames SDK
    if (isCrazyGames) {
      try {
        await new Promise((ok, fail) => {
          const s = document.createElement('script');
          s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
          s.onload = ok;
          s.onerror = fail;
          document.head.appendChild(s);
        });
        const sdk = window.CrazyGames?.SDK;
        if (sdk) {
          await sdk.init();
          if (sdk.environment !== 'disabled') {
            this.sdk = sdk;
            this.provider = 'crazygames';
            this.ads = true;
            const apply = st => {
              this.mute = !!st.muteAudio;
              if (typeof save !== 'undefined' && typeof Sfx !== 'undefined' && typeof Music !== 'undefined') {
                Sfx.on = save.set.sfx && !this.mute;
                Music.on = save.set.music && !this.mute;
              }
            };
            apply(sdk.game.settings);
            sdk.game.addSettingsChangeListener(apply);
            if (onSave) onSave(sdk.data.getItem(SAVE_KEY));
            return;
          }
        }
      } catch (e) { }
    }

    // 2. Google Ad Placement API (H5 Games Ads / AdMob TWA)
    if (window.adBreak || this.googleClientId) {
      try {
        if (!window.adBreak && this.googleClientId) {
          await new Promise(ok => {
            const s = document.createElement('script');
            s.async = true;
            s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${this.googleClientId}`;
            s.crossOrigin = 'anonymous';
            s.setAttribute('data-ad-frequency-hint', '60s');
            s.onload = ok;
            s.onerror = ok; // continue even if blocked by adblocker
            document.head.appendChild(s);
          });
          window.adsbygoogle = window.adsbygoogle || [];
          window.adBreak = window.adConfig = function(o) { window.adsbygoogle.push(o); };
        }
        if (typeof window.adConfig === 'function') {
          window.adConfig({ preloadAdBreaks: 'on' });
        }
        this.provider = 'google';
        this.ads = true;
        return;
      } catch (e) { }
    }

    // 3. Android TWA / Mobile / Local Ad Simulator fallback
    // Enabled automatically on Android TWA, mobile standalone, ?ads query, or debug mode
    if (isTWA || isAdTest || (!this.sdk && matchMedia?.('(pointer: coarse)').matches)) {
      this.provider = 'sim';
      this.ads = true;
    }
  },

  // Game lifecycle notifications
  gameplay(on) {
    if (on === this.playing) return;
    this.playing = on;
    if (this.sdk) on ? this.sdk.game.gameplayStart() : this.sdk.game.gameplayStop();
  },

  happy() {
    if (this.sdk) this.sdk.game.happytime();
  },

  store(v) {
    if (this.sdk) {
      try { this.sdk.data.setItem(SAVE_KEY, v); } catch (e) { }
    }
  },

  // Requests an ad: type 'midgame' | 'rewarded'. done(ok) fires once upon completion.
  ad(type, done) {
    if (!this.ads) return done(false);

    // Better Ads Standard: enforce interval between midgame interstitials
    const now = Date.now();
    if (type === 'midgame' && (now - this.lastAdTime < this.adCooldown)) {
      return done(false);
    }

    const startAd = () => {
      this.inAd = true;
      if (typeof Sfx !== 'undefined' && Sfx.ac?.state === 'running') {
        Sfx.ac.suspend().catch(() => {});
      }
    };

    const finishAd = ok => {
      this.inAd = false;
      this.lastAdTime = Date.now();
      if (typeof Sfx !== 'undefined' && Sfx.ac?.state === 'suspended') {
        Sfx.ac.resume().catch(() => {});
      }
      done(ok);
    };

    startAd();

    // Provider A: CrazyGames SDK
    if (this.provider === 'crazygames' && this.sdk) {
      this.sdk.ad.requestAd(type, {
        adStarted: () => {},
        adFinished: () => finishAd(true),
        adError: e => {
          if (e && (e.code === 'adsDisabledBasicLaunch' || e.code === 'adblock')) this.ads = false;
          finishAd(false);
        },
      });
      return;
    }

    // Provider B: Google H5 Ads / Ad Placement API
    if (this.provider === 'google' && typeof window.adBreak === 'function') {
      if (type === 'rewarded') {
        let watched = false;
        window.adBreak({
          type: 'reward',
          name: 'rewarded',
          beforeReward: showAdFn => showAdFn(),
          adViewed: () => { watched = true; },
          adDismissed: () => { watched = false; },
          adBreakDone: () => finishAd(watched),
        });
      } else {
        window.adBreak({
          type: 'next',
          name: 'midgame',
          adBreakDone: () => finishAd(true),
        });
      }
      return;
    }

    // Provider C: High-fidelity Ad Simulation (Test / TWA fallback)
    this.showSimAd(type, finishAd);
  },

  // Visual in-game ad simulation overlay (for testing / pre-approval monetization testing)
  showSimAd(type, done) {
    const isRewarded = type === 'rewarded';
    let duration = isRewarded ? 4 : 3;
    let remaining = duration;
    let finished = false;

    const overlay = document.createElement('div');
    overlay.id = 'adOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,7,12,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;touch-action:none;user-select:none;font-family:var(--font,sans-serif);';

    overlay.innerHTML = `
      <div style="width:min(480px,94vw);background:#171d2b;border:3px solid #ffd21f;border-radius:16px;padding:22px;box-shadow:0 12px 30px rgba(0,0,0,0.8);text-align:center;color:#fff;">
        <div style="display:inline-block;padding:3px 10px;border-radius:6px;background:#ffd21f;color:#10141f;font-size:11px;font-weight:900;letter-spacing:1px;margin-bottom:10px;">
          ${isRewarded ? 'REWARDED ADVERTISEMENT' : 'SPONSORED BREAK'}
        </div>
        <h3 style="font-size:clamp(18px,5vh,24px);margin:6px 0 12px;letter-spacing:0.5px;color:#fff;">
          ${isRewarded ? 'Watch Ad to Earn Reward' : 'Shoot Unlimited'}
        </h3>
        <p style="font-size:13px;opacity:0.8;margin-bottom:16px;font-family:system-ui,sans-serif;">
          ${isRewarded ? 'Complete the video to revive with health or double your coins.' : 'Game will resume shortly...'}
        </p>
        <div style="height:10px;background:#0d111a;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);margin-bottom:16px;">
          <div id="adBar" style="width:0%;height:100%;background:linear-gradient(90deg,#ffd21f,#39e1ff);transition:width 0.25s linear;"></div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <span id="adTimer" style="font-size:14px;color:#ffd21f;font-weight:bold;">${remaining}s remaining</span>
          <button id="adSkip" style="padding:8px 16px;border-radius:8px;background:#2a334a;border:2px solid #0c0f18;color:#fff;font-size:12px;cursor:pointer;opacity:0.5;" disabled>
            ${isRewarded ? 'CANCEL' : 'SKIP AD'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const bar = overlay.querySelector('#adBar');
    const timerTxt = overlay.querySelector('#adTimer');
    const skipBtn = overlay.querySelector('#adSkip');

    const cleanup = ok => {
      if (finished) return;
      finished = true;
      clearInterval(interval);
      overlay.remove();
      done(ok);
    };

    skipBtn.onclick = () => cleanup(false);

    const interval = setInterval(() => {
      remaining--;
      const elapsed = duration - remaining;
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      if (bar) bar.style.width = pct + '%';
      if (timerTxt) timerTxt.textContent = remaining > 0 ? `${remaining}s remaining` : '✓ Completed';

      // Allow skipping interstitial after 2s
      if (!isRewarded && elapsed >= 2 && skipBtn) {
        skipBtn.disabled = false;
        skipBtn.style.opacity = '1';
        skipBtn.style.background = '#3e4e73';
      }
      // Rewarded cancel button
      if (isRewarded && elapsed >= 1 && skipBtn) {
        skipBtn.disabled = false;
        skipBtn.style.opacity = '0.85';
      }

      if (remaining <= 0) {
        clearInterval(interval);
        setTimeout(() => cleanup(true), 350);
      }
    }, 1000);
  },
};
