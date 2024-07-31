/**
 * Invalid email error.
 *
 *  @public
 */
export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailValidationError'
  }
}
