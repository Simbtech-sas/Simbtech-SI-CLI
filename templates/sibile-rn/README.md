# Simbkit — mobile (React Native)

Expo + expo-router + NativeWind + TanStack Query, wired to a SiSAAS backend.

```bash
npm install
cp .env.example .env
npx expo start
```

## What is already handled

- **Auth with token refresh.** `src/api/client.ts` retries a 401 exactly once
  after refreshing, and shares a single in-flight refresh across concurrent
  requests — five queries on mount would otherwise trigger five rotations, and
  the API treats a re-presented rotated token as reuse and kills the session.
- **Credentials in the Keychain/Keystore**, not in MMKV. `src/lib/storage.ts`
  keeps that split; MMKV is for cache only.
- **All four list states.** `app/(tabs)/index.tsx` handles loading, error, empty
  and populated. Copy that screen, not just its happy path.
- **Dark mode** throughout, via NativeWind `dark:` variants.

## Notes

- `EXPO_PUBLIC_*` is the only env prefix Expo exposes, and those values are
  **bundled into the app**. Never put a secret in `.env`.
- `ios/` and `android/` are gitignored: this is a managed project, and
  `expo prebuild` regenerates them. Commit them only if you eject.
