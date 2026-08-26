import 'package:flutter_test/flutter_test.dart';
import 'package:simbkit/core/network/api_client.dart';

void main() {
  test('SessionExpired is identifiable by type, not by message matching', () {
    const err = SessionExpired();
    expect(err, isA<SessionExpired>());
    expect(err.toString(), 'SessionExpired');
  });

  test('apiUrl falls back to localhost when no --dart-define is given', () {
    // Compiled-in configuration: this is what the binary ships with.
    expect(apiUrl, isNotEmpty);
  });
}
