# ADR-003 — Security measures across the boilerplates

Status: accepted · 2026-08-28

## Context

`eshe-huli/nestjs-ddd-cli` generates ten security artifacts (`ddd security-patterns`,
2,230 lines). The instruction was to include them in all boilerplates. Reading
them rather than the README, they divide cleanly into three groups.

## Ported — these are real

| Measure | Where | Why it matters |
|---|---|---|
| **AES-256-GCM + PBKDF2-SHA256 600k** | SiSAAS `modules/security` | Authenticated encryption: a ciphertext altered in the database fails to decrypt instead of yielding different plaintext |
| **Constant-time comparison** with a length guard | SiSAAS | `===` on a secret leaks its prefix through timing; `timingSafeEqual` throws on a length mismatch, and that throw is itself an oracle |
| **JWT algorithm pinning** | SiSAAS, 3 call sites | See below — this was a live vulnerability in our own template |
| **JWT issuer validation** | SiSAAS | A token from a staging environment that shares a secret is rejected rather than honoured |
| **Secure headers, CORS allowlist, HSTS** | SiSAAS `main.ts` | Already present; verified and now checked |
| **Explicit body limit** | SiSAAS `main.ts` | An oversized body is consumed before any guard runs |

### The vulnerability this exercise found

**None of our three JWT verifiers pinned an algorithm.** `verifyAsync` without an
`algorithms` allowlist accepts whatever the token's own header asks for — the
`alg: none` bypass and HMAC/RSA confusion. Two HTTP guards and the Socket.IO
gateway were all affected; the gateway matters as much as the guards, because a
websocket handshake is a second front door and one unpinned verifier undoes every
other.

Fixed, and `verify:security` now fails if any verifier loses its pin.

## Added — gaps the fork does not cover

- **Login throttling** (`LoginThrottleGuard`). The global limiter is 300/min,
  sized for ordinary API traffic — an attacker gets 300 password guesses a minute
  inside it. Counted in Redis because the API runs replicas, and keyed on IP
  **and** identifier: IP alone lets one NAT'd office lock itself out, identifier
  alone lets an attacker lock a victim out of their own account.
- **Release gate for SiMICE.** The development licence key's private half is
  public — it is in this template. A release built with it can be licensed by
  anyone. `RELEASE=true npm run verify:security` now fails on it.
- **Mobile checks.** Everything in a mobile bundle ships to the device. The
  checks look for credential-shaped values in `EXPO_PUBLIC_*`/`VITE_*`, tokens
  outside the Keychain, credential logging, and cleartext endpoints.

## Deliberately NOT ported

Three of the fork's measures are counterproductive, and copying them would have
traded real correctness for the appearance of thoroughness.

**Regex SQL-injection blocking.** It scans request bodies for SQL keywords and
returns 400. Every query in these templates is parameterised — Drizzle does not
concatenate user input into SQL, so there is nothing to inject. What the filter
does do is reject a customer named `O'Brien`, a note containing `--`, and a
password with `select` in it. That is a WAF pattern misplaced in application
middleware: it breaks legitimate input while protecting against nothing the
parameterisation has not already handled. `verify:security` checks that queries
stay parameterised instead.

**Regex XSS blocking on input.** XSS is an output-encoding problem. React escapes
by default and our CSP is restrictive; stripping `<script>` from input does not
stop XSS (there are dozens of vectors that carry no `<script>`) and does destroy
any field that legitimately holds markup. Encode on output, which the framework
already does.

**`X-XSS-Protection: 1; mode=block`.** Deprecated, removed from every current
browser, and the filter it enabled was itself exploitable — it could be abused to
selectively disable inline scripts. The modern header is a CSP, which helmet
already sets. If set at all, the correct value is `0`.

## Verification

Every flavor gains a `verify:security` that fails the build:

```bash
pnpm verify:security     # sisaas, simice, sibile-rn, sibile-capacitor
pnpm verify:rls          # sisaas — the live tenant-isolation proof
npm test                 # sisaas — 9 crypto tests against real primitives
```

Each check was confirmed to fail on a real regression, not merely to pass:
unpinning a JWT verifier, and building SiMICE with the development key. A check
that cannot fail is decoration.

## Not covered here

Dependency scanning, container image scanning, and secret scanning in CI belong
in the pipeline, not the templates. They are listed in the follow-ups rather than
silently omitted.
