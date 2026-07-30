import ipaddr from 'ipaddr.js'

/**
 * Derive the store key for a client IP, or `null` when the input is not a
 * valid IP address so the caller can warn and fall back to the shared bucket.
 *
 * IPv4 addresses, including IPv4-mapped IPv6 addresses, are keyed per
 * address. IPv6 addresses are keyed by their /64 prefix, since a subscriber
 * typically holds an entire /64 and could otherwise mint a fresh bucket per
 * request by rotating within it.
 *
 * @public
 */
export const normalizeIp = (ip: string): string | null => {
  if (!ipaddr.IPv4.isValidFourPartDecimal(ip) && !ipaddr.IPv6.isValid(ip)) return null

  // `process` normalizes every spelling of an IPv4-mapped IPv6 address to
  // IPv4 so all representations of the client share one bucket.
  const address = ipaddr.process(ip)
  if (address instanceof ipaddr.IPv4) return address.toString()

  // The first four 16-bit groups form the /64 key. Parsed groups make
  // compressed, expanded, and zone-bearing spellings equivalent. Dashes keep
  // colons out of the common `namespace:subkey` Redis convention.
  return address.parts
    .slice(0, 4)
    .map(group => group.toString(16))
    .join('-')
}
