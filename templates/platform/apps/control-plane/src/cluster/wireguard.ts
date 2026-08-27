/**
 * WireGuard address allocation.
 *
 * In the repo this replaces, the operator picked the next `10.89.0.N` by reading
 * the file and counting — which silently reuses an address after a node is
 * removed, and two nodes on one address break the mesh in a way that looks like
 * a firewall problem.
 */
export interface Cidr {
  /** Network address, e.g. `10.89.0.0`. */
  network: string;
  /** Prefix length, e.g. 24. */
  prefix: number;
}

export function parseCidr(cidr: string): Cidr {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new Error(`not a CIDR: ${cidr}`);
  const prefix = Number(match[2]);
  if (prefix < 8 || prefix > 30) throw new Error(`unsupported prefix /${prefix} (want /8../30)`);
  const octets = match[1]!.split('.').map(Number);
  if (octets.some((o) => o > 255)) throw new Error(`not a CIDR: ${cidr}`);
  return { network: match[1]!, prefix };
}

export function ipToInt(ip: string): number {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    throw new Error(`not an IPv4 address: ${ip}`);
  }
  // >>> 0 keeps it unsigned: without it 10.x addresses are fine but anything
  // above 127.x comes back negative and every comparison inverts.
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

export function intToIp(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/**
 * Lowest free host address in the range.
 *
 * Skips the network and broadcast addresses, and never returns one that is
 * already taken — including addresses freed by removing a node, which are
 * reusable precisely because the caller passes the *current* set.
 */
export function allocateAddress(cidr: string, taken: readonly string[]): string {
  const { network, prefix } = parseCidr(cidr);
  const base = ipToInt(network);
  const size = 2 ** (32 - prefix);
  const used = new Set(taken.map(ipToInt));

  // Skip .0 (network) and stop before the broadcast address.
  for (let offset = 1; offset < size - 1; offset++) {
    const candidate = base + offset;
    if (!used.has(candidate)) return intToIp(candidate);
  }
  throw new Error(`no free address left in ${cidr} (${taken.length} in use)`);
}

export function isWithin(cidr: string, ip: string): boolean {
  const { network, prefix } = parseCidr(cidr);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
}
