'use strict';
// Portal SDK bridge (CrazyGames). Everything is a no-op when the game runs anywhere else.

const Platform = {
  sdk: null, ads: false, mute: false, playing: false,
  // loads the SDK only on CrazyGames (or with ?cg for local testing), then hands the cloud save to `onSave`
  async init(onSave) {
    if (!/crazygames/.test(location.hostname + document.referrer) && !location.search.includes('cg')) return;
    try {
      await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
      const sdk = window.CrazyGames.SDK; await sdk.init();
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk; this.ads = true;
      const apply = st => { this.mute = !!st.muteAudio; Sfx.on = save.set.sfx && !this.mute; };
      apply(sdk.game.settings); sdk.game.addSettingsChangeListener(apply);
      onSave(sdk.data.getItem(SAVE_KEY));
    } catch (e) { this.sdk = null; }
  },
  // the loop reports every play/non-play switch; the SDK wants gameplayStart/Stop on exactly those
  gameplay(on) {
    if (on === this.playing) return; this.playing = on;
    if (this.sdk) on ? this.sdk.game.gameplayStart() : this.sdk.game.gameplayStop();
  },
  happy() { if (this.sdk) this.sdk.game.happytime(); },
  store(v) { if (this.sdk) try { this.sdk.data.setItem(SAVE_KEY, v); } catch (e) { } },
  // type 'midgame' | 'rewarded'; done(ok) always fires once. Audio is muted only while an ad actually plays.
  ad(type, done) {
    if (!this.sdk || !this.ads) return done(false);
    const end = ok => { Sfx.ac?.resume(); done(ok); };
    this.sdk.ad.requestAd(type, {
      adStarted: () => Sfx.ac?.suspend(),
      adFinished: () => end(true),
      adError: e => { if (e && (e.code === 'adsDisabledBasicLaunch' || e.code === 'adblock')) this.ads = false; end(false); },
    });
  },
};
