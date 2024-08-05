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
