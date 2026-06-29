import { describe, expect, it } from 'vitest'

import { MAX_CONTEXT_CHARS, serializeContext } from '../context.js'

describe('serializeContext', () => {
  it('passes a normal context through unchanged with no emissions', () => {
    const ctx = { foo: 'bar', n: 1 }
    expect(serializeContext(ctx)).toEqual({ context: ctx, emissions: [] })
  })

  it('returns undefined for an undefined context', () => {
    expect(serializeContext(undefined)).toEqual({ context: undefined, emissions: [] })
  })

  it('drops an empty object to undefined (no noisy `context: {}`)', () => {
    expect(serializeContext({})).toEqual({ context: undefined, emissions: [] })
  })

  it('drops an oversized context and emits a size warning plus chunks', () => {
    // 25 x's => JSON `{"blob":"xxxx..."}` is 36 chars; at maxChars 10 => 4 chunks.
    const ctx = { blob: 'x'.repeat(25) }
    const stringified = JSON.stringify(ctx)
    const { context, emissions } = serializeContext(ctx, 10)

    expect(context).toEqual({ logger: '[Context removed]' })

    // 1 size warning + ceil(36/10) = 4 chunk emissions.
    expect(emissions).toHaveLength(5)

    const [sizeWarning, ...chunks] = emissions
    expect(sizeWarning).toEqual({
      level: 'warn',
      message: 'Log context is too large',
      context: { size: stringified.length },
    })

    expect(chunks).toHaveLength(4)
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.level).toBe('warn')
      expect(chunk.message).toBe('Removed context')
      expect(chunk.context).toMatchObject({ chunk: i + 1, chunks: 4 })
      expect(String(chunk.context?.data).length).toBeLessThanOrEqual(10)
    }
    // The chunks reconstruct the original serialised context exactly.
    expect(chunks.map(c => c.context?.data).join('')).toBe(stringified)
  })

  it('drops an unserialisable (circular) context and emits a single error', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(serializeContext(circular)).toEqual({
      context: { logger: '[Context removed]' },
      emissions: [{ level: 'error', message: 'Failed to serialise log context' }],
    })
  })

  it('uses the 200kB default threshold when none is given', () => {
    const justUnder = { blob: 'x'.repeat(MAX_CONTEXT_CHARS - 100) }
    expect(serializeContext(justUnder).emissions).toEqual([])

    const over = { blob: 'x'.repeat(MAX_CONTEXT_CHARS) }
    expect(serializeContext(over).context).toEqual({ logger: '[Context removed]' })
  })
})
