// Config plugin for SonosTube's native Android part.
//  - JitPack repository (NewPipeExtractor is only published there)
//  - Share / YouTube link intent filters on MainActivity
//  - Cleartext HTTP (Sonos UPnP on :1400 and our local stream proxy are plain HTTP)
//  - Core library desugaring (NewPipeExtractor uses Java 11+ APIs; required below minSdk 33)
const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} = require('expo/config-plugins');

const DESUGAR_LIB = 'com.android.tools:desugar_jdk_libs_nio:2.1.5';
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

function withJitPack(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withSonosTube: only Groovy android/build.gradle is supported');
    }
    let contents = cfg.modResults.contents;
    if (!/jitpack\.io/.test(contents)) {
      const re = /allprojects\s*\{\s*repositories\s*\{/;
      if (re.test(contents)) {
        contents = contents.replace(re, (m) => `${m}\n    maven { url 'https://jitpack.io' }`);
      } else {
        contents += `\nallprojects {\n  repositories {\n    maven { url 'https://jitpack.io' }\n  }\n}\n`;
      }
      cfg.modResults.contents = contents;
    }
    return cfg;
  });
}

function withDesugaring(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withSonosTube: only Groovy app/build.gradle is supported');
    }
    let contents = cfg.modResults.contents;
    if (!contents.includes('coreLibraryDesugaringEnabled')) {
      contents = contents.replace(
        /\nandroid\s*\{/,
        (m) => `${m}\n    compileOptions {\n        coreLibraryDesugaringEnabled true\n    }\n`
      );
    }
    if (!contents.includes('desugar_jdk_libs')) {
      contents = contents.replace(
        /\ndependencies\s*\{/,
        (m) => `${m}\n    coreLibraryDesugaring("${DESUGAR_LIB}")\n`
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function buildIntentFilters() {
  const send = {
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': 'text/plain' } }],
  };
  const view = {
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    category: [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
    ],
    data: [
      { $: { 'android:scheme': 'https' } },
      { $: { 'android:scheme': 'http' } },
      ...YOUTUBE_HOSTS.map((host) => ({ $: { 'android:host': host } })),
    ],
  };
  return [send, view];
}

/** True for intent filters this plugin added earlier (keeps the plugin idempotent). */
function isOurFilter(filter) {
  const actions = (filter.action || []).map((a) => a.$ && a.$['android:name']);
  const data = filter.data || [];
  if (actions.includes('android.intent.action.SEND')) {
    return data.some((d) => d.$ && d.$['android:mimeType'] === 'text/plain');
  }
  if (actions.includes('android.intent.action.VIEW')) {
    return data.some((d) => d.$ && YOUTUBE_HOSTS.includes(d.$['android:host']));
  }
  return false;
}

function withSonosManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.$['android:usesCleartextTraffic'] = 'true';

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    const existing = (activity['intent-filter'] || []).filter((f) => !isOurFilter(f));
    activity['intent-filter'] = [...existing, ...buildIntentFilters()];
    return cfg;
  });
}

/**
 * Windows only: the CMake 3.22 bundled ninja fails on React Native codegen paths longer than
 * 260 characters. If a newer SDK CMake (3.31+) is installed, point Gradle at it via
 * local.properties, which prebuild --clean would otherwise drop.
 */
function withNewerCmakeOnWindows(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      if (process.platform !== "win32") return cfg;
      const fs = require("fs");
      const path = require("path");
      const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
      const cmakeRoot = path.join(sdk, "cmake");
      if (!fs.existsSync(cmakeRoot)) return cfg;
      const newer = fs
        .readdirSync(cmakeRoot)
        .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
        .filter((v) => { const [a, b] = v.split(".").map(Number); return a > 3 || (a === 3 && b >= 31); })
        .sort((x, y) => y.localeCompare(x, undefined, { numeric: true }))[0];
      if (!newer) return cfg;
      const file = path.join(cfg.modRequest.platformProjectRoot, "local.properties");
      const fwd = (p) => p.split(path.sep).join('/');
      const keep = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('cmake.dir=') && !l.startsWith('sdk.dir='));
      const lines = [`sdk.dir=${fwd(sdk)}`, `cmake.dir=${fwd(path.join(cmakeRoot, newer))}`, ...keep];
      fs.writeFileSync(file, lines.join('\n') + '\n');
      return cfg;
    },
  ]);
}

/**
 * Release signing with our own key. Reads credentials/keystore.properties (git-ignored) from the
 * project root; without it the release build stays signed with the debug key.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes('wfsSigningProps')) return cfg;
    const header = [
      "def wfsSigningFile = rootProject.file('../credentials/keystore.properties')",
      'def wfsSigningProps = new Properties()',
      'if (wfsSigningFile.exists()) { wfsSigningFile.withInputStream { wfsSigningProps.load(it) } }',
      '',
    ].join('\n');
    contents = contents.replace(/\nandroid\s*\{/, (m) => `\n${header}${m}`);
    contents = contents.replace(
      /signingConfigs\s*\{/,
      (m) =>
        `${m}\n        release {\n            if (wfsSigningFile.exists()) {\n                storeFile new File(wfsSigningFile.parentFile, wfsSigningProps['storeFile'])\n                storePassword wfsSigningProps['storePassword']\n                keyAlias wfsSigningProps['keyAlias']\n                keyPassword wfsSigningProps['keyPassword']\n            }\n        }`
    );
    contents = contents.replace(
      /(release\s*\{\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/,
      '$1signingConfig wfsSigningFile.exists() ? signingConfigs.release : signingConfigs.debug'
    );
    cfg.modResults.contents = contents;
    return cfg;
  });
}

function withSonosTube(config) {
  config = withJitPack(config);
  config = withDesugaring(config);
  config = withSonosManifest(config);
  config = withNewerCmakeOnWindows(config);
  config = withReleaseSigning(config);
  return config;
}

module.exports = createRunOncePlugin(withSonosTube, 'withSonosTube', '1.0.0');
