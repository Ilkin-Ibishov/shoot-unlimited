const path = require('path');
const fs = require('fs');
const { TwaManifest, TwaGenerator, ConsoleLog, fetchUtils } = require('C:/Users/user/AppData/Roaming/npm/node_modules/@bubblewrap/cli/node_modules/@bubblewrap/core');

(async () => {
  fetchUtils.setFetchEngine('node-fetch');
  const targetDir = path.resolve(__dirname, '..', 'android');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const manifestUrl = 'https://ilkin-ibishov.github.io/shoot-unlimited/manifest.webmanifest';
  console.log('Fetching manifest from', manifestUrl);
  const twaManifest = await TwaManifest.fromWebManifest(manifestUrl);

  twaManifest.packageId = 'com.shootunlimited.app';
  twaManifest.launcherName = 'Shoot∞';
  twaManifest.orientation = 'landscape';
  twaManifest.display = 'fullscreen';
  twaManifest.signingKey = {
    path: path.resolve(__dirname, '..', 'android-release.keystore'),
    alias: 'shootunlimited'
  };
  twaManifest.appVersionName = '1.0.0';
  twaManifest.appVersionCode = 1;

  console.log('Saving twa-manifest.json...');
  await twaManifest.saveToFile(path.join(targetDir, 'twa-manifest.json'));

  console.log('Generating Android Studio project...');
  const generator = new TwaGenerator();
  const log = new ConsoleLog('twa-gen');
  await generator.createTwaProject(targetDir, twaManifest, log);
  console.log('Project successfully generated in', targetDir);
})().catch(err => {
  console.error('Failed to create TWA project:', err);
  process.exit(1);
});
