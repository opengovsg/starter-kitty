import { UNKNOWN_BUCKET } from './constants.js'
import type { Logger } from './types.js'
import { normalizeIp } from './utilities.js'

/**
 * Derive the store key for a client IP, warning and falling back to the
 * shared unknown bucket when the input is `null` or not a valid IP address.
 */
export const resolveIpBucket = ({
  ip,
  validate,
  logger,
  factoryLogger,
}: {
  ip: string | null
  validate: boolean
  logger?: Logger
  factoryLogger?: Logger
}): string => {
  const key = ip === null ? null : validate ? normalizeIp(ip) : ip
  if (key === null) {
    const warnLogger = logger ?? factoryLogger
    warnLogger?.warn(
      ip === null
        ? {
            message: 'Client IP extraction returned null, using the shared unknown bucket',
          }
        : {
            message: 'Client IP is not a valid IPv4 or IPv6 address, using the shared unknown bucket',
            context: { ip: ip.slice(0, 64) },
          },
    )
  }
  return key?.replaceAll(':', '-') ?? UNKNOWN_BUCKET
}
