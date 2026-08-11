/**
 * Framework-agnostic building blocks for a safe-by-default OTP login flow:
 * PKCE-style session binding and one-time-password generation/verification.
 *
 * This root entry point re-exports only the parts that are safe to bundle
 * into a browser: {@link createPkceVerifier}, {@link createPkceChallenge},
 * {@link isValidCodeChallenge}, and the OTP constants/error type. The
 * Node-only verify orchestration lives at `@opengovsg/auth/server/otp` —
 * import it there so `node:crypto` never reaches a client bundle.
 *
 * @packageDocumentation
 */

export { OTP_DEFAULTS } from './otp/constants.js'
export type { OtpResult, OtpVerificationErrorCode } from './otp/errors.js'
export { OtpVerificationError } from './otp/errors.js'
export { createPkceChallenge, createPkceVerifier, isValidCodeChallenge } from './pkce/index.js'
