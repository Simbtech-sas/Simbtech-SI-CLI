import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Credentials live in the iOS Keychain / Android Keystore, never in
/// SharedPreferences — the latter is a plain XML file that any process with
/// filesystem access on a rooted device can read.
class SecureTokens {
  const SecureTokens(this._storage);

  final FlutterSecureStorage _storage;

  static const _access = 'simbkit.accessToken';
  static const _refresh = 'simbkit.refreshToken';

  Future<String?> readAccess() => _storage.read(key: _access);
  Future<String?> readRefresh() => _storage.read(key: _refresh);

  Future<void> write({required String access, required String refresh}) async {
    await _storage.write(key: _access, value: access);
    await _storage.write(key: _refresh, value: refresh);
  }

  Future<void> clear() async {
    await _storage.delete(key: _access);
    await _storage.delete(key: _refresh);
  }
}
