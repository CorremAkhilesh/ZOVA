import { describe, expect, it } from 'vitest';
import {
  embeddedIPv4,
  expandIPv6,
  isAllowedPort,
  isBlockedHostname,
  isPublicAddress,
} from './address-policy.ts';

describe('isPublicAddress', () => {
  it.each([
    ['0.0.0.0', 'this network'],
    ['0.255.1.2', 'this network'],
    ['10.0.0.1', 'private 10/8'],
    ['10.255.255.255', 'private 10/8'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['100.127.255.254', 'carrier-grade NAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'private 172.16/12'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.10', 'TEST-NET-1'],
    ['192.168.1.1', 'private 192.168/16'],
    ['198.18.0.1', 'benchmarking'],
    ['198.19.255.255', 'benchmarking'],
    ['198.51.100.7', 'TEST-NET-2'],
    ['203.0.113.7', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks IPv4 %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback, long form'],
    ['::127.0.0.1', 'IPv4-compatible'],
    ['fc00::1', 'unique local'],
    ['fd12:3456:789a::1', 'unique local'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['ff02::1', 'multicast'],
    ['64:ff9b::8.8.8.8', 'NAT64 (any IPv4 behind it)'],
    ['64:ff9b::a00:1', 'NAT64'],
    ['2001:db8::1', 'documentation'],
    ['2001:0:4136:e378::1', 'Teredo'],
    ['fe80::1%eth0', 'scoped address'],
  ])('blocks IPv6 %s (%s)', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.1.2.3',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:c0a8:101',
    '2002:7f00:1::1',
    '2002:c0a8:101::',
  ])('blocks IPv4-mapped / 6to4 %s carrying a private IPv4', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '198.17.255.255',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2a00:1450:4001::200e',
    '::ffff:8.8.8.8',
    '2002:808:808::1',
  ])('allows public %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(['', 'localhost', 'example.com', '1.2.3', '999.1.1.1', '::g'])(
    'refuses non-addresses (%s)',
    (value) => {
      expect(isPublicAddress(value)).toBe(false);
    },
  );
});

describe('expandIPv6 / embeddedIPv4', () => {
  it('expands compressed, full and dotted forms', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(expandIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects malformed input', () => {
    expect(expandIPv6('1::2::3')).toBeNull();
    expect(expandIPv6('1:2:3')).toBeNull();
    expect(expandIPv6('::zzzz')).toBeNull();
  });

  it('extracts the IPv4 address from mapped and 6to4 addresses only', () => {
    expect(embeddedIPv4([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])).toBe('127.0.0.1');
    expect(embeddedIPv4([0x2002, 0xc0a8, 0x0101, 0, 0, 0, 0, 1])).toBe('192.168.1.1');
    expect(embeddedIPv4([0x2606, 0x4700, 0, 0, 0, 0, 0, 1])).toBeNull();
  });
});

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'app.localhost',
    'printer.local',
    'metadata.google.internal',
    'db.internal',
    'box.localdomain',
    'nas.home.arpa',
    'intranet',
  ])('blocks %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  it.each(['example.com', 'localhost.example.com', 'internal.example.com', 'www.local-news.in'])(
    'allows %s',
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(false);
    },
  );
});

describe('isAllowedPort', () => {
  it('allows web and unprivileged ports, refuses other well-known ports', () => {
    for (const port of [80, 443, 1024, 8080, 8443, 65535]) expect(isAllowedPort(port)).toBe(true);
    for (const port of [0, 21, 22, 25, 110, 445, 1023, 65536]) {
      expect(isAllowedPort(port)).toBe(false);
    }
  });
});
