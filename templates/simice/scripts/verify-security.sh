#!/usr/bin/env bash
#
# Security checks for an on-premise build. The binary leaves your control the
# moment it ships, so these run before it does.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DEV_KEY="3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"
fail=0
pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

echo "Licence signing"
# The development default is a key whose PRIVATE half is public knowledge — it is
# in this repository's history and in every copy of the template. A release built
# with it can be licensed by anyone who reads the source.
if [ "${SIMBKIT_LICENCE_PUBLIC_KEY:-}" = "" ]; then
  if [ "${CI:-}" = "true" ] || [ "${RELEASE:-}" = "true" ]; then
    bad "SIMBKIT_LICENCE_PUBLIC_KEY is unset — this build uses the PUBLIC development key"
  else
    pass "development build (set SIMBKIT_LICENCE_PUBLIC_KEY for a release)"
  fi
elif [ "${SIMBKIT_LICENCE_PUBLIC_KEY}" = "$DEV_KEY" ]; then
  bad "SIMBKIT_LICENCE_PUBLIC_KEY is the development key — anyone can mint licences for this build"
else
  pass "a project-specific signing key is configured"
fi

# A private key in the tree is the whole security model, gone.
if git ls-files 2>/dev/null | grep -qE '(licence-signing-key|\.private\.key)$'; then
  bad "a private signing key is tracked by git"
else
  pass "no private key tracked by git"
fi

echo "Crypto"
if grep -q 'ed25519-dalek' crates/licence/Cargo.toml; then
  pass "signatures are Ed25519"
else
  bad "no signature library — a licence anyone can edit is not a licence"
fi
if grep -q 'key.verify' crates/licence/src/lib.rs && \
   grep -B6 'serde_json::from_slice' crates/licence/src/lib.rs | grep -q 'key.verify'; then
  pass "payload is authenticated BEFORE it is parsed"
else
  bad "the payload is parsed before the signature is checked — that hands the parser to an attacker"
fi

echo "Application"
if grep -q '"csp"' src-tauri/tauri.conf.json; then
  pass "a Content-Security-Policy is set"
else
  bad "no CSP in tauri.conf.json"
fi
# Enforcement belongs in Rust; the UI hiding a button is presentation.
if grep -q 'fn require_feature' src-tauri/src/lib.rs; then
  pass "feature entitlement is enforced in Rust"
else
  bad "no server-side feature check — hiding a button is not enforcement"
fi

echo
if [ "$fail" -eq 0 ]; then echo "  security checks passed"; else echo "  SECURITY CHECKS FAILED"; exit 1; fi
