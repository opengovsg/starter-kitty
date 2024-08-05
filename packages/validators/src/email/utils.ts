import { ParsedMailbox } from 'email-addresses'

import { MAX_DOMAIN_LENGTH, MAX_LOCAL_LENGTH } from './consts'
import { ParsedEmailValidatorOptions } from './options'

export const isValidEmail = (
  email: ParsedMailbox,
  whitelisted: ParsedEmailValidatorOptions['domains'],
) => {
  console.log(email)
  const domain = email.domain
  const local = email.local

  if (local.length > MAX_LOCAL_LENGTH || domain.length > MAX_DOMAIN_LENGTH)
    return false

  if (whitelisted.length === 0) {
    return true
  }
  return isWhitelistedDomain(domain, whitelisted)
}

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
