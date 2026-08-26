# Simbkit — mobile (Capacitor)

A Vite + React app shipped as a native binary. Same web stack as the SiSAAS
frontend, so components and API code move between them.

```bash
npm install
cp .env.example .env
npm run dev                 # browser, for development

npx cap add android         # generates android/ for your SDK
npm run cap:android         # build + sync + open Android Studio
```

`android/` and `ios/` are gitignored — `npx cap add` regenerates them. Commit
them only once you have native code of your own in there.

## What is already handled

- **Credentials in the Keychain / EncryptedSharedPreferences** via
  `capacitor-secure-storage-plugin`, not `Preferences` — the latter is a plain
  readable file. `src/lib/storage.ts` keeps that split explicit.
- **Token refresh with a single-flight guard**, so concurrent 401s trigger one
  rotation rather than several. Several would look like token reuse to the API
  and kill the session.
- **The Android back button** is wired in `App.tsx`. Untouched, it exits the app
  from any screen, which users read as a crash.
- **Safe-area insets** — `viewport-fit=cover` plus `env(safe-area-inset-*)`, so
  content clears the notch and the home indicator.
- **All four list states** in `routes/widgets.tsx`.
- **Dark mode** throughout.

## Choosing this over React Native

Pick Capacitor when the team is a web team, the UI is largely forms and lists,
and you want one codebase that also runs as a website. Pick React Native when
you need heavy lists, gesture-driven UI, or native-feeling navigation.

## Configuration

Only `VITE_`-prefixed variables reach the bundle, and they **are** the bundle —
anything in `.env` ships inside the app. No secrets.
