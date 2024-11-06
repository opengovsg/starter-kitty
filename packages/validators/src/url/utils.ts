import { UrlValidationError } from '@/url/errors'
import { UrlValidatorWhitelist } from '@/url/options'

// regex from https://github.com/vercel/next.js/blob/8cb8edb686ec8ddf7e24c69545d11175fcb9df02/packages/next/src/shared/lib/router/utils/is-dynamic.ts#L7
const DYNAMIC_ROUTE_SEGMENT_REGEX = /\/\[[^/]+?\](?=\/|$)/
const IS_NOT_HOSTNAME_REGEX = /[^.]+\.[^.]+/g

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

export const isDynamicRoute = (url: URL): boolean => {
  return DYNAMIC_ROUTE_SEGMENT_REGEX.test(url.pathname)
}

export const isSafeUrl = (url: URL, whitelist: UrlValidatorWhitelist) => {
  // only allow whitelisted protocols
  if (!whitelist.protocols.some(protocol => url.protocol === `${protocol}:`)) {
    return false
  }
  if (whitelist.hosts) {
    // only allow whitelisted hosts
    if (!whitelist.hosts.some(host => url.host === host)) {
      return false
    }
  } else {
    // no hosts provided
    if (whitelist.disallowHostnames && !url.host.match(IS_NOT_HOSTNAME_REGEX)) {
      return false
    }
  }

  // don't allow dynamic routes
  if (isDynamicRoute(url)) {
    return false
  }
  return true
}
