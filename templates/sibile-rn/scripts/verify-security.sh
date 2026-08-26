#!/usr/bin/env bash
#
# Mobile security checks.
#
# The governing fact: everything in the bundle ships to the device, and anyone
# with the app has it. There are no secrets in a mobile client — only the
# question of whether someone believed there were.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

echo "Secrets"
# EXPO_PUBLIC_* is compiled into the binary. A value that looks like a real
# credential here is one that has already shipped.
if [ -f .env ] && grep -qEi '^EXPO_PUBLIC_.*(secret|private|password|api_?key)' .env; then
  bad ".env has a EXPO_PUBLIC_ value that looks like a credential — it ships inside the app"
else
  pass "no credential-shaped values in the bundled env"
fi
if git ls-files 2>/dev/null | grep -qE '^\.env$'; then
  bad ".env is tracked by git"
else
  pass ".env is not tracked by git"
fi

echo "Credential storage"
# Keychain / Keystore, not a plain file. A refresh token in a readable file is a
# permanent session for anyone with filesystem access to a rooted device.
if grep -rqE 'SecureStore|SecureStoragePlugin' src/lib/storage.ts 2>/dev/null; then
  pass "tokens are stored in the Keychain / Keystore"
else
  bad "tokens are not in secure storage"
fi
if grep -rnE '(AsyncStorage|localStorage)\.(set|get)Item' src 2>/dev/null | grep -iE 'token|password'; then
  bad "a credential is written to unencrypted storage"
else
  pass "no credential in unencrypted storage"
fi

echo "Leakage"
if grep -rnE 'console\.(log|warn|info)\(' src 2>/dev/null | grep -iE 'token|password|secret'; then
  bad "a credential is logged — device logs are readable by other apps and crash reporters"
else
  pass "no credential logging"
fi

echo "Transport"
if grep -rnE "'http://(?!localhost|127\.)" src 2>/dev/null | grep -v localhost; then
  bad "a cleartext http:// endpoint is referenced"
else
  pass "no cleartext endpoints"
fi

echo
if [ "$fail" -eq 0 ]; then echo "  security checks passed"; else echo "  SECURITY CHECKS FAILED"; exit 1; fi
