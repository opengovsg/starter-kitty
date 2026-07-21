// IANA IPv4 special-purpose registry ranges that must never be reachable via a
// user-supplied webhook destination: https://www.iana.org/assignments/iana-ipv4-special-registry
export const BLOCKED_IPV4_CIDRS: readonly string[] = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8', // RFC 1918 private
  '100.64.0.0/10', // carrier-grade NAT (RFC 6598)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, includes cloud metadata (169.254.169.254)
  '172.16.0.0/12', // RFC 1918 private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation (TEST-NET-1)
  '192.168.0.0/16', // RFC 1918 private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation (TEST-NET-2)
  '203.0.113.0/24', // documentation (TEST-NET-3)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
  '255.255.255.255/32', // broadcast
]

// IANA IPv6 special-purpose registry ranges: https://www.iana.org/assignments/iana-ipv6-special-registry
export const BLOCKED_IPV6_CIDRS: readonly string[] = [
  '::/128', // unspecified
  '::1/128', // loopback
  'fc00::/7', // unique local (private)
  'fe80::/10', // link-local
  '2001:db8::/32', // documentation
]

export const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'metadata.google.internal', // GCP metadata
  'metadata', // GCP metadata short form
])
