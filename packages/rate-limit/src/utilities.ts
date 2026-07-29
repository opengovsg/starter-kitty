import ipaddr from 'ipaddr.js'

/**
 * Derive the store key for a client IP, or `null` when the input is not a
 * valid IP address so the caller can warn and fall back to the shared bucket.
 *
 * IPv4 addresses (including IPv4-mapped IPv6 addresses, normalized to IPv4)
 * are keyed per address. IPv6 addresses are keyed by their /64 prefix, since a
 * subscriber typically holds an entire /64 and per-address keying would let
 * an attacker mint a fresh bucket per request by rotating within their
 * prefix.
 *
 * @public
 */
export const normalizeIp = (ip: string): string | null => {
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip) && !ipaddr.IPv6.isValid(ip)) return null

  // IPv4-mapped IPv6 addresses are IPv4 traffic arriving on a dual-stack
  // socket. `process` normalizes both their dotted and hexadecimal spellings
  // to IPv4 so every representation of the client shares one bucket.
  const address = ipaddr.process(ip)
  if (address instanceof ipaddr.IPv4) return address.toString()

  // Use the first four 16-bit groups as the IPv6 /64 key. Working from parsed
  // groups makes compressed, expanded, embedded-IPv4, and zone-bearing
  // spellings equivalent. Colons are avoided for compatibility with the
  // common `namespace:subkey` Redis convention.
  return address.parts
    .slice(0, 4)
    .map(group => group.toString(16))
    .join('-')
}
