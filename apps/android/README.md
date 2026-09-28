# SKB for Android

A real installable Android app that opens the company server's SKB web app in a secure,
full-screen window.
- All screens, rules and data stay on the server, so **the app updates itself whenever the
  server is updated**.
- You rebuild the APK only when this shell changes.
- It is plain Java with no extra libraries: about 20 KB, minSdk 26 (Android 8+).

## What it does

- Opens the server address: `https://skb-d211.onrender.com` by default.
- **Changing the server:** long-press the app icon → **Server address**. This works for the
  company's own server on the office network (e.g. `http://192.168.1.10:8080`); plain http://
  gets a warning, because it's for the office network only.
- **Links:** only pages of that server open inside the app. Other links open in the browser.
- **Server unreachable:** a local page offers **Try again** / **Server address**.
- **Files:** downloads and file uploads work.
- **Back:** the Back button goes back.
- **Security:** `allowBackup=false`, so the signed-in session never leaves the phone in a backup.
- **Language:** Arabic/English follows the phone's language.

## Build

Needs JDK 17 and the Android SDK (platform 34, build-tools 35). Gradle 8.11.1 comes through
the wrapper.

```powershell
cd apps\android
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
.\gradlew.bat assembleRelease
```

`local.properties` (git-ignored) holds `sdk.dir=…`.

The release APK is `app\build\outputs\apk\release\app-release.apk`. To publish it, copy it to
`apps/web/public/downloads/SKB-Android.apk`. The server then offers it on the login page and in
Settings → Get the app.

## Signing key — keep it safe

Release builds are signed with a private key that **stays on the build PC and is never
committed**:
- The key itself: `%USERPROFILE%\.skb\android\skb-release.jks`.
- Its passwords: `apps\android\keystore.properties`, which is git-ignored.

**Back up both files.** Android only installs an update over an existing install when it is
signed with the **same key**. Without the key, every phone would have to uninstall and
reinstall the app.

Bump `versionCode` in `app/build.gradle` for every new APK.

## Install on a phone

1. Open the SKB site on the phone.
2. Tap **Get the app → Android app** and open the downloaded file.
3. Allow installing from this source when Android asks.
