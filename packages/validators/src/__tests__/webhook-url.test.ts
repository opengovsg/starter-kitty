import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebhookUrlSchema, webhookUrlSchema, WebhookUrlValidator } from '@/index'
import { WebhookUrlValidationError } from '@/webhook-url/errors'

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

  it('should reject known cloud metadata hostnames', () => {
    expect(() => webhookUrlSchema.parse('http://metadata.google.internal')).toThrow()
    expect(() => webhookUrlSchema.parse('http://metadata/computeMetadata/v1/')).toThrow()
  })

  it('should reject literal loopback, private, and link-local/metadata IPv4 addresses', () => {
    expect(() => webhookUrlSchema.parse('http://127.0.0.1')).toThrow()
    expect(() => webhookUrlSchema.parse('http://10.1.2.3')).toThrow()
    expect(() => webhookUrlSchema.parse('http://172.16.0.5')).toThrow()
    expect(() => webhookUrlSchema.parse('http://192.168.1.1')).toThrow()
    expect(() => webhookUrlSchema.parse('http://169.254.169.254')).toThrow() // cloud metadata endpoint
  })

  it('should reject obfuscated (decimal/octal/hex/short-form) IPv4 loopback addresses', () => {
    expect(() => webhookUrlSchema.parse('http://2130706433')).toThrow() // decimal for 127.0.0.1
    expect(() => webhookUrlSchema.parse('http://0x7f.0.0.1')).toThrow()
    expect(() => webhookUrlSchema.parse('http://017700000001')).toThrow()
    expect(() => webhookUrlSchema.parse('http://127.1')).toThrow()
  })

  it('should reject literal IPv6 loopback, unique-local, and link-local addresses', () => {
    expect(() => webhookUrlSchema.parse('http://[::1]')).toThrow()
    expect(() => webhookUrlSchema.parse('http://[fc00::1]')).toThrow()
    expect(() => webhookUrlSchema.parse('http://[fe80::1]')).toThrow()
  })

  it('should reject IPv4-mapped IPv6 addresses that embed a blocked IPv4 address', () => {
    expect(() => webhookUrlSchema.parse('http://[::ffff:127.0.0.1]')).toThrow()
    expect(() => webhookUrlSchema.parse('http://[::ffff:169.254.169.254]')).toThrow()
  })

  it('should allow an IPv4-mapped IPv6 address that embeds a public IPv4 address', () => {
    expect(() => webhookUrlSchema.parse('http://[::ffff:8.8.8.8]')).not.toThrow()
  })

  it('should allow public IPv6 addresses', () => {
    expect(() => webhookUrlSchema.parse('http://[2606:4700:4700::1111]')).not.toThrow()
  })

  it('should support restricting protocols via createWebhookUrlSchema', () => {
    const schema = createWebhookUrlSchema({ protocols: ['https'] })
    expect(() => schema.parse('https://example.com')).not.toThrow()
    expect(() => schema.parse('http://example.com')).toThrow()
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('should perform the request with redirect set to error, using the validated URL', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const validator = new WebhookUrlValidator({ lookup })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await validator.fetch('https://example.com/hooks', { method: 'POST' })

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

  it('should not call fetch when validation fails', async () => {
    const validator = new WebhookUrlValidator()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    await expect(validator.fetch('http://127.0.0.1/hooks')).rejects.toThrow(WebhookUrlValidationError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
