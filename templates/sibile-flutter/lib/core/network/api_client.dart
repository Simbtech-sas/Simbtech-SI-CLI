import 'dart:async';

import 'package:dio/dio.dart';

import '../storage/secure_tokens.dart';

/// Tells the API this client has no cookie jar, so the refresh token comes back
/// in the BODY instead of as an httpOnly Set-Cookie it could never read. A
/// browser deliberately does not send this — there the cookie is the only thing
/// keeping the token away from XSS.
const Map<String, String> nativeClientHeaders = {'x-client-type': 'native'};

const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:8080');

/// Raised when refreshing fails and the session is genuinely over.
class SessionExpired implements Exception {
  const SessionExpired();
  @override
  String toString() => 'SessionExpired';
}

/// Attaches the access token, and refreshes exactly once on a 401.
///
/// The single-flight guard matters: a screen that fires several requests at once
/// would otherwise trigger several refreshes. The API rotates the refresh token
/// on each, so the later ones present an already-rotated token — which the server
/// correctly reads as token reuse and responds to by revoking the whole family.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this.tokens,
    required this.dio,
    required this.onSessionExpired,
  });

  final SecureTokens tokens;
  final Dio dio;
  final void Function() onSessionExpired;

  Future<String?>? _refreshInFlight;

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra['anonymous'] != true) {
      final token = await tokens.readAccess();
      if (token != null) options.headers['authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final isAuthFailure = err.response?.statusCode == 401;
    final alreadyRetried = err.requestOptions.extra['retried'] == true;
    final anonymous = err.requestOptions.extra['anonymous'] == true;

    // 403 means authenticated but not permitted; refreshing cannot help.
    if (!isAuthFailure || alreadyRetried || anonymous) {
      handler.next(err);
      return;
    }

    final fresh = await _refresh();
    if (fresh == null) {
      await tokens.clear();
      onSessionExpired();
      handler.reject(
        DioException(requestOptions: err.requestOptions, error: const SessionExpired()),
      );
      return;
    }

    final retry = err.requestOptions
      ..headers['authorization'] = 'Bearer $fresh'
      ..extra['retried'] = true;

    try {
      handler.resolve(await dio.fetch<dynamic>(retry));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<String?> _refresh() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<String?> _doRefresh() async {
    final refresh = await tokens.readRefresh();
    if (refresh == null) return null;
    try {
      // A bare Dio: the interceptor must not recurse into itself.
      final response = await Dio(
        BaseOptions(baseUrl: apiUrl, headers: nativeClientHeaders),
      ).post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refresh},
      );
      final data = response.data;
      if (data == null) return null;
      final access = data['accessToken'] as String;
      await tokens.write(access: access, refresh: data['refreshToken'] as String);
      return access;
    } on DioException {
      return null;
    }
  }
}

Dio buildDio({
  required SecureTokens tokens,
  required void Function() onSessionExpired,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: apiUrl,
      headers: nativeClientHeaders,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      contentType: 'application/json',
    ),
  );
  dio.interceptors.add(
    AuthInterceptor(tokens: tokens, dio: dio, onSessionExpired: onSessionExpired),
  );
  return dio;
}
