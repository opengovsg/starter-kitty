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
