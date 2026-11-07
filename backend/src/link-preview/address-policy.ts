import { BlockList, isIP } from 'node:net';

/**
 * Addresses a link preview must never connect to: "this" network, private, carrier-grade NAT,
 * loopback, link-local (incl. cloud metadata 169.254.169.254), IETF/benchmark/documentation
 * ranges, multicast, reserved and broadcast.
 */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

/**
 * IPv6 equivalents. IPv4-mapped (::ffff:0:0/96) and 6to4 (2002::/16) addresses are not listed:
 * their embedded IPv4 address is checked against the IPv4 list instead.
 */
const BLOCKED_V6: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], // unspecified, loopback and deprecated IPv4-compatible addresses
  ['64:ff9b::', 96], // NAT64 — would reach any IPv4 address, private ones included
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

const blockedV4 = new BlockList();
for (const [network, prefix] of BLOCKED_V4) blockedV4.addSubnet(network, prefix, 'ipv4');
const blockedV6 = new BlockList();
for (const [network, prefix] of BLOCKED_V6) blockedV6.addSubnet(network, prefix, 'ipv6');

/** Expands a valid IPv6 address (optionally ending in dotted IPv4) into its eight 16-bit groups. */
export function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = text.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 ? (parts[1] ? parts[1].split(':') : []) : null;
  const groups =
    tail === null ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const values = groups.map((group) => Number.parseInt(group, 16));
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : null;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** The IPv4 address carried inside an IPv4-mapped (::ffff:a.b.c.d) or 6to4 (2002::/16) address. */
export function embeddedIPv4(groups: readonly number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, ...number[]];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return ipv4FromGroups(g6 ?? 0, g7 ?? 0);
  }
  if (g0 === 0x2002) return ipv4FromGroups(g1 ?? 0, g2 ?? 0);
  return null;
}

/**
 * True only for a valid, globally routable unicast IP address. Anything unparsable, scoped
 * (`fe80::1%eth0`) or inside a blocked range is refused.
 */
export function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, 'ipv4');
  if (family !== 6) return false;
  const groups = expandIPv6(address);
  if (!groups) return false;
  const embedded = embeddedIPv4(groups);
  if (embedded) return isPublicAddress(embedded);
  return !blockedV6.check(address, 'ipv6');
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/**
 * Host names that point at the local machine or network by convention. Single-label names
 * (`intranet`) are refused too: the resolver's search domains could make them internal.
 * Expects a lower-case hostname without a trailing dot and that is not an IP literal.
 */
export function isBlockedHostname(hostname: string): boolean {
  if (hostname === 'localhost' || !hostname.includes('.')) return true;
  return BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

/**
 * Default port policy: the standard web ports plus unprivileged ports (≥ 1024). Other
 * well-known ports (SMTP 25, SSH 22, …) are refused so an http request can't be aimed at
 * another protocol's server on a public host.
 */
export function isAllowedPort(port: number): boolean {
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}
