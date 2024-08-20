import { UrlValidationError } from '@/url/errors'
import { UrlValidatorWhitelist } from '@/url/options'

const DYNAMIC_ROUTE_SEGMENT_REGEX = /\[\[?([^\]]+)\]?\]/g

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
    throw new UrlValidationError(
      `Invalid URL: ${url} is not on the same origin as base URL ${baseOrigin.href}`,
    )
  }
  return normalizedUrl
}

/* As of Next.js 14.2.5, router.push() resolves dynamic routes using query parameters. */
const resolveNextDynamicRoute = (url: URL): URL => {
  const pathname = url.pathname
  const query = new URLSearchParams(url.search)
  const resolvedPathname = pathname.replace(
    DYNAMIC_ROUTE_SEGMENT_REGEX,
    (_, name: string) => {
      const value = query.get(name) || ''
      query.delete(name)
      return value
    },
  )

  const result = new URL(url.href)
  result.pathname = resolvedPathname
  return result
}

export const isSafeUrl = (url: URL, whitelist: UrlValidatorWhitelist) => {
  // only allow whitelisted protocols
  if (
    !whitelist.protocols.some((protocol) => url.protocol === `${protocol}:`)
  ) {
    return false
  }
  // only allow whitelisted hosts
  if (whitelist.hosts && !whitelist.hosts.some((host) => url.host === host)) {
    return false
  }
  // don't allow dynamic routes
  if (resolveNextDynamicRoute(url).href !== url.href) {
    return false
  }
  return true
}
