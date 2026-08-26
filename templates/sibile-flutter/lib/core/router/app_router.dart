import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/login_screen.dart';
import '../../features/widgets/presentation/widgets_screen.dart';
import '../providers.dart';
import '../../features/auth/presentation/splash_screen.dart';

/// Auth guarding lives in one `redirect`, not scattered across screens. A screen
/// that forgets its own guard is a screen that leaks; a central redirect cannot
/// be forgotten.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      // Returns null to stay put, or a path to move.
      final status = ref.read(sessionStatusProvider);
      final atSplash = state.matchedLocation == '/';
      final atLogin = state.matchedLocation == '/login';

      switch (status) {
        case SessionStatus.loading:
          return atSplash ? null : '/';
        case SessionStatus.anonymous:
          return atLogin ? null : '/login';
        case SessionStatus.authenticated:
          return atSplash || atLogin ? '/widgets' : null;
      }
    },
    routes: [
      GoRoute(path: '/', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/widgets', builder: (_, _) => const WidgetsScreen()),
    ],
  );
});
