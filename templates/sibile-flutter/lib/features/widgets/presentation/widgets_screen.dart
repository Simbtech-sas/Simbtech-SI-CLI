import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/widgets_repository.dart';

/// The reference list screen. All four states are handled — loading, error,
/// empty, populated — because the other three are where a mobile app spends
/// most of its life.
class WidgetsScreen extends ConsumerWidget {
  const WidgetsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final widgets = ref.watch(widgetsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Widgets')),
      body: widgets.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Could not load widgets.'),
                const SizedBox(height: 8),
                FilledButton.tonal(
                  onPressed: () => ref.invalidate(widgetsProvider),
                  child: const Text('Try again'),
                ),
              ],
            ),
          ),
        ),
        data: (items) {
          if (items.isEmpty) {
            return const Center(child: Text('No widgets yet'));
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(widgetsProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                final item = items[i];
                return Card(
                  child: ListTile(
                    title: Text(item.name),
                    subtitle: item.description == null ? null : Text(item.description!),
                    trailing: Text('${item.quantity}'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
