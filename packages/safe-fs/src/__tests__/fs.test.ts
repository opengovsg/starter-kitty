import { describe, expect, it } from 'vitest'

import { Overrides } from '@/overrides'

describe('createFs with default options', () => {
  const fs = new Overrides('/')

  it('should return correct text', () => {
    fs.writeFileSync('meaning_of_life.txt', '42')
    const text = fs.readFileSync('meaning_of_life.txt', 'utf8')
    expect(text).toBe('42')
  })
})
