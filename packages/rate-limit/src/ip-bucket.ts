import { UNKNOWN_BUCKET } from './constants.js'
import type { Logger } from './types.js'
import { normalizeIp } from './utilities.js'

/**
 * Derive the store key for a client IP, shared by the IP-keyed limiters.
 *
 * An unparseable IP falls into the shared unknown bucket and logs an error,
 * so a broken extractor shows up in logs, not just as 429s. With
 * `skipKeyNormalization`, every string is used verbatim.
 */
export const resolveIpBucket = ({
  ip,
  skipKeyNormalization,
  logger,
}: {
  ip: unknown
  skipKeyNormalization: boolean
  logger: Logger
}): string => {
  // Non-strings never reach normalizeIp or the verbatim path, so a broken
  // extractor cannot crash the limiter on either path.
  const key = typeof ip !== 'string' ? null : skipKeyNormalization ? ip : normalizeIp(ip)
  if (key === null) {
    logger.error({
      message:
        typeof ip !== 'string'
          ? 'Client IP extraction did not return a string, using the shared unknown bucket'
          : 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
      // Truncated because an unparseable value is attacker-controlled
      // input and must not flood logs.
      context: { ip: String(ip).slice(0, 64) },
    })
  }
  return key ?? UNKNOWN_BUCKET
}
