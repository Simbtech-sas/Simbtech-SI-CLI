# Simbkit — mobile (Flutter)

Feature-first Flutter with Riverpod, go_router, dio and Drift, wired to a SiSAAS
backend.

```bash
flutter create . --project-name simbkit --platforms android,ios
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:8080
```

The platform folders (`android/`, `ios/`, …) are **not** in the template and are
gitignored. `flutter create .` generates them for the platforms you actually
target, at the SDK version you actually have — a checked-in `android/` from
someone else's machine is a merge conflict waiting to happen.

## Layout

```
lib/
  core/
    network/     dio + the auth interceptor
    router/      go_router, with auth guarding in ONE redirect
    storage/     Keychain/Keystore-backed tokens
    theme/       light + dark
    providers.dart   composition root
  features/<feature>/
    data/        repositories
    domain/      models
    presentation/ screens
```

Feature-first, not layer-first: everything one feature needs sits together, so
deleting a feature is deleting a folder.

## What is already handled

- **Token refresh with a single-flight guard** (`core/network/api_client.dart`).
  Several concurrent 401s trigger one refresh, not several — the API rotates the
  refresh token each time and treats a re-presented one as reuse, which revokes
  the session.
- **Auth guarding in one place.** `app_router.dart`'s `redirect` decides; screens
  never guard themselves, so no screen can forget to.
- **Credentials in the Keychain / Keystore**, never SharedPreferences.
- **All four list states** in `widgets_screen.dart`.
- **Dark theme** defined, not just light.

## Configuration

`--dart-define`, not a `.env` file. Anything compiled into a mobile binary is
readable by anyone holding the binary, so there are no secrets here — only the
API URL. Note `10.0.2.2` is how the Android emulator reaches your host machine.
