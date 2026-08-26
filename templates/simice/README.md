# Simbkit — on-premise desktop

Tauri v2 (Rust core + web UI), an offline licence system, and three deployment
modes. Built for machines that may never see the internet.

```bash
npm install
npm run test:licence          # 13 tests, no GUI toolchain needed
npm run licence:keygen        # once — keep the private half OFFLINE
npm run desktop               # dev
npm run desktop:build         # .deb / .AppImage / .msi / .dmg
```

## Licensing

A licence is a signed one-line token the customer can receive by email:

```
npm run licence:sign -- --key <private-hex> --customer "Acme Ltd" \
  --days 365 --grace 14 --features reports,payroll [--machine <fingerprint>]
```

Verification is Ed25519, entirely offline, in `crates/licence` — a pure Rust
crate with **no Tauri dependency**, so the logic can be tested anywhere and the
GUI toolchain is not needed to run its suite.

What it stops: editing the expiry date, copying a machine-bound licence to
another machine, forging a licence without the private key, and winding the
system clock back to revive an expired one (a high-water mark is persisted
between runs).

What it does not stop: someone patching the binary. Nothing running on hardware
you do not control can. The goal is to keep honest customers correct.

**The private key never enters this repository.** If it leaks, every licence ever
issued becomes forgeable and the only remedy is shipping a new binary with a new
key. `.gitignore` blocks the obvious filenames; that is a safety net, not a plan.

Build a release with the public half compiled in:

```bash
SIMBKIT_LICENCE_PUBLIC_KEY=<public-hex> npm run desktop:build
```

A build that still carries the development default key can be licensed by
anyone. Fail your release pipeline if that value survives.

## Deployment modes

Set `SIMBKIT_MODE` at build time.

| Mode | What it means |
|---|---|
| `standalone` | One machine, local SQLite, **no sockets opened at all** |
| `lan-server` | One machine runs the embedded API; other machines connect to it |
| `cloud-sync` | Local database plus an outbox that syncs when a server is reachable |

The updater plugin is only compiled into networked builds — a standalone install
is offline by construction, not by configuration.

## Layout

```
crates/licence/     pure Rust: sign, verify, expiry, machine binding, clock rollback
  examples/issue.rs the licence-issuing CLI (yours, never shipped)
src-tauri/          the Tauri app: commands, licence state, deployment mode
src/                the web UI, behind a LicenceGate
```

`require_feature` is enforced in Rust, not in the UI. Hiding a button is
presentation; refusing the command is enforcement.

## Cloud sync

The SaaS side of this protocol lives in the `cloud-sync` feature of a SiSAAS
project (`si add cloud-sync`). This install is the other half.

```
crates/sync/          the protocol. No HTTP, no database — both are traits.
  src/wire.rs         the wire format, mirroring the server's zod schema
  src/lib.rs          cursor, outbox, batching, conflicts
  src/http.rs         the real transport (ureq), behind the `http` feature
  examples/smoke.rs   drives it against a live server
src-tauri/migrations/ sync_outbox, sync_versions, sync_conflicts, sync_state
```

Neither HTTP nor the database is a dependency of the protocol, for two reasons
that turned out to matter: the Tauri app crate cannot compile without GTK/WebKit
headers, and a protocol whose tests need a network is a protocol nobody runs.
`cargo test -p sync` covers the whole thing in milliseconds.

### Three properties worth knowing before you change anything

**The idempotency key is written when a change is QUEUED, not when it is sent.**
`sync_outbox.batch_key` exists for exactly this. A push that times out is retried
with the same key and the server returns the original result; a key generated at
send time turns every timeout into a second application of the batch — which for
financial records is the failure this whole mechanism exists to survive.

**`baseVersion` is read at send time, from `sync_versions`.** The record may have
been pulled and updated while the entry sat in the outbox. Sending the version
captured at queue time reports a conflict that does not exist.

**The cursor comes from the server's reply, never from counting locally.** The
server never echoes an install's own writes, so the sequence has holes;
`since + changes.len()` steps straight over another machine's change.

### What is wired, and what is not

Verified: the protocol (12 tests), both migrations against a real SQLite and a
real Postgres, and the transport against a live HTTP server — the request the
server receives matches its schema field for field.

**Not written yet:** the `SyncStore` implementation over `tauri-plugin-sql`, the
background loop that honours the server's `intervalSeconds`, and the Tauri
commands that expose status and conflicts to the UI. They are the thin glue
between the two verified halves, and they cannot be compiled on a machine
without the WebKit headers — so they are left for a machine that can, rather
than shipped unchecked.
