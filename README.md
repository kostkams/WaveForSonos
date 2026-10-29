<p align="center">
  <img src="fastlane/metadata/android/en-US/images/icon.png" width="112" alt="Wave for Sonos icon">
</p>

<h1 align="center">Wave for Sonos</h1>

<p align="center">
  Play YouTube – music, videos and playlists – and your own audio files on your Sonos speakers.<br>
  Search, share from other apps, build your own playlists, and control every room from one place.
</p>

<p align="center">
  <a href="../../actions/workflows/android.yml"><img alt="Android build" src="https://github.com/kostkams/WaveForSonos/actions/workflows/android.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: GPL v3" src="https://img.shields.io/badge/license-GPLv3-blue.svg"></a>
  <img alt="Platform: Android" src="https://img.shields.io/badge/platform-Android%207%2B-3ddc84.svg">
  <img alt="Languages" src="https://img.shields.io/badge/languages-English%20%7C%20Deutsch-8F4C38.svg">
</p>

> 🇩🇪 **Deutsch:** [Kurzfassung weiter unten](#deutsch).

---

## Features

**Search, share or play your own files**
- Search YouTube for songs, videos and playlists in the app
- Share a video from the YouTube app with *Wave for Sonos*, and it starts playing on your speakers
- Paste links from the clipboard
- Play audio files from your phone (MP3, M4A, FLAC, WAV, OGG) on Sonos

**Queue, playlists and history**
- A real queue with shuffle, repeat and autoplay
- Your own playlists: create, sort, rename, shuffle-play
- Play history grouped by day
- Everything stays on your phone

**All rooms under control**
- Sonos speakers on your Wi-Fi are discovered automatically
- Group rooms with a tap; the first room leads the group
- Volume per room or for the whole group
- **Your phone's hardware volume keys control the Sonos volume**, even on the lock screen
- Playback controls in the notification

**Looks and feel**
- Material 3 design, light and dark
- Five color schemes or Material You dynamic colors (Android 12+)
- English and German

**Private by design**
- No account, no ads, no analytics, no trackers
- No data is sent to the developer

## How it works

```
 YouTube ──► phone (NewPipeExtractor) ──► local HTTP proxy on the phone ──► Sonos (UPnP, port 1400)
```

1. The app looks up the audio stream of a video with [NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor).
2. A small HTTP server inside the app (running as a foreground service) passes the audio to your speakers over your Wi-Fi.
3. Wave for Sonos controls the speakers directly with UPnP/SOAP: play, pause, seek, grouping and volume.

The phone has to stay on the same Wi-Fi as the speakers while music is playing. Sonos only plays audio, so videos play as audio only.

## Install

| Source | Notes |
|---|---|
| **F-Droid** (own repository) | In the F-Droid app (or Neo Store / Droid-ify): *Settings → Repositories → +* and add `https://kostkams.github.io/WaveForSonos/repo?fingerprint=d8c5c5be6b6a6ffaf70427fe3e95e105518b10b8c3fd14625ef401ecdc42de83` – or open [kostkams.github.io/WaveForSonos](https://kostkams.github.io/WaveForSonos/) on your phone and tap *Add to F-Droid*. |
| **GitHub Releases** | Download `wave-for-sonos-<version>.apk` from [Releases](../../releases) and verify it against the `.sha256` file. |
| **Obtainium** | [Add to Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/kostkams/WaveForSonos) – or add `https://github.com/kostkams/WaveForSonos` as a new app. Obtainium checks the GitHub releases for updates. |

Requirements: Android 7.0 or newer and Sonos speakers on the same Wi-Fi network (S2 and S1 speakers that speak UPnP).

If a track does not play on your speaker, turn on **Settings → Compatibility mode**. The app then sends a plain AAC stream instead of the original M4A stream.

## Permissions

| Permission | Why |
|---|---|
| Internet, network/Wi-Fi state | Search and loading audio streams |
| Wi-Fi multicast | Finding Sonos speakers (SSDP) |
| Foreground service (media playback), wake lock | Keeping the stream running while the app is in the background or the screen is off |
| Notifications | The playback notification with its controls |
| Ignore battery optimizations *(optional)* | Only if you request it in the settings; stops Android from killing playback |

## Anti-features

- **NonFreeNet**: the app depends on YouTube, a non-free network service.

## Building from source

Requirements: Node.js 20+, JDK 17 (newer JDKs are not supported by the Android Gradle plugin yet), Android SDK with build tools 36. On Windows: SDK CMake 3.31 or newer (the bundled 3.22 fails on long paths; the config plugin picks a newer one automatically).

```bash
npm install
npx expo prebuild --platform android --clean     # generates android/ (don't edit it by hand)
cd android
./gradlew :app:assembleRelease                    # → app/build/outputs/apk/release/app-release.apk
```

During development:

```bash
npx expo run:android      # development build on a connected device
npm test                  # Jest unit tests
npm run typecheck
npm run lint
```

**Release signing:** if `credentials/keystore.properties` exists, release builds are signed with that key; otherwise with the debug key. The file is git-ignored and looks like this:

```properties
storeFile=release.keystore
storePassword=…
keyAlias=waveforsonos
keyPassword=…
```

> Expo Go does **not** work. The app needs its own native module.

### Project layout

```
src/app/                      screens (expo-router)
src/sonos/                    Sonos UPnP/SOAP client: transport, volume, zone groups, DIDL-Lite
src/playback/                 playback controller, queue, speaker grouping, volume keys
src/state/                    zustand stores (settings, queue, history, playlists)
src/i18n/                     German and English texts
src/theme/                    Material 3 color schemes
modules/sonos-tube-native/    Kotlin Expo module: NewPipeExtractor, stream proxy, SSDP, media session
plugins/withSonosTube.js      Expo config plugin (intent filters, cleartext HTTP, desugaring, signing)
fastlane/metadata/android/    store texts (F-Droid repo, release notes)
fdroid/metadata/              F-Droid app metadata for the self-hosted repository
```

## Releasing

1. Raise `expo.version` and `expo.android.versionCode` in `app.json`.
2. Add release notes as `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` (and `de-DE`).
3. Commit, then tag and push: `git tag v1.0.1 && git push origin v1.0.1`.

The [Android build](.github/workflows/android.yml) workflow checks the code, builds the signed universal APK, publishes the GitHub release with a SHA-256 checksum and updates the F-Droid repository on GitHub Pages. Every push to `main` produces a test APK (arm64) as a workflow artifact.

## Contributing

Issues and pull requests are welcome. Please run `npm test`, `npm run typecheck` and `npm run lint` before opening a pull request. New UI texts go into both `src/i18n/de.ts` and `src/i18n/en.ts`; TypeScript reports a missing translation.

## AI assistance

This app was developed with extensive help from an AI coding assistant (Anthropic's Claude): large parts of the code, tests and texts were generated with it and then reviewed, tested and adjusted. Commits made this way carry a `Co-Authored-By: Claude` line. Please keep this in mind when you evaluate or reuse the code.

## Disclaimer

Wave for Sonos is an independent project. It is **not affiliated with, endorsed by or sponsored by Sonos, Inc., YouTube or Google LLC**. Sonos is a trademark of Sonos, Inc.; YouTube is a trademark of Google LLC.

The app streams content from YouTube without using the official YouTube API. This may conflict with YouTube's Terms of Service. You are responsible for how you use it.

## License

Copyright © 2026 kostkams

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

It uses [NewPipeExtractor](https://github.com/TeamNewPipe/NewPipeExtractor) (GPLv3), [Expo](https://expo.dev) and [React Native](https://reactnative.dev) (MIT), [React Native Paper](https://github.com/callstack/react-native-paper) (MIT) and other open-source libraries.

---

<a id="deutsch"></a>

## Deutsch

**Wave for Sonos** spielt YouTube – Musik, Videos und Playlists – sowie eigene Audiodateien vom Android-Handy auf deinen Sonos-Lautsprechern ab.

- **Suchen oder teilen:** YouTube in der App durchsuchen, ein Video aus der YouTube-App teilen, einen Link einfügen oder eigene Audiodateien abspielen
- **Warteschlange, eigene Playlists und Verlauf**, alles nur auf deinem Handy gespeichert
- **Räume gruppieren**, Lautstärke pro Raum oder für die Gruppe, **Lautstärketasten des Handys steuern Sonos**
- Material-3-Design in Hell und Dunkel, fünf Farbschemata, Deutsch und Englisch
- Kein Konto, keine Werbung, kein Tracking

**Installation:** über das eigene F-Droid-Repository (`https://kostkams.github.io/WaveForSonos/repo`, in der F-Droid-App unter *Einstellungen → Paketquellen* hinzufügen), als APK aus den [Releases](../../releases) oder mit automatischen Updates über [Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/kostkams/WaveForSonos). Handy und Lautsprecher müssen im selben WLAN sein.

Die App wurde mit umfangreicher Hilfe eines KI-Programmierassistenten (Claude von Anthropic) entwickelt.

Spielt ein Titel nicht, hilft meist **Einstellungen → Kompatibilitätsmodus**.

Wave for Sonos ist ein unabhängiges Projekt und steht in keiner Verbindung zu Sonos, Inc., YouTube oder Google LLC. Lizenz: GPLv3.
