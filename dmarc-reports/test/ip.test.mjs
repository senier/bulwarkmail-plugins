import { describe, expect, it } from 'vitest';
import { isPublic, parseIp, ptrName } from '../src/lib/ip.js';

describe('parseIp', () => {
  it('accepts IPv4 and IPv6 and gives the canonical text', () => {
    expect(parseIp('8.8.8.8').text).toBe('8.8.8.8');
    expect(parseIp(' 8.8.4.4 ').text).toBe('8.8.4.4');
    expect(parseIp('2606:4700:4700:0:0:0:0:1111').text).toBe('2606:4700:4700::1111');
    expect(parseIp('2001:DB8::A').text).toBe('2001:db8::a');
    expect(parseIp('::').text).toBe('::');
    expect(parseIp('::1').text).toBe('::1');
    expect(parseIp('1:0:0:2:0:0:0:3').text).toBe('1:0:0:2::3'); // the longest run is compressed
    expect(parseIp('::ffff:1.2.3.4').text).toBe('::ffff:102:304');
  });

  it.each([
    '', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.4/../x', '1.2.3.4%eth0', '[::1]', '::1::2',
    '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', 'g::1', ':1', '1:', '1.2.3.4:80', 'example.org', '1.2.3.4\n5.6.7.8',
    '../../etc', `${'1'.repeat(60)}`, null, undefined,
  ])('refuses %j', (value) => {
    expect(parseIp(value)).toBeNull();
  });
});

describe('isPublic', () => {
  it.each(['8.8.8.8', '1.1.1.1', '159.0.0.1', '172.32.0.1', '2001:4860:4860::8888', '2a00:1450:4001:80b::200e', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(isPublic(ip)).toBe(true);
  });

  it.each([
    '0.1.2.3', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.0.2.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.7', '203.0.113.10', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2001:0:1::1', '2002:808:808::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '3fff::1',
  ])('%s is not', (ip) => {
    expect(isPublic(ip)).toBe(false);
  });

  it('is false for anything that is not an address', () => {
    expect(isPublic('example.org')).toBe(false);
    expect(isPublic(null)).toBe(false);
  });
});

describe('ptrName', () => {
  it('reverses the octets and the nibbles', () => {
    expect(ptrName('8.8.4.4')).toBe('4.4.8.8.in-addr.arpa');
    expect(ptrName('2001:db8::567:89ab')).toBe('b.a.9.8.7.6.5.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa'); // RFC 3596
  });

  it('refuses what is not an address, so nothing else can become a DNS name', () => {
    expect(() => ptrName('evil.example')).toThrow();
    expect(() => ptrName('1.2.3.4/x')).toThrow();
  });
});
