import { ParsedMailbox, parseOneAddress } from 'email-addresses'

import { EmailValidationError } from '@/email/errors'

export const parseEmail = (email: string) => {
  const result = parseOneAddress(email) as ParsedMailbox
  if (!result) {
    throw new EmailValidationError('Invalid email address')
  }
  return result
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
