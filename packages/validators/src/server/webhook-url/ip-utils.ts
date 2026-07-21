import net from 'node:net'

import { BLOCKED_IPV4_CIDRS, BLOCKED_IPV6_CIDRS } from '@/server/webhook-url/consts'

const ipv4ToInt = (ip: string): number => ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0

const isIpv4InCidr = (ip: string, cidr: string): boolean => {
  const [range, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask)
}

// Expands any valid IPv6 textual representation (compressed groups, embedded
// IPv4 tail, zone ID) into its 128-bit integer value for range comparisons.
const expandIpv6 = (ip: string): bigint => {
  const withoutZone = ip.split('%')[0]
  const doubleColonIdx = withoutZone.indexOf('::')
  const head = doubleColonIdx === -1 ? withoutZone : withoutZone.slice(0, doubleColonIdx)
  const tail = doubleColonIdx === -1 ? '' : withoutZone.slice(doubleColonIdx + 2)

  const parseGroups = (part: string): string[] => (part ? part.split(':') : [])
  const headGroups = parseGroups(head)
  const tailGroups = parseGroups(tail)

  // unwrap an embedded IPv4 address in the final group, e.g. ::ffff:127.0.0.1
  const lastGroups = tailGroups.length ? tailGroups : headGroups
  const lastIdx = lastGroups.length - 1
  if (lastIdx >= 0 && lastGroups[lastIdx].includes('.')) {
    const ipv4Int = ipv4ToInt(lastGroups[lastIdx])
    lastGroups.splice(lastIdx, 1, ((ipv4Int >>> 16) & 0xffff).toString(16), (ipv4Int & 0xffff).toString(16))
  }

  const missing = 8 - (headGroups.length + tailGroups.length)
  const zeroGroups: string[] = Array.from({ length: Math.max(missing, 0) }, () => '0')
  const groups = [...headGroups, ...zeroGroups, ...tailGroups]

  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group || '0', 16)), 0n)
}

const isIpv6InCidr = (ip: string, cidr: string): boolean => {
  const [range, bitsStr] = cidr.split('/')
  const bits = BigInt(bitsStr)
  const mask = bits === 0n ? 0n : BigInt.asUintN(128, -1n << (128n - bits))
  return (expandIpv6(ip) & mask) === (expandIpv6(range) & mask)
}

// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are a well-known SSRF filter bypass:
// unwrap them and check the embedded IPv4 address instead of the /96 prefix itself,
// since e.g. ::ffff:8.8.8.8 (public) should still be allowed.
const extractIpv4MappedAddress = (ip: string): string | null => {
  const value = expandIpv6(ip)
  if (value >> 32n !== 0xffffn) return null
  const ipv4Int = Number(value & 0xffffffffn)
  return [24, 16, 8, 0].map(shift => (ipv4Int >>> shift) & 0xff).join('.')
}

const stripBrackets = (host: string): string => host.replace(/^\[|\]$/g, '')

/**
 * Whether a literal IP address (v4 or v6, as resolved by DNS) falls within a blocked
 * private/reserved range.
 */
export const isBlockedIp = (rawIp: string): boolean => {
  const ip = stripBrackets(rawIp)
  const family = net.isIP(ip)
  if (family === 4) {
    return BLOCKED_IPV4_CIDRS.some(cidr => isIpv4InCidr(ip, cidr))
  }
  if (family === 6) {
    const mappedIpv4 = extractIpv4MappedAddress(ip)
    if (mappedIpv4) {
      return BLOCKED_IPV4_CIDRS.some(cidr => isIpv4InCidr(mappedIpv4, cidr))
    }
    return BLOCKED_IPV6_CIDRS.some(cidr => isIpv6InCidr(ip, cidr))
  }
  return false
}
