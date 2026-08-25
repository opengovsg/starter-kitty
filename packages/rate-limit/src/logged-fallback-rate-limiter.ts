import { IRateLimiterOptions, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

import { Logger } from './types'

const FALLBACK_TRIGGERED_MESSAGE = 'Fallback rate limiter triggered'

export class LoggedFallbackRateLimiter extends RateLimiterMemory {
  private logger: Logger

  constructor({ logger, ...rest }: { logger: Logger } & IRateLimiterOptions) {
    super(rest)
    this.logger = logger
  }

  consume(
    key: string | number,
    pointsToConsume?: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.consume(key, pointsToConsume, options)
  }

  penalty(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.penalty(key, points, options)
  }

  reward(key: string | number, points?: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.reward(key, points, options)
  }

  get(key: string | number, options?: { [key: string]: unknown }): Promise<RateLimiterRes | null> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.get(key, options)
  }

  set(
    key: string | number,
    points: number,
    secDuration: number,
    options?: { [key: string]: unknown },
  ): Promise<RateLimiterRes> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.set(key, points, secDuration, options)
  }

  block(key: string | number, secDuration: number, options?: { [key: string]: unknown }): Promise<RateLimiterRes> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.block(key, secDuration, options)
  }

  delete(key: string | number, options?: { [key: string]: unknown }): Promise<boolean> {
    this.logger.warn({
      message: FALLBACK_TRIGGERED_MESSAGE,
      context: {
        key: key.toString(),
      },
    })
    return super.delete(key, options)
  }
}
