import { NextResponse, type NextRequest } from 'next/server';

// ── Tenant-routing layer ────────────────────────────────────────────────────
// One Next.js app serves three shapes of host, all pointed here by wildcard DNS:
//   1. {slug}.simbkit.local      → a tenant, rewritten onto the /s/[slug] subtree
//      so no per-tenant pages or config are needed.
//   2. {role}.simbkit.local      → a role dashboard (admin/app/…), each serving
//      one path subtree of this same app at the subdomain root.
//   3. a tenant's own custom domain → resolved to a slug via the API, then
//      rewritten exactly like case 1.
// Subdomains map locally (no network). Custom domains resolve via the API. In
// local dev (no simbkit.local host) nothing rewrites — use /s/<slug> directly.
const BASE = '.simbkit.local';
const RESERVED = new Set(['www', 'app', 'api']);

// Role dashboards each live on their own subdomain and serve one path subtree.
// These labels are NEVER treated as tenant slugs. Add roles here as you add
// dashboards; keep the app's own links carrying the prefix (e.g. /dashboard/x).
const ROLE_ROUTES: Record<string, string> = {
  admin: '/admin',
  app: '/dashboard',
};

// Our own hosts (landing, api, dev) — never treated as a custom domain.
const OWN_HOSTS = new Set(['simbkit.local', 'www.simbkit.local', 'localhost']);
const API_URL = process.env.API_URL ?? 'http://localhost:8080';

// ponytail: per-instance host→slug cache; a cold/other instance just re-resolves.
const slugCache = new Map<string, { slug: string | null; exp: number }>();
const TTL_MS = 300_000;

async function resolveCustomSlug(host: string): Promise<string | null> {
  const hit = slugCache.get(host);
  if (hit && hit.exp > Date.now()) return hit.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(
      `${API_URL}/public/storefront/resolve?host=${encodeURIComponent(host)}`,
    );
    if (res.ok) slug = ((await res.json()) as { slug: string | null }).slug;
  } catch {
    /* API unreachable → don't rewrite, fall through */
  }
  slugCache.set(host, { slug, exp: Date.now() + TTL_MS });
  return slug;
}

function rewriteToSlug(req: NextRequest, slug: string) {
  const url = req.nextUrl.clone();
  if (url.pathname.startsWith('/s/')) return NextResponse.next(); // already mapped
  url.pathname = `/s/${slug}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export async function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();

  // 1) {label}.simbkit.local — role dashboard, reserved host, or tenant slug.
  if (host.endsWith(BASE)) {
    const label = host.slice(0, -BASE.length);
    if (!label || label.includes('.') || RESERVED.has(label)) {
      return NextResponse.next();
    }
    // Role subdomains serve their path subtree at the subdomain root. The app's
    // own links already carry the prefix (e.g. /dashboard/settings), so only the
    // bare root needs rewriting; everything else passes through unchanged.
    const prefix = ROLE_ROUTES[label];
    if (prefix) {
      if (req.nextUrl.pathname === '/') {
        const url = req.nextUrl.clone();
        url.pathname = prefix;
        return NextResponse.rewrite(url);
      }
      return NextResponse.next();
    }
    return rewriteToSlug(req, label);
  }

  // 2) Our apex/landing/dev hosts and raw IPs — leave untouched.
  if (OWN_HOSTS.has(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return NextResponse.next();
  }

  // 3) A tenant's custom domain — resolve to its slug, else pass through.
  const slug = await resolveCustomSlug(host);
  return slug ? rewriteToSlug(req, slug) : NextResponse.next();
}

// Skip Next internals, the same-origin API proxy, and ANY static file (has an
// extension) — else tenant subdomains rewrite /public assets onto /s/{slug}/…
// and 404 them.
export const config = {
  matcher: ['/((?!_next/|api/|.*\\.[^/]+$).*)'],
};
