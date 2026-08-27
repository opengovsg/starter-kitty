// RFC 7636 unreserved character set: ALPHA / DIGIT / "-" / "." / "_" / "~"
export const PKCE_VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

// RFC 7636 caps the verifier at 43-128 characters. Longer is strictly more
// entropy, so what this package mints isn't exposed as a tunable.
export const PKCE_VERIFIER_LENGTH = 128

// The full range the RFC allows. Verification accepts any of it, since a
// caller may bring a verifier minted elsewhere; only createPkceVerifier is
// pinned to the maximum.
export const PKCE_VERIFIER_LENGTH_RANGE = { min: 43, max: 128 } as const
