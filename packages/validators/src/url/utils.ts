import { z } from 'zod'

import { UrlValidationError } from '@/url/errors'

/**
 * Creates a Zod schema that validates a string to ensure all characters are within the allowed characters set.
 *
 * @param allowedChars - A string containing all allowed characters. If this is blank, the schema will always pass.
 * @returns A Zod schema that validates a string to ensure all characters are within the allowed characters set.
 *
 * @example
 * ```typescript
 * const schema = createAllowedCharsSchema('abc123');
 * schema.parse('abc'); // Valid
 * schema.parse('a1b2c3'); // Valid
 * schema.parse('abcd'); // Throws an error
 * ```
 */
export const createAllowedCharsSchema = (allowedChars: string): z.ZodType<string> => {
  if (!allowedChars) {
    return z.string()
  }
  const allowed = new Set(Array.from(allowedChars))

  const schema = z.string().refine(
    (str: string) => {
      return Array.from(str).every(c=>allowed.has(c))
    },
    {
      message: `Every character must be in ${allowedChars}`,
    },
  )

  return schema
}

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
