export const isWhitelistedDomain = (
  domain: string,
  whitelistedDomains: { domain: string; includeSubdomains: boolean }[],
) => {
  return whitelistedDomains.some(
    (whitelisted) =>
      domain === whitelisted.domain ||
      (whitelisted.includeSubdomains &&
        domain.endsWith(`.${whitelisted.domain}`)),
  )
}
