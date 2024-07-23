/**
 * Invalid options error.
 *
 * @public
 */
export class OptionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OptionsError'
  }
}

/**
 * Invalid URL error.
 *
 *  @public
 */
export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}
