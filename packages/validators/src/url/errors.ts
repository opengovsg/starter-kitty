export class OptionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OptionsError'
  }
}

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}
