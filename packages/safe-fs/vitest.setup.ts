import { vol } from 'memfs'
import { beforeEach, vi } from 'vitest'

vi.mock('node:fs', async () => {
  const memfs: { fs: typeof fs } = await vi.importActual('memfs')

  return {
    default: {
      ...memfs.fs,
    },
  }
})

vi.mock('node:fs/promises', async () => {
  const memfs: { fs: typeof fs } = await vi.importActual('memfs')

  return {
    default: {
      ...memfs.fs.promises,
    },
  }
})

beforeEach(() => {
  // reset the state of in-memory fs
  vol.reset()
})
