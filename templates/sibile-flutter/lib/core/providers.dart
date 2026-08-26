import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'network/api_client.dart';
import 'storage/secure_tokens.dart';

/// Composition root. Everything with an external dependency is created here so
/// a test can override one provider instead of reaching into a singleton.
// v11 encrypts by default on both platforms; no options needed.
final secureStorageProvider = Provider<FlutterSecureStorage>(
  (ref) => const FlutterSecureStorage(),
);

final secureTokensProvider = Provider<SecureTokens>(
  (ref) => SecureTokens(ref.watch(secureStorageProvider)),
);

enum SessionStatus { loading, authenticated, anonymous }

/// Riverpod 3 removed `StateProvider`; a `Notifier` is the replacement and keeps
/// mutation behind a named method rather than a public settable field.
class SessionStatusNotifier extends Notifier<SessionStatus> {
  @override
  SessionStatus build() => SessionStatus.loading;

  void set(SessionStatus status) => state = status;
}

final sessionStatusProvider =
    NotifierProvider<SessionStatusNotifier, SessionStatus>(SessionStatusNotifier.new);

final dioProvider = Provider<Dio>((ref) {
  return buildDio(
    tokens: ref.watch(secureTokensProvider),
    // The network layer cannot import UI state directly without a cycle, so the
    // interceptor calls back here.
    onSessionExpired: () =>
        ref.read(sessionStatusProvider.notifier).set(SessionStatus.anonymous),
  );
});
