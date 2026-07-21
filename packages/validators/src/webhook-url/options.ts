export const defaultWebhookProtocols: readonly string[] = ['http', 'https']

/**
 * The options to use for webhook URL validation.
 *
 * @public
 */
export interface WebhookUrlValidatorOptions {
  /**
   * The list of allowed protocols for webhook destination URLs.
   *
   * @defaultValue ['http', 'https']
   */
  protocols?: string[]
}

export interface ParsedWebhookUrlValidatorOptions {
  protocols: readonly string[]
}

export const parseOptions = (options: WebhookUrlValidatorOptions = {}): ParsedWebhookUrlValidatorOptions => ({
  protocols: options.protocols ?? defaultWebhookProtocols,
})
