import { IRateLimiterOptions, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

import { Logger } from './types'

const FALLBACK_TRIGGERED_MESSAGE = 'Fallback rate limiter triggered'

export class LoggedFallbackRateLimiter extends RateLimiterMemory {
  private logger: Logger
  private prefix: string

  constructor({ logger, prefix, ...rest }: { logger: Logger; prefix: string } & IRateLimiterOptions) {
    super(rest)
    this.logger = logger
    this.prefix = prefix
  }

  private logTriggered(key: string | number): void {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        prefix: this.prefix,
        key: key.toString(),
      },
    })
  }

  consume(
    key: string | number,
    pointsToConsume?: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logTriggered(key)
    return super.consume(key, pointsToConsume, options)
  }

  penalty(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered(key)
    return super.penalty(key, points, options)
  }

  reward(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered(key)
    return super.reward(key, points, options)
  }

  get(key: string | number, options?: { [key: string]: unknown }): Promise<RateLimiterRes | null> {
    this.logTriggered(key)
    return super.get(key, options)
  }

  set(
    key: string | number,
    points: number,
    secDuration: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logTriggered(key)
    return super.set(key, points, secDuration, options)
  }

  block(key: string | number, secDuration: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logTriggered(key)
    return super.block(key, secDuration, options)
  }

  delete(key: string | number, options?: { [key: string]: unknown }): Promise<boolean> {
    this.logTriggered(key)
    return super.delete(key, options)
  }
}
