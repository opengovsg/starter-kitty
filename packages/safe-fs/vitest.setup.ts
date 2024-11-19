import { vi } from 'vitest'

vi.mock('fs', async () => {
  const memfs: { fs: typeof fs } = await vi.importActual('memfs')

  return {
    default: {
      ...memfs.fs,
    },
  }
})

vi.mock('fs/promises', async () => {
  const memfs: { fs: typeof fs } = await vi.importActual('memfs')

  return {
    default: {
      ...memfs.fs.promises,
    },
  }
})
