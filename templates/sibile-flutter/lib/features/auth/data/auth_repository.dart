import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/storage/secure_tokens.dart';
import '../domain/principal.dart';

class AuthRepository {
  const AuthRepository(this._dio, this._tokens);

  final Dio _dio;
  final SecureTokens _tokens;

  Future<void> login({required String email, required String password}) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
      options: Options(extra: {'anonymous': true}),
    );
    final data = res.data!;
    await _tokens.write(
      access: data['accessToken'] as String,
      refresh: data['refreshToken'] as String,
    );
  }

  Future<Principal> me() async {
    final res = await _dio.get<Map<String, dynamic>>('/auth/me');
    return Principal.fromJson(res.data!);
  }

  Future<void> logout() async {
    try {
      await _dio.post<void>('/auth/logout');
    } finally {
      // Clear locally regardless: the user asked to be signed out.
      await _tokens.clear();
    }
  }
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(dioProvider), ref.watch(secureTokensProvider)),
);

/// Resolved once at startup: a stored token that the API still accepts means the
/// user is already signed in.
final restoreSessionProvider = FutureProvider<Principal?>((ref) async {
  final tokens = ref.watch(secureTokensProvider);
  if (await tokens.readAccess() == null) {
    ref.read(sessionStatusProvider.notifier).set(SessionStatus.anonymous);
    return null;
  }
  try {
    final principal = await ref.watch(authRepositoryProvider).me();
    ref.read(sessionStatusProvider.notifier).set(SessionStatus.authenticated);
    return principal;
  } on DioException {
    await tokens.clear();
    ref.read(sessionStatusProvider.notifier).set(SessionStatus.anonymous);
    return null;
  }
});
