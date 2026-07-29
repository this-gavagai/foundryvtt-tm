import { describe, it, expect } from 'vitest'
import {
  ImagePrepareError,
  imageFileFromTransfer,
  prepareImageForUpload
} from '@/utils/imageUpload'

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

describe('imageFileFromTransfer', () => {
  const png = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })

  it('returns the first image file from clipboard items (pasted screenshot)', () => {
    const data = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => png }
      ]
    }
    expect(imageFileFromTransfer(data)).toBe(png)
  })

  it('falls back to files when items carry no image', () => {
    const data = { items: [], files: [png] }
    expect(imageFileFromTransfer(data)).toBe(png)
  })

  it('returns null for a text-only paste', () => {
    const data = { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }
    expect(imageFileFromTransfer(data)).toBeNull()
  })

  it('returns null for null/undefined data', () => {
    expect(imageFileFromTransfer(null)).toBeNull()
    expect(imageFileFromTransfer(undefined)).toBeNull()
  })
})
