import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * What "cannot reach the network" actually means here, and who enforces it.
 *
 * The **browser** is the enforcement, via `connect-src 'self'` in the CSP: a
 * request to any other origin is refused no matter what code asks for it. That
 * covers the case this flavor exists for — data must not leave the machine.
 *
 * This scanner is the second layer. It runs on the BUILD OUTPUT, because a
 * dependency three levels down is exactly what reading your own source misses.
 * It looks for two things:
 *
 *   1. APIs that exist only to talk to someone else (WebSocket, EventSource,
 *      sendBeacon, WebRTC). There is no offline use for any of them.
 *   2. Absolute URLs to hosts that are not on the allowlist.
 *
 * It deliberately does NOT flag bare `fetch` or `XMLHttpRequest`. Loading your
 * own WASM and assets uses them — PGlite does, with `credentials: 'same-origin'`
 * — and banning them would mean banning a local database engine. `connect-src`
 * is what bounds where they may go.
 */
export const FORBIDDEN_APIS = [
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b|\bWebSocket\s*\(/ },
  { name: 'EventSource', re: /\bnew\s+EventSource\b/ },
  { name: 'navigator.sendBeacon', re: /\bsendBeacon\s*\(/ },
  { name: 'RTCPeerConnection', re: /\bRTCPeerConnection\b/ },
  { name: 'importScripts from a URL', re: /importScripts\s*\(\s*['"`]https?:/ },
];

/** Directives the CSP must carry, and what each one buys. */
export const REQUIRED_CSP = [
  {
    directive: "connect-src 'self'",
    why: "confines fetch/XHR/WebSocket/SSE to this app's own origin — the guarantee",
  },
  { directive: "default-src 'self'", why: 'blocks loading any subresource from off-origin' },
  {
    directive: "form-action 'none'",
    why: 'a form POST exfiltrates without ever touching connect-src',
  },
];

const SCANNED = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json']);
const URL_RE = /['"`(](https?:\/\/[a-z0-9.-]+[^'"`)\s]*)/gi;

/** Hosts that are never contacted: loopback is a dev-server reference, not a shipped call. */
const LOCAL_HOSTS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

export async function collectFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collectFiles(full)));
    else if (SCANNED.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

export function findForbiddenApis(source) {
  const cleaned = source.replace(/\/\/# sourceMappingURL=.*$/gm, '');
  return FORBIDDEN_APIS.filter((p) => p.re.test(cleaned)).map((p) => p.name);
}

export function findExternalUrls(source, allowPrefixes = []) {
  const cleaned = source.replace(/\/\/# sourceMappingURL=.*$/gm, '');
  const found = new Set();
  for (const match of cleaned.matchAll(URL_RE)) {
    const url = match[1];
    if (LOCAL_HOSTS.test(url)) continue;
    if (allowPrefixes.some((prefix) => url.startsWith(prefix))) continue;
    found.add(url);
  }
  return [...found];
}

export function checkCsp(html) {
  return REQUIRED_CSP.filter(({ directive }) => !html.includes(directive));
}

export async function verifyOffline(distDir, allowPrefixes = []) {
  const files = await collectFiles(distDir);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const rel = path.relative(distDir, file);
    for (const api of findForbiddenApis(source)) {
      violations.push({ file: rel, finding: api });
    }
    for (const url of findExternalUrls(source, allowPrefixes)) {
      violations.push({ file: rel, finding: `external URL ${url}` });
    }
  }

  const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
  return { files: files.length, violations, missingCsp: checkCsp(html) };
}
