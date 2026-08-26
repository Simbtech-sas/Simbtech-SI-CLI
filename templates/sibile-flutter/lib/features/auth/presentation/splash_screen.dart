import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';

/// Holds the UI while the stored token is checked, so the login form never
/// flashes for a user who is already signed in.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(restoreSessionProvider);
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
