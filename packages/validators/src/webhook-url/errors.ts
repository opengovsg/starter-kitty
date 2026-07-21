/**
 * Invalid or unsafe webhook URL error.
 *
 * @public
 */
export class WebhookUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookUrlValidationError'
  }
}
