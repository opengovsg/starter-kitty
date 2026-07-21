import { describe, expect, it } from 'vitest'

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

describe('WebhookUrlValidator.assertResolvedIpsAreSafe', () => {
  const validator = new WebhookUrlValidator()

  it('should pass through a hostname whose resolved addresses are all public', () => {
    const url = validator.assertResolvedIpsAreSafe('https://example.com/hooks', ['93.184.216.34'])
    expect(url).toBeInstanceOf(URL)
  })

  it('should reject a hostname that resolves to a private IP (DNS rebinding)', () => {
    expect(() => validator.assertResolvedIpsAreSafe('https://sneaky-webhook.example.com/hooks', ['10.0.0.5'])).toThrow(
      WebhookUrlValidationError,
    )
  })

  it('should reject if any of multiple resolved IPs is blocked', () => {
    expect(() =>
      validator.assertResolvedIpsAreSafe('https://multi-a-record.example.com', ['93.184.216.34', '169.254.169.254']),
    ).toThrow(WebhookUrlValidationError)
  })

  it('should reject if no resolved IPs are given', () => {
    expect(() => validator.assertResolvedIpsAreSafe('https://does-not-resolve.example.com', [])).toThrow(
      WebhookUrlValidationError,
    )
  })

  it('should reject an obvious blocked target without needing resolved IPs', () => {
    expect(() => validator.assertResolvedIpsAreSafe('http://localhost/hooks', ['93.184.216.34'])).toThrow(
      WebhookUrlValidationError,
    )
  })
})
