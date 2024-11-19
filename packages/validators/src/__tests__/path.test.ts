import path from 'path'

import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { OptionsError } from '@/common/errors'
import { createPathSchema } from '@/index'

describe('Path validator with current working directory', () => {
  const schema = createPathSchema({ basePath: process.cwd() })

  it('should allow a valid path', () => {
    expect(() => schema.parse('valid/path')).not.toThrow()
    expect(() => schema.parse('valid/nested/path')).not.toThrow()
    expect(() => schema.parse('.')).not.toThrow(ZodError)
  })

  it('should trim the path', () => {
    expect(schema.parse('  valid/path  ')).toBe(path.join(process.cwd(), 'valid/path'))
  })

  it('should not allow directory traversal', () => {
    expect(() => schema.parse('../etc/passwd')).toThrow(ZodError)
    expect(() => schema.parse('..')).toThrow(ZodError)
    expect(() => schema.parse('../')).toThrow(ZodError)
    expect(() => schema.parse('..\\')).toThrow(ZodError)
    expect(() => schema.parse('..././')).toThrow(ZodError)
  })

  it('should handle paths with special characters', () => {
    expect(() => schema.parse('path with spaces')).not.toThrow()
    expect(() => schema.parse('path_with_underscores')).not.toThrow()
    expect(() => schema.parse('path-with-hyphens')).not.toThrow()
    expect(() => schema.parse('path.with.dots')).not.toThrow()
  })

  it('should handle paths with non-ASCII characters', () => {
    expect(() => schema.parse('パス')).not.toThrow()
    expect(() => schema.parse('путь')).not.toThrow()
    expect(() => schema.parse('路径')).not.toThrow()
  })

  it('should handle absolute paths', () => {
    const absolutePath = path.resolve('/absolute/path')
    expect(() => schema.parse(absolutePath)).toThrow(ZodError)

    const cwd = process.cwd()
    expect(path.isAbsolute(cwd)).toBe(true)
    expect(() => schema.parse(cwd)).not.toThrow(ZodError)
  })
})

describe('Path validator with different directory', () => {
  const schema = createPathSchema({ basePath: '/var/www' })

  it('should allow a valid path within the base path', () => {
    expect(() => schema.parse('../'.repeat(process.cwd().split('/').length) + 'var/www')).not.toThrow()
    expect(() => schema.parse('/var/www')).not.toThrow()
    expect(() => schema.parse('/var/www/valid/path')).not.toThrow()
    expect(() => schema.parse('/var/www/valid/nested/path')).not.toThrow()
  })

  it('should not allow paths outside the base path', () => {
    expect(() => schema.parse('/etc/passwd')).toThrow(ZodError)
    expect(() => schema.parse('/var/log/app.log')).toThrow(ZodError)
    expect(() => schema.parse('/var/www/../etc/passwd')).toThrow(ZodError)
  })
})

describe('Path validator with invalid options', () => {
  it('should throw an error for missing options', () => {
    // @ts-expect-error Testing invalid options
    expect(() => createPathSchema()).toThrow(OptionsError)
  })
  it('should throw an error for an invalid base path', () => {
    expect(() => createPathSchema({ basePath: 'relative/path' })).toThrow(OptionsError)
    expect(() => createPathSchema({ basePath: '' })).toThrow(OptionsError)
    expect(() => createPathSchema({ basePath: '.' })).toThrow(OptionsError)
  })

  it('should throw an error for non-string base paths', () => {
    // @ts-expect-error Testing invalid options
    expect(() => createPathSchema({ basePath: 123 })).toThrow(OptionsError)
    // @ts-expect-error Testing invalid options
    expect(() => createPathSchema({ basePath: null })).toThrow(OptionsError)
    // @ts-expect-error Testing invalid options
    expect(() => createPathSchema({ basePath: {} })).toThrow(OptionsError)
  })
})
