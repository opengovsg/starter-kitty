import { UrlValidationError } from '@/url/errors'

export const IS_NOT_HOSTNAME_REGEX = /[^.]+\.[^.]+/g

export const resolveRelativeUrl = (url: string, baseOrigin?: URL): URL => {
  if (!baseOrigin) {
    try {
      return new URL(url)
    } catch (error) {
      throw new UrlValidationError(`Invalid URL: ${url}`)
    }
  }

  let normalizedUrl
  try {
    normalizedUrl = new URL(url, baseOrigin)
  } catch (error) {
    throw new UrlValidationError(`Invalid URL: ${url}`)
  }

  if (new URL(baseOrigin).origin !== normalizedUrl.origin) {
    throw new UrlValidationError(`Invalid URL: ${url} is not on the same origin as base URL ${baseOrigin.href}`)
  }
  return normalizedUrl
}

export const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err) {
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return 'Unknown error'
}
