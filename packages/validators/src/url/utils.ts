import { UrlValidationError } from '@/url/errors'
import { Whitelist } from '@/url/options'

export const resolveRelativeUrl = (url: string, baseUrl?: URL): URL => {
  if (!baseUrl) {
    try {
      return new URL(url)
    } catch (error: TypeError) {
      throw new UrlValidationError(`Invalid URL: ${url}`)
    }
  }

  let normalizedUrl: URL

  try {
    normalizedUrl = new URL(url, baseUrl)
  } catch (error: TypeError) {
    throw new UrlValidationError(`Invalid URL: ${url}`)
  }

  if (new URL(baseUrl).origin !== normalizedUrl.origin) {
    throw new UrlValidationError(
      `Invalid URL: ${url} is not on the same origin as base URL ${baseUrl.href}`,
    )
  }
  return normalizedUrl
}

export const isSafeUrl = (url: URL, whitelist: Whitelist) => {
  if (
    !whitelist.protocols.some((protocol) => url.protocol === `${protocol}:`)
  ) {
    return false
  }
  if (whitelist.hosts && !whitelist.hosts.some((host) => url.host === host)) {
    return false
  }
  return true
}
