#!/usr/bin/env bash
#
# Mobile security checks. Everything in the bundle ships to the device, and
# anyone with the app has it — there are no secrets in a mobile client, only the
# question of whether someone believed there were.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

echo "Credential storage"
if grep -rq 'flutter_secure_storage' lib/core/storage/secure_tokens.dart 2>/dev/null; then
  pass "tokens are in the Keychain / Keystore"
else
  bad "tokens are not in secure storage"
fi
# SharedPreferences is a plain XML file any process on a rooted device can read.
if grep -rn 'SharedPreferences' lib --include='*.dart' 2>/dev/null | grep -v '^\s*[^:]*:[0-9]*:\s*//'; then
  bad "SharedPreferences is used — it is not encrypted"
else
  pass "no SharedPreferences"
fi

echo "Leakage"
if grep -rnE '\bprint\(' lib --include='*.dart' 2>/dev/null | grep -v '^\s*[^:]*:[0-9]*:\s*//'; then
  bad "print() reaches device logs, which other apps and crash reporters can read"
else
  pass "no print()"
fi

echo "Transport"
if grep -rnE "'http://" lib --include='*.dart' 2>/dev/null | grep -vE 'localhost|127\.0\.0\.1|10\.0\.2\.2|^\s*[^:]*:[0-9]*:\s*//'; then
  bad "a cleartext http:// endpoint is referenced"
else
  pass "no cleartext endpoints"
fi

echo "Configuration"
# --dart-define, not a bundled .env: either way it ships, but the former makes
# that obvious at the build command.
if [ -f .env ] && grep -qEi '(secret|password|private|api_?key)' .env 2>/dev/null; then
  bad ".env holds something credential-shaped, and it ships inside the app"
else
  pass "no credential-shaped configuration"
fi

echo
if [ "$fail" -eq 0 ]; then echo "  security checks passed"; else echo "  SECURITY CHECKS FAILED"; exit 1; fi
