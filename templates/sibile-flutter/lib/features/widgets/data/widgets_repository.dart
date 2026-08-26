import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../domain/widget_item.dart';

class WidgetsRepository {
  const WidgetsRepository(this._dio);

  final Dio _dio;

  Future<List<WidgetItem>> list() async {
    final res = await _dio.get<List<dynamic>>('/widgets');
    return (res.data ?? <dynamic>[])
        .map((e) => WidgetItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final widgetsRepositoryProvider =
    Provider<WidgetsRepository>((ref) => WidgetsRepository(ref.watch(dioProvider)));

final widgetsProvider =
    FutureProvider<List<WidgetItem>>((ref) => ref.watch(widgetsRepositoryProvider).list());
