import { ParsedMailbox } from 'email-addresses'

import { MAX_DOMAIN_LENGTH, MAX_LOCAL_LENGTH } from './consts'
import { ParsedEmailValidatorOptions } from './options'

export const isValidEmail = (
  email: ParsedMailbox,
  whitelisted: ParsedEmailValidatorOptions['domains'],
) => {
  const domain = email.domain
  const local = email.local

  if (local.length > MAX_LOCAL_LENGTH || domain.length > MAX_DOMAIN_LENGTH) {
    return false
  }

  if (whitelisted.length === 0) {
    return true
  }
  return isWhitelistedDomain(domain, whitelisted)
}

export const isWhitelistedDomain = (
  domain: string,
  whitelistedDomains: { domain: string; includeSubdomains: boolean }[],
) => {
  // Accept in the following cases:
  // Case 1: The domain is an exact match of a whitelisted domain
  // Case 2: The domain is a subdomain of a whitelisted domain, AND includeSubdomains is true
  return whitelistedDomains.some(
    (whitelisted) =>
      domain === whitelisted.domain ||
      (whitelisted.includeSubdomains &&
        domain.endsWith(`.${whitelisted.domain}`)),
  )
}
