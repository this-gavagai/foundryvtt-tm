import { describe, it, expect } from 'vitest'
import { ImagePrepareError, prepareImageForUpload } from '@/utils/imageUpload'

// These cover the up-front validation guards, which run before any canvas /
// bitmap decode — so they're exercisable without a DOM image pipeline. The
// downscale path itself needs a real browser canvas and is left to manual /
// e2e verification.
describe('prepareImageForUpload guards', () => {
  it('rejects an unsupported file type with kind "invalid"', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.pdf', { type: 'application/pdf' })
    await expect(prepareImageForUpload(file)).rejects.toMatchObject({
      name: 'ImagePrepareError',
      kind: 'invalid'
    })
  })

  it('rejects a file with no type as "invalid"', async () => {
    const file = new File([new Uint8Array([1])], 'mystery', { type: '' })
    await expect(prepareImageForUpload(file)).rejects.toBeInstanceOf(ImagePrepareError)
  })

  it('rejects an over-large source image with kind "too-large"', async () => {
    // Fake a 26 MB JPEG without allocating it: override the size getter.
    const file = new File([new Uint8Array([1, 2, 3])], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 })
    await expect(prepareImageForUpload(file)).rejects.toMatchObject({ kind: 'too-large' })
  })
})
