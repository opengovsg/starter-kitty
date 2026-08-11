// RFC 7636 unreserved character set: ALPHA / DIGIT / "-" / "." / "_" / "~"
export const PKCE_VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

// RFC 7636 caps the verifier at 43-128 characters. Longer is strictly more
// entropy, so this isn't exposed as a tunable.
export const PKCE_VERIFIER_LENGTH = 128
