import fs from 'node:fs'
import path from 'node:path'

import { vol } from 'memfs'
import { beforeEach, describe, expect, it } from 'vitest'

import { createGetter } from '@/getter'

describe('getter', () => {
  const testDir = '/tmp/test-fs-sfs'
  const getter = createGetter(testDir)
  const sfs = new Proxy<typeof fs>(fs, { get: getter })

  beforeEach(() => {
    // reset the state of in-memory fs
    vol.reset()
    sfs.mkdirSync(testDir, { recursive: true })
  })

  describe('synchronous API', () => {
    it('should write and read files correctly', () => {
      const filePath = 'test.txt'
      const content = 'Hello, World!'

      sfs.writeFileSync(filePath, content)
      const readContent = sfs.readFileSync(filePath, 'utf8')

      expect(readContent).toBe(content)
    })

    it('should append to files correctly', () => {
      const filePath = 'append-test.txt'
      const initialContent = 'Initial content\n'
      const appendedContent = 'Appended content'

      sfs.writeFileSync(filePath, initialContent)
      sfs.appendFileSync(filePath, appendedContent)

      const finalContent = sfs.readFileSync(filePath, 'utf8')
      expect(finalContent).toBe(initialContent + appendedContent)
    })

    it('should create and remove directories correctly', () => {
      const dirPath = 'test-dir'

      sfs.mkdirSync(dirPath)
      expect(sfs.existsSync(path.join(testDir, dirPath))).toBe(true)

      sfs.rmdirSync(dirPath)
      expect(sfs.existsSync(path.join(testDir, dirPath))).toBe(false)
    })

    it('should rename files correctly', () => {
      const oldPath = 'old.txt'
      const newPath = 'new.txt'
      const content = 'Rename test'

      sfs.writeFileSync(oldPath, content)
      sfs.renameSync(oldPath, newPath)

      expect(sfs.existsSync(path.join(testDir, oldPath))).toBe(false)
      expect(sfs.existsSync(path.join(testDir, newPath))).toBe(true)

      const readContent = sfs.readFileSync(newPath, 'utf8')
      expect(readContent).toBe(content)
    })

    it('should get file stats correctly', () => {
      const filePath = 'stat-test.txt'
      const content = 'Stat test'

      sfs.writeFileSync(filePath, content)
      const stats = sfs.statSync(filePath)

      expect(stats.isFile()).toBe(true)
      expect(stats.size).toBe(content.length)
    })
  })

  describe('asynchronous API', () => {
    it('should write and read files correctly', async () => {
      const filePath = 'async-test.txt'
      const content = 'Async Hello, World!'

      await new Promise<void>((resolve, reject) => {
        sfs.writeFile(filePath, content, err => {
          if (err) reject(err)
          else resolve()
        })
      })

      const readContent = await new Promise<string>((resolve, reject) => {
        sfs.readFile(filePath, 'utf8', (err, data) => {
          if (err) reject(err)
          else resolve(data)
        })
      })

      expect(readContent).toBe(content)
    })

    it('should append to files correctly', async () => {
      const filePath = 'async-append-test.txt'
      const initialContent = 'Initial async content\n'
      const appendedContent = 'Appended async content'

      await new Promise<void>((resolve, reject) => {
        sfs.writeFile(filePath, initialContent, err => {
          if (err) reject(err)
          else resolve()
        })
      })

      await new Promise<void>((resolve, reject) => {
        sfs.appendFile(filePath, appendedContent, err => {
          if (err) reject(err)
          else resolve()
        })
      })

      const finalContent = await new Promise<string>((resolve, reject) => {
        sfs.readFile(filePath, 'utf8', (err, data) => {
          if (err) reject(err)
          else resolve(data)
        })
      })

      expect(finalContent).toBe(initialContent + appendedContent)
    })
  })

  describe('security tests', () => {
    beforeEach(() => {
      const sensitiveDir = '/etc'

      vol.reset()
      vol.mkdirSync(sensitiveDir, { recursive: true })
    })

    it('should prevent path traversal attempts', () => {
      const maliciousPath = '../../../etc/passwd'
      const content = 'Malicious content'

      expect(() => sfs.writeFileSync(maliciousPath, content)).toThrow()
      expect(() => sfs.readFileSync(maliciousPath)).toThrow()
      expect(() => sfs.mkdirSync(maliciousPath)).toThrow()
      expect(() => sfs.rmdirSync(maliciousPath)).toThrow()
      expect(() => sfs.unlinkSync(maliciousPath)).toThrow()
      expect(() => sfs.renameSync(maliciousPath, 'new.txt')).toThrow()
      expect(() => sfs.renameSync('old.txt', maliciousPath)).toThrow()
      expect(() => sfs.statSync(maliciousPath)).toThrow()
    })

    it('should prevent absolute path usage', () => {
      const absolutePath = '/etc/passwd'
      const content = 'Absolute path content'

      expect(() => sfs.writeFileSync(absolutePath, content)).toThrow()
      expect(() => sfs.readFileSync(absolutePath)).toThrow()
      expect(() => sfs.mkdirSync(absolutePath)).toThrow()
      expect(() => sfs.rmdirSync(absolutePath)).toThrow()
      expect(() => sfs.unlinkSync(absolutePath)).toThrow()
      expect(() => sfs.renameSync(absolutePath, 'new.txt')).toThrow()
      expect(() => sfs.renameSync('old.txt', absolutePath)).toThrow()
      expect(() => sfs.statSync(absolutePath)).toThrow()
    })

    it('should allow operations within the base path', () => {
      const sfs2 = new Proxy<typeof fs>(fs, { get: createGetter('/etc') }) // unsafe usage of the library
      const maliciousPath = 'passwd'
      const content = 'Valid content'

      expect(() => sfs2.writeFileSync(maliciousPath, content)).not.toThrow()
      expect(() => sfs2.readFileSync(maliciousPath)).not.toThrow()
      expect(() => sfs2.renameSync(maliciousPath, 'new.txt')).not.toThrow()
      expect(() => sfs2.statSync('new.txt')).not.toThrow()
      expect(() => sfs2.unlinkSync('new.txt')).not.toThrow()

      const validPath = 'valid/nested/path.txt'
      const newPath = 'valid/new.txt'

      expect(() => sfs.mkdirSync('valid/nested', { recursive: true })).not.toThrow()
      expect(() => sfs.writeFileSync(validPath, content)).not.toThrow()
      expect(() => sfs.readFileSync(validPath)).not.toThrow()
      expect(() => sfs.renameSync(validPath, newPath)).not.toThrow()
      expect(() => sfs.statSync(newPath)).not.toThrow()
      expect(() => sfs.unlinkSync(newPath)).not.toThrow()
      expect(() => sfs.rmdirSync('valid/nested')).not.toThrow()
    })
  })
})
