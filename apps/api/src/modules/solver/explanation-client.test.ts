import { describe, expect, it } from 'vitest';
import { addressKey, explanationClient } from './explanation-client.js';

describe('explanationClient', () => {
  const verified = { id: 'u1', emailVerifiedAt: new Date('2026-10-01T00:00:00Z') };
  const unverified = { id: 'u2', emailVerifiedAt: null };

  it('gives a guest no client, so no model', () => {
    expect(explanationClient(undefined, '203.0.113.7')).toBeNull();
  });

  it('keys a verified account on its id, wherever it comes from', () => {
    expect(explanationClient(verified, '203.0.113.7')).toBe('user:u1');
    expect(explanationClient(verified, '198.51.100.1')).toBe('user:u1');
  });

  it('keys an unverified account on its address, shared with others there', () => {
    expect(explanationClient(unverified, '203.0.113.7')).toBe('ip:203.0.113.7');
    expect(explanationClient({ id: 'u3', emailVerifiedAt: null }, '203.0.113.7')).toBe(
      'ip:203.0.113.7',
    );
  });
});

describe('addressKey', () => {
  it('keeps an IPv4 address whole', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('reads an IPv4 address carried as IPv6 as the IPv4 address', () => {
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it.each([
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['2001:db8:1:2::203.0.113.7', '2001:db8:1:2::/64'],
  ])('keys the IPv6 address %s on its /64, %s', (ip, key) => {
    expect(addressKey(ip)).toBe(key);
  });

  it('gives every address in one /64 the same key', () => {
    expect(addressKey('2001:db8:aa:bb::1')).toBe(addressKey('2001:db8:aa:bb:dead:beef:0:9'));
    expect(addressKey('2001:db8:aa:bb::1')).not.toBe(addressKey('2001:db8:aa:bc::1'));
  });

  it('passes anything that is not an address through unchanged', () => {
    expect(addressKey('unknown')).toBe('unknown');
  });
});
