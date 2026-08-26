/**
 * Extracts a tenant slug from a Host header, given the root domain.
 *   shop1.simbkit.local        → 'shop1'
 *   simbkit.local / www.*      → null   (apex, not a tenant)
 *   admin.simbkit.local        → null   (reserved role subdomain)
 * Custom domains (a host not under rootDomain) return null here and are resolved
 * separately against the tenants table.
 */
const RESERVED = new Set(['www', 'app', 'admin', 'api']);

export function slugFromHost(host: string | undefined, rootDomain: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  if (hostname === rootDomain) return null;
  const suffix = `.${rootDomain}`;
  if (!hostname.endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  if (!label || label.includes('.') || RESERVED.has(label)) return null;
  return label;
}
