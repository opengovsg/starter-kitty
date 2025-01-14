// regex from https://github.com/vercel/next.js/blob/8cb8edb686ec8ddf7e24c69545d11175fcb9df02/packages/next/src/shared/lib/router/utils/is-dynamic.ts#L7
const DYNAMIC_ROUTE_SEGMENT_REGEX = /\/\[[^/]+?\](?=\/|$)/

// from https://github.com/vercel/next.js/blob/94bda4995ee5ea0bb5b73288d21918ceeb2b35be/packages/next/src/server/lib/interception-routes.ts#L11
function isInterceptionRouteAppPath(path: string): boolean {
  const INTERCEPTION_ROUTE_MARKERS = ['(..)(..)', '(.)', '(..)', '(...)'] as const

  return path.split('/').find(segment => INTERCEPTION_ROUTE_MARKERS.find(m => segment.startsWith(m))) !== undefined
}

export const isDynamicRoute = (url: URL): boolean => {
  const route = url.pathname
  if (isInterceptionRouteAppPath(route)) {
    return true
  }
  return DYNAMIC_ROUTE_SEGMENT_REGEX.test(route)
}
