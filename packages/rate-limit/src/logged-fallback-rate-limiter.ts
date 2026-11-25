import type { IRateLimiterOptions, RateLimiterRes } from 'rate-limiter-flexible'
import { RateLimiterMemory } from 'rate-limiter-flexible'

import type { Logger } from './types.js'

const FALLBACK_TRIGGERED_MESSAGE = 'Fallback rate limiter triggered'

export class LoggedFallbackRateLimiter extends RateLimiterMemory {
  private logger: Logger
  private prefix: string

  constructor({ logger, prefix, ...rest }: { logger: Logger; prefix: string } & IRateLimiterOptions) {
    super(rest)
    this.logger = logger
    this.prefix = prefix
  }

  /**
   * The context omits the key, which is a client IP or a caller-defined
   * actor and may contain personal data.
   */
  private logTriggered(): void {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        prefix: this.prefix,
      },
    })
  }

  consume(
    key: string | number,
    pointsToConsume?: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logTriggered()
    return super.consume(key, pointsToConsume, options)
  }

  penalty(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered()
    return super.penalty(key, points, options)
  }

  reward(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered()
    return super.reward(key, points, options)
  }

  get(key: string | number, options?: { [key: string]: unknown }): Promise<RateLimiterRes | null> {
    this.logTriggered()
    return super.get(key, options)
  }

  set(
    key: string | number,
    points: number,
    secDuration: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logTriggered()
    return super.set(key, points, secDuration, options)
  }

  block(key: string | number, secDuration: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered()
    return super.block(key, secDuration, options)
  }

  delete(key: string | number, options?: { [key: string]: unknown }): Promise<boolean> {
    this.logTriggered()
    return super.delete(key, options)
  }

  /**
   * Delete without logging, for a caller clearing fallback state itself
   * while Redis is healthy, which is not a fallback invocation.
   */
  deleteSilently(key: string | number): Promise<boolean> {
    return super.delete(key)
  }
}
