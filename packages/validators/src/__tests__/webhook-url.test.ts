import { afterEach, describe, expect, it, vi } from 'vitest'

import { webhookUrlSchema, WebhookUrlValidator } from '@/server/webhook-url'
import { WebhookUrlValidationError } from '@/server/webhook-url/errors'

describe('webhookUrlSchema', () => {
  it('should allow a normal public https URL', () => {
    expect(() => webhookUrlSchema.parse('https://example.com/hooks/incoming')).not.toThrow()
  })

  it('should reject non-http(s) protocols', () => {
    expect(() => webhookUrlSchema.parse('ftp://example.com')).toThrow()
    expect(() => webhookUrlSchema.parse('file:///etc/passwd')).toThrow()
  })

  it('should reject localhost and its reserved subdomains', () => {
    expect(() => webhookUrlSchema.parse('http://localhost')).toThrow()
    expect(() => webhookUrlSchema.parse('http://foo.localhost')).toThrow()
    expect(() => webhookUrlSchema.parse('http://LOCALHOST:3000')).toThrow()
  })

  it('should reject the bare cloud-metadata hostname alias (single-label, not a domain)', () => {
    expect(() => webhookUrlSchema.parse('http://metadata/computeMetadata/v1/')).toThrow()
  })

  it('should reject every literal IP address, public or private, in any form', () => {
    // z.httpUrl() only accepts domain-shaped hostnames - no literal IP survives the sync schema at
    // all, so a hostname's *resolved* address is the only place a literal IP is checked (see
    // WebhookUrlValidator.validateAsync tests) - including metadata.google.internal, which is a
    // syntactically valid domain and is only caught once it resolves to 169.254.169.254.
    expect(() => webhookUrlSchema.parse('http://127.0.0.1')).toThrow() // loopback
    expect(() => webhookUrlSchema.parse('http://10.1.2.3')).toThrow() // RFC 1918
    expect(() => webhookUrlSchema.parse('http://169.254.169.254')).toThrow() // cloud metadata IP
    expect(() => webhookUrlSchema.parse('http://8.8.8.8')).toThrow() // public IPv4
    expect(() => webhookUrlSchema.parse('http://2130706433')).toThrow() // decimal-encoded 127.0.0.1
    expect(() => webhookUrlSchema.parse('http://0x7f.0.0.1')).toThrow() // hex-encoded
    expect(() => webhookUrlSchema.parse('http://017700000001')).toThrow() // octal-encoded
    expect(() => webhookUrlSchema.parse('http://[::1]')).toThrow() // IPv6 loopback
    expect(() => webhookUrlSchema.parse('http://[::ffff:127.0.0.1]')).toThrow() // IPv4-mapped IPv6
    expect(() => webhookUrlSchema.parse('http://[2606:4700:4700::1111]')).toThrow() // public IPv6
  })
})

describe('WebhookUrlValidator.validate', () => {
  const validator = new WebhookUrlValidator()

  it('should return a URL instance for a valid webhook URL', () => {
    expect(validator.validate('https://example.com/hooks')).toBeInstanceOf(URL)
  })

  it('should throw WebhookUrlValidationError for an obvious blocked target', () => {
    expect(() => validator.validate('http://127.0.0.1/hooks')).toThrow(WebhookUrlValidationError)
  })
})

describe('WebhookUrlValidator.validateAsync', () => {
  it('should resolve and pass through a hostname that only resolves to public IPs', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })

    const url = await validator.validateAsync('https://example.com/hooks')
    expect(url).toBeInstanceOf(URL)
    expect(lookup).toHaveBeenCalledWith('example.com')
  })

  it('should reject a hostname that resolves to a private IP (DNS rebinding)', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })

    await expect(validator.validateAsync('https://sneaky-webhook.example.com/hooks')).rejects.toThrow(
      WebhookUrlValidationError,
    )
  })

  it('should reject metadata.google.internal once it resolves to the cloud metadata IP', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })

    await expect(validator.validateAsync('http://metadata.google.internal')).rejects.toThrow(WebhookUrlValidationError)
  })

  it('should reject if any of multiple resolved IPs is blocked', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    const validator = new WebhookUrlValidator({ lookup })

    await expect(validator.validateAsync('https://multi-a-record.example.com')).rejects.toThrow(
      WebhookUrlValidationError,
    )
  })

  it('should reject if DNS resolution fails', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const validator = new WebhookUrlValidator({ lookup })

    await expect(validator.validateAsync('https://does-not-resolve.example.com')).rejects.toThrow(
      WebhookUrlValidationError,
    )
  })

  it('should reject an obvious blocked target before even attempting DNS resolution', async () => {
    const lookup = vi.fn()
    const validator = new WebhookUrlValidator({ lookup })

    await expect(validator.validateAsync('http://localhost/hooks')).rejects.toThrow(WebhookUrlValidationError)
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('WebhookUrlValidator.fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should validate then perform the request with redirect forced to error', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await validator.fetch('https://example.com/hooks', { method: 'POST' })

    expect(lookup).toHaveBeenCalledWith('example.com')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]
    expect(String(calledUrl)).toBe('https://example.com/hooks')
    expect(calledInit).toMatchObject({ method: 'POST', redirect: 'error' })
  })

  it('should not allow the caller to override redirect handling', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    // intentionally passing a disallowed redirect mode to prove it gets overridden
    await validator.fetch('https://example.com/hooks', { redirect: 'follow' })

    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })

  it('should not call fetch when sync validation fails', async () => {
    const validator = new WebhookUrlValidator()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await expect(validator.fetch('http://127.0.0.1/hooks')).rejects.toThrow(WebhookUrlValidationError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should not call fetch when the resolved IP is blocked', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await expect(validator.fetch('https://sneaky-webhook.example.com/hooks')).rejects.toThrow(WebhookUrlValidationError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should throw a clear, actionable error when the destination responds with a redirect', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    // this is the exact TypeError shape undici's fetch throws for `redirect: 'error'` on a 3xx response
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
    )

    await expect(validator.fetch('https://example.com/hooks')).rejects.toThrow(WebhookUrlValidationError)
    await expect(validator.fetch('https://example.com/hooks')).rejects.toThrow(/redirected/)
  })

  it('should not mask an unrelated fetch failure as a redirect error', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    const connectionError = new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(connectionError)

    await expect(validator.fetch('https://example.com/hooks')).rejects.toBe(connectionError)
  })
})
