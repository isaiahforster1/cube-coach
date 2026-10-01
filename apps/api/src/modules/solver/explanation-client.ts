import { isIPv4, isIPv6 } from 'node:net';

/**
 * Whose daily model budget a solver request spends (ADR-0022 §5), or `null` for a guest,
 * who gets template explanations.
 *
 * - A verified account is its own client, wherever it signs in from. Verification is what
 *   makes it worth a budget: an unverified account costs nothing to create, so giving each
 *   one a budget would hand a fresh budget to every throwaway registration.
 * - An unverified account shares the budget of the address it comes from, which `request.ip`
 *   gives reliably since the proxy trust fix (ADR-0018 §5).
 */
export function explanationClient(
  user: { readonly id: string; readonly emailVerifiedAt: Date | null } | undefined,
  ip: string,
): string | null {
  if (user === undefined) return null;
  if (user.emailVerifiedAt !== null) return `user:${user.id}`;
  return `ip:${addressKey(ip)}`;
}

/**
 * An address as one subscriber. IPv4 is the whole address. IPv6 is its first 64 bits,
 * because a home connection is usually given a whole /64 and could otherwise spend a fresh
 * budget from every address in it. An IPv4 address carried as IPv6 (`::ffff:1.2.3.4`,
 * which a dual-stack socket reports) is the IPv4 address. Anything else is used as it is.
 */
export function addressKey(ip: string): string {
  const address = ip.split('%')[0] ?? ip; // drop an IPv6 zone index
  const mapped = /^::ffff:(.+)$/iu.exec(address)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (!isIPv6(address)) return address;
  return `${ipv6Groups(address).slice(0, 4).join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, `::` expanded, in lower-case hex. */
function ipv6Groups(address: string): string[] {
  const groupsIn = (part: string): string[] => {
    if (part === '') return [];
    const groups = part.split(':');
    const last = groups.at(-1)!;
    // A dotted IPv4 tail is the last two groups.
    if (isIPv4(last)) {
      const [a, b, c, d] = last.split('.').map(Number) as [number, number, number, number];
      groups.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    return groups;
  };

  const [head = '', tail] = address.split('::');
  const left = groupsIn(head);
  const right = tail === undefined ? [] : groupsIn(tail);
  const zeros = Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...zeros, ...right].map((group) => parseInt(group, 16).toString(16));
}
