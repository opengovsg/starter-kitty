import { describe, expect, it, vi } from 'vitest'

describe('package root', () => {
  it('does not pull in Node-only DNS/net APIs (safe for browser/edge bundles)', async () => {
    vi.doMock('node:dns/promises', () => {
      throw new Error("Cannot find module 'node:dns/promises'")
    })
    vi.doMock('node:net', () => {
      throw new Error("Cannot find module 'node:net'")
    })

    // if the root barrel still transitively required either mocked module, this import would throw
    const rootExports = await import('@/index')

    expect(rootExports).toHaveProperty('createUrlSchema')
    expect(rootExports).not.toHaveProperty('webhookUrlSchema')
    expect(rootExports).not.toHaveProperty('WebhookUrlValidator')
  })
})
