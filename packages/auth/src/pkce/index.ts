import { customAlphabet } from 'nanoid'

import { PKCE_VERIFIER_ALPHABET, PKCE_VERIFIER_LENGTH } from './constants.js'

/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) verifier/challenge
 * construction, for binding a secret to the specific session that requested
 * it. For example, an OTP that must only be redeemable by the browser tab
 * that requested it, not by whoever intercepts it in transit.
 *
 * This is **not an OAuth/OIDC client**. There is no `state`, no `nonce`, and
 * no authorization-code exchange here, only the verifier/challenge pair. Do
 * not use this for an actual OAuth authorization-code flow; use a maintained
 * OAuth/OIDC library for that instead.
 */

const generateVerifier = customAlphabet(PKCE_VERIFIER_ALPHABET, PKCE_VERIFIER_LENGTH)

/**
 * Generate a random PKCE code verifier: 128 characters (the RFC 7636
 * maximum) from the unreserved character set.
 *
 * Keep this value only on the requesting client, in memory rather than
 * `sessionStorage` or `localStorage` (see the package README), and send only
 * its {@link createPkceChallenge | challenge} with the initiating request.
 *
 * @public
 */
export function createPkceVerifier(): string {
  return generateVerifier()
}

/**
 * Derive the PKCE code challenge for a verifier using the `S256` method:
 * base64url(SHA-256(verifier)).
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`), available unflagged
 * since Node.js 19 and in every modern browser, so the exact same code runs
 * on the client and the server. There is no separate "browser" and "server"
 * implementation to keep in sync.
 *
 * @public
 */
export async function createPkceChallenge(codeVerifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Web Crypto API (globalThis.crypto.subtle) is unavailable in this environment. ' +
        'In browsers, crypto.subtle requires a secure context: serve the page over HTTPS ' +
        '(or use http://localhost for development); it is undefined on a plain-HTTP origin ' +
        'such as a staging server or a LAN IP. In Node.js, @opengovsg/auth requires >=20.19.0.',
    )
  }
  const data = new TextEncoder().encode(codeVerifier)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Check that a string is a plausible PKCE `S256` code challenge: the
 * canonical base64url encoding of a 32-byte SHA-256 digest.
 *
 * Re-encodes the decoded bytes and requires an exact match against the
 * input, not just a matching decoded length. A non-canonical base64url
 * string (nonzero padding bits in the last symbol) can decode to a 32-byte
 * value while never being producible by {@link createPkceChallenge} itself,
 * which would let a malformed-but-length-passing challenge through and
 * leave the resulting OTP permanently unverifiable.
 *
 * This validates shape only, not that any particular verifier produced it.
 * Pair with {@link createPkceChallenge} server-side to check that.
 *
 * @public
 */
export function isValidCodeChallenge(codeChallenge: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    // A 32-byte value base64url-encodes to exactly 43 characters (no padding).
    return false
  }
  try {
    let base64 = codeChallenge.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4
    if (padding) {
      base64 += '='.repeat(4 - padding)
    }
    const binary = atob(base64)
    if (binary.length !== 32) {
      return false
    }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return base64UrlEncode(bytes) === codeChallenge
  } catch {
    return false
  }
}
