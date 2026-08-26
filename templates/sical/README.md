# Simbkit — fully local

Web technology, no network. Postgres (via PGlite/WASM) runs in the page and the
data lives in IndexedDB. There is no server, no account, no telemetry.

```bash
npm install
npm test          # the offline guard's own tests
npm run dev
npm run build     # builds, then FAILS if the bundle can reach the network
```

## "No network" is enforced, not documented

Two independent layers, because a promise nothing checks quietly stops being true
the first time someone adds a dependency.

1. **A Content-Security-Policy** in `index.html` with `connect-src 'self'` — the
   browser refuses any request to another origin, whatever code asks for it —
   plus `default-src 'self'` and `form-action 'none'` (a form POST exfiltrates
   without ever touching `connect-src`).

   Not `'none'`: the local database engine loads its own WASM with a same-origin
   `fetch`. `'none'` would block that and break the app. `'self'` is the actual
   guarantee — nothing leaves this origin.

2. **`npm run verify:offline`**, wired into `build`. It scans the **built
   bundle**, not the source, for APIs that exist only to talk to someone else
   (`WebSocket`, `EventSource`, `sendBeacon`, `RTCPeerConnection`) and for
   absolute URLs to hosts that are not allowlisted. Scanning the output is the
   point: a transitive dependency that phones home is exactly what reading your
   own source misses.

   URLs that are only ever strings — XML namespaces, docs links — live in
   `offline.allowlist.json` with a reason. A real endpoint does not belong there.

The guard has its own tests (`npm test`) — including one that proves it fails on
a build that gained a `fetch`, because a check that cannot fail is decoration.

If the build fails on a dependency you need, the honest options are to bundle its
data, replace it, or accept that this is not a SiCAL app.

## Data belongs to the user

With no server there is no backup. **Export and import are first-class features**
in the footer, not a settings-page afterthought: a cleared browser profile is
otherwise total data loss.

For a desktop build, wrap this in Tauri v2 — the same source, with the data in a
real SQLite file the user can copy. Keep the CSP.

## What is deliberately absent

No auth (one user, one device — a login screen would protect nothing). No
tenant_id and no RLS: row-level security constrains a shared server, and there
isn't one. No webfonts, no CDN, no analytics.
